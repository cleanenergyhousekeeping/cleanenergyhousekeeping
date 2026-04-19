/* begin[clockin_shell_constants] */
const LIVE_APP_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";

const LIVE_APP_PREP_URL = LIVE_APP_URL + "?view=prepareShell";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";

const SHELL_AUTH_KEY = "ce_shell_auth_v1";
const SHELL_QUEUE_KEY = "ce_shell_queue_v1";
/* end[clockin_shell_constants] */


/* begin[clockin_shell_dom_refs] */
const statusText = document.getElementById("statusText");
const offlineBtn = document.getElementById("offlineBtn");
const installHelp = document.getElementById("installHelp");

const shellUnlockSection = document.getElementById("shellUnlockSection");
const shellAccessCode = document.getElementById("shellAccessCode");
const shellClearPinBtn = document.getElementById("shellClearPinBtn");
const shellBackspacePinBtn = document.getElementById("shellBackspacePinBtn");
const shellPinDots = Array.from(document.querySelectorAll("[data-pin-slot]"));
const shellKeypadButtons = Array.from(document.querySelectorAll("#shellKeypad [data-key]"));

const prepSection = document.getElementById("prepSection");
const loadPrepBtn = document.getElementById("loadPrepBtn");
const prepAccessCode = document.getElementById("prepAccessCode");
const prepClearPinBtn = document.getElementById("prepClearPinBtn");
const prepBackspacePinBtn = document.getElementById("prepBackspacePinBtn");
const prepPinDots = Array.from(document.querySelectorAll("[data-prep-pin-slot]"));
const prepKeypadButtons = Array.from(document.querySelectorAll("#prepKeypad [data-prep-key]"));

const offlineEntrySection = document.getElementById("offlineEntrySection");
const offlineCleanerDisplay = document.getElementById("offlineCleanerDisplay");
const offlineReadyText = document.getElementById("offlineReadyText");
const offlineQueueCount = document.getElementById("offlineQueueCount");
const offlineCurrentCleanStatusRow = document.getElementById("offlineCurrentCleanStatusRow");
const offlineCurrentCleanStatusText = document.getElementById("offlineCurrentCleanStatusText");
const offlineCurrentCleanStartedText = document.getElementById("offlineCurrentCleanStartedText");
const offlineDirectionsBtn = document.getElementById("offlineDirectionsBtn");
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
const shellSyncHud = document.getElementById("shellSyncHud");
const shellSyncHudDetail = document.getElementById("shellSyncHudDetail");
const shellFlashHud = document.getElementById("shellFlashHud");
const shellFlashHudTitle = document.getElementById("shellFlashHudTitle");
const shellFlashHudDetail = document.getElementById("shellFlashHudDetail");
/* end[clockin_shell_dom_refs] */


