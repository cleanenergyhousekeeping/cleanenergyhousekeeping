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
const offlineQueueDetails = document.getElementById("offlineQueueDetails");
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
let shellSyncInProgress = false;
let shellSyncFailureCount = 0;
let shellSyncPausedAfterFailures = false;
/* end[clockin_shell_state] */

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

function setButtonState_(text, mode, disabled) {
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

  offlineBtn.disabled = !!disabled;
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

function formatShellQueueTime_(submittedAtMs) {
  const d = new Date(Number(submittedAtMs || 0));
  if (Number.isNaN(d.getTime())) {
    return "—";
  }

  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShellQueueActionLabel_(eventType) {
  if (eventType === "clock_in") return "Clock In";
  if (eventType === "clock_out") return "Clock Out";
  if (eventType === "add_note") return "Add Cleaning Note";
  return eventType || "Unknown";
}

function renderOfflineQueueDetails_() {
  if (!offlineQueueDetails) return;

  const queue = getShellQueue_();

  if (!queue.length) {
    offlineQueueDetails.innerHTML = "";
    hideElement_(offlineQueueDetails);
    return;
  }

  offlineQueueDetails.innerHTML = queue
    .map(function (item) {
      const actionText = formatShellQueueActionLabel_(item.eventType);
      const propertyText = item.property || "—";
      const timeText = formatShellQueueTime_(item.submittedAtMs);
      const noteText =
        item.eventType === "add_note" && item.note
          ? '<div class="offlineQueueDetailsItemNote">Note: ' + item.note + "</div>"
          : "";

      return (
        '<div class="offlineQueueDetailsItem">• ' +
        actionText +
        " — " +
        propertyText +
        " — " +
        timeText +
        noteText +
        "</div>"
      );
    })
    .join("");

  showElement_(offlineQueueDetails);
}

function updateOfflineQueueCount_() {
  if (!offlineQueueCount) return;
  const queue = getShellQueue_();
  offlineQueueCount.textContent = "Queued entries: " + queue.length;
  renderOfflineQueueDetails_();
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

function updateOfflineActionOptions_(shellAuth) {
  if (!offlineActionSelect) return;

  const isClockedIn = !!(shellAuth && shellAuth.currentShift);

  const clockInOption = Array.from(offlineActionSelect.options).find(function (opt) {
    return opt.value === "clock_in";
  });

  const noteOption = Array.from(offlineActionSelect.options).find(function (opt) {
    return opt.value === "add_note";
  });

  const clockOutOption = Array.from(offlineActionSelect.options).find(function (opt) {
    return opt.value === "clock_out";
  });

  function setOptionVisible_(option, isVisible) {
    if (!option) return;
    option.hidden = !isVisible;
    option.disabled = !isVisible;
  }

  setOptionVisible_(clockInOption, !isClockedIn);
  setOptionVisible_(noteOption, isClockedIn);
  setOptionVisible_(clockOutOption, isClockedIn);

  const selectedAction = offlineActionSelect.value || "";
  const selectedStillAllowed =
    (selectedAction === "clock_in" && !isClockedIn) ||
    ((selectedAction === "add_note" || selectedAction === "clock_out") && isClockedIn);

  if (!selectedStillAllowed) {
    offlineActionSelect.value = isClockedIn ? "clock_out" : "clock_in";
  }

  if (offlineActionSelect.value === "add_note") {
    showElement_(offlineNoteWrap);
  } else {
    hideElement_(offlineNoteWrap);
  }
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

  updateOfflineActionOptions_(shellAuth);
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
/* begin[shell_refresh_and_sync_helpers] */
async function refreshShellAuth_() {
  const shellAuth = getShellAuth_() || {};

  const sessionToken = shellAuth.sessionToken || "";
  const clientId = shellAuth.clientId || "";

  if (!sessionToken) {
    return {
      ok: false,
      message: "Missing session token.",
      requiresLogin: true,
    };
  }

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        mode: "refreshShellAuth",
        payload: {
          sessionToken: sessionToken,
          clientId: clientId,
        },
      }),
      cache: "no-store",
    });

    const rawText = await response.text();
    let parsed = null;

    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      parsed = null;
    }

    if (!response.ok) {
      throw new Error(
        "Shell auth refresh HTTP " +
          response.status +
          (rawText ? " — " + rawText.slice(0, 200) : "")
      );
    }

    if (!parsed) {
      throw new Error("Shell auth refresh returned a non-JSON response.");
    }

    if (parsed.ok && parsed.payload) {
      saveShellAuth_(parsed.payload);
      return {
        ok: true,
        payload: parsed.payload,
      };
    }

    const message = (parsed && parsed.message) || "Could not refresh shell auth.";
    return {
      ok: false,
      message: message,
      requiresLogin: /session expired|log in again/i.test(message),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        "Shell auth refresh failed: " +
        ((error && error.message) || String(error) || "Unknown error"),
      requiresLogin: false,
    };
  }
}

