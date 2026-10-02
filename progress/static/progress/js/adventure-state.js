// Client-side Adventure state and the JavaScript mirror of get_quest_state() in progress/services.py.
// No DOM access here: adventure.js seeds the state and renders it.

export function createQuestStates(questSeeds) {
  const questStates = {};

  questSeeds.forEach((seed) => {
    const objectives = {};

    Object.entries(seed.objectives).forEach(([objectiveId, objective]) => {
      objectives[objectiveId] = {
        type: objective.type,
        minValue: objective.min_value ?? 0,
        goalValue: objective.goal_value,
        isComplete: objective.is_complete,
        currentValue: objective.current_value,
        confirmedIsComplete: objective.is_complete,
        confirmedCurrentValue: objective.current_value,
      };
    });

    questStates[seed.id] = {
      id: seed.id,
      isOptional: seed.isOptional,
      prerequisiteIds: seed.prerequisiteIds,
      nextQuestIds: [],
      isUnlocked: seed.isUnlocked,
      isDone: seed.isDone,
      confirmedIsUnlocked: seed.isUnlocked,
      objectives,
    };
  });

  // Prerequisite links point backwards; the cascade needs them forwards
  Object.values(questStates).forEach((questState) => {
    questState.prerequisiteIds.forEach((prerequisiteId) => {
      questStates[prerequisiteId]?.nextQuestIds.push(questState.id);
    });
  });

  return questStates;
}

export function applyObjectivePreview(questStates, questId, objectiveId, value) {
  updateObjectiveValue(questStates[questId].objectives[objectiveId], value);
  applyQuestPreview(questStates, questId);
}

export function applyObjectiveRollback(
  questStates,
  questId,
  objectiveId,
  sentValue,
) {
  const objective = questStates[questId].objectives[objectiveId];

  // A newer edit is still waiting for its own request, so keep it
  if (!isCurrentValue(objective, sentValue)) return;

  objective.isComplete = objective.confirmedIsComplete;
  objective.currentValue = objective.confirmedCurrentValue;
  applyQuestPreview(questStates, questId);
}

export function applyObjectiveConfirmed(questStates, response, sentValue) {
  const changedObjective = response.changed_objective;
  const objective =
    questStates[changedObjective.quest_id].objectives[changedObjective.id];

  objective.confirmedIsComplete = changedObjective.is_complete;
  objective.confirmedCurrentValue = changedObjective.current_value;

  if (isCurrentValue(objective, sentValue)) {
    objective.isComplete = objective.confirmedIsComplete;
    objective.currentValue = objective.confirmedCurrentValue;
  }

  Object.entries(response.quests).forEach(([questId, questData]) => {
    questStates[questId].isUnlocked = questData.is_unlocked;
    questStates[questId].confirmedIsUnlocked = questData.is_unlocked;
    questStates[questId].isDone = questData.effective_complete;
  });

  // The server only knows about saved values, so replay edits that are still in flight on top of its answer
  let hasPendingEdits = false;
  Object.values(questStates).forEach((questState) => {
    if (!hasPendingObjective(questState)) return;

    hasPendingEdits = true;
    applyQuestPreview(questStates, questState.id);
  });

  return hasPendingEdits;
}

export function calculateProgressSummary(questStates) {
  const questsSummary = {
    main_total: 0,
    optional_total: 0,
    completed_main: 0,
    completed_optional: 0,
  };
  const mainObjectiveValues = [];
  const optionalObjectiveValues = [];

  Object.values(questStates).forEach((questState) => {
    const objectiveValues = questState.isOptional
      ? optionalObjectiveValues
      : mainObjectiveValues;

    if (questState.isOptional) {
      questsSummary.optional_total += 1;
      if (questState.isDone) questsSummary.completed_optional += 1;
    } else {
      questsSummary.main_total += 1;
      if (questState.isDone) questsSummary.completed_main += 1;
    }

    // Mirrors the server: a locked Quest keeps its progress but counts as 0
    Object.values(questState.objectives).forEach((objective) => {
      objectiveValues.push(
        questState.isUnlocked ? calculateObjectiveProgress(objective) : 0,
      );
    });
  });

  return {
    questsSummary,
    mainRatio: calculateAverage(mainObjectiveValues),
    optionalRatio: calculateAverage(optionalObjectiveValues),
  };
}

export function calculateObjectiveProgress(objective) {
  if (objective.type === "checklistobjective") {
    return objective.isComplete ? 1 : 0;
  }

  if (objective.type === "sliderobjective") {
    if (objective.goalValue === objective.minValue) return 1;

    const progress =
      ((objective.currentValue ?? 0) - objective.minValue) /
      (objective.goalValue - objective.minValue);
    return Math.max(0, Math.min(progress, 1));
  }

  return 0;
}

export function hasPendingObjective(questState) {
  return Object.values(questState.objectives).some(
    (objective) =>
      objective.isComplete !== objective.confirmedIsComplete ||
      objective.currentValue !== objective.confirmedCurrentValue,
  );
}

function applyQuestPreview(questStates, questId) {
  const questState = questStates[questId];
  const wasDone = questState.isDone;

  questState.isDone = questState.isUnlocked && isQuestComplete(questState);

  if (wasDone !== questState.isDone) {
    applyNextQuestsPreview(questStates, questId);
  }
}

// Recalculates the Quests after a Quest whose done state just flipped, then recurses for each one that flips too
function applyNextQuestsPreview(questStates, flippedQuestId) {
  questStates[flippedQuestId].nextQuestIds.forEach((nextQuestId) => {
    const nextQuest = questStates[nextQuestId];
    const wasDone = nextQuest.isDone;

    nextQuest.isUnlocked = arePrerequisitesDone(questStates, nextQuest);
    nextQuest.isDone = nextQuest.isUnlocked && isQuestComplete(nextQuest);

    if (wasDone !== nextQuest.isDone) {
      applyNextQuestsPreview(questStates, nextQuestId);
    }
  });
}

function arePrerequisitesDone(questStates, questState) {
  return questState.prerequisiteIds.every((prerequisiteId) => {
    const prerequisite = questStates[prerequisiteId];

    // A required Quest never waits on an optional prerequisite
    if (!questState.isOptional && prerequisite.isOptional) return true;

    return prerequisite.isDone;
  });
}

function isQuestComplete(questState) {
  const objectives = Object.values(questState.objectives);

  return (
    objectives.length > 0 && objectives.every((objective) => objective.isComplete)
  );
}

function updateObjectiveValue(objective, value) {
  if (objective.type === "sliderobjective") {
    objective.currentValue = value;
    objective.isComplete = value >= objective.goalValue;
  } else {
    objective.isComplete = value;
  }
}

function isCurrentValue(objective, value) {
  return objective.type === "sliderobjective"
    ? objective.currentValue === value
    : objective.isComplete === value;
}

function calculateAverage(values) {
  if (values.length === 0) return 0;

  return values.reduce((total, value) => total + value, 0) / values.length;
}
