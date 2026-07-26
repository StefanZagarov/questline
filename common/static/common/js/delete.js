const dialog = document.querySelector("[data-questline-delete-dialog]");
const form = document.querySelector("[data-questline-delete-form]");
const title = document.querySelector("[data-questline-delete-title]");

document.querySelectorAll("[data-open-questline-delete]").forEach((delBtn) => {
  delBtn.addEventListener("click", () => {
    title.textContent = delBtn.dataset.questlineTitle;
    form.action = delBtn.dataset.deleteUrl;

    dialog.showModal();
  });
});

document
  .querySelectorAll("[data-close-questline-delete]")
  .forEach((closeBtn) => {
    closeBtn.addEventListener("click", () => {
      dialog.close();
    });
  });
