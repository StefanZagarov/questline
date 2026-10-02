import {
  applyObjectiveConfirmed,
  applyObjectivePreview,
  applyObjectiveRollback,
  calculateObjectiveProgress,
  calculateProgressSummary,
  createQuestStates,
} from "./adventure-state.js";

const canvas = document.querySelector(".adventure-canvas");
const edges = document.querySelector("[data-edges]");
const questlineState = document.querySelector("[data-questline-state]");
const completedMainQuestsCount = document.querySelector(
  "[data-completed-main-quests]",
);
const mainProgressPercent = document.querySelector(
  "[data-main-progress-percent]",
);
const mainProgressBar = document.querySelector("[data-main-progress-bar]");
const mainProgressBarFill = document.querySelector(
  "[data-main-progress-bar-fill]",
);

const SVG_NS = "http://www.w3.org/2000/svg";
const EDGE_CURVE = 60;
const VISIBLE_OBJECTIVE_ROWS = 5;
const CANVAS_BOTTOM_GUTTER = 32;
const QUICK_VIEW_TRANSITION_MS = 140;
const allQuests = document.querySelectorAll(".adventure-quest");
// Quest ID -> its wrapper, so rendering never searches the page per Quest
const questWrappers = {};
const questSeeds = [];
allQuests.forEach((quest) => {
  questWrappers[quest.dataset.questId] = quest;
  questSeeds.push({
    id: quest.dataset.questId,
    isOptional: quest.dataset.questIsOptional === "true",
    isUnlocked: quest.dataset.questIsUnlocked === "true",
    isDone: quest.dataset.questEffectiveComplete === "true",
    prerequisiteIds: quest.dataset.prerequisites
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean), // prevents [""] array if prerequisite quests do not exist
    objectives: JSON.parse(quest.dataset.questObjectives),
  });
});
// The page's datasets are only the starting point; from here on this object is the source of truth
const questStates = createQuestStates(questSeeds);

function limitObjectiveLists() {
  document.querySelectorAll(".objective-quick-list").forEach((list) => {
    const rows = [...list.querySelectorAll(".objective-quick-row")];
    list.style.removeProperty("max-height");

    if (rows.length <= VISIBLE_OBJECTIVE_ROWS) return;

    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    const visibleRowsHeight = rows
      .slice(0, VISIBLE_OBJECTIVE_ROWS)
      .reduce((height, row) => height + row.getBoundingClientRect().height, 0);

    list.style.maxHeight = `${Math.ceil(
      visibleRowsHeight + gap * (VISIBLE_OBJECTIVE_ROWS - 1),
    )}px`;
  });
}

function fitAdventureCanvas() {
  if (!canvas) return;

  const minimumHeight =
    Number.parseFloat(getComputedStyle(canvas).minHeight) || 680;
  let requiredHeight = minimumHeight;

  document.querySelectorAll(".adventure-quest").forEach((questGroup) => {
    let groupBottom = questGroup.offsetTop + questGroup.offsetHeight;
    const openQuickView = questGroup.querySelector(
      ".objective-quick-view.is-open",
    );

    if (openQuickView) {
      groupBottom = Math.max(
        groupBottom,
        questGroup.offsetTop +
          openQuickView.offsetTop +
          openQuickView.offsetHeight,
      );
    }

    requiredHeight = Math.max(
      requiredHeight,
      groupBottom + CANVAS_BOTTOM_GUTTER,
    );
  });

  canvas.style.height = `${Math.ceil(requiredHeight)}px`;
}

function updateAdventureLayout() {
  limitObjectiveLists();
  fitAdventureCanvas();
}

document.querySelectorAll(".quest-objective-toggle").forEach((button) => {
  const questGroup = button.closest(".adventure-quest");
  const quickView = questGroup?.querySelector(".objective-quick-view");

  if (!quickView) return;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = button.getAttribute("aria-expanded") !== "true";

    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute(
      "aria-label",
      `${isOpen ? "Hide" : "Show"} Quest Objectives`,
    );

    if (isOpen) {
      quickView.hidden = false;
      window.requestAnimationFrame(() => {
        quickView.classList.add("is-open");
        updateAdventureLayout();
      });
    } else {
      quickView.classList.remove("is-open");
      window.setTimeout(() => {
        if (button.getAttribute("aria-expanded") === "false") {
          quickView.hidden = true;
        }
        updateAdventureLayout();
      }, QUICK_VIEW_TRANSITION_MS);
    }
  });
});

