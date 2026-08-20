# Progress calculator that will distribute the value to the different views (pages)


def get_questline_progress(enrollment):
    questline_progress = {}
    quests_state = {}
    # Quest id -> finished answer, so a quest several others depend on is calculated once.
    memo = {}
    # Quest ids currently mid-calculation, which is how a looping map is caught.
    visiting_set = set()
    invalid_quests_set = set()

    # Every quest of the enrolled questline, with each quest's objectives and prerequisites
    # pulled along now so the loop below never queries again per quest.
    quests = enrollment.questline.quests.prefetch_related(
        "prerequisite_quests", "objectives"
    )
    quests_by_id = {}
    for quest in quests:
        quests_by_id[quest.id] = quest

    all_objective_progress = enrollment.objectiveprogress_set.all()

    # This user's progress rows keyed by objective id, because the loops below look rows up
    # one objective at a time. The whole row is kept since sliders need current_value.
    objective_progress = {}
    for row in all_objective_progress:
        objective_progress[row.objective_id] = row

    main_quests_count = 0
    optional_quests_count = 0
    completed_main_quests = 0
    completed_optional_quests = 0
    for quest in quests:
        if quest.is_optional:
            optional_quests_count += 1
        else:
            main_quests_count += 1

        quest_state = get_quest_state(
            quest,
            objective_progress,
            memo,
            quests_by_id,
            visiting_set,
            invalid_quests_set,
        )
        if quest_state["effective_complete"] and quest.is_optional:
            completed_optional_quests += 1
        elif quest_state["effective_complete"]:
            completed_main_quests += 1
        quests_state[quest.id] = quest_state

    percent_main_quests_completed = 0
    percent_optional_quests_completed = 0
    if main_quests_count > 0:
        percent_main_quests_completed = completed_main_quests * 100 // main_quests_count
    if optional_quests_count > 0:
        percent_optional_quests_completed = (
            completed_optional_quests * 100 // optional_quests_count
        )

    # Populate the payload
    questline_progress["invalid_quests"] = invalid_quests_set
    questline_progress["quests_summary"] = {
        "main_total": main_quests_count,
        "optional_total": optional_quests_count,
        "completed_main": completed_main_quests,
        "completed_optional": completed_optional_quests,
        "percent_main_completed": percent_main_quests_completed,
        "percent_optional_completed": percent_optional_quests_completed,
    }
    questline_progress["quests"] = quests_state

    return questline_progress


# Returns one quest's is_unlocked / raw_complete / effective_complete.
# Unlocking depends on the prerequisites' own state, so it asks itself the same question.
# memo skips quests already answered; visiting_set catches a map that loops back on itself.
def get_quest_state(
    quest, objective_progress, memo, quests_by_id, visiting_set, invalid_quests_set
):
    quest_state = {
        "quest": quest,
        "is_unlocked": False,
        "raw_complete": False,
        "effective_complete": False,
    }

    # Reaching a quest that is still mid-calculation means the map loops back on itself.
    # A broken map opens nothing; the validator is what should stop these existing.
    if quest.id in visiting_set:
        # raw_complete does not relate to this return path but we need to return the full dict
        # This dict never reaches a template, so False makes no claim to the user.
        # If something ever does read it, failing closed matches the rule for a broken map.
        invalid_quests_set.add(quest.id)
        return quest_state

    # Already calculated in an earlier call, so reuse the answer instead of walking
    # this quest's prerequisite chain a second time.
    if quest.id in memo:
        return memo.get(quest.id)

    # Anything reached from here that leads back to this quest is a loop.
    visiting_set.add(quest.id)

    # --- Is unlocked ---
    # A prerequisite only counts as done if it is itself unlocked and finished, which is the
    # same question being answered here, so each one is asked recursively.
    are_prev_quests_complete = True
    prerequisite_quests = quest.prerequisite_quests.all()
    if prerequisite_quests:
        for prev_quest in prerequisite_quests:
            # If the quest is a main quest, and the previous quest is optional, then do not block the main quest's progress
            if not quest.is_optional and prev_quest.is_optional:
                continue
            if not get_quest_state(
                quests_by_id[prev_quest.id],
                objective_progress,
                memo,
                quests_by_id,
                visiting_set,
                invalid_quests_set,
            )["effective_complete"]:
                are_prev_quests_complete = False
    else:
        # No prerequisites means this is the root, which starts unlocked.
        are_prev_quests_complete = True

    # A blocked quest is not complete no matter what its own objectives say.
    quest_state["is_unlocked"] = are_prev_quests_complete

    # --- Is completed ---
    # Unlocked, so this quest's own objectives decide the answer that gets remembered.
    are_objectives_complete = True
    quest_objectives = quest.objectives.all()
    if quest_objectives:
        for objective in quest_objectives:
            dict_objective_progress = objective_progress.get(objective.id)
            if not dict_objective_progress or not dict_objective_progress.is_complete:
                are_objectives_complete = False
                break
    else:
        are_objectives_complete = False
    quest_state["raw_complete"] = are_objectives_complete

    # --- Is effective complete ---
    quest_state["effective_complete"] = (
        quest_state["is_unlocked"] and quest_state["raw_complete"]
    )

    memo[quest.id] = quest_state
    visiting_set.remove(quest.id)
    return quest_state
