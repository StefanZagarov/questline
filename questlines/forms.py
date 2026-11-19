from django import forms

from questlines.models import ChecklistObjective, Quest, Questline, SliderObjective
from questlines.validation import (
    validate_questline,
)


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
        ]


class QuestlineStatusForm(forms.ModelForm):
    class Meta:
        model = Questline
        fields = ["status"]

    def clean(self):
        # * Good to do this to keep the logic of the parent clean() method
        cleaned_data = super().clean()
        current_status = self.instance.status
        # Return None if the selected questline status is different from what the UI
        # provides: Draft, Private, Public. This way the validation conditional can catch
        # this invalid value and skip the whole validation, as the status field's own
        # check (run before clean()) has already caught it and added an error
        requested_status = cleaned_data.get("status", None)

        if (
            requested_status is not None
            and current_status == Questline.Status.DRAFT
            and requested_status != Questline.Status.DRAFT
        ):
            errors = validate_questline(self.instance)
            if errors:
                validation_errors = [
                    forms.ValidationError(error["message"], error["error_type"])
                    for error in errors
                ]
                raise forms.ValidationError(validation_errors)  # type: ignore[arg-type]

        # *
        return cleaned_data


# Serves both create and edit — a ModelForm doesn't know the difference; it just
# binds to an instance or doesn't.
class QuestForm(forms.ModelForm):
    class Meta:
        model = Quest
        fields = ["title", "description", "is_optional", "prerequisite_quests"]
        # Widgets changes how a field is drawn as HTML
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


# Validating objectives
class ChecklistObjectiveForm(forms.ModelForm):
    class Meta:
        model = ChecklistObjective
        fields = ["title", "description"]


class SliderObjectiveForm(forms.ModelForm):
    class Meta:
        model = SliderObjective
        fields = ["title", "description", "min_value", "goal_value"]
