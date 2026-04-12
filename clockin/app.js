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
const offlinePropertySearch = document.getElementById("offlinePropertySearch");
const offlinePropertyResults = document.getElementById("offlinePropertyResults");
const offlinePropertyInfoPanel = document.getElementById("offlinePropertyInfoPanel");
const offlinePropertyInfoEntrance = document.getElementById("offlinePropertyInfoEntrance");
const offlinePropertyInfoAlarm = document.getElementById("offlinePropertyInfoAlarm");
const offlinePropertyInfoWifi = document.getElementById("offlinePropertyInfoWifi");
const offlinePropertyInfoWifiPassword = document.getElementById("offlinePropertyInfoWifiPassword");
const offlinePropertyInfoOwners = document.getElementById("offlinePropertyInfoOwners");
const offlinePropertyInfoNotes = document.getElementById("offlinePropertyInfoNotes");
const offlineNoteWrap = document.getElementById("offlineNoteWrap");
const offlineNoteInput = document.getElementById("offlineNoteInput");
const saveOfflineEntryBtn = document.getElementById("saveOfflineEntryBtn");
/* end[clockin_shell_dom_refs] */


/* begin[clockin_shell_state] */
let selectedOfflineProperty = null;
/* end[clockin_shell_state] */
let shellSyncInProgress = false;

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