/* begin[clockin_shell_state] */
let selectedOfflineProperty = null;
let shellEnteredPin = "";
let prepEnteredPin = "";
let shellUnlocked = false;
const SHELL_PIN_LENGTH = 4;
/* end[clockin_shell_state] */
let shellSyncInProgress = false;
let shellSyncTimer = null;

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
async function hashShellPin_(pin) {
  const normalized = String(pin || "").replace(/\D/g, "").trim();
  if (!normalized) return "";

  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));

  return bytes.map(function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

function updateShellPinDots_() {
  shellPinDots.forEach(function (dot, index) {
    if (index < shellEnteredPin.length) {
      dot.classList.add("filled");
    } else {
      dot.classList.remove("filled");
    }
  });

  if (shellAccessCode) {
    shellAccessCode.value = shellEnteredPin;
  }
}

function clearShellPin_() {
  shellEnteredPin = "";
  updateShellPinDots_();
}

function appendShellPinDigit_(digit) {
  if (shellEnteredPin.length >= SHELL_PIN_LENGTH) return;

  shellEnteredPin += String(digit);
  updateShellPinDots_();

  if (shellEnteredPin.length === SHELL_PIN_LENGTH) {
    if (navigator.vibrate) {
      navigator.vibrate(35);
    }
    unlockShellWithPin_();
  }
}

function backspaceShellPin_() {
  shellEnteredPin = shellEnteredPin.slice(0, -1);
  updateShellPinDots_();
}

function updatePrepPinDots_() {
  prepPinDots.forEach(function (dot, index) {
    if (index < prepEnteredPin.length) {
      dot.classList.add("filled");
    } else {
      dot.classList.remove("filled");
    }
  });

  if (prepAccessCode) {
    prepAccessCode.value = prepEnteredPin;
  }
}

function clearPrepPin_() {
  prepEnteredPin = "";
  updatePrepPinDots_();
}

function appendPrepPinDigit_(digit) {
  if (prepEnteredPin.length >= SHELL_PIN_LENGTH) return;

  prepEnteredPin += String(digit);
  updatePrepPinDots_();

  if (prepEnteredPin.length === SHELL_PIN_LENGTH && navigator.vibrate) {
    navigator.vibrate(35);
  }
}

function backspacePrepPin_() {
  prepEnteredPin = prepEnteredPin.slice(0, -1);
  updatePrepPinDots_();
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

/* function startShellBackgroundSync_() {
  if (shellSyncTimer) {
    clearInterval(shellSyncTimer);
    shellSyncTimer = null;
  }

  shellSyncTimer = setInterval(function () {
    const queue = getShellQueue_();

    if (!queue.length) {
      return;
    }

    if (!navigator.onLine) {
      return;
    }

    syncShellQueue_();
  }, 5000);
} */

function setStatusText_(text) {
  if (!statusText) return;
  statusText.textContent = text || "";
}

function setShellEntryLocked_(locked) {
  const isLocked = !!locked;

  if (offlineActionSelect) {
    offlineActionSelect.disabled = isLocked;
    offlineActionSelect.classList.toggle("shellLocked", isLocked);
  }

  if (offlinePropertySearch) {
    offlinePropertySearch.disabled = isLocked;
    offlinePropertySearch.classList.toggle("shellLocked", isLocked);
  }

  if (offlineNoteInput) {
    offlineNoteInput.disabled = isLocked;
    offlineNoteInput.classList.toggle("shellLocked", isLocked);
  }

  if (saveOfflineEntryBtn) {
    saveOfflineEntryBtn.disabled = isLocked;
    saveOfflineEntryBtn.classList.toggle("shellLocked", isLocked);
  }
}

function showShellSyncHud_(detailText) {
  setShellEntryLocked_(true);

  if (shellSyncHudDetail) {
    shellSyncHudDetail.textContent = detailText || "Please wait...";
  }

  if (shellSyncHud) {
    shellSyncHud.classList.remove("hidden");
    shellSyncHud.setAttribute("aria-hidden", "false");
  }
}

function hideShellSyncHud_() {
  setShellEntryLocked_(false);

  if (shellSyncHud) {
    shellSyncHud.classList.add("hidden");
    shellSyncHud.setAttribute("aria-hidden", "true");
  }

  if (shellSyncHudDetail) {
    shellSyncHudDetail.textContent = "Please wait...";
  }
}

let shellFlashHudTimer = null;

function showShellFlashHud_(message, isSuccess) {
  if (!shellFlashHud || !shellFlashHudTitle || !shellFlashHudDetail) return;

  if (shellFlashHudTimer) {
    clearTimeout(shellFlashHudTimer);
    shellFlashHudTimer = null;
  }

  shellFlashHud.classList.remove("hidden", "success", "error");
  shellFlashHud.classList.add(isSuccess ? "success" : "error");
  shellFlashHud.setAttribute("aria-hidden", "false");

  shellFlashHudTitle.textContent = isSuccess ? "SUCCESS" : "ERROR";
  shellFlashHudDetail.textContent = message || "";

  shellFlashHudTimer = setTimeout(function () {
    shellFlashHud.classList.add("hidden");
    shellFlashHud.classList.remove("success", "error");
    shellFlashHud.setAttribute("aria-hidden", "true");
  }, 1800);
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

function formatShellClockTime_(ms) {
  const d = new Date(Number(ms || 0));
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShellElapsedTime_(ms) {
  if (!ms || ms < 0) return "";

  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const colon = '<span class="timerColon">:</span>';
  const clock = `${hours}${colon}${String(minutes).padStart(2, "0")}`;

  return `${clock} (${hours}h ${minutes}m elapsed)`;
}

function renderOfflineCurrentCleanStatus_(shellAuth) {
  if (
    !offlineCurrentCleanStatusRow ||
    !offlineCurrentCleanStatusText ||
    !offlineCurrentCleanStartedText
  ) {
    return;
  }

  const shift = shellAuth && shellAuth.currentShift ? shellAuth.currentShift : null;

  if (!shift || !shift.property || !shift.clockInMs) {
    hideElement_(offlineCurrentCleanStatusRow);
    offlineCurrentCleanStatusText.textContent = "";
    offlineCurrentCleanStartedText.innerHTML = "";
    return;
  }

  showElement_(offlineCurrentCleanStatusRow);
  offlineCurrentCleanStatusText.textContent =
    "Clocked In at " + String(shift.property || "");

  const startedText = shift.clockInDisplay || formatShellClockTime_(shift.clockInMs);

  if (!navigator.onLine) {
    offlineCurrentCleanStartedText.innerHTML =
      'Started: ' + startedText + ' • <span class="offlineElapsedText">Time elapsed unavailable offline.</span>';
    return;
  }

  const elapsedText = formatShellElapsedTime_(Date.now() - Number(shift.clockInMs || 0));

  offlineCurrentCleanStartedText.innerHTML =
    'Started: ' + startedText + ' • <span class="offlineElapsedText">' + elapsedText + "</span>";
}

function updateOfflineDirectionsButton_(prop) {
  if (!offlineDirectionsBtn) return;

  const destination = String((prop && prop.name) || "").trim();
  if (!destination) {
    offlineDirectionsBtn.setAttribute("href", "#");
    offlineDirectionsBtn.classList.add("hidden");
    return;
  }

  offlineDirectionsBtn.setAttribute(
    "href",
    "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination)
  );
  offlineDirectionsBtn.classList.remove("hidden");
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

  const currentValue = offlineActionSelect.value || "";
  const currentStillAllowed =
    (currentValue === "clock_in" && !isClockedIn) ||
    (currentValue === "add_note" && isClockedIn) ||
    (currentValue === "clock_out" && isClockedIn);

  if (!currentStillAllowed) {
    offlineActionSelect.value = "";
  }

  const selectedAction = offlineActionSelect.value || "";
  if (selectedAction === "add_note") {
    showElement_(offlineNoteWrap);
  } else {
    hideElement_(offlineNoteWrap);
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

  if (!queue.length) {
    offlineQueueCount.textContent = "";
    offlineQueueCount.style.display = "none";
    return;
  }

  const latest = queue[queue.length - 1];
  const latestType = String((latest && latest.eventType) || "").replace(/_/g, " ");
  const latestProperty = String((latest && latest.property) || "");

  offlineQueueCount.textContent =
    "Queued: " +
    queue.length +
    (latestType ? " • Last: " + latestType : "") +
    (latestProperty ? " at " + latestProperty : "");

  offlineQueueCount.style.display = "block";
}

function updateOfflineReadyText_(shellAuth) {
  if (offlineCleanerDisplay) {
    offlineCleanerDisplay.value =
      shellAuth && shellAuth.cleanerName ? String(shellAuth.cleanerName) : "";
  }

  renderOfflineCurrentCleanStatus_(shellAuth);
  updateOfflineActionOptions_(shellAuth);

  if (!offlineReadyText) return;

  if (shellAuth && shellAuth.cleanerName) {
    offlineReadyText.textContent = "Welcome, " + shellAuth.cleanerName + ".";
    return;
  }

  offlineReadyText.textContent = "";
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
updateOfflineDirectionsButton_(prop);
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
  if (offlineDirectionsBtn) {
    offlineDirectionsBtn.setAttribute("href", "#");
    offlineDirectionsBtn.classList.add("hidden");
  }
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

    if (currentPropertyName) {
      offlinePropertySearch.readOnly = true;
      offlinePropertySearch.classList.add("lockedProperty");
    } else {
      offlinePropertySearch.readOnly = false;
      offlinePropertySearch.classList.remove("lockedProperty");
    }

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
    showShellFlashHud_("This phone is not ready yet. Please prepare it first.", false);
    return;
  }

  if (!action) {
    showShellFlashHud_("Please select an action.", false);
    return;
  }

  if (!selectedOfflineProperty || !selectedOfflineProperty.name) {
    showShellFlashHud_("Please select a property from the list.", false);
    return;
  }

  if (action === "add_note" && !note) {
    showShellFlashHud_("Please enter a cleaning note.", false);
    return;
  }

  if (shellSyncInProgress) {
    showShellSyncHud_("Previous entry is still syncing...");
    showShellFlashHud_("Please wait — syncing previous entry.", false);
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

  if (navigator.onLine) {
    showShellFlashHud_("Submitting entry...", true);
    syncShellQueue_();
  } else {
    const actionLabel =
      action === "clock_in"
        ? "Clock in saved offline."
        : action === "clock_out"
        ? "Clock out saved offline."
        : "Note saved offline.";

    showShellFlashHud_(actionLabel, true);
  }
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

  const initialQueue = getShellQueue_();
  if (!initialQueue.length) return;

  shellSyncInProgress = true;
  showShellSyncHud_("Please wait...");

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
      showShellSyncHud_(
        (nextEntry.eventType || "entry") +
          " • " +
          (nextEntry.property || "Property")
      );

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
    hideShellSyncHud_();
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

    if (queueRemaining > 0) {
      setTimeout(function () {
        retryQueuedSyncIfReady_();
      }, 1500);
    }
  }
}
/* end[shell_refresh_and_sync_helpers] */

async function unlockShellWithPin_() {
  const shellAuth = getShellAuth_() || {};
  const enteredPin = shellEnteredPin.trim();

  if (!shellAuth || !shellAuth.pinHash) {
    clearShellPin_();
    setStatusText_("This phone is not ready yet. Go online and prepare it first.");
    return;
  }

  if (!enteredPin) {
    setStatusText_("Please enter your access code.");
    return;
  }

  setStatusText_("Checking access code...");

  try {
    const enteredHash = await hashShellPin_(enteredPin);

    if (!enteredHash || enteredHash !== String(shellAuth.pinHash || "")) {
      clearShellPin_();
      setStatusText_("Invalid access code.");
      return;
    }

    shellUnlocked = true;
    clearShellPin_();
    updateShellUi_();
    updateOfflineQueueCount_();
    resetOfflineEntryForm_(shellAuth);

    const cleanerName = shellAuth.cleanerName || "Cleaner";
    setStatusText_("Unlocked for " + cleanerName + ".");
  } catch (error) {
    clearShellPin_();
    setStatusText_(
      "PIN check failed: " +
        ((error && error.message) || String(error) || "Unknown error")
    );
  }
}
/* begin[shell_token_prep_flow] */
const OFFLINE_SHELL_SEED_URL =
  "https://www.cleanenergyhousekeeping.com/clockin/seed.html";

function buildShellSeedPayload_() {
  const shellAuth = getShellAuth_() || {};

  return {
    cleanerName: String(shellAuth.cleanerName || ""),
    accessLevel: String(shellAuth.accessLevel || "LIMITED"),
    currentShift: shellAuth.currentShift || null,
    properties: Array.isArray(shellAuth.properties) ? shellAuth.properties : [],
    sessionToken: String(shellAuth.sessionToken || ""),
    clientId: String(shellAuth.clientId || ""),
    seededAtMs: Date.now(),
  };
}

async function requestShellPrepToken_(payload) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      mode: "createOfflineShellPrepToken",
      payload: payload,
      sessionToken: String((payload && payload.sessionToken) || ""),
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
      "Prep token request failed: " +
        response.status +
        (rawText ? " — " + rawText.slice(0, 200) : "")
    );
  }

  if (!parsed || !parsed.ok || !parsed.token) {
    throw new Error((parsed && parsed.message) || "Could not prepare this phone.");
  }

  return parsed;
}

async function loadOfflinePrep_() {
  if (!navigator.onLine) {
    setStatusText_("No connection. Reconnect before preparing this phone.");
    return;
  }

  const pin = String(prepEnteredPin || "").trim();

  if (!pin || pin.length !== SHELL_PIN_LENGTH) {
    setStatusText_("Please enter your 4-digit PIN to prepare this phone.");
    return;
  }

  setStatusText_("Preparing this phone...");
  if (loadPrepBtn) {
    loadPrepBtn.textContent = "Preparing...";
    loadPrepBtn.disabled = true;
  }

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        mode: "loginWithPin",
        payload: {
          accessCode: pin,
          clientId: "",
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
        "Prepare login failed: " +
          response.status +
          (rawText ? " — " + rawText.slice(0, 200) : "")
      );
    }

    if (!parsed || !parsed.ok) {
      setStatusText_((parsed && parsed.message) || "Could not prepare this phone.");
      return;
    }

    const pinHash = await hashShellPin_(pin);

    const shellAuth = {
      cleanerName: String(parsed.cleanerName || ""),
      accessLevel: String(parsed.accessLevel || "LIMITED"),
      currentShift: parsed.currentShift || null,
      properties: Array.isArray(parsed.properties) ? parsed.properties : [],
      sessionToken: String(parsed.sessionToken || ""),
      clientId: String(parsed.clientId || ""),
      pinHash: pinHash,
      seededAtMs: Date.now(),
    };

    saveShellAuth_(shellAuth);
    shellUnlocked = false;
    clearPrepPin_();
    clearShellPin_();
    updateShellUi_();
    updateOfflineQueueCount_();
    setStatusText_("Phone is prepared. Enter your access code to unlock.");
  } catch (error) {
    setStatusText_(
      "Offline prep failed: " +
        ((error && error.message) || String(error) || "Unknown error")
    );
  } finally {
    if (loadPrepBtn) {
      loadPrepBtn.textContent = "Prepare This Phone";
      loadPrepBtn.disabled = false;
    }
  }
}
/* end[shell_token_prep_flow] */

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
    hideElement_(shellUnlockSection);
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
  hideElement_(offlineBtn);

  if (shellAuth && shellAuth.cleanerName) {
    if (!shellUnlocked) {
      showElement_(shellUnlockSection);
      hideElement_(prepSection);
      hideElement_(offlineEntrySection);

      setStatusText_(
        online
          ? "Phone is prepared. Enter your access code to unlock."
          : "Offline mode is ready. Enter your access code to unlock."
      );
      return;
    }

    hideElement_(shellUnlockSection);
    hideElement_(prepSection);
    showElement_(offlineEntrySection);

    const currentShiftText =
      shellAuth.currentShift && shellAuth.currentShift.property
        ? ` Current shift: ${shellAuth.currentShift.property}.`
        : "";

    const queueCount = getShellQueue_().length;
    const queueSuffix =
      queueCount > 0 ? ` Queued entries: ${queueCount}.` : "";

    setStatusText_(
      `${online ? "Online" : "Offline"} ready for ${shellAuth.cleanerName}.${currentShiftText}${queueSuffix}`
    );

    updateOfflineReadyText_(shellAuth);
    updateOfflineQueueCount_();
    resetOfflineEntryForm_(shellAuth);
    return;
  }

  hideElement_(shellUnlockSection);
  hideElement_(offlineEntrySection);
  showElement_(prepSection);

  if (online) {
    setStatusText_("Go online once and prepare this phone.");
  } else {
    setStatusText_("No connection. This phone is not ready yet. Go online once and prepare it first.");
  }
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

