const TrackerClass = window.ForestFocus.WorkSessionTracker;

const savedThreshold = Number(window.localStorage.getItem("forest-focus-threshold-minutes"));
const tracker = new TrackerClass({
  thresholdMs: Number.isFinite(savedThreshold) && savedThreshold > 0 ? savedThreshold * 60 * 1000 : undefined
});
let session = null;
let previewCompanion = window.ForestFocus.COMPANIONS[1];
let inactivityTimer = null;
const notes = document.querySelector("#notes");
const status = document.querySelector("#status");
const companion = document.querySelector("#companion");
const checkIn = document.querySelector("#check-in");
const companionReaction = document.querySelector("#companion-reaction");
const empowerment = document.querySelector("#empowerment");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const stuckButton = document.querySelector("#direct-stuck");

function showStatus(message) {
  status.textContent = message;
}

function showCompanion(data) {
  companion.hidden = false;
  const artwork = companion.querySelector("img");
  artwork.src = `./${data.companion.image}`;
  artwork.alt = `${data.companion.name}, your forest companion`;
  companion.querySelector(".companion-name").textContent = data.companion.name;
}

function setSessionControls(active) {
  startButton.hidden = active;
  stopButton.hidden = !active;
  stuckButton.hidden = !active;
  companion.querySelector("small").textContent = active ? "is quietly with you." : "will be here when you begin.";
}

function renderCheckIn(data) {
  if (!data) {
    checkIn.hidden = true;
    return;
  }
  if (inactivityTimer !== null) {
    clearInterval(inactivityTimer);
    inactivityTimer = null;
  }
  empowerment.hidden = true;
  companionReaction.hidden = true;
  checkIn.hidden = false;
  checkIn.querySelector(".check-in-text").textContent = data.text;
  checkIn.querySelector(".check-in-name").textContent = data.companion.name;
  checkIn.dataset.id = data.id;
}

function renderEmpowerment(data) {
  checkIn.hidden = true;
  companionReaction.hidden = true;
  empowerment.hidden = false;
  empowerment.querySelector(".empowerment-text").textContent = data.text;
  empowerment.querySelector(".empowerment-name").textContent = data.companion.name;
}

document.querySelector("#start").addEventListener("click", () => {
  if (session?.status === "active") return;
  session = tracker.startSession("local-user", previewCompanion);
  empowerment.hidden = true;
  companionReaction.hidden = true;
  setSessionControls(true);
  inactivityTimer = setInterval(checkInactivityAutomatically, 30_000);
  showStatus("A gentle session is ready. Your notes are yours.");
});

document.querySelector("#stop").addEventListener("click", () => {
  if (!session) return;
  try {
    session = tracker.stopSession(session.id);
    const availableCompanions = window.ForestFocus.COMPANIONS
      .filter(({ id }) => id !== session.companion.id);
    previewCompanion = availableCompanions[
      Math.floor(Math.random() * availableCompanions.length)
    ];
    showCompanion({ companion: previewCompanion });
    setSessionControls(false);
    renderCheckIn(null);
    empowerment.hidden = true;
    if (inactivityTimer !== null) {
      clearInterval(inactivityTimer);
      inactivityTimer = null;
    }
    companionReaction.hidden = true;
    showStatus("Session complete. Your threshold has been restored.");
  } catch (error) {
    showStatus(error.message);
  }
});

showCompanion({ companion: previewCompanion });
setSessionControls(false);

notes.addEventListener("input", () => {
  if (session?.status === "active") tracker.recordActivity(session.id);
});

function checkInactivityAutomatically() {
  if (!session || session.status !== "active") return;
  try {
    const data = tracker.checkInactivity(session.id);
    renderCheckIn(data);
    if (data) showStatus(`${data.companion.name} is here if you need a little help.`);
  } catch (error) {
    showStatus(error.message);
  }
}


checkIn.addEventListener("click", (event) => {
  const response = event.target.dataset.response;
  if (!response) return;
  try {
    if (response === "stuck") {
      if (inactivityTimer !== null) {
        clearInterval(inactivityTimer);
        inactivityTimer = null;
      }
      renderEmpowerment(tracker.signalStuck(session.id));
      inactivityTimer = setInterval(checkInactivityAutomatically, 30_000);
    } else {
      session = tracker.respondToCheckIn(checkIn.dataset.id, response);
      if (response === "false-alarm") {
        companionReaction.hidden = false;
        companionReaction.querySelector(".reaction-name").textContent = session.companion.name;
        companionReaction.querySelector(".reaction-text").textContent =
          "Lovely. I’ll give you room to stay with it.";
        showStatus("Your companion is giving you more breathing room.");
      }
    }
    renderCheckIn(null);
    if (response !== "stuck" && session?.status === "active" && inactivityTimer === null) {
      inactivityTimer = setInterval(checkInactivityAutomatically, 30_000);
    }
  } catch (error) {
    showStatus(error.message);
  }
});

document.querySelector("#direct-stuck").addEventListener("click", () => {
  if (!session) return showStatus("Start a session before asking for support.");
  try {
    if (inactivityTimer !== null) {
      clearInterval(inactivityTimer);
      inactivityTimer = null;
    }
    renderEmpowerment(tracker.signalStuck(session.id));
    inactivityTimer = setInterval(checkInactivityAutomatically, 30_000);
  } catch (error) {
    showStatus(error.message);
  }
});
