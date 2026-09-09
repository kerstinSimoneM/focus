const DEFAULT_THRESHOLD_MINUTES = 15;
const thresholdInput = document.querySelector("#threshold");
const status = document.querySelector("#settings-status");
const saved = Number(window.localStorage.getItem("forest-focus-threshold-minutes"));
thresholdInput.value = Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_THRESHOLD_MINUTES;

document.querySelector("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const minutes = Number(thresholdInput.value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
    status.textContent = "Choose a whole number between 1 and 120 minutes.";
    return;
  }
  window.localStorage.setItem("forest-focus-threshold-minutes", String(minutes));
  status.textContent = "Saved. Your next session will use this threshold.";
});