async function postShellQueueEntry_(queuedEntry) {
  const shellAuth = getShellAuth_() || {};

  const sessionToken =
    (shellAuth && shellAuth.sessionToken) ||
    (queuedEntry && queuedEntry.sessionToken) ||
    "";

  const clientId =
    (shellAuth && shellAuth.clientId) ||
    (queuedEntry && queuedEntry.clientId) ||
    "";

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        mode: "submitShellQueueEntry",
        payload: {
          sessionToken: sessionToken,
          clientId: clientId,
          property: queuedEntry.property || "",
          eventType: queuedEntry.eventType || "",
          note: queuedEntry.note || "",
          submittedAtMs: queuedEntry.submittedAtMs || Date.now(),
        },
      }),
      cache: "no-store",
    });

    const rawText = await response.text();
    let parsed = null;

    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      parsed = null;
    }

    if (!response.ok) {
      throw new Error(
        "Shell sync HTTP " +
          response.status +
          (rawText ? " — " + rawText.slice(0, 200) : "")
      );
    }

    if (!parsed) {
      throw new Error("Shell sync returned a non-JSON response.");
    }

    return parsed;
  } catch (error) {
    throw new Error(
      "Shell sync fetch failed: " +
        ((error && error.message) || String(error) || "Unknown error")
    );
  }
}

async function syncShellQueue_() {
  if (shellSyncInProgress) return;
  if (!navigator.onLine) return;
  if (shellSyncPausedAfterFailures) return;

  const initialQueue = getShellQueue_();
  if (!initialQueue.length) return;

  shellSyncInProgress = true;
  updateShellUi_();

  let finalStatusMessage = "";

  try {
    setStatusText_("Refreshing offline authorization...");

    const refreshResult = await refreshShellAuth_();

    if (!refreshResult || !refreshResult.ok) {
      shellSyncFailureCount += 1;

      finalStatusMessage =
        (refreshResult && refreshResult.message) ||
        "Could not refresh offline authorization. Will retry automatically.";

      if (refreshResult && refreshResult.requiresLogin) {
        finalStatusMessage =
          "Offline entries are waiting. Open the live app and log in online.";
      }

      if (shellSyncFailureCount >= 3) {
        shellSyncPausedAfterFailures = true;
        finalStatusMessage += " Auto-sync paused after 3 failed attempts. Please close and reopen the app, then try again.";
      }

      setStatusText_(finalStatusMessage);
      return;
    }

    while (true) {
      const queue = getShellQueue_();
      if (!queue.length) {
        break;
      }

      const nextEntry = queue[0];
      finalStatusMessage =
        "Syncing queued entry: " +
        (nextEntry.eventType || "?") +
        " at " +
        (nextEntry.property || "?");
      setStatusText_(finalStatusMessage);

      const response = await postShellQueueEntry_(nextEntry);

      if (!response || !response.ok) {
        shellSyncFailureCount += 1;

        finalStatusMessage =
          (response && response.message) ||
          "Could not sync a queued shell entry yet. Will retry automatically.";

        if (/session expired|log in again/i.test(finalStatusMessage)) {
          finalStatusMessage =
            "Offline entries are waiting. Open the live app and log in online.";
        }

        if (shellSyncFailureCount >= 3) {
          shellSyncPausedAfterFailures = true;
          finalStatusMessage += " Auto-sync paused after 3 failed attempts. Please close and reopen the app, then try again.";
        }

        setStatusText_(finalStatusMessage);
        break;
      }

      shellSyncFailureCount = 0;
      shellSyncPausedAfterFailures = false;

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
      shellSyncFailureCount = 0;
      shellSyncPausedAfterFailures = false;
      finalStatusMessage = "Offline entries synced.";
      setStatusText_(finalStatusMessage);
    } else if (!finalStatusMessage) {
      finalStatusMessage =
        "Some offline entries are still queued: " + remainingQueue.length;
      setStatusText_(finalStatusMessage);
    }

  } catch (error) {
    shellSyncFailureCount += 1;

    finalStatusMessage =
      (error && error.message) ||
      "Could not sync offline entries yet. They will stay queued and retry automatically.";

    if (shellSyncFailureCount >= 3) {
      shellSyncPausedAfterFailures = true;
      finalStatusMessage += " Auto-sync paused after 3 failed attempts. Please close and reopen the app, then try again.";
    }

    setStatusText_(finalStatusMessage);
  } finally {
    shellSyncInProgress = false;
    updateOfflineQueueCount_();

    const queueRemaining = getShellQueue_().length;
    updateShellUi_();

    if (finalStatusMessage) {
      const suffix =
        queueRemaining > 0
          ? " Queue remaining: " + queueRemaining
          : " Queue remaining: 0";
      setStatusText_(finalStatusMessage + suffix);
    }
  }
}
/* end[shell_refresh_and_sync_helpers] */


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

