# Playable-map validation: the one rule set for "a valid map".
# Called on: status change Draft → Private/Public (blocks it), Start (backup — should never
# fail in normal use), and while editing a Draft (marks faulty Quests; item 3).
# Each rule check returns a list of problems; an empty list means valid.
# A Quest can break several rules, so each Quest's problems are a list of reasons.
# Some problems belong to the whole map, not to one Quest (rules 1 and 3).


def fetchQuests(questline):
    quests = questline.quests.all()
    quests_full_data = quests.prefetch_related("objectives", "prerequisite_quests")
    return quests_full_data


# Entry validator
def validate_questline(questline):
    quests = fetchQuests(questline)

    errors = []

    errors += validate_quest_objectives(quests)
    errors += validate_single_root(questline, quests)
    validate_required_prerequisites(quests)
    validate_reachability(quests)
    validate_no_loops(quests)

    return errors


# 2. Every Quest, required or optional, has at least one Objective — otherwise nothing can
#    complete it. Each Quest with zero Objectives is faulty.
#    How: go through every Quest and check its Objectives; a Quest with 0 goes into the
#    faulty collection.
def validate_quest_objectives(quests):
    objectives_error = [
        {
            "quest_ids": [quest.id],
            "error_type": "no_objective",
            "message": f"{quest.title} does not have an objective",
        }
        for quest in quests
        if not quest.objectives.all()
    ]

    return objectives_error


# 3. Exactly one root: one Quest without prerequisites, and it must be required.
#    A root is not assigned anywhere — any Quest with no prerequisites is one, so count them.
#    How: rule 1 already guarantees a required Quest exists; then check that exactly one
#    Quest has no prerequisites, and that this Quest is required.
def validate_single_root(questline, quests):
    if len(quests) == 0:
        return [
            {
                "quest_ids": [],
                "error_type": "no_quest",
                "message": f"{questline.title} has no quest",
            }
        ]

    root_quest = [quest for quest in quests if not quest.prerequisite_quests.all()]
    optional_root_quest = [root for root in root_quest if root.is_optional]

    if len(root_quest) == 0:
        return [
            {
                "quest_ids": [],
                "error_type": "no_root",
                "message": f"{questline.title} needs a root quest",
            }
        ]

    error = []

    if len(root_quest) > 1:
        error.append(
            {
                "quest_ids": [quest.id for quest in root_quest],
                "error_type": "multiple_roots",
                "message": "More than one root quest",
            }
        )

    if len(optional_root_quest) > 0:
        error.append(
            {
                "quest_ids": [quest.id for quest in optional_root_quest],
                "error_type": "optional_root_quest",
                "message": "Quest can't be optional if it's a root quest",
            }
        )

    return error


# 4. A required Quest may only have required prerequisites (decided 2026-11-11).
#    Optional Quests may have any prerequisites. A required non-root Quest needs at least
#    one prerequisite, and all of them must be required: R → (o)O → A and R → A ← (o)O
#    are both invalid. Optional Quests branch off the main path, never into it.
#    How: for each required Quest that is not the root, check it has a prerequisite and
#    that none of its prerequisites is optional.
def validate_required_prerequisites(quests):
    pass


# 5. Every Quest, optional ones included, is reachable from the root through
#    prerequisites. No floating Quests or disconnected branches.
#    How: a pure graph check — every Quest must connect back to the root.
def validate_reachability(quests):
    pass


# 6. No loops, direct or transitive. The validator owns this check; the loop detection in
#    progress/services.py stays as a defensive fallback for bad data.
#    How: a pure graph check, written here in the validator.
def validate_no_loops(quests):
    pass
