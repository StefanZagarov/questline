from django.db import migrations, models


def ensure_goal_above_minimum(apps, schema_editor):
    slider_objective = apps.get_model("questlines", "SliderObjective")

    for slider in slider_objective.objects.filter(
        goal_value__lte=models.F("min_value")
    ).iterator():
        if slider.min_value > slider.goal_value:
            slider.min_value, slider.goal_value = slider.goal_value, slider.min_value
        else:
            slider.goal_value += 1

        slider.save(update_fields=["min_value", "goal_value"])


class Migration(migrations.Migration):
    dependencies = [
        ("questlines", "0013_remove_quest_note"),
    ]

    operations = [
        migrations.RenameField(
            model_name="sliderobjective",
            old_name="target_value",
            new_name="goal_value",
        ),
        migrations.RunPython(
            ensure_goal_above_minimum,
            migrations.RunPython.noop,
        ),
        migrations.RemoveField(
            model_name="sliderobjective",
            name="max_value",
        ),
        migrations.AlterField(
            model_name="sliderobjective",
            name="goal_value",
            field=models.IntegerField(default=100),
        ),
    ]
