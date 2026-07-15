from django import forms

from questlines.models import Quest, Questline


class CreateQuestlineForm(forms.ModelForm):
    class Meta:
        model = Questline
        # Adding fields, instead of excluding author and visibility is slightly better because new fields in the model won't be silently added to the generated form
        fields = [
            "title",
            "description",
            "category",
            "difficulty",
            "cover_image",
        ]


class CreateQuestForm(forms.ModelForm):
    class Meta:
        model = Quest
        fields = ["title", "is_optional", "prerequisite_quests"]
