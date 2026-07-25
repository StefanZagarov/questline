from django import forms

from questlines.models import Quest, Questline


# Rewrite the default message for the clear uploaded file label
class CoverInput(forms.ClearableFileInput):
    clear_checkbox_label = "Clear on save"


class CreateQuestlineForm(forms.ModelForm):
    class Meta:
        model = Questline
        # Listing fields beats excluding author/visibility: a new model field can't
        # then appear on the form by accident.
        fields = [
            "title",
            "description",
            "category",
            "difficulty",
            "cover_image",
        ]
        widgets = {"cover_image": CoverInput}


# Serves both create and edit — a ModelForm doesn't know the difference; it just
# binds to an instance or doesn't.
class QuestForm(forms.ModelForm):
    class Meta:
        model = Quest
        fields = ["title", "description", "is_optional", "prerequisite_quests"]
        widgets = {"prerequisite_quests": forms.CheckboxSelectMultiple}

    # questline_pk is keyword-only (it sits after *args) so it never reaches super(),
    # which would raise TypeError on an argument Django has never heard of.
    # The view has to pass it: a form can't reach the request or the URL itself.
    def __init__(self, *args, questline_pk=None, **kwargs):
        super().__init__(*args, **kwargs)  # first — self.fields doesn't exist until now

        # Without this the dropdown would offer every quest in the database.
        quests = Quest.objects.filter(questline_id=questline_pk)

        # self.instance.pk is None on create, a number on edit — that's how the form
        # knows its own mode, with no flag from the view.
        if self.instance.pk:
            # A quest must not be its own prerequisite: it would sit sealed waiting
            # on itself forever, and Django would save it without complaint.
            quests = quests.exclude(pk=self.instance.pk)

        # .queryset is what the widget renders as <option>s
        self.fields["prerequisite_quests"].queryset = quests


# Coords only, for the drag's POST on drop.
class MoveQuestForm(forms.ModelForm):
    class Meta:
        model = Quest
        fields = ["coord_x", "coord_y"]
