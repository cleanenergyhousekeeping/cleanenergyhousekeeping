/* begin[clockin_shell_constants] */
const LIVE_APP_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";

const SHELL_AUTH_KEY = "ce_shell_auth_v1";
const SHELL_QUEUE_KEY = "ce_shell_queue_v1";
/* end[clockin_shell_constants] */


/* begin[clockin_shell_dom_refs] */
const statusText = document.getElementById("statusText");
const offlineBtn = document.getElementById("offlineBtn");
const installHelp = document.getElementById("installHelp");
const prepSection = document.getElementById("prepSection");
const prepCodeInput = document.getElementById("prepCodeInput");
const loadPrepBtn = document.getElementById("loadPrepBtn");

const offlineEntrySection = document.getElementById("offlineEntrySection");
const offlineReadyText = document.getElementById("offlineReadyText");
const offlineQueueCount = document.getElementById("offlineQueueCount");
const offlineActionSelect = document.getElementById("offlineActionSelect");
const offlinePropertyInput = document.getElementById("offlinePropertyInput");
const offlineNoteWrap = document.getElementById("offlineNoteWrap");
const offlineNoteInput = document.getElementById("offlineNoteInput");
const saveOfflineEntryBtn = document.getElementById("saveOfflineEntryBtn");
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

function getShellQueue_() {
  try {
    const raw = localStorage.getItem(SHELL_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveShellQueue_(queue) {
  localStorage.setItem(SHELL_QUEUE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
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

function getCurrentPropertyText_(shellAuth) {
  if (
    shellAuth &&
    shellAuth.currentShift &&
    shellAuth.currentShift.property
  ) {
    return String(shellAuth.currentShift.property);
  }

  return "";
}

function updateOfflineQueueCount_() {
  if (!offlineQueueCount) return;
  const queue = getShellQueue_();
  offlineQueueCount.textContent = "Queued entries: " + queue.length;
}

function resetOfflineEntryForm_(shellAuth) {
  if (offlineActionSelect) {
    offlineActionSelect.value = "";
  }

  if (offlinePropertyInput) {
    offlinePropertyInput.value = getCurrentPropertyText_(shellAuth);
  }

  if (offlineNoteInput) {
    offlineNoteInput.value = "";
  }

  if (offlineNoteWrap) {
    offlineNoteWrap.classList.add("hidden");
  }
}

function updateOfflineReadyText_(shellAuth) {
  if (!offlineReadyText) return;

  if (shellAuth && shellAuth.cleanerName) {
    const currentShiftText =
      shellAuth.currentShift && shellAuth.currentShift.property
        ? " Current shift: " + shellAuth.currentShift.property + "."
        : "";

    offlineReadyText.textContent =
      "Offline mode is ready for " + shellAuth.cleanerName + "." + currentShiftText;
    return;
  }

  offlineReadyText.textContent =
    "Offline mode is not ready yet on this phone. Please go online and load offline prep first.";
}

function saveOfflineEntry_() {
  const shellAuth = getShellAuth_();
  const action = (offlineActionSelect && offlineActionSelect.value || "").trim();
  const property = (offlinePropertyInput && offlinePropertyInput.value || "").trim();
  const note = (offlineNoteInput && offlineNoteInput.value || "").trim();

  if (!shellAuth || !shellAuth.cleanerName) {
    setStatusText_("Offline mode is not ready yet on this phone. Please go online and load offline prep first.");
    return;
  }

  if (!action) {
    setStatusText_("Please select an offline action.");
    return;
  }

  if (!property) {
    setStatusText_("Please enter the property name.");
    return;
  }

  if (action === "add_note" && !note) {
    setStatusText_("Please enter a cleaning note.");
    return;
  }

  const queue = getShellQueue_();
  queue.push({
    queuedId: "shell_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    cleanerName: shellAuth.cleanerName,
    accessLevel: shellAuth.accessLevel || "LIMITED",
    eventType: action,
    property: property,
    note: note,
    submittedAtMs: Date.now(),
    source: "shell_offline",
  });

  saveShellQueue_(queue);

  if (action === "clock_in") {
    shellAuth.currentShift = {
      property: property,
      clockInMs: Date.now(),
      clockInDisplay: "",
    };
    saveShellAuth_(shellAuth);
  }

  if (action === "clock_out") {
    shellAuth.currentShift = null;
    saveShellAuth_(shellAuth);
  }

  updateOfflineQueueCount_();
  updateOfflineReadyText_(shellAuth);
  resetOfflineEntryForm_(shellAuth);

  setStatusText_("Offline entry saved on this phone.");
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
      `Offline mode is ready for ${shellAuth.cleanerName}.${currentShiftText}`
    );

    showElement_(offlineEntrySection);
    updateOfflineReadyText_(shellAuth);
    updateOfflineQueueCount_();
    resetOfflineEntryForm_(shellAuth);
    return;
  }

  setButtonState_("Enter Offline Mode", "offline");
  setStatusText_("Offline mode is not ready yet on this phone. Please go online and load offline prep first.");
  hideElement_(offlineEntrySection);
}

function updateShellUi_() {
  const standalone = isStandaloneMode_();
  const online = navigator.onLine;
  const shellAuth = getShellAuth_();

  if (!standalone) {
    showElement_(installHelp);
    hideElement_(offlineBtn);
    hideElement_(prepSection);
    hideElement_(offlineEntrySection);

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
    hideElement_(offlineEntrySection);

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
/* end[clockin_shell_helpers] */


/* begin[clockin_shell_service_worker] */
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
/* end[clockin_shell_service_worker] */


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

if (offlineActionSelect) {
  offlineActionSelect.addEventListener("change", function () {
    const action = offlineActionSelect.value || "";

    if (action === "add_note") {
      showElement_(offlineNoteWrap);
    } else {
      hideElement_(offlineNoteWrap);
    }
  });
}

if (saveOfflineEntryBtn) {
  saveOfflineEntryBtn.addEventListener("click", saveOfflineEntry_);
}
/* end[clockin_shell_event_wiring] */


/* begin[clockin_shell_init] */
document.addEventListener("DOMContentLoaded", async function () {
  setStatusText_("Preparing app shell...");
  await registerServiceWorker_();
  updateShellUi_();
  updateOfflineQueueCount_();
});
/* end[clockin_shell_init] */
