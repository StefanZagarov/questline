import json

from django.conf import settings
from django.db import models

from common.validators import validate_image_size


class Questline(models.Model):
    class Meta:
        ordering = ["-created_at"]

    class Difficulty(models.TextChoices):
        EASY = "easy", "Easy"
        MEDIUM = "medium", "Medium"
        HARD = "hard", "Hard"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PRIVATE = "private", "Private"
        PUBLIC = "public", "Public"

    title = models.CharField(max_length=100)
    description = models.TextField(max_length=100)
    category = models.CharField(max_length=100)
    difficulty = models.CharField(
        max_length=6, choices=Difficulty.choices, default=Difficulty.EASY
    )
    cover_image = models.ImageField(
        upload_to="covers", validators=(validate_image_size,), blank=True, null=True
    )
    author = models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    status = models.CharField(
        max_length=9, choices=Status.choices, default=Status.DRAFT
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class Quest(models.Model):
    title = models.CharField(max_length=100)
    description = models.TextField(max_length=99999, blank=True)
    is_optional = models.BooleanField(default=False)
    note = models.TextField(max_length=99999, blank=True)
    coord_x = models.FloatField(default=0)
    coord_y = models.FloatField(default=0)
    # related_name - makes questline.quest_set to read as quests
    questline = models.ForeignKey(
        Questline, on_delete=models.CASCADE, related_name="quests"
    )
    # Making quest.quest_set read as quest.unlocks
    prerequisite_quests = models.ManyToManyField(
        "self", symmetrical=False, blank=True, related_name="unlocks"
    )

    # This is used in map.html: data-objectives="{{ quest.objectives_json }}"
    @property
    def objectives_json(self):
        return json.dumps(self.objectives_preview)

    # This is quest's objectives as a JSON string, for the edit drawer to prefill from.
    # The pen renders it into data-objectives on the edit button (see map.html), and
    # quest-drawer.js JSON.parses it to rebuild the rows — the exact same shape the JS
    # packs on submit, so the round-trip is symmetric.
    # A @property so templates can call {{ quest.objectives_json }} with no view wiring.
    @property
    def objectives_preview(self):
        data = []
        for objective in self.objectives.all():
            entry = {
                "type": objective.objective_type,
                "order": objective.order,
                "title": objective.title,
                "description": objective.description,
            }
            if objective.objective_type == "sliderobjective":
                slider = getattr(objective, objective.objective_type)
                entry["min_value"] = slider.min_value
                entry["max_value"] = slider.max_value
                entry["target_value"] = slider.target_value
            data.append(entry)
        return data

    def __str__(self):
        return self.title


class Objective(models.Model):
    class Meta:
        ordering = ["order"]

    quest = models.ForeignKey(
        Quest, related_name="objectives", on_delete=models.CASCADE
    )
    order = models.PositiveIntegerField(default=0)
    title = models.CharField(max_length=100)
    description = models.TextField(max_length=99999, blank=True)
    objective_type = models.CharField(max_length=100, editable=False)

    def save(self, *args, **kwargs):
        self.objective_type = self._meta.model_name
        super().save(*args, **kwargs)


class SliderObjective(Objective):
    min_value = models.IntegerField(default=0)
    max_value = models.IntegerField(default=100)
    target_value = models.IntegerField(default=50)

    # Validate min/max/target like in the UI
    def save(self, *args, **kwargs):
        if self.min_value > self.max_value:
            self.min_value, self.max_value = self.max_value, self.min_value

        self.target_value = min(max(self.target_value, self.min_value), self.max_value)
        super().save(*args, **kwargs)


class ChecklistObjective(Objective):
    pass