// The card link's href is a placeholder; clicking the Quest wrapper opens the drawer instead.
document.querySelectorAll(".adventure-card-frame .qcard").forEach((card) => {
  card.addEventListener("click", (event) => event.preventDefault());
});

// Return the point on one Quest group's edge that faces another group, plus the
// direction in which the curve should leave that edge.
function getEdgeAnchor(group, otherGroup) {
  const centerX = group.offsetLeft + group.offsetWidth / 2;
  const centerY = group.offsetTop + group.offsetHeight / 2;
  const otherCenterX = otherGroup.offsetLeft + otherGroup.offsetWidth / 2;
  const otherCenterY = otherGroup.offsetTop + otherGroup.offsetHeight / 2;

  const horizontalDistance = otherCenterX - centerX;
  const verticalDistance = otherCenterY - centerY;

  if (Math.abs(horizontalDistance) > Math.abs(verticalDistance)) {
    return {
      x:
        horizontalDistance > 0
          ? group.offsetLeft + group.offsetWidth
          : group.offsetLeft,
      y: centerY,
      directionX: horizontalDistance > 0 ? 1 : -1,
      directionY: 0,
    };
  }

  return {
    x: centerX,
    y:
      verticalDistance > 0
        ? group.offsetTop + group.offsetHeight
        : group.offsetTop,
    directionX: 0,
    directionY: verticalDistance > 0 ? 1 : -1,
  };
}

function drawEdges() {
  if (!canvas || !edges) return;

  edges.replaceChildren();
  allQuests.forEach((questGroup) => {
    const prerequisiteIds = questGroup.dataset.prerequisites
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    prerequisiteIds.forEach((prerequisiteId) => {
      const prerequisiteGroup = questWrappers[prerequisiteId];

      if (!prerequisiteGroup) return;

      const start = getEdgeAnchor(prerequisiteGroup, questGroup);
      const end = getEdgeAnchor(questGroup, prerequisiteGroup);
      const firstControlX = start.x + start.directionX * EDGE_CURVE;
      const firstControlY = start.y + start.directionY * EDGE_CURVE;
      const secondControlX = end.x + end.directionX * EDGE_CURVE;
      const secondControlY = end.y + end.directionY * EDGE_CURVE;

      const path = document.createElementNS(SVG_NS, "path");
      const sourceIsComplete = questStates[prerequisiteId].isDone;
      const targetIsOptional = questStates[questGroup.dataset.questId].isOptional;

      path.classList.add(
        "map-edge",
        sourceIsComplete ? "is-complete" : "is-locked",
      );

      if (targetIsOptional) path.classList.add("is-optional");

      path.setAttribute(
        "d",
        `M ${start.x} ${start.y} C ${firstControlX} ${firstControlY}, ${secondControlX} ${secondControlY}, ${end.x} ${end.y}`,
      );
      edges.appendChild(path);
    });
  });
}

export function getQuestState(questId) {
  return questStates[questId];
}

export function updateObjectivePreview(questId, objectiveId, value) {
  applyObjectivePreview(questStates, questId, objectiveId, value);
  updateQuickObjective(questId, objectiveId);
  updateQuestCards();
  updateOptimisticProgressHud();
  drawEdges();
}

export function updateObjectiveRollback(questId, objectiveId, sentValue) {
  applyObjectiveRollback(questStates, questId, objectiveId, sentValue);
  updateQuickObjective(questId, objectiveId);
  updateQuestCards();
  updateOptimisticProgressHud();
  drawEdges();
}

