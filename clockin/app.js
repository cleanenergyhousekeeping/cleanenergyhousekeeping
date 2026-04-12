/* begin[clockin_shell_constants] */
const LIVE_APP_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";

const SHELL_AUTH_KEY = "ce_shell_auth_v1";
/* end[clockin_shell_constants] */


/* begin[clockin_shell_dom_refs] */
const statusText = document.getElementById("statusText");
const offlineBtn = document.getElementById("offlineBtn");
const installHelp = document.getElementById("installHelp");
const prepSection = document.getElementById("prepSection");
const prepCodeInput = document.getElementById("prepCodeInput");
const loadPrepBtn = document.getElementById("loadPrepBtn");
/* end[clockin_shell_dom_refs] */


/* begin[clockin_shell_helpers] */
function isStandaloneMode_() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function getShellAuth_() {
  try {
    const raw = localStorage.getItem(SHELL_AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function saveShellAuth_(payload) {
  localStorage.setItem(SHELL_AUTH_KEY, JSON.stringify(payload));
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

function setButtonState_(text, mode) {
  if (!offlineBtn) return;

  offlineBtn.textContent = text || "";
  offlineBtn.classList.remove("btnOnline", "btnOffline", "btnLoading");

  if (mode === "online") {
    offlineBtn.classList.add("btnOnline");
  } else if (mode === "offline") {
    offlineBtn.classList.add("btnOffline");
  } else if (mode === "loading") {
    offlineBtn.classList.add("btnLoading");
  }
}

async function fetchPrepPayloadByCode_(code) {
  const url =
    APPS_SCRIPT_URL +
    "?mode=getOfflineShellPrepByCode&code=" +
    encodeURIComponent(code);

  const response = await fetch(url, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error("Prep request failed.");
  }

  return response.json();
}

async function loadOfflinePrep_() {
  const code = (prepCodeInput && prepCodeInput.value || "").trim();

  if (!code) {
    setStatusText_("Please enter the offline prep code.");
    return;
  }

  setStatusText_("Loading offline prep...");
  if (loadPrepBtn) {
    loadPrepBtn.textContent = "Loading...";
    loadPrepBtn.disabled = true;
  }

  try {
    const res = await fetchPrepPayloadByCode_(code);

    if (!res || !res.ok || !res.payload) {
      setStatusText_((res && res.message) || "Offline prep failed.");
      return;
    }

    saveShellAuth_(res.payload);

    const cleanerName = res.payload.cleanerName || "this cleaner";
    const currentShiftText =
      res.payload.currentShift && res.payload.currentShift.property
        ? ` Current shift: ${res.payload.currentShift.property}.`
        : "";

    setStatusText_(
      `Online. Offline mode is prepared for ${cleanerName}.${currentShiftText}`
    );

    if (prepCodeInput) {
      prepCodeInput.value = "";
    }
  } catch (_) {
    setStatusText_("Offline prep failed. Please try again while online.");
  } finally {
    if (loadPrepBtn) {
      loadPrepBtn.textContent = "Load Offline Prep";
      loadPrepBtn.disabled = false;
    }
    updateShellUi_();
  }
}

function openLiveApp_() {
  setButtonState_("Loading...", "loading");
  window.location.href = LIVE_APP_URL;
}

function enterOfflineMode_() {
  const shellAuth = getShellAuth_();

  if (shellAuth && shellAuth.cleanerName) {
    const currentShiftText =
      shellAuth.currentShift && shellAuth.currentShift.property
        ? ` Current shift: ${shellAuth.currentShift.property}.`
        : "";

    setButtonState_("Enter Offline Mode", "offline");
    setStatusText_(
      `Offline mode is ready for ${shellAuth.cleanerName}.${currentShiftText} Full offline entry is the next build step.`
    );
    return;
  }

  setButtonState_("Enter Offline Mode", "offline");
  setStatusText_("Offline mode is not ready yet on this phone. Please go online and load offline prep first.");
}

function updateShellUi_() {
  const standalone = isStandaloneMode_();
  const online = navigator.onLine;
  const shellAuth = getShellAuth_();

  if (!standalone) {
    showElement_(installHelp);
    hideElement_(offlineBtn);
    hideElement_(prepSection);

    if (online) {
      setStatusText_("Install this page to your home screen for the app icon.");
    } else {
      setStatusText_("No signal right now. Install the icon when online for the best experience.");
    }

    return;
  }

  hideElement_(installHelp);
  showElement_(offlineBtn);

  if (online) {
    showElement_(prepSection);

    if (shellAuth && shellAuth.cleanerName) {
      const currentShiftText =
        shellAuth.currentShift && shellAuth.currentShift.property
          ? ` Current shift: ${shellAuth.currentShift.property}.`
          : "";

      setStatusText_(
        `Online. Offline mode is prepared for ${shellAuth.cleanerName}.${currentShiftText}`
      );
    } else {
      setStatusText_("Online. Tap below to open the live app or load offline prep.");
    }

    setButtonState_("Open Live App", "online");
    return;
  }

  hideElement_(prepSection);

  if (shellAuth && shellAuth.cleanerName) {
    const currentShiftText =
      shellAuth.currentShift && shellAuth.currentShift.property
        ? ` Current shift: ${shellAuth.currentShift.property}.`
        : "";

    setStatusText_(
      `No signal detected. Offline mode is ready for ${shellAuth.cleanerName}.${currentShiftText}`
    );
  } else {
    setStatusText_("No connection. Please use Offline Mode.");
  }

  setButtonState_("Enter Offline Mode", "offline");
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

if (loadPrepBtn) {
  loadPrepBtn.addEventListener("click", loadOfflinePrep_);
}
/* end[clockin_shell_event_wiring] */


/* begin[clockin_shell_init] */
document.addEventListener("DOMContentLoaded", async function () {
  setStatusText_("Preparing app shell...");
  await registerServiceWorker_();
  updateShellUi_();
});
/* end[clockin_shell_init] */
