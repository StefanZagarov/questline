from django.conf import settings
from django.db import models

from questlines.models import Objective, Quest, Questline


class Enrollment(models.Model):
    class Meta:
        # This allows many users to enroll Questline, but prevents the same user from enrolling the same Questline twice
        constraints = [
            models.UniqueConstraint(
                fields=["enrolled_user", "questline"],
                name="unique_user_questline_enrollment",
            )
        ]

    enrolled_user = models.ForeignKey(
        to=settings.AUTH_USER_MODEL, on_delete=models.CASCADE
    )
    questline = models.ForeignKey(to=Questline, on_delete=models.CASCADE)
    started_at = models.DateTimeField(auto_now_add=True)


class ObjectiveProgress(models.Model):
    # One Enrollment + one Objective = exactly one progress state
    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["enrollment", "objective"], name="unique_enrollment_objective"
            )
        ]

    enrollment = models.ForeignKey(to=Enrollment, on_delete=models.CASCADE)
    objective = models.ForeignKey(to=Objective, on_delete=models.CASCADE)
    is_complete = models.BooleanField(default=False)
    current_value = models.IntegerField(null=True)


# A personal note belongs to one user's run through one Quest. It is separate from
# Quest because Quest is shared definition data, while this content is private to
# the Enrollment and may differ between users without changing the original map.
class AdventureNote(models.Model):
    class Meta:
        # One note per Enrollment + Quest pair
        constraints = [
            models.UniqueConstraint(
                fields=["enrollment", "quest"], name="unique_enrollment_quest"
            )
        ]

    enrollment = models.ForeignKey(to=Enrollment, on_delete=models.CASCADE)
    quest = models.ForeignKey(to=Quest, on_delete=models.CASCADE)
    content = models.TextField(max_length=99999, blank=True)
