import {
  getQuestState,
  updateObjectiveConfirmed,
  updateObjectivePreview,
  updateObjectiveRollback,
} from "./adventure.js";

const quests = document.querySelectorAll(".adventure-quest");
const drawer = document.getElementById("adventure-drawer");
const adventureNoteField = drawer.querySelector("[data-adventure-note]");
const adventureNoteStatus = drawer.querySelector(
  "[data-adventure-note-status]",
);

let selectedAdventureNoteUpdateUrl = "";
// Read and store in the adventure note field dataset
let confirmedAdventureNoteContent = "";
let adventureNoteSaveTimer;
// Specifically for adventure notes value update in the dom
let openedQuest;
let noteIsSaving;

quests.forEach((quest) => {
  quest.addEventListener("click", (event) => {
    // Reopening the same quest while its note save hasn't been confirmed yet (timer waiting or reply not back), so the dataset still holds the older note
    const reopenedWithUnsavedNote =
      openedQuest === quest &&
      adventureNoteField.value !== confirmedAdventureNoteContent;

    // flushing: when a debounced action is pending, you run it right away instead of dropping it
    if (noteIsSaving) {
      saveAdventureNote(
        openedQuest,
        adventureNoteField.value,
        adventureNoteField,
        adventureNoteStatus,
        selectedAdventureNoteUpdateUrl,
      );
    }

    openedQuest = quest;
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

    const questId = data.questId;
    const questState = getQuestState(questId);
    // The JSON only supplies definitions (titles, ranges, URLs); live values come from the shared state
    const objectives = JSON.parse(data.questObjectives);
    const objectiveValues = Object.values(questState.objectives);
    drawer.querySelector("[data-objectives-count]").textContent =
      `${objectiveValues.filter((objective) => objective.isComplete).length} / ${objectiveValues.length}\u00A0\u00A0DONE`;

    const objectivesContainer = drawer.querySelector("[data-quest-objectives]");
    const emptyObjectivesMessage = drawer.querySelector("[data-empty-quest]");
    // Controls follow the server-confirmed lock, never an optimistic unlock
    const controlsDisabled =
      !questState.confirmedIsUnlocked || data.questIsInvalid === "true";

    // Since the same drawer is reused, we need to clear previously drawn quests
    objectivesContainer.replaceChildren();
    objectivesContainer.hidden = objectiveValues.length === 0;
    emptyObjectivesMessage.hidden = objectiveValues.length !== 0;

    const objectiveEntries = Object.entries(objectives);
    objectiveEntries.forEach(([objectiveId, objective]) => {
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

      const objectiveItem = objectiveRow.querySelector("[data-objective-row]");
      const objectiveState = questState.objectives[objectiveId];
      if (objectiveState.isComplete) objectiveItem.classList.add("is-complete");

      if (objective.type === "checklistobjective") {
        input.checked = objectiveState.isComplete;

        input.addEventListener("change", async (event) => {
          errorMessage.hidden = true;
          errorMessage.textContent = "";

          const sentValue = event.currentTarget.checked;
          updateDrawerObjectiveComplete(objectiveItem, sentValue);
          updateObjectivePreview(questId, objectiveId, sentValue);

          const body = new FormData();
          body.append("is_complete", String(sentValue));

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
              updateObjectiveRollback(questId, objectiveId, sentValue);
              updateDrawerChecklist(input, objectiveItem, objectiveState);
              errorMessage.textContent = responseData.error;
              errorMessage.hidden = false;
              return;
            }

            updateObjectiveConfirmed(responseData, sentValue);
            updateDrawerChecklist(input, objectiveItem, objectiveState);
            // catch handles missing responses, connection failures, and unreadable responses.
          } catch {
            updateObjectiveRollback(questId, objectiveId, sentValue);
            updateDrawerChecklist(input, objectiveItem, objectiveState);
            errorMessage.textContent =
              "Unable to save. Check your connection and try again.";
            errorMessage.hidden = false;
          }
        });
      } else if (objective.type === "sliderobjective") {
        let sliderSaveTimer;
        input.min = objective.min_value;
        input.max = objective.goal_value;

        const currentValue = objectiveRow.querySelector(
          "[data-objective-current]",
        );
        updateDrawerSlider(input, currentValue, objectiveItem, objectiveState);

        const minusButton = objectiveRow.querySelector(
          "[data-objective-step='-1']",
        );
        minusButton.addEventListener("click", () => {
          const currentValueInt = Number(currentValue.textContent);
          if (currentValueInt === objective.min_value) return;

          const step = Number(minusButton.dataset.objectiveStep);
          updateObjectivePreview(questId, objectiveId, currentValueInt + step);
          updateDrawerSlider(input, currentValue, objectiveItem, objectiveState);

          window.clearTimeout(sliderSaveTimer);
          sliderSaveTimer = window.setTimeout(() => {
            input.dispatchEvent(new Event("change"));
          }, 500);
        });

        const plusButton = objectiveRow.querySelector(
          "[data-objective-step='1']",
        );
        plusButton.addEventListener("click", () => {
          const currentValueInt = Number(currentValue.textContent);
          if (currentValueInt === objective.goal_value) return;

          const step = Number(plusButton.dataset.objectiveStep);
          updateObjectivePreview(questId, objectiveId, currentValueInt + step);
          updateDrawerSlider(input, currentValue, objectiveItem, objectiveState);

          window.clearTimeout(sliderSaveTimer);
          sliderSaveTimer = window.setTimeout(() => {
            input.dispatchEvent(new Event("change"));
          }, 500);
        });

        input.addEventListener("input", (event) => {
          updateObjectivePreview(
            questId,
            objectiveId,
            Number(event.currentTarget.value),
          );
          updateDrawerSlider(input, currentValue, objectiveItem, objectiveState);
        });

        input.addEventListener("change", async (event) => {
          errorMessage.hidden = true;
          errorMessage.textContent = "";

          const sentValue = Number(event.currentTarget.value);
          const body = new FormData();
          body.append("current_value", String(sentValue));

          const csrfToken = document.querySelector(
            "[name=csrfmiddlewaretoken]",
          ).value;

          try {
            const response = await fetch(objective.update_url, {
              method: "POST",
              headers: { "X-CSRFToken": csrfToken },
              body,
            });

            const responseData = await response.json();

            // response.ok still handles server-reported HTTP errors.
            if (!response.ok) {
              updateObjectiveRollback(questId, objectiveId, sentValue);
              updateDrawerSlider(input, currentValue, objectiveItem, objectiveState);
              errorMessage.textContent = responseData.error;
              errorMessage.hidden = false;
              return;
            }

            updateObjectiveConfirmed(responseData, sentValue);
            updateDrawerSlider(input, currentValue, objectiveItem, objectiveState);
            // catch handles missing responses, connection failures, and unreadable responses.
          } catch {
            updateObjectiveRollback(questId, objectiveId, sentValue);
            updateDrawerSlider(input, currentValue, objectiveItem, objectiveState);
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
      objectivesContainer.appendChild(objectiveRow);
    });

    window.clearTimeout(adventureNoteSaveTimer);
    selectedAdventureNoteUpdateUrl = data.adventureNoteUpdate;

    // Keep the typed note instead of overwriting it with the older dataset copy; the pending save's reply will confirm it or roll it back
    if (!reopenedWithUnsavedNote) {
      confirmedAdventureNoteContent = JSON.parse(data.adventureNoteContent);
      adventureNoteStatus.textContent = "";
      adventureNoteField.value = confirmedAdventureNoteContent;
    }

    drawer.showModal();
  });
});

adventureNoteField.addEventListener("input", () => {
  window.clearTimeout(adventureNoteSaveTimer);

  const updateUrl = selectedAdventureNoteUpdateUrl;
  // Get a snapshot of the quest so if it changes (user clicks on another quest) before it is saved, the logic still saves to the correct quest
  const currentQuest = openedQuest;
  const pendingContent = adventureNoteField.value;
  if (!updateUrl) return;

  adventureNoteStatus.textContent = "Saving...";
  noteIsSaving = true;
  adventureNoteSaveTimer = window.setTimeout(async () => {
    saveAdventureNote(
      currentQuest,
      pendingContent,
      adventureNoteField,
      adventureNoteStatus,
      updateUrl,
    );
  }, 500);
});

async function saveAdventureNote(
  quest,
  noteContent,
  adventureNoteField,
  adventureNoteStatus,
  updateUrl,
) {
  noteIsSaving = false;
  const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]").value;

  try {
    const response = await fetch(updateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken,
      },
      body: JSON.stringify({ content: noteContent }),
    });
    const responseData = await response.json();

    // Save the new input field value to the DOM dataset only if the data is succesfully saved in the database. This allows for the drawer to display the updated value on next opening
    if (response.ok) {
      quest.dataset.adventureNoteContent = JSON.stringify(noteContent);
    }

    if (selectedAdventureNoteUpdateUrl !== updateUrl) {
      return;
    }

    if (!response.ok) {
      adventureNoteField.value = confirmedAdventureNoteContent;
      adventureNoteStatus.textContent =
        responseData.error || "Unable to save this note.";
      return;
    }

    confirmedAdventureNoteContent = noteContent;
    adventureNoteStatus.textContent = "Saved";
  } catch {
    if (selectedAdventureNoteUpdateUrl !== updateUrl) return;

    adventureNoteField.value = confirmedAdventureNoteContent;
    adventureNoteStatus.textContent =
      "Unable to save. Check your connection and try again.";
  }
}

