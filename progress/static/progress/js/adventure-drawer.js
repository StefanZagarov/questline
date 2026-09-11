const quests = document.querySelectorAll(".adventure-quest");
const drawer = document.getElementById("adventure-drawer");
const adventureNoteField = drawer.querySelector("[data-adventure-note]");
const adventureNoteStatus = drawer.querySelector(
  "[data-adventure-note-status]",
);

let selectedAdventureNoteUpdateUrl = "";
let confirmedAdventureNoteContent = "";
let adventureNoteSaveTimer;

quests.forEach((quest) => {
  quest.addEventListener("click", (event) => {
    const clickedItem = event.currentTarget;
    const data = clickedItem.dataset;

    const crumb = drawer.querySelector("[data-adventure-crumb]");
    const isOptional = data.questIsOptional === "true" ? true : false;

    crumb.textContent = isOptional
      ? ""
      : `QUEST ${data.questIndex} OF ${data.questTotal}`;
    drawer.querySelector("[data-adventure-optional]").hidden = !isOptional;

    drawer.querySelector("[data-quest-title]").textContent = data.questTitle;

    const description = drawer.querySelector("[data-quest-description]");
    description.hidden = data.questDescription === "";
    description.textContent = data.questDescription;

    const prerequisitesWrapper = drawer.querySelector(
      "[data-prerequisites-line]",
    );
    const prerequisiteQuests = drawer.querySelector(
      "[data-prerequisites-titles]",
    );
    const prerequisiteQuestsArray = JSON.parse(data.prerequisitesTitles);
    prerequisiteQuests.replaceChildren();
    prerequisitesWrapper.hidden = prerequisiteQuestsArray.length === 0;

    prerequisiteQuestsArray.forEach((title, index) => {
      const prerequisite = document.createElement("strong");
      prerequisite.textContent = title;
      prerequisiteQuests.appendChild(prerequisite);

      if (index < prerequisiteQuestsArray.length - 1) {
        prerequisiteQuests.appendChild(document.createTextNode(", "));
      }
    });

    const objectives = JSON.parse(data.questObjectives);
    const objectiveValues = Object.values(objectives);
    drawer.querySelector("[data-objectives-count]").textContent =
      `${objectiveValues.filter((objective) => objective.is_complete).length} / ${objectiveValues.length}\u00A0\u00A0DONE`;

    const objectivesContainer = drawer.querySelector("[data-quest-objectives]");
    const emptyObjectivesMessage = drawer.querySelector("[data-empty-quest]");
    const controlsDisabled =
      data.questIsUnlocked !== "true" || data.questIsInvalid === "true";

    // Since the same drawer is reused, we need to clear previously drawn quests
    objectivesContainer.replaceChildren();
    objectivesContainer.hidden = objectiveValues.length === 0;
    emptyObjectivesMessage.hidden = objectiveValues.length !== 0;

    objectiveValues.forEach((objective) => {
      const template = drawer.querySelector(
        `[data-objective-template="${objective.type}"]`,
      );
      if (!template) return;

      const objectiveRow = template.content.cloneNode(true);
      objectiveRow.querySelector("[data-objective-title]").textContent =
        objective.title;

      const detail = objectiveRow.querySelector("[data-objective-detail]");
      detail.hidden = !objective.description;
      objectiveRow.querySelector("[data-objective-description]").textContent =
        objective.description;

      const input = objectiveRow.querySelector("[data-objective-input]");
      const errorMessage = objectiveRow.querySelector("[data-objective-error]");
      input.disabled = controlsDisabled;

      if (objective.type === "checklistobjective") {
        let confirmedChecked = objective.is_complete;
        input.checked = confirmedChecked;
        input.addEventListener("change", async (event) => {
          errorMessage.hidden = true;
          errorMessage.textContent = "";

          const body = new FormData();
          body.append("is_complete", String(event.currentTarget.checked));

          const csrfToken = document.querySelector(
            "[name=csrfmiddlewaretoken]",
          ).value;

          try {
            const response = await fetch(objective.update_url, {
              method: "POST",
              headers: {
                "X-CSRFToken": csrfToken,
              },
              body,
            });

            const responseData = await response.json();

            // response.ok still handles server-reported HTTP errors.
            if (!response.ok) {
              input.checked = confirmedChecked;
              errorMessage.textContent = responseData.error;
              errorMessage.hidden = false;
              return;
            }

            confirmedChecked = responseData.changed_objective.is_complete;
            input.checked = confirmedChecked;
            // catch handles missing responses, connection failures, and unreadable responses.
          } catch {
            input.checked = confirmedChecked;
            errorMessage.textContent =
              "Unable to save. Check your connection and try again.";
            errorMessage.hidden = false;
          }
        });
      } else if (objective.type === "sliderobjective") {
        let confirmedValue = objective.current_value;
        input.min = objective.min_value;
        input.max = objective.goal_value;
        input.value = confirmedValue;

        const currentValue = objectiveRow.querySelector(
          "[data-objective-current]",
        );
        currentValue.textContent = confirmedValue;

        input.addEventListener("change", async (event) => {
          errorMessage.hidden = true;
          errorMessage.textContent = "";

          const body = new FormData();
          body.append("current_value", String(event.currentTarget.value));

          const csrfToken = document.querySelector(
            "[name=csrfmiddlewaretoken]",
          ).value;

          try {
            const response = await fetch(objective.update_url, {
              method: "POST",
              headers: {
                "X-CSRFToken": csrfToken,
              },
              body,
            });

            const responseData = await response.json();

            // response.ok still handles server-reported HTTP errors.
            if (!response.ok) {
              input.value = confirmedValue;
              currentValue.textContent = confirmedValue;
              errorMessage.textContent = responseData.error;
              errorMessage.hidden = false;
              return;
            }

            confirmedValue = responseData.changed_objective.current_value;
            input.value = confirmedValue;
            currentValue.textContent = confirmedValue;
            // catch handles missing responses, connection failures, and unreadable responses.
          } catch {
            input.value = confirmedValue;
            currentValue.textContent = confirmedValue;
            errorMessage.textContent =
              "Unable to save. Check your connection and try again.";
            errorMessage.hidden = false;
          }
        });

        objectiveRow
          .querySelectorAll("[data-objective-step]")
          .forEach((button) => {
            button.disabled = controlsDisabled;
          });

        objectiveRow.querySelector("[data-objective-goal]").textContent =
          objective.goal_value;
        objectiveRow.querySelector("[data-objective-goal-hint]").textContent =
          objective.goal_value;
      }

      input.setAttribute("aria-label", objective.title);
      // TODO (Stage 2): Send Checklist/Slider changes to objective.update_url and apply the authoritative response.
      objectivesContainer.appendChild(objectiveRow);
    });

    window.clearTimeout(adventureNoteSaveTimer);
    selectedAdventureNoteUpdateUrl = data.adventureNoteUpdate;
    confirmedAdventureNoteContent = JSON.parse(data.adventureNoteContent);
    adventureNoteStatus.textContent = "";
    adventureNoteField.value = confirmedAdventureNoteContent;

    drawer.showModal();
  });
});

