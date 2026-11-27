import json

from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db import transaction
from django.http.response import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views import generic as views

from progress.models import AdventureNote, Enrollment, ObjectiveProgress
from progress.services import get_questline_progress
from questlines.models import Objective, Quest, Questline
from questlines.validation import validate_questline


class AdventureView(LoginRequiredMixin, views.DetailView):
    model = Enrollment
    template_name = "progress/adventure.html"

    def get_object(self, queryset=None):
        user_enrollments_queryset = (
            super().get_queryset().filter(enrolled_user=self.request.user)
        )
        return super().get_object(user_enrollments_queryset)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["progress"] = get_questline_progress(self.object)
        # Building the adventure note and their related quest lookup (key-value pairs)
        adventure_notes_by_quest_id = {
            note.quest_id: note.content for note in self.object.adventurenote_set.all()
        }
        # Values shared by every quest are stored once, at the top level
        adventure_data = {
            "main_quest_total": context["progress"]["quests_summary"]["main_total"],
            "quests": {},
        }
        # Keeping count of every main quest for the "Quest X of Y" label
        main_index = 1
        for quest_state in context["progress"]["quests"].values():
            quest = quest_state["quest"]

            if not quest.is_optional:
                quest_state["main_index"] = main_index
                main_index += 1

            # Add the update url to each objective so JS knows what endpoint to use to send the new objective data to the BE
            for objective_id, objective_state in quest_state["objectives"].items():
                objective_state["update_url"] = reverse(
                    "update-objective-progress",
                    kwargs={
                        "enrollment_pk": self.object.id,
                        "objective_pk": objective_id,
                    },
                )

            prerequisites = quest.prerequisite_quests.all()
            # Plain, JSON-safe copy of everything JS reads for this quest; json_script serializes it once in the template
            adventure_data["quests"][quest.id] = {
                "index": quest_state.get("main_index"),
                "title": quest.title,
                "description": quest.description,
                "is_optional": quest.is_optional,
                "is_unlocked": quest_state["is_unlocked"],
                "is_done": quest_state["effective_complete"],
                "is_invalid": quest.id in context["progress"]["invalid_quests"],
                "prerequisite_ids": [prerequisite.id for prerequisite in prerequisites],
                "prerequisite_titles": [
                    prerequisite.title for prerequisite in prerequisites
                ],
                # objective_progress is only read by the template's quick view, so it stays out of the JavaScript payload
                "objectives": {
                    objective_id: {
                        key: value
                        for key, value in objective_state.items()
                        if key != "objective_progress"
                    }
                    for objective_id, objective_state in quest_state[
                        "objectives"
                    ].items()
                },
                # A quest without a saved note gets an empty string
                "adventure_note_content": adventure_notes_by_quest_id.get(quest.id, ""),
                # The endpoint JS sends this quest's new Adventure Note to
                "adventure_note_update_url": reverse(
                    "update-adventure-note",
                    kwargs={
                        "enrollment_pk": self.object.id,
                        "quest_pk": quest.id,
                    },
                ),
            }

        context["adventure_data"] = adventure_data
        return context


class StartAdventureView(LoginRequiredMixin, views.View):
    # 1. Keep Enrollment and initial progress creation in one transaction.
    @transaction.atomic
    def post(self, request, pk):
        # 2. Restrict Start to the user's playable Questlines.
        eligible_questlines = Questline.objects.filter(
            author=request.user,
            status__in=[Questline.Status.PRIVATE, Questline.Status.PUBLIC],
        )
        # 3. Resolve the requested eligible Questline or return 404.
        questline = get_object_or_404(eligible_questlines, pk=pk)

        # Backup guard - in case questlines somehow avoid the guard from Draft to Private/Public, check whether non-started quests are valid
        is_started = Enrollment.objects.filter(
            enrolled_user=request.user, questline=questline
        ).exists()

        if not is_started:
            questline_errors = validate_questline(questline)
            if questline_errors:
                for error in questline_errors:
                    messages.error(
                        self.request, error["message"], extra_tags=error["error_type"]
                    )

                return redirect("home")

        # 4. Reuse an existing run or create the user's first Enrollment.
        enrollment, created = Enrollment.objects.get_or_create(
            enrolled_user=request.user, questline=questline
        )

        # 5. Initialize ObjectiveProgress only for a new Enrollment.
        if created:
            # 6. Load every Objective and join Slider-specific values in the same query.
            objectives = Objective.objects.filter(
                quest__questline=questline
            ).select_related("sliderobjective")

            progress_rows = []

            for objective in objectives:
                # 7. Checklists have no numeric value; Sliders start at their minimum.
                current_value = None

                if objective.objective_type == "sliderobjective":
                    current_value = objective.sliderobjective.min_value

                # 8. Prepare each unsaved initial progress row.
                progress_rows.append(
                    ObjectiveProgress(
                        enrollment=enrollment,
                        objective=objective,
                        current_value=current_value,
                    )
                )
            # 9. Insert all initial progress rows together.
            ObjectiveProgress.objects.bulk_create(progress_rows)

        return redirect("adventure", pk=enrollment.pk)


