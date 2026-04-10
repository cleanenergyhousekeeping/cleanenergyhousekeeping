/* begin[clockin_shell_constants] */
const LIVE_APP_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";
/* end[clockin_shell_constants] */


/* begin[clockin_shell_dom_refs] */
const statusText = document.getElementById("statusText");
const openAppBtn = document.getElementById("openAppBtn");
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

function setOpenButtonEnabled_(isEnabled) {
  if (!openAppBtn) return;
  openAppBtn.disabled = !isEnabled;
}

function updateInstallHelpVisibility_() {
  if (!installHelp) return;

  if (isStandaloneMode_()) {
    installHelp.style.display = "none";
  } else {
    installHelp.style.display = "block";
  }
}

function updateShellStatus_() {
  const standalone = isStandaloneMode_();
  const online = navigator.onLine;

  updateInstallHelpVisibility_();

  if (online && standalone) {
    setStatusText_("Online. Tap below to open the live app.");
    setOpenButtonEnabled_(true);
    return;
  }

  if (online && !standalone) {
    setStatusText_("Online. Install this page to your home screen for the app icon.");
    setOpenButtonEnabled_(true);
    return;
  }

  if (!online && standalone) {
    setStatusText_("Offline. The shell is available, but full offline clock-in is the next build step.");
    setOpenButtonEnabled_(false);
    return;
  }

  setStatusText_("Offline. Connect to the internet to open the live app.");
  setOpenButtonEnabled_(false);
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
    updateShellStatus_();
    return;
  }

  window.location.href = LIVE_APP_URL;
}
/* end[clockin_shell_helpers] */


/* begin[clockin_shell_event_wiring] */
window.addEventListener("online", updateShellStatus_);
window.addEventListener("offline", updateShellStatus_);

if (openAppBtn) {
  openAppBtn.addEventListener("click", openLiveApp_);
}
/* end[clockin_shell_event_wiring] */


/* begin[clockin_shell_init] */
document.addEventListener("DOMContentLoaded", async function () {
  setStatusText_("Preparing app shell...");
  setOpenButtonEnabled_(false);

  await registerServiceWorker_();
  updateShellStatus_();
});
/* end[clockin_shell_init] */
