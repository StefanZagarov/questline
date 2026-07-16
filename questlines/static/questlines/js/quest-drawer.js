// One form serves both create and edit. The button that opens the drawer sets
// form.action; the submit handler just posts wherever it points.

const drawer = document.getElementById("quest-drawer");
const form = document.getElementById("quest-form");
const canvas = document.querySelector(".map-canvas"); // the coordinate space
const edges = document.querySelector("[data-edges]");

// The wording openDrawer() swaps per mode.
const crumb = document.querySelector("[data-drawer-crumb]");
const title = document.querySelector("[data-drawer-title]");
const lede = document.querySelector("[data-drawer-lede]");
const submit = document.querySelector("[data-submit-label]");

const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]").value;

// Snapshot the create URL before the pen overwrites form.action.
const createUrl = form.action;
const SVG_NS = "http://www.w3.org/2000/svg";

const CREATE_TEXT = {
  crumb: "✎ NEW QUEST",
  title: "CHART A QUEST",
  lede: "A node on the road. Name it, then it will show on the map.",
  submit: "⚔ CHART IT",
};

const EDIT_TEXT = {
  crumb: "✎ EDIT QUEST",
  title: "REDRAW A QUEST",
  lede: "Change what this stretch of the road demands.",
  submit: "⚔ REDRAW IT",
};

// ---- OPEN / CLOSE ----

document.querySelectorAll("[data-open-drawer]").forEach((button) => {
  button.addEventListener("click", () => {
    openDrawer(createUrl, CREATE_TEXT);
  });
});

document.querySelectorAll("[data-close-drawer]").forEach((button) => {
  button.addEventListener("click", () => {
    drawer.close();
  });
});

// Resets the drawer to a known state, then opens it. Prefill must come after.
function openDrawer(action, text) {
  form.reset(); // back to the HTML's values, i.e. blank
  clearErrors();
  form.action = action; // decides create vs edit

  // Undo the edit path's self-exclusion; form.reset() doesn't touch visibility.
  Array.from(form.elements.prerequisite_quests.options).forEach((option) => {
    option.hidden = false;
  });

  crumb.textContent = text.crumb;
  title.textContent = text.title;
  lede.textContent = text.lede;
  submit.textContent = text.submit;

  drawer.showModal(); // showModal, not show — backdrop, focus trap, Esc
}

// ---- ERRORS ----

// Empty every error box so old messages don't stack under the new ones.
function clearErrors() {
  document
    .querySelectorAll("[data-errors-for], [data-non-field-errors]")
    .forEach((box) => {
      box.innerHTML = "";
    });
}

// Paint Django's error JSON: {"title": [{"message": "...", "code": "..."}]}
function showErrors(errors) {
  Object.entries(errors).forEach(([fieldName, fieldErrors]) => {
    // "__all__" is Django's key for form-level errors → the top banner.
    const box =
      fieldName === "__all__"
        ? document.querySelector("[data-non-field-errors]")
        : document.querySelector(`[data-errors-for="${fieldName}"]`);

    if (!box) return; // field not rendered — bail rather than crash

    // Same markup Django renders, so the existing .errorlist CSS applies.
    const list = document.createElement("ul");
    list.className = "errorlist";

    fieldErrors.forEach((error) => {
      const item = document.createElement("li");
      item.textContent = error.message; // textContent, not innerHTML — XSS
      list.appendChild(item);
    });

    box.appendChild(list);
  });
}

// How far the curve pulls straight out of each edge before bending.
const EDGE_CURVE = 60;

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

// ---- SUBMIT (create + edit) ----

// On the form, not the button, so Enter in a text field works too.
form.addEventListener("submit", async (event) => {
  event.preventDefault(); // stop the browser's full-page POST
  clearErrors();

  // FormData reads the form's current state, csrfmiddlewaretoken included —
  // that's why no CSRF header here. form.action is whatever opened the drawer.
  const response = await fetch(form.action, {
    method: "POST",
    body: new FormData(form),
  });

  if (response.ok) {
    window.location.reload(); // discards the success JSON; keeps one source of truth
    return;
  }

  const data = await response.json();
  showErrors(data.errors);
});

// ---- EDIT ----

// Each pen carries its quest's values as data-*, so prefill needs no request.
document.querySelectorAll("[data-edit-quest]").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.closest("[data-quest-id]");
    const questId = group.dataset.questId;
    const editUrl = button.dataset.editUrl;
    const ids = group.dataset.prerequisites.split(",");

    openDrawer(editUrl, EDIT_TEXT); // resets, so prefill goes after

    form.elements.title.value = button.dataset.title;
    form.elements.is_optional.checked = button.dataset.optional === "1"; // dataset is always strings

    // A multi-select has no single value — selection lives per option.
    Array.from(form.elements.prerequisite_quests.options).forEach((option) => {
      const isSelf = option.value === questId; // a quest can't require itself
      option.hidden = isSelf;
      option.selected = !isSelf && ids.includes(option.value); // false clears the last quest's picks
    });
  });
});

// ---- MOVE ----

// A drag is three events stitched together, so the grab has to be remembered
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

    draggedGroup.style.left = `${left}px`;
    draggedGroup.style.top = `${top}px`;

    drawEdges();
  });

  // The drag is only visual until here — the DB still holds the old coords.
  group.addEventListener("pointerup", async () => {
    if (!draggedGroup) return;

    const moved = draggedGroup; // keep the reference; await outlives the flag
    draggedGroup = null;

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
});

// ---- DELETE ----

// No body: the URL names the quest and the view reads nothing from the POST.
document.querySelectorAll("[data-delete-quest]").forEach((button) => {
  button.addEventListener("click", async () => {
    const response = await fetch(button.dataset.deleteUrl, {
      method: "POST",
      headers: { "X-CSRFToken": csrfToken },
    });

    if (response.ok) {
      window.location.reload();
    }
  });
});

drawEdges();
