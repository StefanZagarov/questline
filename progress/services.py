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
    # The quests above are the only ones carrying the prefetched objectives and prerequisites.
    # quest.prerequisite_quests.all() hands back fresh Quest objects with empty caches, so the
    # recursion looks each prerequisite up here and walks the loaded one instead.
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
    questline_progress["quests"] = order_quest_states(quests_state, invalid_quests_set)

    # Calculate global (questline) progress
    main_objective_values = [
        objective_state["objective_progress"] if quest_state["is_unlocked"] else 0
        for quest_state in questline_progress["quests"].values()
        if not quest_state["quest"].is_optional
        for objective_state in quest_state["objectives"].values()
    ]
    optional_objective_values = [
        objective_state["objective_progress"] if quest_state["is_unlocked"] else 0
        for quest_state in questline_progress["quests"].values()
        if quest_state["quest"].is_optional
        for objective_state in quest_state["objectives"].values()
    ]

    main_questline_progress_ratio = (
        sum(main_objective_values) / len(main_objective_values)
        if main_objective_values
        else 0
    )
    optional_questline_progress_ratio = (
        sum(optional_objective_values) / len(optional_objective_values)
        if optional_objective_values
        else 0
    )

    questline_progress["main_questline_progress_ratio"] = main_questline_progress_ratio
    questline_progress["optional_questline_progress_ratio"] = (
        optional_questline_progress_ratio
    )

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
        "objectives": {},
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
            # The loaded twin of prev_quest, so the call below reads cached relations.
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

    progress_ratio = 0
    # Map objective progress for each quest
    for objective in quest_objectives:
        current_objective_progress = objective_progress.get(objective.id)
        objective_progress_value = 0

        match objective.objective_type:
            case "checklistobjective":
                objective_progress_value = (
                    1
                    if current_objective_progress is not None
                    and current_objective_progress.is_complete
                    else 0
                )
            case "sliderobjective":
                # Get the child model instance from the parent by using getattr
                sliderobjective = getattr(objective, objective.objective_type)
                # Guard check each value
                min_value = (
                    sliderobjective.min_value
                    if sliderobjective.min_value is not None
                    else 0
                )
                target_value = sliderobjective.target_value
                current_value = (
                    current_objective_progress.current_value
                    if current_objective_progress is not None
                    and current_objective_progress.current_value is not None
                    else 0
                )

                objective_progress_value = (
                    0
                    if current_objective_progress is None
                    else 1
                    if target_value == min_value
                    else (current_value - min_value) / (target_value - min_value)
                )
            case _:
                pass

        objective_progress_value = max(0, min(objective_progress_value, 1))
        progress_ratio += objective_progress_value

        quest_state["objectives"][objective.id] = {
            "title": objective.title,
            "type": objective.objective_type,
            "is_complete": current_objective_progress.is_complete
            if current_objective_progress is not None
            else False,
            "current_value": current_objective_progress.current_value
            if current_objective_progress is not None
            else None,
            "objective_progress": objective_progress_value,
        }

    quest_progress_ratio = (
        progress_ratio / len(quest_objectives) if len(quest_objectives) != 0 else 0
    )
    quest_state["quest_progress_ratio"] = quest_progress_ratio

    memo[quest.id] = quest_state
    visiting_set.remove(quest.id)
    return quest_state


def order_quest_states(quests_state, invalid_quests_set):
    pending = quests_state.copy()
    ordered = {}

    # Loop until pending is empty. Since quests can be skipped in the loop if their prerequisite quest is missing from the ordered list, this makes sure the pending list is repeated until all quests are moved from the pending to the ordered dict
    while len(pending) > 0:
        snapshot = pending.copy()

        # sorted() - Before we iterate, we must sort the items by their id. This will help us in a case of two quests assigned to the same prerequisite quest to assign in proper order - the id will be used for the z-index, so the older it is, the smaller the number
        for key, quest_state in sorted(snapshot.items()):
            is_eligible = True

            # Check if its prerequisites exist before we map it to the ordered list
            for prerequisite in quest_state["quest"].prerequisite_quests.all():
                if prerequisite.id not in ordered:
                    is_eligible = False
                    break

            if not is_eligible:
                continue

            ordered[key] = pending.pop(key)

        # If nothing got moved then something is broken in the quest chain
        if len(pending) == len(snapshot):
            for key, quest_state in pending.items():
                invalid_quests_set.add(quest_state["quest"].id)
            # We still need to return whatever is ordered, as per this function's job. So return what has been ordered and the still pending quests under a new dict that joins the two with the union operator (|)
            return ordered | pending

    return ordered
