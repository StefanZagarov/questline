import {
  getMainQuestTotal,
  getQuestData,
  getQuestState,
  updateAdventureNoteConfirmed,
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
// The opened quest's note as last confirmed by the server
let confirmedAdventureNoteContent = "";
let adventureNoteSaveTimer;
// Specifically for adventure notes value update in the page data
let openedQuestId;
let noteIsSaving;
const objectiveRequests = {};
const objectiveRows = {};
const adventureNoteRequests = {};

quests.forEach((quest) => {
  quest.addEventListener("click", () => {
    const questId = quest.dataset.questId;
    // Reopening the same quest while its note save hasn't been confirmed yet (timer waiting or reply not back), so the page data still holds the older note
    const reopenedWithUnsavedNote =
      openedQuestId === questId &&
      adventureNoteField.value !== confirmedAdventureNoteContent;

    // flushing: when a debounced action is pending, you run it right away instead of dropping it
    if (noteIsSaving) {
      saveAdventureNote(
        openedQuestId,
        adventureNoteField.value,
        adventureNoteField,
        adventureNoteStatus,
        selectedAdventureNoteUpdateUrl,
      );
    }

    openedQuestId = questId;
    const questData = getQuestData(questId);

    const crumb = drawer.querySelector("[data-adventure-crumb]");
    const isOptional = questData.is_optional;

    crumb.textContent = isOptional
      ? ""
      : `QUEST ${questData.index} OF ${getMainQuestTotal()}`;
    drawer.querySelector("[data-adventure-optional]").hidden = !isOptional;

    drawer.querySelector("[data-quest-title]").textContent = questData.title;

    const description = drawer.querySelector("[data-quest-description]");
    description.hidden = questData.description === "";
    description.textContent = questData.description;

    const prerequisitesWrapper = drawer.querySelector(
      "[data-prerequisites-line]",
    );
    const prerequisiteQuests = drawer.querySelector(
      "[data-prerequisites-titles]",
    );
    const prerequisiteQuestsArray = questData.prerequisite_titles;
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

    const questState = getQuestState(questId);
    // The JSON only supplies definitions (titles, ranges, URLs); live values come from the shared state
    const objectives = questData.objectives;
    const objectiveValues = Object.values(questState.objectives);
    drawer.querySelector("[data-objectives-count]").textContent =
      `${objectiveValues.filter((objective) => objective.isComplete).length} / ${objectiveValues.length}\u00A0\u00A0DONE`;

    const objectivesContainer = drawer.querySelector("[data-quest-objectives]");
    const emptyObjectivesMessage = drawer.querySelector("[data-empty-quest]");
    // Controls follow the server-confirmed lock, never an optimistic unlock
    const controlsDisabled =
      !questState.confirmedIsUnlocked || questData.is_invalid;

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

      const currentValue = objectiveRow.querySelector(
        "[data-objective-current]",
      );
      objectiveRows[objectiveId] = {
        input,
        currentValue,
        objectiveItem,
        errorMessage,
      };

      if (objective.type === "checklistobjective") {
        input.checked = objectiveState.isComplete;

        input.addEventListener("change", (event) => {
          errorMessage.hidden = true;
          errorMessage.textContent = "";

          const value = event.currentTarget.checked;
          updateDrawerObjectiveComplete(objectiveItem, value);
          updateObjectivePreview(questId, objectiveId, value);
          saveObjectiveValue(questId, objectiveId, value);
        });
      } else if (objective.type === "sliderobjective") {
        let sliderSaveTimer;
        input.min = objective.min_value;
        input.max = objective.goal_value;

        updateDrawerSlider(input, currentValue, objectiveItem, objectiveState);

        const minusButton = objectiveRow.querySelector(
          "[data-objective-step='-1']",
        );
        minusButton.addEventListener("click", () => {
          const currentValueInt = Number(currentValue.textContent);
          if (currentValueInt === objective.min_value) return;

          const step = Number(minusButton.dataset.objectiveStep);
          updateObjectivePreview(questId, objectiveId, currentValueInt + step);
          updateDrawerSlider(
            input,
            currentValue,
            objectiveItem,
            objectiveState,
          );

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
          updateDrawerSlider(
            input,
            currentValue,
            objectiveItem,
            objectiveState,
          );

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
          updateDrawerSlider(
            input,
            currentValue,
            objectiveItem,
            objectiveState,
          );
        });

        input.addEventListener("change", (event) => {
          errorMessage.hidden = true;
          errorMessage.textContent = "";

          saveObjectiveValue(
            questId,
            objectiveId,
            Number(event.currentTarget.value),
          );
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
    selectedAdventureNoteUpdateUrl = questData.adventure_note_update_url;

    // Keep the typed note instead of overwriting it with the older page data copy; the pending save's reply will confirm it or roll it back
    if (!reopenedWithUnsavedNote) {
      confirmedAdventureNoteContent = questData.adventure_note_content;
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
  const currentQuestId = openedQuestId;
  const pendingContent = adventureNoteField.value;
  if (!updateUrl) return;

  adventureNoteStatus.textContent = "Saving...";
  noteIsSaving = true;
  adventureNoteSaveTimer = window.setTimeout(async () => {
    saveAdventureNote(
      currentQuestId,
      pendingContent,
      adventureNoteField,
      adventureNoteStatus,
      updateUrl,
    );
  }, 500);
});

async function saveAdventureNote(
  questId,
  noteContent,
  adventureNoteField,
  adventureNoteStatus,
  updateUrl,
) {
  noteIsSaving = false;
  const adventureNoteRequest = adventureNoteRequests[questId];

  if (adventureNoteRequest) {
    adventureNoteRequest.hasWaitingContent = true;
    adventureNoteRequest.waitingContent = noteContent;
    return;
  }

  adventureNoteRequests[questId] = {
    hasWaitingContent: false,
    waitingContent: "",
  };
  await sendAdventureNote(
    questId,
    noteContent,
    adventureNoteField,
    adventureNoteStatus,
    updateUrl,
  );

  const finishedRequest = adventureNoteRequests[questId];
  delete adventureNoteRequests[questId];

  if (finishedRequest.hasWaitingContent) {
    saveAdventureNote(
      questId,
      finishedRequest.waitingContent,
      adventureNoteField,
      adventureNoteStatus,
      updateUrl,
    );
  }
}

async function sendAdventureNote(
  questId,
  noteContent,
  adventureNoteField,
  adventureNoteStatus,
  updateUrl,
) {
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

    // Save the new input field value to the page data only if the data is succesfully saved in the database. This allows for the drawer to display the updated value on next opening
    if (response.ok) {
      updateAdventureNoteConfirmed(questId, noteContent);
    }

    if (selectedAdventureNoteUpdateUrl !== updateUrl) {
      return;
    }

    if (response.ok) {
      confirmedAdventureNoteContent = noteContent;
    }

    if (adventureNoteField.value !== noteContent) {
      return;
    }

    if (!response.ok) {
      adventureNoteField.value = confirmedAdventureNoteContent;
      adventureNoteStatus.textContent =
        responseData.error || "Unable to save this note.";
      return;
    }

    adventureNoteStatus.textContent = "Saved";
  } catch {
    if (selectedAdventureNoteUpdateUrl !== updateUrl) return;
    if (adventureNoteField.value !== noteContent) return;

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

// Saves an Objective's new value, but only one save per Objective may be on its way at a time
// If a save is still on its way, the new value waits its turn (a newer value replaces an older waiting one)
function saveObjectiveValue(questId, objectiveId, value) {
  const objectiveRequest = objectiveRequests[objectiveId];

  if (objectiveRequest) {
    objectiveRequest.hasWaitingValue = true;
    objectiveRequest.waitingValue = value;
    return;
  }

  objectiveRequests[objectiveId] = {
    hasWaitingValue: false,
    waitingValue: null,
  };
  sendObjectiveValue(questId, objectiveId, value);
}

// Sends one value to the server and shows the result (saved, or undone with an error)
// When the server has answered, it sends the value that waited meanwhile, if there is one
async function sendObjectiveValue(questId, objectiveId, sentValue) {
  const objective = getQuestData(questId).objectives[objectiveId];
  const body = new FormData();
  objective.type === "sliderobjective"
    ? body.append("current_value", String(sentValue))
    : body.append("is_complete", String(sentValue));

  const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]").value;

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
      updateDrawerObjective(questId, objectiveId, responseData.error);
    } else {
      updateObjectiveConfirmed(responseData, sentValue);
      updateDrawerObjective(questId, objectiveId, "");
    }
    // catch handles missing responses, connection failures, and unreadable responses.
  } catch {
    updateObjectiveRollback(questId, objectiveId, sentValue);
    updateDrawerObjective(
      questId,
      objectiveId,
      "Unable to save. Check your connection and try again.",
    );
  }

  const finishedRequest = objectiveRequests[objectiveId];
  delete objectiveRequests[objectiveId];

  if (finishedRequest.hasWaitingValue) {
    // This is what keeps it going: the value that waited is now saved the same way, and anything newer waits for it
    saveObjectiveValue(questId, objectiveId, finishedRequest.waitingValue);
  }
}

function updateDrawerObjective(questId, objectiveId, errorText) {
  const row = objectiveRows[objectiveId];
  const objectiveState = getQuestState(questId).objectives[objectiveId];

  if (objectiveState.type === "sliderobjective") {
    updateDrawerSlider(
      row.input,
      row.currentValue,
      row.objectiveItem,
      objectiveState,
    );
  } else {
    updateDrawerChecklist(row.input, row.objectiveItem, objectiveState);
  }

  row.errorMessage.textContent = errorText;
  row.errorMessage.hidden = errorText === "";
}

function updateDrawerChecklist(input, objectiveItem, objectiveState) {
  input.checked = objectiveState.isComplete;
  updateDrawerObjectiveComplete(objectiveItem, objectiveState.isComplete);
}

function updateDrawerSlider(
  input,
  currentValue,
  objectiveItem,
  objectiveState,
) {
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
