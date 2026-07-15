from django.contrib.auth.mixins import LoginRequiredMixin
from django.shortcuts import get_object_or_404
from django.urls import reverse, reverse_lazy
from django.views import generic as views

from questlines.forms import CreateQuestForm, CreateQuestlineForm
from questlines.models import Quest, Questline


# You can use LoginRequiredMiddleware in MIDDLEWARE to automatically make each view auth guarded, instead of explicitly typing it every time here. But then the register and login views will need to add unblocking mixins
class CreateQuestlineView(LoginRequiredMixin, views.CreateView):
    model = Questline
    form_class = CreateQuestlineForm
    template_name = "questlines/questline-create.html"
    # success_url = reverse_lazy("questline-map")
    success_url = reverse_lazy("home")

    def form_valid(self, form):
        form.instance.author = self.request.user
        return super().form_valid(form)


class DetailQuestlineView(LoginRequiredMixin, views.DetailView):
    model = Questline
    template_name = "questlines/map.html"


class CreateQuestView(LoginRequiredMixin, views.CreateView):
    # LoginRequiredMixin (leftmost) guards the view; CreateView runs the whole
    # form lifecycle for us: show blank form on GET, bind + validate on POST, save.
    model = Quest  # which table CreateView saves into
    form_class = CreateQuestForm  # the ModelForm defining the visible fields
    template_name = "questlines/quest-create.html"

    # form_valid runs AFTER the form passes validation but BEFORE the save.
    # form.instance is the unsaved Quest built from the submitted fields; here we
    # attach the one field the user didn't fill: which questline this quest belongs to.
    def form_valid(self, form):
        # self.kwargs holds the values captured from the URL path (<int:pk>).
        # A FK expects a Questline *object*, so we fetch it (not the raw pk).
        form.instance.questline = get_object_or_404(Questline, pk=self.kwargs["pk"])
        # super().form_valid(form) performs the actual save + redirect.
        return super().form_valid(form)

    # success_url can't be used here: it's evaluated once at class-definition time,
    # when no pk exists. get_success_url runs per-request, so it can read the pk and
    # redirect back to THIS questline's map after saving.
    def get_success_url(self):
        return reverse("questline-map", kwargs={"pk": self.kwargs["pk"]})

    # get_form is the hook CreateView uses to BUILD the form object each request.
    # We let it build the form normally, then reach in and narrow one field's
    # options before it's ever rendered — so the dropdown only offers quests
    # from THIS questline instead of every quest in the database.
    def get_form(self, form_class=None):
        # super() does the normal work: instantiate CreateQuestForm (bound to POST
        # data on submit, unbound on GET). We keep that form and just tweak it.
        form = super().get_form(form_class)
        # form.fields[...] is the live field object; .queryset is the set of rows
        # it renders as <option>s. Replace it with only this questline's quests.
        form.fields["prerequisite_quests"].quesryset = Quest.objects.filter(
            questline_id=self.kwargs["pk"]  # the questline pk captured from the URL
        )
        return form  # hand the tweaked form back to CreateView to render/validate
