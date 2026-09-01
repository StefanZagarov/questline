from django.contrib.auth.mixins import LoginRequiredMixin
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render
from django.views import generic as views

from progress.models import Enrollment, ObjectiveProgress
from progress.services import get_questline_progress
from questlines.models import Objective, Questline


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
