const canvas = document.querySelector(".adventure-canvas");
const edges = document.querySelector("[data-edges]");

const SVG_NS = "http://www.w3.org/2000/svg";
const EDGE_CURVE = 60;

document.querySelectorAll(".quest-objective-toggle").forEach((button) => {
  const questGroup = button.closest(".adventure-quest");
  const quickView = questGroup?.querySelector(".objective-quick-view");

  if (!quickView) return;

  button.addEventListener("click", () => {
    const isOpen = quickView.classList.toggle("is-open");

    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute(
      "aria-label",
      `${isOpen ? "Hide" : "Show"} Quest Objectives`,
    );
  });
});

// Adventure cards are read-only in this slice; the chevron owns the interaction.
document.querySelectorAll(".adventure-card-frame .qcard").forEach((card) => {
  card.addEventListener("click", (event) => event.preventDefault());
});

// Return the point on one Quest group's edge that faces another group, plus the
// direction in which the curve should leave that edge.
function anchor(group, otherGroup) {
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

  document.querySelectorAll(".adventure-quest").forEach((questGroup) => {
    const prerequisiteIds = questGroup.dataset.prerequisites
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    prerequisiteIds.forEach((prerequisiteId) => {
      const prerequisiteGroup = document.querySelector(
        `[data-quest-id="${prerequisiteId}"]`,
      );

      if (!prerequisiteGroup) return;

      const start = anchor(prerequisiteGroup, questGroup);
      const end = anchor(questGroup, prerequisiteGroup);
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

drawEdges();
window.addEventListener("load", drawEdges);
window.addEventListener("resize", drawEdges);