drawer.querySelector(".preview-close").addEventListener("click", (event) => {
  drawer.close();
});

drawer.addEventListener("click", (event) => {
  if (event.target === drawer) drawer.close();
});

/*{
    changed_objective: {
      id: 12,
      quest_id: 3,
      is_complete: true,
      current_value: null,       // number for a Slider
    },

    quests: {
      "3": { is_unlocked: true, effective_complete: true },
      "4": { is_unlocked: true, effective_complete: false },
      // One entry for every Quest; IDs are string keys in JavaScript.
    },

    quests_summary: {
      main_total: 5,
      optional_total: 2,
      completed_main: 1,
      completed_optional: 0
    },

    main_questline_progress_ratio: 0.3,
    optional_questline_progress_ratio: 0,
  } */
// Objectives (data-quest-objectives on each Quest wrapper; live values are read from the shared state instead)
/*   {
    "12": {
      title: "Gather supplies",
      type: "checklistobjective",
      description: "Find what you need",
      is_complete: true,
      current_value: null,
      update_url: "/questline/adventure/..."
    },
    "13": {
      title: "Train",
      type: "sliderobjective",
      description: "",
      min_value: 0,
      goal_value: 10,
      is_complete: false,
      current_value: 4,
      update_url: "/questline/adventure/..."
    }
  }*/
function updateDrawerChecklist(input, objectiveItem, objectiveState) {
  input.checked = objectiveState.isComplete;
  updateDrawerObjectiveComplete(objectiveItem, objectiveState.isComplete);
}

function updateDrawerSlider(input, currentValue, objectiveItem, objectiveState) {
  input.value = objectiveState.currentValue;
  currentValue.textContent = objectiveState.currentValue;
  updateDrawerObjectiveComplete(objectiveItem, objectiveState.isComplete);
}

function updateDrawerObjectiveComplete(objectiveItem, isComplete) {
  isComplete
    ? objectiveItem.classList.add("is-complete")
    : objectiveItem.classList.remove("is-complete");

  const objectiveItems = drawer.querySelectorAll("[data-objective-row]");
  const completeObjectiveItems = drawer.querySelectorAll(
    "[data-objective-row].is-complete",
  );
  drawer.querySelector("[data-objectives-count]").textContent =
    `${completeObjectiveItems.length} / ${objectiveItems.length}\u00A0\u00A0DONE`;
}
