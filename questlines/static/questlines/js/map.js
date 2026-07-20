const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]").value;

const canvas = document.querySelector(".map-canvas"); // the coordinate space
const edges = document.querySelector("[data-edges]");

const SVG_NS = "http://www.w3.org/2000/svg";

// How far the curve pulls straight out of each edge before bending.
const EDGE_CURVE = 60;
// Breathing room a card keeps from the border, all four sides. Must be >= the 10px
// .qcard-actions overhang in questline-map.css, or its buttons cross the edge.
const CARD_GUTTER = 10;

// The point on `box`'s edge that faces `other`, plus which way that edge faces.
function anchor(box, other) {
  const cx = box.offsetLeft + box.offsetWidth / 2; // this card's centre
  const cy = box.offsetTop + box.offsetHeight / 2;
  const ox = other.offsetLeft + other.offsetWidth / 2; // the other card's centre
  const oy = other.offsetTop + other.offsetHeight / 2;

  const dx = ox - cx; // how far right the other card is (negative = left)
  const dy = oy - cy; // how far down  the other card is (negative = up)

  if (Math.abs(dx) > Math.abs(dy)) {
    // mostly side by side → leave from the left or right edge, at mid-height
    return {
      x: dx > 0 ? box.offsetLeft + box.offsetWidth : box.offsetLeft,
      y: cy,
      dx: dx > 0 ? 1 : -1, // facing right or left
      dy: 0,
    };
  }

  // mostly stacked → leave from the top or bottom edge, at mid-width
  return {
    x: cx,
    y: dy > 0 ? box.offsetTop + box.offsetHeight : box.offsetTop,
    dx: 0,
    dy: dy > 0 ? 1 : -1, // facing down or up
  };
}

function drawEdges() {
  edges.replaceChildren();

  document.querySelectorAll(".qgroup").forEach((group) => {
    const ids = group.dataset.prerequisites.split(",").filter(Boolean);

    ids.forEach((id) => {
      const from = document.querySelector(`[data-quest-id="${id}"]`);
      if (!from) return;

      const a = anchor(from, group); // on the prerequisite, facing this quest
      const b = anchor(group, from); // on this quest, facing the prerequisite

      // Control points sit straight out from each edge, so the curve leaves and
      // arrives perpendicular to the card instead of just bending. They are
      // magnets — the line never touches them.
      const c1x = a.x + a.dx * EDGE_CURVE;
      const c1y = a.y + a.dy * EDGE_CURVE;
      const c2x = b.x + b.dx * EDGE_CURVE;
      const c2y = b.y + b.dy * EDGE_CURVE;

      // <path>, not <line>: a line has two points, a cubic bézier needs four.
      // d = "M start C control1, control2, end"
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", "map-edge");
      path.setAttribute(
        "d",
        `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`,
      );
      edges.appendChild(path);
    });
  });
}

// ---- MOVE ----

// A drag is four events stitched together, so the grab has to be remembered
// between them — hence module scope rather than consts inside the handler.
// draggedGroup also answers "is a drag happening?", since pointermove fires on
// plain hover too.
let draggedGroup = null;
let grabX = 0;
let grabY = 0;

document.querySelectorAll(".qgroup").forEach((group) => {
  group.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    event.preventDefault(); // .qcard is an <a> — stops the native drag ghost

    const rectangle = group.getBoundingClientRect(); // viewport coords, like clientX/Y

    draggedGroup = group;
    group.classList.add("is-dragging"); // drives the grabbing cursor + z-index
    grabX = event.clientX - rectangle.left; // how far into the card we grabbed
    grabY = event.clientY - rectangle.top;

    // Keeps this pointer's events coming here even once the cursor leaves.
    group.setPointerCapture(event.pointerId);
  });

  group.addEventListener("pointermove", (event) => {
    if (draggedGroup === null) return; // hover, not a drag

    // pointer − canvas position − grab = the card's left/top inside the canvas.
    // Rect is read live, so a scrolled canvas needs no correction.
    const canvasRect = canvas.getBoundingClientRect();
    const left = event.clientX - canvasRect.left - grabX;
    const top = event.clientY - canvasRect.top - grabY;

    // The furthest a card's edge can sit and still keep its buttons inside.
    const maxHorizontalPosition =
      canvas.clientWidth - group.offsetWidth - CARD_GUTTER;
    // Clamp: lift to the gutter, then cap at the far edge. Both bounds usually
    // lose — they only win once the card has been dragged past them.
    const clampedHorizontalPosition = Math.min(
      Math.max(left, CARD_GUTTER),
      maxHorizontalPosition,
    );

    const maxVerticalPosition =
      canvas.clientHeight - group.offsetHeight - CARD_GUTTER;
    const clampedVerticalPosition = Math.min(
      Math.max(top, CARD_GUTTER),
      maxVerticalPosition,
    );

    draggedGroup.style.left = `${clampedHorizontalPosition}px`;
    draggedGroup.style.top = `${clampedVerticalPosition}px`;

    drawEdges();
  });

  // The drag is only visual until here — the DB still holds the old coords.
  group.addEventListener("pointerup", async () => {
    if (!draggedGroup) return;

    const moved = draggedGroup; // keep the reference; await outlives the flag
    draggedGroup = null;
    moved.classList.remove("is-dragging");

    // When cursor releases, make a form with the x and y coordinates of the dragged card to send to the BE so they can be stored in the database, surviving reloads and app restarts
    const body = new FormData(); // no form to read, so build one
    body.append("coord_x", parseFloat(moved.style.left)); // "360px" → 360
    body.append("coord_y", parseFloat(moved.style.top));

    const response = await fetch(moved.dataset.moveUrl, {
      method: "POST",
      headers: { "X-CSRFToken": csrfToken }, // hand-built body has no token in it
      body,
    });

    // Nothing to do on success — the card is already there. On failure the page
    // is lying about what's stored, so reload to the truth.
    if (!response.ok) {
      window.location.reload();
    }
  });

  // The browser can revoke a pointer mid-drag (OS gesture, interrupted touch) —
  // then pointerup never fires and draggedGroup would stay set, so the next plain
  // hover would drag the card with no button held. No POST: the card never landed
  // anywhere deliberate, so it keeps its old coords and snaps back on next load.
  group.addEventListener("pointercancel", () => {
    if (!draggedGroup) return;

    draggedGroup.classList.remove("is-dragging");
    draggedGroup = null;
  });
});

drawEdges();
