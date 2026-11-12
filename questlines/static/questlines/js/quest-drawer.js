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

form.elements.is_optional.addEventListener("change", () => {
  filterPrerequisiteList();
});

// Resets the drawer to a known state, then opens it. Prefill must come after.
function openDrawer(action, text) {
  form.reset(); // back to the HTML's default values, i.e. blank
  objectivesList.replaceChildren(); // Cloned rows aren't form fields; reset from the line above won't remove them
  clearErrors();
  form.action = action; // decides create vs edit
  form.dataset.formQuestId = "";

  filterPrerequisiteList();

  crumb.textContent = text.crumb;
  title.textContent = text.title;
  lede.textContent = text.lede;
  submit.textContent = text.submit;

  drawer.showModal(); // showModal, not show — backdrop, focus trap, Esc
}

function filterPrerequisiteList() {
  const thisQuestIsOptional = form.elements.is_optional.checked;

  form
    .querySelectorAll('input[name="prerequisite_quests"]')
    .forEach((input) => {
      // Check each quest if it's optional, then hide it for this quest, if the quest itself is non-optional
      const otherQuest = document.querySelector(
        `[data-quest-id="${input.value}"]`,
      );
      const otherQuestIsOptional =
        otherQuest.querySelector("[data-optional]").dataset.optional === "1";

      if (
        (!thisQuestIsOptional && otherQuestIsOptional) ||
        input.value === form.dataset.formQuestId
      ) {
        input.closest("label").hidden = true;
      } else {
        input.closest("label").hidden = false;
      }
    });
}

// ---- ERRORS ----
// Empty every error box so old messages don't stack under the new ones.
function clearErrors() {
  document
    .querySelectorAll(
      "[data-errors-for], [data-non-field-errors], [data-row-errors-for]",
    )
    .forEach((box) => {
      box.innerHTML = "";
    });
}

function fillErrorBox(box, fieldErrors) {
  // Same markup Django renders, so the existing .errorlist CSS applies.
  const list = document.createElement("ul");
  list.className = "errorlist";

  fieldErrors.forEach((error) => {
    const item = document.createElement("li");
    item.textContent = error.message; // textContent, not innerHTML — XSS
    list.appendChild(item);
  });

  box.appendChild(list);
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

    fillErrorBox(box, fieldErrors);
  });
}

function showObjectiveErrors(objectiveErrors) {
  const rows = objectivesList.querySelectorAll(".objective-row");

  objectiveErrors.forEach((objectiveError) => {
    const row = rows[objectiveError.order];

    if (!row) return;

    Object.entries(objectiveError.fields).forEach(
      ([fieldName, fieldErrors]) => {
        const box = row.querySelector(`[data-row-errors-for="${fieldName}"]`);

        if (!box) return;

        fillErrorBox(box, fieldErrors);
      },
    );
  });
}

// ---- SUBMIT (create + edit) ----

// On the form, not the button, so Enter in a text field works too.
form.addEventListener("submit", async (event) => {
  event.preventDefault(); // stop the browser's full-page POST
  clearErrors();

  // If the quest is non-optional, but has ticked optional quests as prerequisites, remove the optional quests as prerequisite by unticking them. Side effect: it unticks itself every time. Harmless, acts as additional security against selecting itself
  form.querySelectorAll("label[hidden]").forEach((label) => {
    label.querySelector("input").checked = false;
  });

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

  if (data.errors) {
    showErrors(data.errors);
  }

  if (data.objective_errors) {
    showObjectiveErrors(data.objective_errors);
  }
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
    form.dataset.formQuestId = questId;

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

    filterPrerequisiteList();
    form
      .querySelectorAll('input[name="prerequisite_quests"]')
      .forEach((input) => {
        const isSelf = input.value === questId; // a quest can't require itself
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

// Clamping slider min/goal values
// Focus out is like blur, but unlike it, it bubbles up
objectivesList.addEventListener("focusout", (e) => {
  const row = e.target.closest(".objective-row");
  if (!row || row.dataset.type !== "sliderobjective") return;

  const minInput = row.querySelector('[data-field="min_value"]');
  const goalInput = row.querySelector('[data-field="goal_value"]');

  let min = Number(minInput.value);
  let goal = Number(goalInput.value);

  if (min > goal) {
    [min, goal] = [goal, min];
  } else if (min === goal) {
    goal += 1;
  }

  minInput.value = min;
  goalInput.value = goal;
});
