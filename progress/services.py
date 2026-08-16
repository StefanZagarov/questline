# Progress calculator that will distribute the value to the different views (pages)


def get_progress(enrollment):
    questline_progress = {}
    # Every quest of the enrolled questline, with each quest's objectives and prerequisites
    # pulled along now so the loop below never queries again per quest.
    quests = enrollment.questline.quests.prefetch_related(
        "prerequisite_quests", "objectives"
    )
    all_objective_progress = enrollment.objectiveprogress_set.all()

    # This user's progress rows keyed by objective id, because the loops below look rows up
    # one objective at a time. The whole row is kept since sliders need current_value.
    objective_progress = {}
    for row in all_objective_progress:
        objective_progress[row.objective_id] = row

    # Quest id -> finished answer, so a quest several others depend on is calculated once.
    memo = {}
    # Quest ids currently mid-calculation, which is how a looping map is caught.
    visiting_set = set()

    # Split main from side quests and derive each quest's state for the questline progress.
    main_quests = []
    optional_quests = []
    for quest in quests:
        if quest.is_optional:
            optional_quests.append(quest)
        else:
            main_quests.append(quest)

        is_unlocked = True
        for prev_quest in quest.prerequisite_quests.all():
            if not is_quest_complete(
                prev_quest, objective_progress, memo, visiting_set
            ):
                is_unlocked = False

        raw_complete = True
        # A quest with no objectives counts as incomplete, so it can never silently pass.
        # Authoring already blocks empty quests; this is the second layer behind that.
        quest_objectives = quest.objectives.all()
        if quest_objectives:
            for objective in quest_objectives:
                dict_objective_progress = objective_progress.get(objective.id)
                if (
                    not dict_objective_progress
                    or not dict_objective_progress.is_complete
                ):
                    raw_complete = False
                    break
        else:
            raw_complete = False

        effective_complete = False
        if is_unlocked and raw_complete:
            effective_complete = True

        questline_progress[quest.id] = {
            "is_unlocked": is_unlocked,
            "raw_complete": raw_complete,
            "effective_complete": effective_complete,
        }


# Answers "is this quest effectively complete" by asking the same of its prerequisites, so it
# calls itself; memo and visiting_set are what keep that descent cheap and finite.
def is_quest_complete(quest, objective_progress, memo, visiting_set):
    example_return_shape = {
        "is_unlocked": is_unlocked,
        "raw_complete": raw_complete,
        "effective_complete": effective_complete,
    }

    # Reaching a quest that is still mid-calculation means the map loops back on itself.
    # A broken map opens nothing; the validator is what should stop these existing.
    if quest.id in visiting_set:
        # Now must return the same dict shape
        return False

    # Already calculated in an earlier call, so reuse the answer instead of walking
    # this quest's prerequisite chain a second time.
    if quest.id in memo:
        return memo.get(quest.id)

    # Anything reached from here that leads back to this quest is a loop.
    visiting_set.add(quest.id)

    # A prerequisite only counts as done if it is itself unlocked and finished, which is the
    # same question being answered here, so each one is asked recursively.
    are_prev_quests_complete = True
    prerequisite_quests = quest.prerequisite_quests.all()
    if prerequisite_quests:
        for prev_quest in prerequisite_quests:
            # If the quest is a main quest, and the previous quest is optional, then do not block the main quest's progress
            if not quest.is_optional and prev_quest.is_optional:
                continue
            if not is_quest_complete(
                prev_quest, objective_progress, memo, visiting_set
            ):
                are_prev_quests_complete = False
    else:
        # No prerequisites means this is the root, which starts unlocked.
        are_prev_quests_complete = True

    # A blocked quest is not complete no matter what its own objectives say.
    if not are_prev_quests_complete:
        memo[quest.id] = False
        visiting_set.remove(quest.id)
        return False

    # Unlocked, so this quest's own objectives decide the answer that gets remembered.
    are_objectives_complete = True
    quest_objectives = quest.objectives.all()
    if quest_objectives:
        for objective in quest_objectives:
            dict_objective_progress = objective_progress.get(objective.id)
            if not dict_objective_progress or not dict_objective_progress.is_complete:
                are_objectives_complete = False
    else:
        are_objectives_complete = False

    memo[quest.id] = are_objectives_complete
    visiting_set.remove(quest.id)
    return are_objectives_complete
