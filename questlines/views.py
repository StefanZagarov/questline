from django.contrib.auth.mixins import LoginRequiredMixin
from django.db import transaction
from django.http import JsonResponse
from django.http.response import HttpResponse
from django.shortcuts import get_object_or_404, redirect
from django.urls import reverse, reverse_lazy
from django.views import generic as views

from questlines.forms import (
    CreateQuestlineForm,
    MoveQuestForm,
    QuestForm,
    QuestlineStatusForm,
)
from questlines.mixins import ObjectiveSaveMixin
from questlines.models import ChecklistObjective, Quest, Questline, SliderObjective

# The quest views are AJAX-only: the map's drawer POSTs to them and they answer
# with JSON, never a page. LoginRequiredMixin proves WHO you are; the get_queryset
# / get_object_or_404 filters decide WHICH rows you may touch.


# LoginRequiredMiddleware could guard every view automatically, but then login and
# register would each need an opt-out mixin.
class CreateQuestlineView(LoginRequiredMixin, views.CreateView):
    model = Questline
    form_class = CreateQuestlineForm
    template_name = "questlines/questline-create.html"
    success_url = reverse_lazy("home")

    def form_valid(self, form):
        form.instance.author = self.request.user  # the one field the form can't ask for
        return super().form_valid(form)


# Deep copy a questline
class AcceptQuestlineView(LoginRequiredMixin, views.View):
    # 0. Rollback boundary - making the copy atomic
    @transaction.atomic
    # 1. Request must be a post
    def post(self, request, pk):
        # 2. Get all questlines that are public and not the user's
        eligible_questlines = Questline.objects.filter(
            status=Questline.Status.PUBLIC
        ).exclude(author=request.user)
        # 3. Get the specific questline. `pk` comes from the route url `<int:pk>/accept/`
        source = get_object_or_404(eligible_questlines, pk=pk)
        # 4. Copy the questline - create constructs and saves the new database row immediately
        copy = Questline.objects.create(
            title=source.title,
            description=source.description,
            category=source.category,
            difficulty=source.difficulty,
            author=request.user,
            status=Questline.Status.PRIVATE,
        )
        # 5. Clone the Quest rows without prerequisites yet
        quest_map = {}
        for source_quest in source.quests.all():
            copied_quest = Quest.objects.create(
                # Copy the Quest fields from the source
                title=source_quest.title,
                description=source_quest.description,
                is_optional=source_quest.is_optional,
                note=source_quest.note,
                coord_x=source_quest.coord_x,
                coord_y=source_quest.coord_y,
                questline=copy,
            )
            # 5.1 Copy the objectives
            for source_objective in source_quest.objectives.all():
                if source_objective.objective_type == "checklistobjective":
                    ChecklistObjective.objects.create(
                        quest=copied_quest,
                        order=source_objective.order,
                        title=source_objective.title,
                        description=source_objective.description,
                    )
                elif source_objective.objective_type == "sliderobjective":
                    source_slider = source_objective.sliderobjective
                    SliderObjective.objects.create(
                        quest=copied_quest,
                        order=source_objective.order,
                        title=source_objective.title,
                        description=source_objective.description,
                        min_value=source_slider.min_value,
                        max_value=source_slider.max_value,
                        target_value=source_slider.target_value,
                    )

            quest_map[source_quest.pk] = copied_quest
        # 6. Now iterate the prerequisites
        # 6.1 Loop through every Quest belonging to the original Questline
        for source_quest in source.quests.all():
            # 6.2 Uses the original Quest’s primary key to retrieve its corresponding copied Quest
            copied_quest = quest_map[source_quest.pk]
            # 6.3 Fresh list for this copied Quest's prerequisite relationship
            copied_prerequisites = []

            # 6.4 Loops through every Quest required by the original Quest
            for source_prerequisite in source_quest.prerequisite_quests.all():
                # 6.5 Finds the copied version of each original prerequisite and adds it to the list. This prevents the new Quest from linking back to the original Questline
                copied_prerequisites.append(quest_map[source_prerequisite.pk])

            # 6.6 Replaces the copied Quest’s many-to-many prerequisite relationships with that translated list. An empty list correctly means it has no prerequisites.
            copied_quest.prerequisite_quests.set(copied_prerequisites)

        # Build the redirect url, preserve the page and the search input
        redirect_url = reverse("map-public", kwargs={"pk": source.pk})
        # Adding temporary success state to the redirect
        query_parameters = request.GET.copy()
        query_parameters["accepted"] = "1"
        query_string = query_parameters.urlencode()

        if query_string:
            redirect_url = f"{redirect_url}?{query_string}"

        return redirect(redirect_url)


class EditQuestlineView(LoginRequiredMixin, views.UpdateView):
    model = Questline
    form_class = CreateQuestlineForm
    template_name = "questlines/questline-create.html"

    def get_queryset(self):
        return Questline.objects.filter(author=self.request.user)

    def get_success_url(self):
        return reverse("map-edit", kwargs={"pk": self.object.pk})


class UpdateQuestlineStatusView(LoginRequiredMixin, views.UpdateView):
    model = Questline
    form_class = QuestlineStatusForm
    success_url = reverse_lazy("home")
    # Accept only POST requests, all others will make it return 400
    http_method_names = ["post"]

    def get_queryset(self):
        return Questline.objects.filter(author=self.request.user)

    # We need the form as parameter so under the hood Django can wire it: self.form_invalid(form)
    def form_invalid(self, form):
        return HttpResponse(status=400)


