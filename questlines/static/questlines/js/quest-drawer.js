const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]").value;

// One form serves both create and edit. The button that opens the drawer sets
// form.action; the submit handler just posts wherever it points.
const form = document.getElementById("quest-form");
const drawer = document.getElementById("quest-drawer");

// The wording openDrawer() swaps per mode.
const crumb = document.querySelector("[data-drawer-crumb]");
const title = document.querySelector("[data-drawer-title]");
const lede = document.querySelector("[data-drawer-lede]");
const submit = document.querySelector("[data-submit-label]");

// Objectives
const objectivesList = document.querySelector("[data-objective-list]");
const objectiveBtns = document.querySelectorAll("[data-add-objective]");
// Hidden input field - when form snapshots the data, this sends the objectives as a JSON format data
const objectivesData = document.getElementById("id_objectives_data");

// Snapshot the create URL before the pen overwrites form.action.
const createUrl = form.action;

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

// Backdrop click: showModal() reports a ::backdrop hit as target === the dialog
// itself; a click inside the form targets a child, so this only fires outside.
drawer.addEventListener("click", (event) => {
  if (event.target === drawer) drawer.close();
});

// Resets the drawer to a known state, then opens it. Prefill must come after.
function openDrawer(action, text) {
  form.reset(); // back to the HTML's default values, i.e. blank
  objectivesList.replaceChildren(); // Cloned rows aren't form fields; reset from the line above won't remove them
  clearErrors();
  form.action = action; // decides create vs edit

  form
    .querySelectorAll('input[name="prerequisite_quests"]')
    .forEach((input) => {
      input.closest("label").hidden = false;
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

// ---- SUBMIT (create + edit) ----

// On the form, not the button, so Enter in a text field works too.
form.addEventListener("submit", async (event) => {
  event.preventDefault(); // stop the browser's full-page POST
  clearErrors();

  // Objectives data assignment to the form
  // A NodeList of every drafted row
  const rowsData = objectivesList.querySelectorAll(".objective-row");
  const objectivesArray = [];
  // Turn each row into an object
  rowsData.forEach((row, index) => {
    const dataObj = {
      type: row.dataset.type,
      order: index,
    };
    row.querySelectorAll("[data-field]").forEach((field) => {
      dataObj[field.dataset.field] = field.value;
    });
    objectivesArray.push(dataObj);
  });

  const objectivesString = JSON.stringify(objectivesArray);
  objectivesData.value = objectivesString;
  console.log(objectivesData.value);

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

    const objectives = JSON.parse(button.dataset.objectives);
    // This is the packer run backwards
    objectives.forEach((objective) => {
      const template = document.querySelector(
        `[data-row-template="${objective.type}"]`,
      );
      const clone = template.content.cloneNode(true);
      clone.querySelectorAll("[data-field]").forEach((field) => {
        // Key by data-field name - mirrors the packer
        field.value = objective[field.dataset.field];
      });
      objectivesList.appendChild(clone);
    });

    form.elements.title.value = button.dataset.title;
    form.elements.description.value = button.dataset.description;
    form.elements.is_optional.checked = button.dataset.optional === "1"; // dataset is always strings

    // Checkboxes share a name, not a value — selection lives per input.
    form
      .querySelectorAll('input[name="prerequisite_quests"]')
      .forEach((input) => {
        const isSelf = input.value === questId; // a quest can't require itself
        input.closest("label").hidden = isSelf; // hide the row, not just the box
        input.checked = !isSelf && ids.includes(input.value); // false clears the last quest's picks
      });
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

// ---- OBJECTIVE ADD ----
objectiveBtns.forEach((btn) =>
  btn.addEventListener("click", () => {
    // Get the objective type from the dataset of the button
    const type = btn.dataset.addObjective;
    // Get the exact objective type from the button
    const template = document.querySelector(`[data-row-template="${type}"]`);

    // Clone its fields
    const clonedTemplate = template.content.cloneNode(true);
    // Apply the fields to the empty objectives list div as a child element
    objectivesList.appendChild(clonedTemplate);
  }),
);

// The delete objective button won't work as is becasue fields don't exist yet. So we delegate the work to the objectivesList - on the event we click the X delete button, the fields already exist, so we remove them from its list
objectivesList.addEventListener("click", (e) => {
  const target = e.target.closest("[data-remove-objective]");

  if (target === null) return;

  target.closest(".objective-row").remove();
});

// Clamping slider min/max/current values
// Focus out is like blur, but unlike it, it bubbles up
objectivesList.addEventListener("focusout", (e) => {
  const row = e.target.closest(".objective-row");
  if (!row || row.dataset.type !== "sliderobjective") return;

  const minInput = row.querySelector('[data-field="min_value"]');
  const maxInput = row.querySelector('[data-field="max_value"]');
  const targetInput = row.querySelector('[data-field="target_value"]');

  let min = Number(minInput.value);
  let max = Number(maxInput.value);
  let target = Number(targetInput.value);

  if (min > max) {
    [min, max] = [max, min];
  }

  target = Math.min(Math.max(target, min), max);

  minInput.value = min;
  maxInput.value = max;
  targetInput.value = target;
});