/* begin[open_live_app_with_optional_auto_shell_prep] */
function openLiveApp_(options) {
  const opts = options || {};
  const autoShellPrep = !!opts.autoShellPrep;

  shellSyncPausedAfterFailures = false;
  shellSyncFailureCount = 0;
  setButtonState_("Loading...", "loading", true);

  let targetUrl = LIVE_APP_URL;

  if (autoShellPrep) {
    const separator = LIVE_APP_URL.indexOf("?") === -1 ? "?" : "&";
    targetUrl += separator + "autoShellPrep=1";
  }

  window.location.href = targetUrl;
}
/* end[open_live_app_with_optional_auto_shell_prep] */

function enterOfflineMode_() {
  updateShellUi_();
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

    const queueCount = getShellQueue_().length;
    const queueSuffix =
      queueCount > 0 ? ` Queued entries: ${queueCount}.` : "";

    if (shellSyncInProgress) {
      setButtonState_("Syncing...", "loading", true);
      return;
    }

    if (shellSyncPausedAfterFailures && queueCount > 0) {
      setStatusText_(
        `Online, but sync is paused after repeated failures. Please try Open Live App.${queueSuffix}`
      );
      setButtonState_("Open Live App", "online", false);
      return;
    }

/* begin[online_shell_auth_or_auto_prep_handoff] */
    if (shellAuth && shellAuth.cleanerName) {
      const currentShiftText =
        shellAuth.currentShift && shellAuth.currentShift.property
          ? ` Current shift: ${shellAuth.currentShift.property}.`
          : "";

      setStatusText_(
  `Online. No offline prep found on this phone. Launching live app to prepare offline mode...${queueSuffix}`
);

      setButtonState_("Open Live App", "online", false);
      return;
    }

    setStatusText_(
      `Online. Preparing this phone for offline mode...${queueSuffix}`
    );
    setButtonState_("Preparing...", "loading", true);

    setTimeout(function () {
      if (navigator.onLine && !getShellAuth_()) {
        openLiveApp_({ autoShellPrep: true });
      }
    }, 300);

    return;
/* end[online_shell_auth_or_auto_prep_handoff] */
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

    hideElement_(offlineBtn);
    showElement_(offlineEntrySection);
    updateOfflineReadyText_(shellAuth);
    updateOfflineQueueCount_();
    resetOfflineEntryForm_(shellAuth);
    return;
  }

/* begin[clear_missing_prep_offline_message] */
  hideElement_(offlineEntrySection);
  setStatusText_(
    "No connection, and this phone has not been prepared for offline mode yet. Go online once from this home screen icon so the phone can prepare itself."
  );
  setButtonState_("Offline Prep Needed", "offline", true);
/* end[clear_missing_prep_offline_message] */
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
    const shellAuth = getShellAuth_();
    updateOfflineActionOptions_(shellAuth);
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

  if (navigator.onLine) {
    setStatusText_("Refreshing session...");
    await refreshShellAuth_();
  }

  updateShellUi_();
  updateOfflineQueueCount_();
  syncShellQueue_();

  setInterval(function () {
    if (navigator.onLine) {
      syncShellQueue_();
    }
  }, 15000);
});
/* end[clockin_shell_init] */