class DeleteQuestlineView(LoginRequiredMixin, views.DeleteView):
    model = Questline
    success_url = reverse_lazy("home")
    http_method_names = ["post"]

    def get_queryset(self):
        return Questline.objects.filter(author=self.request.user)


class PublicQuestlineDetailView(views.DetailView):
    model = Questline
    template_name = "questlines/map-public.html"

    # DetailView automatically gets the questline's pk from the url and returns that specific instance
    def get_queryset(self):
        return Questline.objects.filter(status=Questline.Status.PUBLIC)


class EditMapView(LoginRequiredMixin, views.DetailView):
    model = Questline
    template_name = "questlines/map-edit.html"

    # A DetailView supplies the questline but knows nothing about forms, and the map
    # carries the add-quest drawer — so we add a blank one ourselves.
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # Unbound (no data) — it only renders here; CreateQuestView validates it.
        # questline_pk scopes the prerequisite dropdown to this questline's quests.
        context["form"] = QuestForm(questline_pk=self.object.pk)
        return context

    # get_object() searches whatever this returns, so narrowing it means someone
    # else's pk simply isn't found → 404 (which leaks less than a 403).
    # TODO: becomes "mine OR public" once publishing exists.
    def get_queryset(self):
        return Questline.objects.filter(author=self.request.user)


class CreateQuestView(LoginRequiredMixin, ObjectiveSaveMixin, views.CreateView):
    model = Quest
    form_class = QuestForm
    template_name = "questlines/quest-create.html"

    def form_valid(self, form):
        # author=... is the authorisation check: exists AND belongs to this user.
        questline = get_object_or_404(
            Questline, pk=self.kwargs["pk"], author=self.request.user
        )
        form.instance.questline = questline  # FK wants an instance, not a pk

        # Not super().form_valid() — that saves AND redirects; we only want the save.
        self.object = form.save()  # ModelForm.save() writes the M2M rows too
        self.save_objectives(self.object)

        # The reply the view sends back to a JS fetch() call when a quest is created — because this endpoint is hit by AJAX, not a normal form POST. (currently the returned body is thrown away from JS since the page reloads when the 201 is received)
        return JsonResponse(
            {
                "id": self.object.pk,
                "title": self.object.title,
                "coord_x": self.object.coord_x,
                "coord_y": self.object.coord_y,
                "is_optional": self.object.is_optional,
            },
            status=201,  # Created
        )

    def form_invalid(self, form):
        # 400 lets the JS branch on response.ok instead of inspecting the body.
        # get_json_data(): {"title": [{"message": "...", "code": "required"}]}
        return JsonResponse({"errors": form.errors.get_json_data()}, status=400)

    # Adds one entry to the dict CreateView splats into QuestForm(**kwargs).
    # A form can't reach the request or the URL, so the view has to hand it over.
    def get_form_kwargs(self):
        kwargs = super().get_form_kwargs()
        kwargs["questline_pk"] = self.kwargs["pk"]  # keyword-only: name must match
        return kwargs


class EditQuestView(LoginRequiredMixin, ObjectiveSaveMixin, views.UpdateView):
    model = Quest
    form_class = QuestForm

    def get_queryset(self):
        return Quest.objects.filter(questline__author=self.request.user)

    def get_form_kwargs(self):
        kwargs = super().get_form_kwargs()
        # This URL carries the QUEST's pk, so the questline comes off the quest.
        kwargs["questline_pk"] = self.object.questline_id
        return kwargs

    def form_valid(self, form):
        self.object = form.save()  # UpdateView already attached the instance
        self.save_objectives(self.object)

        return JsonResponse(
            {
                "id": self.object.pk,
                "title": self.object.title,
                "coord_x": self.object.coord_x,
                "coord_y": self.object.coord_y,
                "is_optional": self.object.is_optional,
            },
        )

    def form_invalid(self, form):
        return JsonResponse({"errors": form.errors.get_json_data()}, status=400)


# Coords only — the drag POSTs here on drop. Same shape as EditQuestView with a
# two-field form, so the model's FloatFields reject anything that isn't a number.
class MoveQuestView(LoginRequiredMixin, views.UpdateView):
    model = Quest
    form_class = MoveQuestForm

    def get_queryset(self):
        return Quest.objects.filter(questline__author=self.request.user)

    def form_valid(self, form):
        self.object = form.save()

        return JsonResponse(
            {
                "coord_x": self.object.coord_x,
                "coord_y": self.object.coord_y,
            },
        )

    def form_invalid(self, form):
        return JsonResponse({"errors": form.errors.get_json_data()}, status=400)


# Plain View, not DeleteView: DeleteView is page-shaped (GET renders a confirm
# template, POST redirects to success_url) and we'd override all of it.
# No get() defined → GET returns 405, which is what we want for a delete URL.
class DeleteQuestView(LoginRequiredMixin, views.View):
    def post(self, request, *args, **kwargs):
        quest = get_object_or_404(
            Quest, pk=kwargs["pk"], questline__author=request.user
        )
        quest_id = quest.pk  # read it first — delete() sets .pk to None
        quest.delete()
        return JsonResponse({"id": quest_id})