export function updateObjectiveConfirmed(response, sentValue) {
  const hasPendingEdits = applyObjectiveConfirmed(
    questStates,
    response,
    sentValue,
  );
  updateQuickObjective(
    String(response.changed_objective.quest_id),
    String(response.changed_objective.id),
  );
  updateQuestCards();

  // With no edits in flight the server's numbers are exact; otherwise they miss the pending edits
  hasPendingEdits
    ? updateOptimisticProgressHud()
    : updateProgressHud(
        response.quests_summary,
        response.main_questline_progress_ratio,
        response.optional_questline_progress_ratio,
      );
  drawEdges();
}

function updateQuestCards() {
  Object.values(questStates).forEach((questState) => {
    const questCard = questWrappers[questState.id].querySelector(".qcard");

    updateQuestCard(questCard, questState.isDone, questState.isUnlocked);
  });
}

function updateQuickObjective(questId, objectiveId) {
  const objective = questStates[questId].objectives[objectiveId];
  const questQuickObjective = questWrappers[questId].querySelector(
    `.objective-quick-row-${objectiveId}`,
  );

  objective.isComplete
    ? questQuickObjective.classList.add("is-complete")
    : questQuickObjective.classList.remove("is-complete");

  if (objective.type !== "sliderobjective") return;

  questQuickObjective.querySelector(".objective-quick-value").textContent =
    objective.currentValue;
  questQuickObjective.querySelector(".objective-mini-fill").style.width = `${
    calculateObjectiveProgress(objective) * 100
  }%`;
}

function updateOptimisticProgressHud() {
  const progressSummary = calculateProgressSummary(questStates);

  updateProgressHud(
    progressSummary.questsSummary,
    progressSummary.mainRatio,
    progressSummary.optionalRatio,
  );
}

function updateQuestCard(mapQuest, isComplete, isUnlocked) {
  if (isUnlocked && isComplete) {
    mapQuest.classList.add("qcard-done");

    mapQuest.classList.remove("qcard-open", "glow");
    mapQuest.classList.remove("qcard-locked");
  } else if (isUnlocked) {
    mapQuest.classList.add("qcard-open", "glow");

    mapQuest.classList.remove("qcard-done");
    mapQuest.classList.remove("qcard-locked");
  } else {
    mapQuest.classList.add("qcard-locked");

    mapQuest.classList.remove("qcard-open", "glow");
    mapQuest.classList.remove("qcard-done");
  }
}

function updateProgressHud(
  questSummary,
  mainQuestlineProgressRatio,
  optionalQuestlineProgressRatio,
) {
  const optionalProgressPercent = document.querySelector(
    "[data-optional-progress-percent]",
  );
  if (optionalProgressPercent) {
    optionalProgressPercent.textContent = `✦ BONUS ${roundHalfToEven(optionalQuestlineProgressRatio * 100)}%`;
  }

  if (
    questSummary.main_total > 0 &&
    questSummary.completed_main === questSummary.main_total
  ) {
    questlineState.textContent = "★ QUESTLINE COMPLETED";
  } else {
    questlineState.textContent = "⚑ ADVENTURE IN PROGRESS";
  }

  const mainProgressPercentValue = roundHalfToEven(
    mainQuestlineProgressRatio * 100,
  );
  completedMainQuestsCount.textContent = `${questSummary.completed_main} / ${questSummary.main_total} QUESTS`;
  mainProgressPercent.textContent = `${mainProgressPercentValue}%`;
  mainProgressBar.setAttribute("aria-valuenow", mainProgressPercentValue);
  mainProgressBarFill.style.width = `${mainProgressPercentValue}%`;
}

// Synchronise how JavaScript should round to how Python rounds with its quirk: Even numbers that end on exactly .5 are rounded down in python
function roundHalfToEven(float) {
  if (Math.trunc(float) % 2 === 0 && float % 1 === 0.5)
    return Math.floor(float);

  return Math.round(float);
}

updateAdventureLayout();
drawEdges();
window.addEventListener("load", () => {
  updateAdventureLayout();
  drawEdges();
});
window.addEventListener("resize", () => {
  updateAdventureLayout();
  drawEdges();
});

document.fonts?.ready.then(updateAdventureLayout);
