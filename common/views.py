from django.db.models import Q
from django.views.generic import ListView

from progress.models import Enrollment
from progress.services import get_questline_progress
from questlines.models import Questline


class HomePageView(ListView):
    model = Questline
    template_name = "common/home-page.html"

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            return Questline.objects.none()

        return Questline.objects.filter(author=self.request.user)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        mine = self.get_queryset()
        context["drafts"] = mine.filter(status=Questline.Status.DRAFT)
        context["private"] = mine.filter(status=Questline.Status.PRIVATE)
        context["public"] = mine.filter(status=Questline.Status.PUBLIC)

        enrollments = Enrollment.objects.filter(
            enrolled_user=self.request.user, questline__in=mine
        )

        progress_by_questline = {}
        for enrollment in enrollments:
            progress = get_questline_progress(enrollment)

            progress_by_questline[enrollment.questline_id] = {
                "enrollment_id": enrollment.pk,
                "completed_quests": progress["quests_summary"]["completed_main"],
                "total_quests": progress["quests_summary"]["main_total"],
                "main_progress_bar": progress["main_questline_progress_ratio"],
                "optional_progress_bar": progress["optional_questline_progress_ratio"],
            }

        context["progress_by_questline"] = progress_by_questline

        return context


class ExploreQuestlinesView(ListView):
    model = Questline
    template_name = "common/explore.html"
    paginate_by = 20
    # Make it more readable when we loop this view's objects in the template
    context_object_name = "questlines"

    # We need to get: Questlines that are filtered by public, remove the user's questlines from the list, if we have logged in user, and filter by the search (query) if we have anything in the search bar (q links to explore.html > input element name="q" line 25), and finally sorting alphabetically
    def get_queryset(self):
        query = self.request.GET.get("q", "").strip()

        # Simply return all questlines. Questline.objects.all() also works, but super() preserves the ListView pipeline
        queryset = super().get_queryset()

        # If we have a user logged in, exclude their questlines
        if self.request.user.is_authenticated:
            queryset = queryset.exclude(author=self.request.user)

        # Filter (get) public status questlines only
        queryset = queryset.filter(status=Questline.Status.PUBLIC)

        # If the searchbar has text, filter to display questlines with title or category containing the search bar value (icontains means case insensitive search)
        if query:
            queryset = queryset.filter(
                Q(title__icontains=query) | Q(category__icontains=query)
            )

        # Finally sort by title, lower the titles first to make the sorting equal
        queryset = queryset.order_by(Lower("title"))

        return queryset
