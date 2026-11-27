# Playable-map validation: the one rule set for "a valid map".
# Called on: status change Draft → Private/Public (blocks it), Start (backup — should never
# fail in normal use), and while editing a Draft (marks faulty Quests; item 3).
# Each rule check returns a list of problems; an empty list means valid.
# A Quest can break several rules, so each Quest's problems are a list of reasons.
# Some problems belong to the whole map, not to one Quest (rules 1 and 3).


def fetch_quests(questline):
    quests = questline.quests.all()
    quests_full_data = quests.prefetch_related("objectives", "prerequisite_quests")
    return quests_full_data


def get_root_quests(quests):
    return [quest for quest in quests if not quest.prerequisite_quests.all()]


# Entry validator
def validate_questline(questline):
    quests = fetch_quests(questline)
    prerequisite_dict = {quest.id: quest.prerequisite_quests.all() for quest in quests}

    errors = []
    root_quests = get_root_quests(quests)

    errors += validate_quest_objectives(quests)
    errors += validate_single_root(questline, root_quests, quests)
    errors += validate_required_prerequisites(quests)
    if len(root_quests) == 1:
        errors += validate_reachability(quests, root_quests, prerequisite_dict)
    errors += validate_no_loops(quests, prerequisite_dict)

    return errors


def validate_quest_objectives(quests):
    objectives_error = [
        {
            "quest_ids": [quest.id],
            "error_type": "no_objective",
            "message": f'"{quest.title}" does not have an objective',
        }
        for quest in quests
        if not quest.objectives.all()
    ]

    return objectives_error


def validate_single_root(questline, root_quests, quests):
    if len(quests) == 0:
        return [
            {
                "quest_ids": [],
                "error_type": "no_quest",
                "message": f'"{questline.title}" has no quest',
            }
        ]

    optional_root_quest = [root for root in root_quests if root.is_optional]

    if len(root_quests) == 0:
        return [
            {
                "quest_ids": [],
                "error_type": "no_root",
                "message": f'"{questline.title}" needs a root quest',
            }
        ]

    errors = []

    if len(root_quests) > 1:
        errors.append(
            {
                "quest_ids": [quest.id for quest in root_quests],
                "error_type": "multiple_roots",
                "message": "More than one root quest",
            }
        )

    if len(optional_root_quest) > 0:
        errors.append(
            {
                "quest_ids": [quest.id for quest in optional_root_quest],
                "error_type": "optional_root_quest",
                "message": "Quest can't be optional if it's a root quest",
            }
        )

    return errors


def validate_required_prerequisites(quests):
    errors = []

    for quest in quests:
        if quest.is_optional or len(quest.prerequisite_quests.all()) == 0:
            continue

        prerequisites = quest.prerequisite_quests.all()

        for prerequisite in prerequisites:
            if prerequisite.is_optional:
                errors.append(
                    {
                        "quest_ids": [quest.id, prerequisite.id],
                        "error_type": "optional_prerequisite",
                        "message": (
                            f'Required quest "{quest.title}" depends on optional '
                            f'quest "{prerequisite.title}". Required quests can only '
                            "depend on required quests"
                        ),
                    }
                )

    return errors


def validate_reachability(quests, root_quests, prerequisite_dict):
    root_id = root_quests[0].id
    visiting = set()
    quests_to_root = set()

    unreachable_quests = [
        quest
        for quest in quests
        if not reaches_root(
            quest.id, root_id, prerequisite_dict, visiting, quests_to_root
        )
    ]

    if not unreachable_quests:
        return []

    unreachable_titles = ", ".join(f'"{quest.title}"' for quest in unreachable_quests)

    return [
        {
            "quest_ids": [quest.id for quest in unreachable_quests],
            "error_type": "unreachable_quest",
            "message": f"Not connected to the root quest: {unreachable_titles}",
        }
    ]


def reaches_root(quest_id, root_id, prerequisite_dict, visiting, quests_to_root):
    if quest_id == root_id or quest_id in quests_to_root:
        return True

    if quest_id in visiting:
        return False

    visiting.add(quest_id)

    found_root = any(
        reaches_root(
            prerequisite.id, root_id, prerequisite_dict, visiting, quests_to_root
        )
        for prerequisite in prerequisite_dict.get(quest_id, [])
    )

    visiting.remove(quest_id)

    if found_root:
        quests_to_root.add(quest_id)

    return found_root


def validate_no_loops(quests, prerequisite_dict):
    visiting = []
    valid_quests = set()
    looping_quest_ids = set()

    for quest in quests:
        quest_loops(
            quest.id, prerequisite_dict, visiting, valid_quests, looping_quest_ids
        )

    if not looping_quest_ids:
        return []

    looping_quests = [quest for quest in quests if quest.id in looping_quest_ids]
    looping_quest_titles = ", ".join(f'"{quest.title}"' for quest in looping_quests)

    return [
        {
            "quest_ids": [quest.id for quest in looping_quests],
            "error_type": "quest_loop",
            "message": f"Quests have looping path: {looping_quest_titles}",
        }
    ]


def quest_loops(quest_id, prerequisite_dict, visiting, valid_quests, looping_quest_ids):
    if quest_id in looping_quest_ids:
        return True
    elif quest_id in visiting:
        loop_start = visiting.index(quest_id)
        looping_quest_ids.update(visiting[loop_start:])
        return True
    elif quest_id in valid_quests:
        return False

    visiting.append(quest_id)

    found_loop = any(
        quest_loops(
            prerequisite.id,
            prerequisite_dict,
            visiting,
            valid_quests,
            looping_quest_ids,
        )
        for prerequisite in prerequisite_dict.get(quest_id, [])
    )

    visiting.pop()

    if not found_loop:
        valid_quests.add(quest_id)

    return found_loop
