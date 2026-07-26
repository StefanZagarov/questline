from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import ListView

from questlines.models import Questline


class HomePageView(LoginRequiredMixin, ListView):
    model = Questline
    template_name = "common/home-page.html"

    def get_queryset(self):
        return Questline.objects.filter(author=self.request.user)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        mine = self.get_queryset()
        context["drafts"] = mine.filter(status=Questline.Status.DRAFT)
        context["private"] = mine.filter(status=Questline.Status.PRIVATE)
        context["public"] = mine.filter(status=Questline.Status.PUBLIC)
        return context
