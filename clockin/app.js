/* begin[clockin_shell_constants] */
const LIVE_APP_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";
/* end[clockin_shell_constants] */


/* begin[clockin_shell_dom_refs] */
const statusText = document.getElementById("statusText");
const primaryBtn = document.getElementById("primaryBtn");
const secondaryBtn = document.getElementById("secondaryBtn");
const installHelp = document.getElementById("installHelp");
/* end[clockin_shell_dom_refs] */


/* begin[clockin_shell_helpers] */
function isStandaloneMode_() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function setStatusText_(text) {
  if (!statusText) return;
  statusText.textContent = text || "";
}

function setButtonText_(button, text) {
  if (!button) return;
  button.textContent = text || "";
}

function setButtonEnabled_(button, isEnabled) {
  if (!button) return;
  button.disabled = !isEnabled;
}

function showElement_(el) {
  if (!el) return;
  el.classList.remove("hidden");
}

function hideElement_(el) {
  if (!el) return;
  el.classList.add("hidden");
}

function updateShellUi_() {
  const standalone = isStandaloneMode_();
  const online = navigator.onLine;

  if (!standalone) {
    showElement_(installHelp);
    showElement_(primaryBtn);
    hideElement_(secondaryBtn);

    setButtonText_(primaryBtn, "Open Live App");
    setButtonEnabled_(primaryBtn, online);

    if (online) {
      setStatusText_("Online. Install this page to your home screen for the app icon.");
    } else {
      setStatusText_("Offline. Connect to the internet to open the live app.");
    }

    return;
  }

  hideElement_(installHelp);
  showElement_(primaryBtn);
  showElement_(secondaryBtn);

  if (online) {
    setStatusText_("Online. Choose how you want to continue.");
    setButtonText_(primaryBtn, "Open Live App");
    setButtonEnabled_(primaryBtn, true);

    setButtonText_(secondaryBtn, "Enter Offline Mode");
    setButtonEnabled_(secondaryBtn, true);
  } else {
    setStatusText_("Offline. The shell is available. Full offline clock-in is the next build step.");
    setButtonText_(primaryBtn, "Open Live App");
    setButtonEnabled_(primaryBtn, false);

    setButtonText_(secondaryBtn, "Enter Offline Mode");
    setButtonEnabled_(secondaryBtn, true);
  }
}

async function registerServiceWorker_() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      "/clockin/service-worker.js",
      { scope: "/clockin/" }
    );

    return !!registration;
  } catch (error) {
    console.error("Service worker registration failed:", error);
    return false;
  }
}

function openLiveApp_() {
  if (!navigator.onLine) {
    updateShellUi_();
    return;
  }

  window.location.href = LIVE_APP_URL;
}

function enterOfflineMode_() {
  if (navigator.onLine) {
    setStatusText_("Offline mode shell is not wired to the live app yet. Use Open Live App for now.");
    return;
  }

  setStatusText_("Offline shell opened. Full offline clock-in is the next build step.");
}
/* end[clockin_shell_helpers] */


/* begin[clockin_shell_event_wiring] */
window.addEventListener("online", updateShellUi_);
window.addEventListener("offline", updateShellUi_);

if (primaryBtn) {
  primaryBtn.addEventListener("click", openLiveApp_);
}

if (secondaryBtn) {
  secondaryBtn.addEventListener("click", enterOfflineMode_);
}
/* end[clockin_shell_event_wiring] */


/* begin[clockin_shell_init] */
document.addEventListener("DOMContentLoaded", async function () {
  setStatusText_("Preparing app shell...");
  setButtonEnabled_(primaryBtn, false);
  setButtonEnabled_(secondaryBtn, false);

  await registerServiceWorker_();
  updateShellUi_();
});
/* end[clockin_shell_init] */
