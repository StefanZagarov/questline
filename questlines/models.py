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

    class Visibility(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"

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
    visibility = models.CharField(
        max_length=9, choices=Visibility.choices, default=Visibility.DRAFT
    )
    created_at = models.DateTimeField(auto_now_add=True)


class Quest(models.Model):
    title = models.CharField(max_length=100)
    is_optional = models.BooleanField(default=False)
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


# class Objective(models.Model):
