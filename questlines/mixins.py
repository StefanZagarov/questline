import json

from questlines.models import ChecklistObjective, SliderObjective

# Why this is a good candidate for a mixin (since I haven't done much of those so far): A plain class that inherits nothing and is not a view — yet it freely uses self.request. A mixin is a bundle of methods designed to be mixed into a host class, and it assumes the host provides what it reaches for. The mixin is a guest that borrows the host's furniture. It is a lot like React's hooks


class ObjectiveSaveMixin:
    def save_objectives(self, quest):
        # Clear existing objectives
        quest.objectives.all().delete()

        # Loop over the objectives to create them. Each objective belongs to a quest (saves its pk), but quests do not exist before form.save, so we do it after
        # The JSON string JS sent - we get the field objectives_data, or in case it doesn't find it, it returns the string "[]"
        raw = self.request.POST.get("objectives_data", "[]")

        # Turn raw data into list of dicts
        objectives = json.loads(raw)

        # Create and store the respective objective types
        for objective in objectives:
            if objective["type"] == "sliderobjective":
                SliderObjective.objects.create(
                    quest=quest,
                    order=objective["order"],
                    title=objective["title"],
                    description=objective["description"],
                    min_value=int(objective["min_value"]),
                    max_value=int(objective["max_value"]),
                    target_value=int(objective["target_value"]),
                )
            elif objective["type"] == "checklistobjective":
                ChecklistObjective.objects.create(
                    quest=quest,
                    order=objective["order"],
                    title=objective["title"],
                    description=objective["description"],
                )