adventureNoteField.addEventListener("input", () => {
  window.clearTimeout(adventureNoteSaveTimer);

  const updateUrl = selectedAdventureNoteUpdateUrl;
  const pendingContent = adventureNoteField.value;
  if (!updateUrl) return;

  adventureNoteStatus.textContent = "Saving...";

  adventureNoteSaveTimer = window.setTimeout(async () => {
    const csrfToken = document.querySelector(
      "[name=csrfmiddlewaretoken]",
    ).value;

    try {
      const response = await fetch(updateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken,
        },
        body: JSON.stringify({ content: pendingContent }),
      });
      const responseData = await response.json();

      if (selectedAdventureNoteUpdateUrl !== updateUrl) return;

      if (!response.ok) {
        adventureNoteField.value = confirmedAdventureNoteContent;
        adventureNoteStatus.textContent =
          responseData.error || "Unable to save this note.";
        return;
      }

      confirmedAdventureNoteContent = pendingContent;
      adventureNoteStatus.textContent = "Saved";
    } catch {
      if (selectedAdventureNoteUpdateUrl !== updateUrl) return;

      adventureNoteField.value = confirmedAdventureNoteContent;
      adventureNoteStatus.textContent =
        "Unable to save. Check your connection and try again.";
    }
  }, 500);
});

drawer.querySelector(".preview-close").addEventListener("click", (event) => {
  drawer.close();
});

drawer.addEventListener("click", (event) => {
  if (event.target === drawer) drawer.close();
});
