from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import ListView

from questlines.models import Questline


class HomePageView(LoginRequiredMixin, ListView):
    model = Questline
    template_name = "common/home-page.html"

    def get_queryset(self):
        return Questline.objects.filter(visibility=Questline.Visibility.PUBLISHED)
