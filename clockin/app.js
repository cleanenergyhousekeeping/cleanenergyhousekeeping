/* begin[clockin_shell_constants] */
const LIVE_APP_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";
/* end[clockin_shell_constants] */


/* begin[clockin_shell_dom_refs] */
const statusText = document.getElementById("statusText");
const offlineBtn = document.getElementById("offlineBtn");
const installHelp = document.getElementById("installHelp");
const openWithoutInstallingLink = document.getElementById("openWithoutInstallingLink");
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

function showElement_(el) {
  if (!el) return;
  el.classList.remove("hidden");
}

function hideElement_(el) {
  if (!el) return;
  el.classList.add("hidden");
}

function openLiveApp_() {
  window.location.href = LIVE_APP_URL;
}

function enterOfflineMode_() {
  setStatusText_(
    "No signal. Please use offline mode. Your info will be stored and transmitted when service returns."
  );
}

function updateShellUi_() {
  const standalone = isStandaloneMode_();
  const online = navigator.onLine;

  if (openWithoutInstallingLink) {
  openWithoutInstallingLink.href = LIVE_APP_URL;

  const standalone = isStandaloneMode_();
  const online = navigator.onLine;

  // Hide link if:
  // - user is in standalone (they should never use link again)
  // - OR user is offline (link won't work anyway)
  if (standalone || !online) {
    openWithoutInstallingLink.classList.add("hidden");
  } else {
    openWithoutInstallingLink.classList.remove("hidden");
  }
}

  if (!standalone) {
    showElement_(installHelp);
    hideElement_(offlineBtn);

    if (online) {
      setStatusText_("Install this page to your home screen for the app icon.");
    } else {
      setStatusText_("No signal right now. Install the icon when online for the best experience.");
    }

    return;
  }

  hideElement_(installHelp);

  if (online) {
    showElement_(offlineBtn);
    setStatusText_("Shell ready. Tap below to open the live app.");
    offlineBtn.textContent = "Open Live App";
    return;
  }

  showElement_(offlineBtn);
  offlineBtn.textContent = "Enter Offline Mode";
  setStatusText_(
    "No signal. Please use offline mode. Your info will be stored and transmitted when service returns."
  );
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
/* end[clockin_shell_helpers] */


/* begin[clockin_shell_event_wiring] */
window.addEventListener("online", updateShellUi_);
window.addEventListener("offline", updateShellUi_);

if (offlineBtn) {
  offlineBtn.addEventListener("click", function () {
    if (navigator.onLine) {
      openLiveApp_();
      return;
    }

    enterOfflineMode_();
  });
}
/* end[clockin_shell_event_wiring] */


/* begin[clockin_shell_init] */
document.addEventListener("DOMContentLoaded", async function () {
  setStatusText_("Preparing app shell...");
  await registerServiceWorker_();
  updateShellUi_();
});
/* end[clockin_shell_init] */
