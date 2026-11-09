import json

from questlines.forms import ChecklistObjectiveForm, SliderObjectiveForm
from questlines.models import ChecklistObjective, SliderObjective

# Why this is a good candidate for a mixin (since I haven't done much of those so far): A plain class that inherits nothing and is not a view — yet it freely uses self.request. A mixin is a bundle of methods designed to be mixed into a host class, and it assumes the host provides what it reaches for. The mixin is a guest that borrows the host's furniture. It is a lot like React's hooks


class ObjectiveSaveMixin:
    # First check if objectives have valid values before saving
    def validate_objectives(self):
        errors = []
        # Loop over the objectives to create them. Each objective belongs to a quest (saves its pk), but quests do not exist before form.save, so we do it after
        # The JSON string JS sent - we get the field objectives_data, or in case it doesn't find it, it returns the string "[]"
        raw = self.request.POST.get("objectives_data", "[]")

        # Turn raw data into list of dicts
        objectives = json.loads(raw)

        for objective in objectives:
            if objective["type"] == "checklistobjective":
                form = ChecklistObjectiveForm(objective)
                if not form.is_valid():
                    errors.append(
                        {
                            "order": objective["order"],
                            "fields": form.errors.get_json_data(),
                        }
                    )
            if objective["type"] == "sliderobjective":
                form = SliderObjectiveForm(objective)
                if not form.is_valid():
                    errors.append(
                        {
                            "order": objective["order"],
                            "fields": form.errors.get_json_data(),
                        }
                    )

        return objectives, errors

    def save_objectives(self, quest, objectives):
        # Clear existing objectives
        quest.objectives.all().delete()

        # Create and store the respective objective types
        for objective in objectives:
            if objective["type"] == "sliderobjective":
                SliderObjective.objects.create(
                    quest=quest,
                    order=objective["order"],
                    title=objective["title"],
                    description=objective["description"],
                    min_value=int(objective["min_value"]),
                    goal_value=int(objective["goal_value"]),
                )
            elif objective["type"] == "checklistobjective":
                ChecklistObjective.objects.create(
                    quest=quest,
                    order=objective["order"],
                    title=objective["title"],
                    description=objective["description"],
                )