class UpdateObjectiveProgressView(LoginRequiredMixin, views.View):
    def post(self, request, enrollment_pk, objective_pk):
        # 1. Get this user's Enrollment from the ID in the URL.
        enrollment = get_object_or_404(
            Enrollment,
            pk=enrollment_pk,  # Match the Enrollment ID from the URL.
            enrolled_user=request.user,  # Make sure the Enrollment belongs to this user.
        )

        # 2. Get the Objective only if it belongs to this Enrollment's Questline.
        objective = get_object_or_404(
            Objective,
            pk=objective_pk,  # Match the Objective ID from the URL.
            # Objective -> its Quest -> the same Questline as the Enrollment.
            quest__questline=enrollment.questline,
        )

        # Check the quest's state before saving, we need to verify no curl has altered the state before we try to save it
        enrollment_state = get_questline_progress(enrollment)
        quest_is_unlocked = enrollment_state["quests"][objective.quest_id][
            "is_unlocked"
        ]

        if not quest_is_unlocked:
            return JsonResponse(
                {"error": "Quest is not unlocked, cannot update objective value"},
                status=400,
            )

        # 3. The unique Enrollment + Objective pair identifies the user's progress row.
        objective_progress = get_object_or_404(
            ObjectiveProgress,
            enrollment=enrollment,
            objective=objective,
        )

        if objective.objective_type == "checklistobjective":
            is_complete_string = request.POST.get("is_complete")

            allowed_values = {"true", "false"}
            if is_complete_string not in allowed_values:
                return JsonResponse({"error": "Invalid checklist value."}, status=400)

            is_complete = True if is_complete_string == "true" else False

            objective_progress.is_complete = is_complete
            objective_progress.save()
        elif objective.objective_type == "sliderobjective":
            slider_objective = objective.sliderobjective
            current_value_string = request.POST.get("current_value")
            try:
                current_value = int(current_value_string)
            except (TypeError, ValueError):
                return JsonResponse(
                    {"error": "Invalid value type for slider objective."}, status=400
                )
            if (
                not slider_objective.min_value
                <= current_value
                <= slider_objective.goal_value
            ):
                return JsonResponse(
                    {"error": "Slider objective value is out of range."}, status=400
                )

            objective_progress.current_value = current_value
            if objective_progress.current_value >= slider_objective.goal_value:
                objective_progress.is_complete = True
            else:
                objective_progress.is_complete = False

            objective_progress.save()
        else:
            return JsonResponse({"error": "Unsupported objective type."}, status=400)

        # Send the recalculated, JSON-safe UI state to JavaScript.
        updated_state = get_questline_progress(enrollment)
        changed_objective = updated_state["quests"][objective.quest_id]["objectives"][
            objective.id
        ]
        updated_state_json = {
            "changed_objective": {
                "id": objective.id,
                "quest_id": objective.quest_id,
                "is_complete": changed_objective["is_complete"],
                "current_value": changed_objective["current_value"],
            },
            "quests": {
                quest_id: {
                    "is_unlocked": quest_state["is_unlocked"],
                    "effective_complete": quest_state["effective_complete"],
                }
                for quest_id, quest_state in updated_state["quests"].items()
            },
            "quests_summary": updated_state["quests_summary"],
            "main_questline_progress_ratio": updated_state[
                "main_questline_progress_ratio"
            ],
            "optional_questline_progress_ratio": updated_state[
                "optional_questline_progress_ratio"
            ],
        }
        return JsonResponse(updated_state_json, status=200)


class UpdateAdventureNoteView(LoginRequiredMixin, views.View):
    model = AdventureNote

    def post(self, request, enrollment_pk, quest_pk):
        enrollment = get_object_or_404(
            Enrollment,
            pk=enrollment_pk,
            enrolled_user=request.user,
        )
        quest = get_object_or_404(Quest, pk=quest_pk, questline=enrollment.questline)

        data = json.loads(request.body)
        content_data = data["content"]

        if content_data == "":
            self.model.objects.filter(enrollment=enrollment, quest=quest).delete()
            return JsonResponse({"success": True}, status=200)

        note, created = self.model.objects.update_or_create(
            enrollment=enrollment,
            quest=quest,
            defaults={
                "content": content_data
            },  # defaults is the value setting argument
        )

        return JsonResponse({"success": True}, status=200)
