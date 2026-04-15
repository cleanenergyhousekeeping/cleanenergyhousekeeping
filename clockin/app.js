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

function scrollToBottom_() {
  window.setTimeout(function () {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: "smooth",
    });
  }, 60);
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
  const queue = getShellQueue_();

  if (offlineQueueCount) {
    offlineQueueCount.textContent = "Queued entries: " + queue.length;
  }

  if (!offlineQueueDetails) return;

  if (!queue.length) {
    offlineQueueDetails.innerHTML = "";
    hideElement_(offlineQueueDetails);
    return;
  }

  offlineQueueDetails.innerHTML = queue
    .map(function (item) {
      const actionMap = {
        clock_in: "Clock In",
        add_note: "Add Cleaning Note",
        clock_out: "Clock Out",
      };

      const actionText = actionMap[item.eventType] || (item.eventType || "—");
      const timeText = new Date(item.submittedAtMs || Date.now()).toLocaleString([], {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      const noteHtml = item.note
        ? '<div class="offlineQueueMeta">Note: ' + item.note + "</div>"
        : "";

      return (
        '<div class="offlineQueueItem">' +
          "<div><strong>" + actionText + "</strong> — " + (item.property || "—") + "</div>" +
          '<div class="offlineQueueMeta">Saved: ' + timeText + "</div>" +
          noteHtml +
        "</div>"
      );
    })
    .join("");

  showElement_(offlineQueueDetails);
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
  "Offline mode is not ready yet on this phone. Please go online, open the live app, log in again if needed, and press Prepare Offline Mode.";
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

/* begin[offline_action_options_keep_select_default] */
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

  const selectedAction = (offlineActionSelect.value || "").trim();
  const selectedStillAllowed =
    selectedAction === "" ||
    (selectedAction === "clock_in" && !isClockedIn) ||
    ((selectedAction === "add_note" || selectedAction === "clock_out") && isClockedIn);

  if (!selectedStillAllowed) {
    offlineActionSelect.value = "";
  }

  if (offlineActionSelect.value === "add_note") {
    showElement_(offlineNoteWrap);
  } else {
    hideElement_(offlineNoteWrap);
  }
}
/* end[offline_action_options_keep_select_default] */

/* begin[reset_offline_entry_form_force_select_default] */
function resetOfflineEntryForm_(shellAuth) {
  if (offlineActionSelect) {
    offlineActionSelect.selectedIndex = 0;
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

  hideElement_(offlineNoteWrap);
  updateOfflineActionOptions_(shellAuth);

  if (offlineActionSelect) {
    offlineActionSelect.selectedIndex = 0;
    offlineActionSelect.value = "";
  }

  clearOfflinePropertyResults_();
}
/* end[reset_offline_entry_form_force_select_default] */

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
  scrollToBottom_();
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

  const initialQueue = getShellQueue_();
  if (!initialQueue.length) return;

  shellSyncInProgress = true;

  let finalStatusMessage = "";

  try {
    setStatusText_("Refreshing offline authorization...");

    const refreshResult = await refreshShellAuth_();

    if (!refreshResult || !refreshResult.ok) {
      finalStatusMessage =
        (refreshResult && refreshResult.message) ||
        "Could not refresh offline authorization.";

      if (refreshResult && refreshResult.requiresLogin) {
        finalStatusMessage =
          "Offline entries are waiting. Open the live app and log in online.";
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
        finalStatusMessage =
          (response && response.message) ||
          "Could not sync a queued shell entry yet.";

        if (/session expired|log in again/i.test(finalStatusMessage)) {
          finalStatusMessage =
            "Offline entries are waiting. Open the live app and log in online.";
        }

        setStatusText_(finalStatusMessage);
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
      finalStatusMessage = "Offline entries synced.";
      setStatusText_(finalStatusMessage);
    } else if (!finalStatusMessage) {
      finalStatusMessage =
        "Some offline entries are still queued: " + remainingQueue.length;
      setStatusText_(finalStatusMessage);
    }

  } catch (error) {
    finalStatusMessage =
      (error && error.message) ||
      "Could not sync offline entries yet. They will stay queued.";
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




function openLiveApp_() {
  setButtonState_("Loading...", "loading");
  window.location.href = LIVE_APP_URL;
}

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
    hideElement_(offlineEntrySection);

    const queueCount = getShellQueue_().length;
    const queueSuffix =
      queueCount > 0 ? ` Queued entries: ${queueCount}.` : "";

    if (shellAuth && shellAuth.cleanerName) {
      const currentShiftText =
        shellAuth.currentShift && shellAuth.currentShift.property
          ? ` Current shift: ${shellAuth.currentShift.property}.`
          : "";

      setStatusText_(
        `Online. Offline mode is prepared for ${shellAuth.cleanerName}.${currentShiftText}${queueSuffix}`
      );
    } else {
      setStatusText_(
        `Online. Tap below to open the live app.${queueSuffix}`
      );
    }

    setButtonState_("Open Live App", "online");
    return;
  }

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

  hideElement_(offlineEntrySection);
  setStatusText_(
  "No connection, and this phone has not been prepared for offline mode yet. Go online, open the live app, log in again if needed, and press Prepare Offline Mode."
);
  setButtonState_("Offline Prep Needed", "offline");
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
});
/* end[clockin_shell_init] */