function getShellProperties_(shellAuth) {
  return Array.isArray(shellAuth && shellAuth.properties) ? shellAuth.properties : [];
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

function clearOfflinePropertyResults_() {
  if (!offlinePropertyResults) return;
  offlinePropertyResults.innerHTML = "";
  hideElement_(offlinePropertyResults);
}

function fillOfflinePropertyInfo_(prop) {
  if (!prop || !offlinePropertyInfoPanel) return;

  offlinePropertyInfoEntrance.textContent = prop.entranceInfo || "—";
  offlinePropertyInfoAlarm.textContent = prop.alarmInfo || "—";
  offlinePropertyInfoWifi.textContent = prop.wifiNetwork || "—";
  offlinePropertyInfoWifiPassword.textContent = prop.wifiPassword || "—";
  offlinePropertyInfoOwners.textContent = prop.ownerNames || "—";
  offlinePropertyInfoNotes.textContent = prop.houseNotes || "—";

  showElement_(offlinePropertyInfoPanel);
}

function hideOfflinePropertyInfo_() {
  if (!offlinePropertyInfoPanel) return;

  offlinePropertyInfoEntrance.textContent = "";
  offlinePropertyInfoAlarm.textContent = "";
  offlinePropertyInfoWifi.textContent = "";
  offlinePropertyInfoWifiPassword.textContent = "";
  offlinePropertyInfoOwners.textContent = "";
  offlinePropertyInfoNotes.textContent = "";

  hideElement_(offlinePropertyInfoPanel);
}

function selectOfflineProperty_(prop) {
  selectedOfflineProperty = prop || null;

  if (offlinePropertySearch) {
    offlinePropertySearch.value = prop && prop.name ? prop.name : "";
  }

  clearOfflinePropertyResults_();

  if (prop) {
    fillOfflinePropertyInfo_(prop);
  } else {
    hideOfflinePropertyInfo_();
  }
}

function findOfflinePropertyByName_(name, shellAuth) {
  const target = String(name || "").trim();
  if (!target) return null;

  return getShellProperties_(shellAuth).find(function (prop) {
    return String((prop && prop.name) || "") === target;
  }) || null;
}

function handleOfflinePropertySearch_() {
  const shellAuth = getShellAuth_();
  const query = (offlinePropertySearch && offlinePropertySearch.value || "").trim().toLowerCase();

  if (!query) {
    selectedOfflineProperty = null;
    clearOfflinePropertyResults_();
    hideOfflinePropertyInfo_();
    return;
  }

  if (
    !selectedOfflineProperty ||
    String((selectedOfflineProperty && selectedOfflineProperty.name) || "") !==
      String((offlinePropertySearch && offlinePropertySearch.value) || "").trim()
  ) {
    selectedOfflineProperty = null;
    hideOfflinePropertyInfo_();
  }

  const matches = getShellProperties_(shellAuth)
    .filter(function (prop) {
      return String((prop && prop.name) || "").toLowerCase().includes(query);
    })
    .slice(0, 12);

  clearOfflinePropertyResults_();

  if (!matches.length) {
    return;
  }

  matches.forEach(function (prop) {
    const div = document.createElement("div");
    div.className = "offlineResultItem";
    div.textContent = prop.name || "—";

    div.addEventListener("click", function () {
      selectOfflineProperty_(prop);
    });

    offlinePropertyResults.appendChild(div);
  });

  showElement_(offlinePropertyResults);
}

function resetOfflineEntryForm_(shellAuth) {
  if (offlineActionSelect) {
    offlineActionSelect.value = "";
  }

  if (offlinePropertySearch) {
    const currentPropertyName = getCurrentPropertyText_(shellAuth);
    offlinePropertySearch.value = currentPropertyName;
    selectedOfflineProperty = findOfflinePropertyByName_(currentPropertyName, shellAuth);

    if (selectedOfflineProperty) {
      fillOfflinePropertyInfo_(selectedOfflineProperty);
    } else {
      hideOfflinePropertyInfo_();
    }
  }

  if (offlineNoteInput) {
    offlineNoteInput.value = "";
  }

  if (offlineNoteWrap) {
    hideElement_(offlineNoteWrap);
  }

  clearOfflinePropertyResults_();
}

function saveOfflineEntry_() {
  const shellAuth = getShellAuth_();
  const action = (offlineActionSelect && offlineActionSelect.value || "").trim();
  const note = (offlineNoteInput && offlineNoteInput.value || "").trim();

  if (!shellAuth || !shellAuth.cleanerName) {
    setStatusText_("Offline mode is not ready yet on this phone. Please go online and load offline prep first.");
    return;
  }

  if (!action) {
    setStatusText_("Please select an offline action.");
    return;
  }

  if (!selectedOfflineProperty || !selectedOfflineProperty.name) {
    setStatusText_("Please select a property from the list.");
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
    sessionToken: shellAuth.sessionToken || "",
    clientId: shellAuth.clientId || "",
    eventType: action,
    property: selectedOfflineProperty.name,
    note: note,
    submittedAtMs: Date.now(),
    source: "shell_offline",
  });

  saveShellQueue_(queue);

  if (action === "clock_in") {
    shellAuth.currentShift = {
      property: selectedOfflineProperty.name,
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
async function postShellQueueEntry_(queuedEntry) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      mode: "submitShellQueueEntry",
      payload: {
        sessionToken: queuedEntry.sessionToken || "",
        clientId: queuedEntry.clientId || "",
        property: queuedEntry.property || "",
        eventType: queuedEntry.eventType || "",
        note: queuedEntry.note || "",
        submittedAtMs: queuedEntry.submittedAtMs || Date.now(),
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Shell sync request failed.");
  }

  return response.json();
}

async function syncShellQueue_() {
  if (shellSyncInProgress) return;
  if (!navigator.onLine) return;

  const initialQueue = getShellQueue_();
  if (!initialQueue.length) return;

  shellSyncInProgress = true;

  try {
    while (true) {
      const queue = getShellQueue_();
      if (!queue.length) {
        break;
      }

      const nextEntry = queue[0];
      const response = await postShellQueueEntry_(nextEntry);

      if (!response || !response.ok) {
        const message = (response && response.message) || "Could not sync a queued shell entry yet.";
        setStatusText_(message);
        break;
      }

      const trimmedQueue = queue.slice(1);
      saveShellQueue_(trimmedQueue);

      const shellAuth = getShellAuth_();
      if (shellAuth) {
        shellAuth.currentShift = response.currentShift || null;
        saveShellAuth_(shellAuth);
      }

      updateOfflineQueueCount_();
    }

    const remainingQueue = getShellQueue_();
    if (!remainingQueue.length) {
      setStatusText_("Offline entries synced.");
    }

  } catch (_) {
    setStatusText_("Could not sync offline entries yet. They will stay queued.");
  } finally {
    shellSyncInProgress = false;
    updateShellUi_();
    updateOfflineQueueCount_();
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
    syncShellQueue_();
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
window.addEventListener("online", function () {
  updateShellUi_();
  syncShellQueue_();
});

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

if (offlinePropertySearch) {
  offlinePropertySearch.addEventListener("input", handleOfflinePropertySearch_);
  offlinePropertySearch.addEventListener("focus", handleOfflinePropertySearch_);
}

document.addEventListener("click", function (event) {
  if (
    offlinePropertySearch &&
    offlinePropertyResults &&
    !offlinePropertySearch.contains(event.target) &&
    !offlinePropertyResults.contains(event.target)
  ) {
    clearOfflinePropertyResults_();
  }
});

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
  syncShellQueue_();
});
/* end[clockin_shell_init] */