function retryQueuedSyncIfReady_() {
  updateShellUi_();

  if (shellSyncInProgress) {
    return;
  }

  const queue = getShellQueue_();
  if (!queue.length) {
    return;
  }

  syncShellQueue_();
}

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState !== "visible") {
    return;
  }

  retryQueuedSyncIfReady_();

  setTimeout(function () {
    retryQueuedSyncIfReady_();
  }, 900);
});

window.addEventListener("pageshow", function () {
  retryQueuedSyncIfReady_();

  setTimeout(function () {
    retryQueuedSyncIfReady_();
  }, 900);
});

window.addEventListener("focus", function () {
  retryQueuedSyncIfReady_();

  setTimeout(function () {
    retryQueuedSyncIfReady_();
  }, 900);
});

if (offlineBtn) {
  offlineBtn.addEventListener("click", function () {
    // Always enter shell mode
    enterOfflineMode_();
  });
}

shellKeypadButtons.forEach(function (btn) {
  btn.addEventListener("click", function () {
    appendShellPinDigit_(btn.getAttribute("data-key"));
  });
});

prepKeypadButtons.forEach(function (btn) {
  btn.addEventListener("click", function () {
    appendPrepPinDigit_(btn.getAttribute("data-prep-key"));
  });
});

if (prepClearPinBtn) {
  prepClearPinBtn.addEventListener("click", function () {
    clearPrepPin_();
  });
}

if (prepBackspacePinBtn) {
  prepBackspacePinBtn.addEventListener("click", function () {
    backspacePrepPin_();
  });
}

if (shellClearPinBtn) {
  shellClearPinBtn.addEventListener("click", function () {
    clearShellPin_();
  });
}

if (shellBackspacePinBtn) {
  shellBackspacePinBtn.addEventListener("click", function () {
    backspaceShellPin_();
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
  shellUnlocked = false;
  clearShellPin_();
  clearPrepPin_();
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

