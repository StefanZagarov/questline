const canvas = document.querySelector(".adventure-canvas");
const edges = document.querySelector("[data-edges]");

const SVG_NS = "http://www.w3.org/2000/svg";
const EDGE_CURVE = 60;
const VISIBLE_OBJECTIVE_ROWS = 5;
const CANVAS_BOTTOM_GUTTER = 32;
const QUICK_VIEW_TRANSITION_MS = 140;
const allQuests = document.querySelectorAll(".adventure-quest");
// Prerequisite ID -> IDs of the Quests that list it as a prerequisite
const questsLookup = {};
allQuests.forEach((quest) => {
  const prerequisites = quest.dataset.prerequisites
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean); // prevents [""] array if prerequisite quests do not exist

  prerequisites.forEach((prerequisiteId) => {
    questsLookup[prerequisiteId] ??= [];
    questsLookup[prerequisiteId].push(quest.dataset.questId);
  });
});

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

// Adventure cards are read-only in this slice; the chevron owns the interaction.
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
      const prerequisiteGroup = document.querySelector(
        `[data-quest-id="${prerequisiteId}"]`,
      );

      if (!prerequisiteGroup) return;

      const start = getEdgeAnchor(prerequisiteGroup, questGroup);
      const end = getEdgeAnchor(questGroup, prerequisiteGroup);
      const firstControlX = start.x + start.directionX * EDGE_CURVE;
      const firstControlY = start.y + start.directionY * EDGE_CURVE;
      const secondControlX = end.x + end.directionX * EDGE_CURVE;
      const secondControlY = end.y + end.directionY * EDGE_CURVE;

      const path = document.createElementNS(SVG_NS, "path");
      const sourceIsComplete = prerequisiteGroup
        .querySelector(".qcard")
        ?.classList.contains("qcard-done");
      const targetIsOptional = questGroup
        .querySelector(".qcard")
        ?.classList.contains("qcard-optional");

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

export function updateConfirmedQuestCards(questsResponse) {
  Object.entries(questsResponse).forEach(([questId, questData]) => {
    const mapQuest = document.querySelector(
      `[data-quest-id="${questId}"] .qcard`,
    );

    updateQuestCard(
      mapQuest,
      questData.effective_complete,
      questData.is_unlocked,
    );
  });
}

export function updateOptimisticQuestCards(quest) {
  const questCard = quest.querySelector(".qcard");
  // We use the quick view objectives here since they update optimistically, so before the server response, we use that to further draw optimistic data
  const questQuickObjectives = quest.querySelectorAll(".objective-quick-row");
  const completeQuestQuickObjectives = quest.querySelectorAll(
    ".objective-quick-row.is-complete",
  );
  const isComplete =
    questQuickObjectives.length === completeQuestQuickObjectives.length;
  const isUnlocked = quest.dataset.questIsUnlocked === "true";
  // Read the card before the redraw to detect whether this edit flipped the Quest
  const previouslyComplete = questCard.classList.contains("qcard-done");

  updateQuestCard(questCard, isComplete, isUnlocked);

  // Optimistically update the linked quest cards
  if (previouslyComplete !== isComplete) {
    updateOptimisticNextQuestCard(quest.dataset.questId);
  }
}

// Previews the Quests after a Quest whose done state just flipped, then recurses for each one that flips too
function updateOptimisticNextQuestCard(flippedQuestId) {
  const nextQuests = questsLookup[flippedQuestId] ?? [];

  nextQuests.forEach((questId) => {
    const nextQuest = document.querySelector(`[data-quest-id="${questId}"]`);
    const nextQuestQuickObjectives = nextQuest.querySelectorAll(
      ".objective-quick-row",
    );
    const nextCompleteQuestQuickObjectives = nextQuest.querySelectorAll(
      ".objective-quick-row.is-complete",
    );

    const nextQuestCard = nextQuest.querySelector(".qcard");

    // Protect from quest with empty objectives - return false. Otherwise check if the length of objectives matches the length of the completed objectives in quick view elements (the dropdown on each quest card) since there it holds the optimistic complete
    const nextQuestIsComplete =
      nextQuestQuickObjectives.length > 0 &&
      nextQuestQuickObjectives.length ===
        nextCompleteQuestQuickObjectives.length;
    const prerequisiteQuestsIds = nextQuest.dataset.prerequisites
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    // Unlocked only if every prerequisite card currently shows done, optimistic redraws included
    const prerequisiteQuestsAreUnlocked = prerequisiteQuestsIds.every((id) => {
      const questCard = document.querySelector(
        `[data-quest-id="${id}"] .qcard`,
      );

      // If this quest is optional, and the next one is not optional, skip the optional prerequisite, i.e. automatically unlock the next quest, as long as it's the only prerequisite for the next quest
      if (
        nextQuest.dataset.questIsOptional === "false" &&
        questCard.closest(".adventure-quest").dataset.questIsOptional === "true"
      )
        return true;

      return questCard.classList.contains("qcard-done");
    });
    // Read before the redraw so the flip check compares old and new state
    const wasQuestComplete = nextQuestCard.classList.contains("qcard-done");

    updateQuestCard(
      nextQuestCard,
      nextQuestIsComplete,
      prerequisiteQuestsAreUnlocked,
    );

    // Recurse after the redraw so the next Quests read this Quest's new state; stop when it did not flip
    if (
      wasQuestComplete !==
      (nextQuestIsComplete && prerequisiteQuestsAreUnlocked)
    ) {
      updateOptimisticNextQuestCard(nextQuest.dataset.questId);
    }
  });
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
