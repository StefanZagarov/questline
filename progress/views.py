from django.contrib.auth.mixins import LoginRequiredMixin
from django.shortcuts import render
from django.views import generic as views

from progress.models import Enrollment
from progress.services import get_questline_progress


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
        context["calculated_data"] = get_questline_progress(self.object)
        return context
