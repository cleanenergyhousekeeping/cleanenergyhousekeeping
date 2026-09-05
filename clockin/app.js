
/* begin[clockin_live_shell_constants] */
const LIVE_APP_URL =
  "https://script.google.com/macros/s/AKfycbz9NS-QSV31FZRy1jWDPBEQQ8Ht4x7UIPegNYp01nwASfwgtZ6pGieYsOeYMcQf62G5/exec";

const LIVE_APP_PREP_URL = LIVE_APP_URL + "?view=prepareShell";
const LIVE_BUILD_VERSION = "v253";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbz9NS-QSV31FZRy1jWDPBEQQ8Ht4x7UIPegNYp01nwASfwgtZ6pGieYsOeYMcQf62G5/exec";

const SHELL_AUTH_KEY = "ce_shell_auth_v1";
const SHELL_QUEUE_KEY = "ce_shell_queue_v1";
const SHELL_ENTRY_DRAFT_KEY = "ce_shell_entry_draft_v1";
// Keep this global switch available for a deliberate production relay shutdown.
const LIVE_RELAY_FEATURE_ENABLED = true;
const LIVE_RELAY_WORKER_URL = "https://ceh-relay-production.kyle-405.workers.dev";
const LIVE_RELAY_STATE_KEY = "ce_shell_live_relay_state_v1";
const LIVE_RELAY_INSTALLATION_ID_KEY = "ce_shell_live_relay_installation_id_v1";
const LIVE_RELAY_LOCK_NAME = "ce-shell-live-relay-v1";
const LIVE_RELAY_HEALTH_TIMEOUT_MS = 5 * 1000;
const LIVE_RELAY_REACHABILITY_RETRY_MS = 30 * 1000;
/* end[clockin_live_shell_constants] */


/* begin[clockin_shell_dom_refs] */
const statusText = document.getElementById("statusText");
const offlineBtn = document.getElementById("offlineBtn");
const installHelp = document.getElementById("installHelp");
const shellBlueBar = document.getElementById("shellBlueBar");
const shellWorkHistoryBtn = document.getElementById("shellWorkHistoryBtn");

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
const offlineGuidanceText = document.getElementById("offlineGuidanceText");
const offlineReadyText = document.getElementById("offlineReadyText");
const offlineQueueCount = document.getElementById("offlineQueueCount");
const offlineCurrentCleanStatusRow = document.getElementById("offlineCurrentCleanStatusRow");
const offlineCurrentCleanStatusText = document.getElementById("offlineCurrentCleanStatusText");
const offlineCurrentCleanStartedText = document.getElementById("offlineCurrentCleanStartedText");
const offlineDirectionsBtn = document.getElementById("offlineDirectionsBtn");
const offlineActionSelect = document.getElementById("offlineActionSelect");
const offlinePropertySearch = document.getElementById("offlinePropertySearch");
const offlinePropertyClearBtn = document.getElementById("offlinePropertyClearBtn");
const offlinePropertyResults = document.getElementById("offlinePropertyResults");
const offlinePropertyInfoPanel = document.getElementById("offlinePropertyInfoPanel");
const offlinePropertyInfoEntranceRow = document.getElementById("offlinePropertyInfoEntranceRow");
const offlinePropertyInfoAlarmRow = document.getElementById("offlinePropertyInfoAlarmRow");
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
const shellSyncHudTitle = document.getElementById("shellSyncHudTitle");
const shellSyncHudDetail = document.getElementById("shellSyncHudDetail");
const shellFlashHud = document.getElementById("shellFlashHud");
const shellFlashHudTitle = document.getElementById("shellFlashHudTitle");
const shellFlashHudDetail = document.getElementById("shellFlashHudDetail");
const shellWorkHistoryModal = document.getElementById("shellWorkHistoryModal");
const shellWorkHistoryBackBtn = document.getElementById("shellWorkHistoryBackBtn");
const shellWorkHistoryWeekLabel = document.getElementById("shellWorkHistoryWeekLabel");
const shellWorkHistoryContent = document.getElementById("shellWorkHistoryContent");
const shellWorkHistoryTotalValue = document.getElementById("shellWorkHistoryTotalValue");
const relayPairingPanel = document.getElementById("relayPairingPanel");
const relayPairingStatus = document.getElementById("relayPairingStatus");
/* end[clockin_shell_dom_refs] */


/* begin[clockin_shell_state] */
let selectedOfflineProperty = null;
let shellEnteredPin = "";
let prepEnteredPin = "";
let shellUnlocked = false;
let shellPinUnlockInProgress = false;
let shellLoginGeneration = 0;
let shellBackgroundPinValidationInProgress = false;
let shellPrepInProgress = false;
const SHELL_PIN_LENGTH = 4;
/* end[clockin_shell_state] */
let shellSyncInProgress = false;
let shellSyncTimer = null;
let shellLastForegroundRefreshMs = 0;
let offlineReadyStatusOverride = "";
let relayReachabilityProbe = null;
let relayReachabilityState = "unknown";
let relayHudAttentionMessage = "";
let relaySubmissionInProgress = false;
let relaySyncInProgress = 0;
let relayAutoPairingInProgress = false;

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

/* begin[live_relay_feature_gate] */
function isLiveRelayEnabledForCleaner_(shellAuth) {
  if (!LIVE_RELAY_FEATURE_ENABLED) return false;
  const candidate = shellAuth || getShellAuth_();
  const cleanerName = String((candidate && candidate.cleanerName) || "").trim();
  const preparedCredential = String(
    (candidate && (candidate.pinHash || candidate.sessionToken)) || ""
  ).trim();
  return !!cleanerName && !!preparedCredential;
}
/* end[live_relay_feature_gate] */

function saveShellAuth_(payload) {
  localStorage.setItem(
    SHELL_AUTH_KEY,
    JSON.stringify(deriveEffectiveRelayShellAuth_(payload))
  );
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
    setStatusText_("Checking access...");
    setOfflineReadyStatusText_("Checking access...");
    showShellSyncHud_("Checking access...", "Logging In");
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

/* begin[clockin_live_entry_draft] */
let shellEntryContext = "";
function getShellEntryDraft_() {
  try {
    const raw = localStorage.getItem(SHELL_ENTRY_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function saveShellEntryDraft_() {
  const shellAuth = getShellAuth_();
  if (!shellAuth || !shellAuth.cleanerName || !shellUnlocked) return;

  localStorage.setItem(SHELL_ENTRY_DRAFT_KEY, JSON.stringify({
    cleanerName: String(shellAuth.cleanerName),
    propertyName: String((selectedOfflineProperty && selectedOfflineProperty.name) || ""),
    action: String((offlineActionSelect && offlineActionSelect.value) || ""),
    note: String((offlineNoteInput && offlineNoteInput.value) || ""),
  }));
}

function clearShellEntryDraft_() {
  shellEntryContext = "";
  localStorage.removeItem(SHELL_ENTRY_DRAFT_KEY);
}

function reconcileShellEntryDraft_(shellAuth) {
  const shift = shellAuth && shellAuth.currentShift;
  const context = JSON.stringify([
    shellLoginGeneration,
    String((shellAuth && shellAuth.cleanerName) || ""),
    !!shift,
    String((shift && shift.property) || ""),
    Number((shift && shift.clockInMs) || 0),
  ]);
  const refreshedProperty = selectedOfflineProperty &&
    findOfflinePropertyByName_(selectedOfflineProperty.name, shellAuth);

  // A refresh of the same session must not reset typing, selection or notes.
  // A changed shift, new login or explicit form reset still reconciles below.
  if (shellUnlocked && shellEntryContext === context &&
      (!selectedOfflineProperty || refreshedProperty)) {
    if (refreshedProperty) {
      selectedOfflineProperty = refreshedProperty;
      fillOfflinePropertyInfo_(refreshedProperty);
    }
    updateOfflineActionOptions_(shellAuth);
    updateOfflineGuidanceText_(shellAuth);
    return;
  }
  shellEntryContext = context;
  const savedDraft = getShellEntryDraft_();
  const sameCleaner =
    savedDraft &&
    String(savedDraft.cleanerName || "") === String((shellAuth && shellAuth.cleanerName) || "");
  const isClockedIn = !!(shellAuth && shellAuth.currentShift);
  const activeShiftProperty = getCurrentPropertyText_(shellAuth);
  const draftAction = sameCleaner ? String(savedDraft.action || "") : "";
  const actionIsValid =
    isClockedIn && (draftAction === "add_note" || draftAction === "clock_out");
  const property = findOfflinePropertyByName_(activeShiftProperty, shellAuth);

  selectedOfflineProperty = property || null;
  if (offlinePropertySearch) {
    offlinePropertySearch.value = property ? String(property.name || "") : "";
    offlinePropertySearch.readOnly = !!activeShiftProperty;
    offlinePropertySearch.classList.toggle("lockedProperty", !!activeShiftProperty);
  }

  if (property) {
    fillOfflinePropertyInfo_(property);
  } else {
    hideOfflinePropertyInfo_();
  }

  if (offlineActionSelect) {
    offlineActionSelect.value = actionIsValid ? draftAction : "";
  }
  updateOfflineActionOptions_(shellAuth);

  if (offlineNoteInput) {
    offlineNoteInput.value =
      actionIsValid && draftAction === "add_note" ? String(savedDraft.note || "") : "";
  }

  clearOfflinePropertyResults_();
  updateOfflineGuidanceText_(shellAuth);
  saveShellEntryDraft_();
}
/* end[clockin_live_entry_draft] */

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

/* begin[shell_ready_status_helpers] */
function setOfflineReadyStatusText_(text) {
  offlineReadyStatusOverride = text ? String(text) : "";

  if (!offlineReadyText) return;

  if (offlineReadyStatusOverride) {
    offlineReadyText.textContent = offlineReadyStatusOverride;
    return;
  }

  const shellAuth = getShellAuth_() || {};
  if (shellAuth && shellAuth.cleanerName) {
    offlineReadyText.textContent = "Welcome, " + String(shellAuth.cleanerName).trim().split(/\s+/)[0] + ".";
    return;
  }

  offlineReadyText.textContent = "";
}
/* end[shell_ready_status_helpers] */

/* begin[shell_entry_lock_helper] */
function setShellEntryLocked_(locked) {
  const isLocked = !!locked;

  if (offlineEntrySection) {
    offlineEntrySection.classList.toggle("shellEntryDimmed", isLocked);
  }

  if (offlineActionSelect) {
    offlineActionSelect.disabled = isLocked;
    offlineActionSelect.classList.toggle("shellLocked", isLocked);
  }

  if (offlinePropertySearch) {
    offlinePropertySearch.disabled = isLocked;
    offlinePropertySearch.classList.toggle("shellLocked", isLocked);
  }

  updateOfflinePropertyClearButton_(getShellAuth_());

  if (offlineNoteInput) {
    offlineNoteInput.disabled = isLocked;
    offlineNoteInput.classList.toggle("shellLocked", isLocked);
  }

  if (saveOfflineEntryBtn) {
    saveOfflineEntryBtn.disabled = isLocked;
    saveOfflineEntryBtn.classList.toggle("shellLocked", isLocked);
  }
}
/* end[shell_entry_lock_helper] */

function relayAttentionRequiresEntryLock_() {
  if (!isLiveRelayEnabledForCleaner_()) return false;
  const shellAuth = getShellAuth_() || {};
  const state = getRelayState_();
  return !!(
    shellAuth.relayAttentionRequired ||
    (state && state.attentionRequired) ||
    (state && Array.isArray(state.queue) && state.queue.some(function (event) {
      return event.status === "terminal";
    }))
  );
}

let shellActionHudTimer = null;

function showShellSyncHud_(detailText, titleText) {
  if (shellActionHudTimer) {
    clearTimeout(shellActionHudTimer);
    shellActionHudTimer = null;
  }
  setShellEntryLocked_(true);

  if (shellSyncHudTitle) {
    shellSyncHudTitle.textContent = titleText || "Syncing";
  }

  if (shellSyncHudDetail) {
    shellSyncHudDetail.textContent = detailText || "Please wait...";
  }

  if (shellSyncHud) {
    shellSyncHud.classList.remove("hidden");
    shellSyncHud.setAttribute("aria-hidden", "false");
  }
}

function hideShellSyncHud_() {
  if (shellActionHudTimer) {
    clearTimeout(shellActionHudTimer);
    shellActionHudTimer = null;
  }
  setShellEntryLocked_(relayAttentionRequiresEntryLock_());

  if (shellSyncHud) {
    shellSyncHud.classList.add("hidden");
    shellSyncHud.setAttribute("aria-hidden", "true");
  }

  if (shellSyncHudDetail) {
    shellSyncHudDetail.textContent = "Please wait...";
  }

  if (shellSyncHudTitle) {
    shellSyncHudTitle.textContent = "Syncing";
  }

  tryLivePwaUpdateReload_();
}

function showShellActionConfirmation_(title, detail, durationMs) {
  const confirmationDurationMs = Number.isFinite(durationMs) ? durationMs : 1000;
  showShellSyncHud_(detail, title);
  shellActionHudTimer = setTimeout(function () {
    shellActionHudTimer = null;
    hideShellSyncHud_();
  }, confirmationDurationMs);
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

  shellFlashHudTitle.textContent = isSuccess ? "Success" : "Error";
  shellFlashHudDetail.textContent = message || "";

  shellFlashHudTimer = setTimeout(function () {
    shellFlashHud.classList.add("hidden");
    shellFlashHud.classList.remove("success", "error");
    shellFlashHud.setAttribute("aria-hidden", "true");
    tryLivePwaUpdateReload_();
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

/* begin[offline_native_directions] */
function getOfflineDirectionsUrl_(destination) {
  const encoded = encodeURIComponent(destination);
  const userAgent = String(navigator.userAgent || "");
  const fallback = "https://www.google.com/maps/dir/?api=1&destination=" + encoded;
  if (/Android/i.test(userAgent)) {
    // No package restriction: let Android choose the user's map handler.
    return "intent:0,0?q=" + encoded +
      "#Intent;scheme=geo;action=android.intent.action.VIEW;S.browser_fallback_url=" +
      encodeURIComponent(fallback) + ";end";
  }
  if (/iPhone|iPad|iPod/i.test(userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "https://maps.apple.com/?daddr=" + encoded;
  }
  return fallback;
}
/* end[offline_native_directions] */

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
    getOfflineDirectionsUrl_(destination)
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

/* begin[offline_queue_panel_and_guidance_helpers] */
function formatOfflineActionLabel_(eventType) {
  const value = String(eventType || "").trim();

  if (value === "clock_in") return "Clock In";
  if (value === "clock_out") return "Clock Out";
  if (value === "add_note") return "Add Note";

  return value ? value.replace(/_/g, " ") : "Entry";
}

function formatOfflineQueueTimestamp_(submittedAtMs) {
  const d = new Date(Number(submittedAtMs || 0));
  if (Number.isNaN(d.getTime())) return "Time unavailable";

  return d.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function updateOfflineQueueCount_() {
  if (!offlineQueueCount) return;

  if (isLiveRelayEnabledForCleaner_()) {
    updateRelayQueueCount_();
    return;
  }

  const queue = getShellQueue_();

  if (!queue.length) {
    offlineQueueCount.innerHTML = "";
    offlineQueueCount.classList.add("hidden");
    return;
  }

  const latest = queue[queue.length - 1];
  const latestAction = formatOfflineActionLabel_(latest && latest.eventType);
  const latestProperty = String((latest && latest.property) || "No property");
  const latestTime = formatOfflineQueueTimestamp_(latest && latest.submittedAtMs);

  offlineQueueCount.innerHTML =
    '<div class="offlineQueueCountTitle">Queued entries: ' + queue.length + "</div>" +
    '<div class="offlineQueueCountMeta">Latest: ' + latestAction + "</div>" +
    '<div class="offlineQueueCountMeta">' + latestProperty + "</div>" +
    '<div class="offlineQueueCountMeta">Saved: ' + latestTime + "</div>";

  offlineQueueCount.classList.remove("hidden");
}

function updateOfflineGuidanceText_(shellAuth) {
  updateOfflinePropertyClearButton_(shellAuth);
  if (!offlineGuidanceText) return;

  const hasActiveShift = !!(shellAuth && shellAuth.currentShift);
  const hasProperty = !!(selectedOfflineProperty && selectedOfflineProperty.name);
  const selectedAction = String((offlineActionSelect && offlineActionSelect.value) || "");

  let guidance = "";

  if (hasActiveShift) {
    guidance = "You are clocked in. Add a note or clock out when finished.";
  } else if (!hasProperty && !selectedAction) {
    guidance = "Select a property and action to begin.";
  } else if (hasProperty && !selectedAction) {
    guidance = "Property selected. Now choose an action.";
  } else if (!hasProperty && selectedAction) {
    guidance = "Action selected. Now choose a property from the list.";
  }

  if (!guidance) {
    offlineGuidanceText.textContent = "";
    offlineGuidanceText.classList.add("hidden");
    return;
  }

  offlineGuidanceText.textContent = guidance;
  offlineGuidanceText.classList.remove("hidden");
}

function updateOfflineReadyText_(shellAuth) {
  if (offlineCleanerDisplay) {
    offlineCleanerDisplay.value =
      shellAuth && shellAuth.cleanerName ? String(shellAuth.cleanerName) : "";
  }

  renderOfflineCurrentCleanStatus_(shellAuth);
  updateOfflineActionOptions_(shellAuth);
  updateOfflineGuidanceText_(shellAuth);

  if (!offlineReadyText) return;

  if (offlineReadyStatusOverride) {
    offlineReadyText.textContent = offlineReadyStatusOverride;
    return;
  }

  if (shellAuth && shellAuth.cleanerName) {
    offlineReadyText.textContent = "Welcome, " + String(shellAuth.cleanerName).trim().split(/\s+/)[0] + ".";
    return;
  }

  offlineReadyText.textContent = "";
}
/* end[offline_queue_panel_and_guidance_helpers] */

function clearOfflinePropertyResults_() {
  if (!offlinePropertyResults) return;
  offlinePropertyResults.innerHTML = "";
  hideElement_(offlinePropertyResults);
}

function fillOfflinePropertyInfo_(prop) {
  if (!prop || !offlinePropertyInfoPanel) return;

  const shellAuth = getShellAuth_() || {};
  const accessLevel = String(shellAuth.accessLevel || "LIMITED").trim().toUpperCase();
  const hasFullAccess = accessLevel === "FULL";

  if (offlinePropertyInfoEntranceRow) {
    offlinePropertyInfoEntranceRow.classList.toggle("hidden", !hasFullAccess);
  }

  if (offlinePropertyInfoAlarmRow) {
    offlinePropertyInfoAlarmRow.classList.toggle("hidden", !hasFullAccess);
  }

  offlinePropertyInfoEntrance.textContent = hasFullAccess ? (prop.entranceInfo || "—") : "";
  offlinePropertyInfoAlarm.textContent = hasFullAccess ? (prop.alarmInfo || "—") : "";
  offlinePropertyInfoWifi.textContent = prop.wifiNetwork || "—";
  offlinePropertyInfoWifiPassword.textContent = prop.wifiPassword || "—";
  offlinePropertyInfoOwners.textContent = prop.ownerNames || "—";
  offlinePropertyInfoNotes.textContent = prop.houseNotes || "—";

  updateOfflineDirectionsButton_(prop);
  showElement_(offlinePropertyInfoPanel);
}

function hideOfflinePropertyInfo_() {
  if (!offlinePropertyInfoPanel) return;

  if (offlinePropertyInfoEntranceRow) {
    offlinePropertyInfoEntranceRow.classList.remove("hidden");
  }

  if (offlinePropertyInfoAlarmRow) {
    offlinePropertyInfoAlarmRow.classList.remove("hidden");
  }

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

/* begin[select_offline_property_with_guidance_refresh] */
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

  updateOfflineGuidanceText_(getShellAuth_());
  saveShellEntryDraft_();
}
/* end[select_offline_property_with_guidance_refresh] */

function findOfflinePropertyByName_(name, shellAuth) {
  const target = String(name || "").trim();
  if (!target) return null;

  return getShellProperties_(shellAuth).find(function (prop) {
    return String((prop && prop.name) || "") === target;
  }) || null;
}

/* begin[offline_property_search_with_guidance_refresh] */
function handleOfflinePropertySearch_() {
  const shellAuth = getShellAuth_();
  const query = (offlinePropertySearch && offlinePropertySearch.value || "").trim().toLowerCase();

  if (!query) {
    selectedOfflineProperty = null;
    clearOfflinePropertyResults_();
    hideOfflinePropertyInfo_();
    updateOfflineGuidanceText_(shellAuth);
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
    updateOfflineGuidanceText_(shellAuth);
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
  updateOfflineGuidanceText_(shellAuth);
}
/* end[offline_property_search_with_guidance_refresh] */

/* begin[offline_property_clear] */
function updateOfflinePropertyClearButton_(shellAuth) {
  if (!offlinePropertyClearBtn) return;
  offlinePropertyClearBtn.disabled =
    !shellUnlocked ||
    !!(shellAuth && shellAuth.currentShift) ||
    !offlinePropertySearch ||
    offlinePropertySearch.readOnly ||
    offlinePropertySearch.disabled;
}

function clearOfflinePropertySearch_() {
  const shellAuth = getShellAuth_();
  if (
    !shellUnlocked ||
    (shellAuth && shellAuth.currentShift) ||
    !offlinePropertySearch ||
    offlinePropertySearch.readOnly ||
    offlinePropertySearch.disabled
  ) return;

  offlinePropertySearch.value = "";
  handleOfflinePropertySearch_();
  saveShellEntryDraft_();
  offlinePropertySearch.focus();
}
/* end[offline_property_clear] */

/* begin[reset_offline_entry_form_with_guidance_refresh] */
function resetOfflineEntryForm_(shellAuth) {
  clearShellEntryDraft_();
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
  updateOfflineGuidanceText_(shellAuth);
}
/* end[reset_offline_entry_form_with_guidance_refresh] */

async function withRelayLock_(callback) {
  if (!navigator.locks || typeof navigator.locks.request !== "function") {
    throw new Error("Relay mode requires exclusive Web Locks support.");
  }
  return navigator.locks.request(LIVE_RELAY_LOCK_NAME, { mode: "exclusive" }, callback);
}

function getRelayState_() {
  try {
    const raw = localStorage.getItem(LIVE_RELAY_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.version === 1 && Array.isArray(parsed.queue) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveRelayState_(state) {
  localStorage.setItem(LIVE_RELAY_STATE_KEY, JSON.stringify(state));
}

function updateRelayQueueCount_() {
  renderRelayStatus_();
}

function setRelayReachabilityState_(state) {
  if (!isLiveRelayEnabledForCleaner_()) return;
  relayReachabilityState = state;
  renderRelayStatus_();
}

function setRelayHudAttention_(message) {
  if (!isLiveRelayEnabledForCleaner_()) return;
  relayHudAttentionMessage = String(message || "");
  renderRelayStatus_();
}

function renderRelayStatus_() {
  if (!isLiveRelayEnabledForCleaner_()) return;
  const state = getRelayState_();
  const queue = state && Array.isArray(state.queue) ? state.queue : [];
  const pending = queue.filter(function (event) {
    return event.status !== "accepted";
  });
  const hasTerminal = pending.some(function (event) {
    return event.status === "terminal";
  });
  const hasAccepted = queue.some(function (event) {
    return event.status === "accepted";
  });
  let message = "";

  if (relayHudAttentionMessage || hasTerminal) {
    message = "Some entries need help syncing. Your work is still saved.";
  } else if (pending.length && !navigator.onLine) {
    message = "Saved on this phone. Waiting for connection.";
  } else if (pending.length && relayReachabilityState === "unreachable") {
    message = "Saved on this phone. Waiting for connection.";
  } else if (pending.length) {
    message = relayReachabilityState === "reachable"
      ? "Sending saved entries..."
      : "Saved on this phone. Checking connection...";
  } else if (hasAccepted) {
    message = "All caught up.";
  } else if (state && state.pairedDeviceId && relayReachabilityState === "reachable") {
    message = "Connected and ready.";
  }

  if (offlineQueueCount) {
    if (message) {
      offlineQueueCount.textContent = message;
      offlineQueueCount.classList.remove("hidden");
    } else {
      offlineQueueCount.textContent = "";
      offlineQueueCount.classList.add("hidden");
    }
  }

  if (message && shellUnlocked && isStandaloneMode_()) {
    setStatusText_(message);
  }
}

function setRelayPairingStatus_(message) {
  if (relayPairingStatus) relayPairingStatus.textContent = String(message || "");
}

function isRelayDeviceId_(value) {
  return /^[A-Za-z][A-Za-z0-9._:-]{15,127}$/.test(String(value || ""));
}

/* begin[live_automatic_relay_installation_identity] */
function getRelayInstallationId_() {
  try {
    const deviceId = localStorage.getItem(LIVE_RELAY_INSTALLATION_ID_KEY);
    return isRelayDeviceId_(deviceId) ? deviceId : "";
  } catch (_) {
    return "";
  }
}

function saveRelayInstallationId_(deviceId) {
  if (!isRelayDeviceId_(deviceId)) {
    throw new Error("This phone could not securely prepare relay setup.");
  }
  localStorage.setItem(LIVE_RELAY_INSTALLATION_ID_KEY, deviceId);
  if (getRelayInstallationId_() !== deviceId) {
    throw new Error("This phone could not securely save relay setup.");
  }
}

function getOrCreateRelayInstallationId_() {
  const existingDeviceId = getRelayInstallationId_();
  if (existingDeviceId) return existingDeviceId;
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("This browser cannot securely prepare this phone.");
  }
  const deviceId = "production-relay-" + crypto.randomUUID();
  saveRelayInstallationId_(deviceId);
  return deviceId;
}

function synchronizeExistingRelayInstallationIdentity_(state) {
  if (!isLiveRelayEnabledForCleaner_()) return false;
  if (!state || !isRelayDeviceId_(state.pairedDeviceId)) return false;
  if (getRelayInstallationId_() !== state.pairedDeviceId) {
    try {
      saveRelayInstallationId_(state.pairedDeviceId);
    } catch (_) {
      // The existing valid pairing remains authoritative if this optional mirror cannot persist.
    }
  }
  return true;
}
/* end[live_automatic_relay_installation_identity] */

function makeRelayEventId_() {
  if (!crypto || typeof crypto.randomUUID !== "function") {
    throw new Error("Relay mode requires secure event-ID generation.");
  }
  return "relay-event-" + crypto.randomUUID();
}

function updateRelayPairingUi_() {
  if (!relayPairingPanel) return;
  const relayEnabled = isLiveRelayEnabledForCleaner_();
  relayPairingPanel.classList.toggle("hidden", !relayEnabled);
  if (!relayEnabled) return;
  const state = getRelayState_();
  const paired = !!(state && state.pairedDeviceId);
  relayPairingPanel.classList.toggle("hidden", paired);
  if (getShellQueue_().length > 0) {
    setRelayPairingStatus_("Finish syncing saved entries before this phone can finish setup.");
    return;
  }
  if (paired) {
    setRelayPairingStatus_("Phone setup is complete.");
  } else if (!relayAutoPairingInProgress) {
    setRelayPairingStatus_("This phone will finish secure setup when it is online.");
  }
}

async function callRelayJson_(path, body, relayToken) {
  if (!isLiveRelayEnabledForCleaner_() || !LIVE_RELAY_WORKER_URL) {
    throw new Error("Live relay is not active.");
  }
  const headers = { "Content-Type": "application/json" };
  if (relayToken) headers.Authorization = "Bearer " + relayToken;
  const response = await fetch(LIVE_RELAY_WORKER_URL + path, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {}
  return { httpStatus: response.status, payload: payload };
}

function probeRelayReachability_() {
  if (!isLiveRelayEnabledForCleaner_() || !LIVE_RELAY_WORKER_URL || !navigator.onLine) {
    return Promise.resolve(false);
  }
  if (relayReachabilityProbe) {
    return relayReachabilityProbe;
  }

  const controller = new AbortController();
  const timeout = setTimeout(function () {
    controller.abort();
  }, LIVE_RELAY_HEALTH_TIMEOUT_MS);

  relayReachabilityProbe = fetch(LIVE_RELAY_WORKER_URL + "/health", {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    signal: controller.signal,
  }).then(function (response) {
    if (response.status !== 200) return null;
    return response.json();
  }).then(function (payload) {
    const reachable = !!(
      payload &&
      payload.ok === true &&
      payload.service === "ceh-relay" &&
      payload.environment === "production" &&
      payload.storage === "ok"
    );
    setRelayReachabilityState_(reachable ? "reachable" : "unreachable");
    if (reachable) {
      // Defer until this shared probe has settled so the drain does not await itself.
      setTimeout(triggerRelayQueueDrainWhenReachable_, 0);
    }
    return reachable;
  }).catch(function () {
    setRelayReachabilityState_("unreachable");
    return false;
  }).finally(function () {
    clearTimeout(timeout);
    relayReachabilityProbe = null;
  });

  return relayReachabilityProbe;
}

function readRelaySession_(result, expectedDeviceId) {
  const payload = result && result.payload;
  const session = payload && payload.ok === true ? payload.session : null;
  if (!session || session.deviceId !== expectedDeviceId || !session.ledgerHighWater) {
    throw new Error("Relay session response did not confirm the paired device.");
  }
  const highWater = session.ledgerHighWater;
  if (highWater.deviceId !== expectedDeviceId || !Number.isSafeInteger(highWater.appliedThroughSequence)) {
    throw new Error("Relay session response has an invalid ledger high-water mark.");
  }
  if (typeof session.relayToken !== "string" || !Number.isSafeInteger(session.expiresAtMs)) {
    throw new Error("Relay session response is incomplete.");
  }
  return session;
}

function verifyRelayHighWater_(state, appliedThroughSequence) {
  const lastConfirmed = Number(state.lastConfirmedLedgerHighWater || 0);
  const highestAllocated = Number(state.highestAllocatedSequence || 0);
  if (appliedThroughSequence < lastConfirmed) {
    throw new Error("Relay ledger high-water moved backward. Pairing must be reviewed.");
  }
  if (appliedThroughSequence > highestAllocated) {
    throw new Error("Relay state is stale or conflicts with this installation. Pairing must be reviewed.");
  }
  // A lower high-water is expected while immutable local events await delivery.
  // Their existing IDs and sequences are preserved without renumbering.
}

function deriveEffectiveRelayShellAuth_(shellAuth) {
  if (!shellAuth || !isLiveRelayEnabledForCleaner_(shellAuth)) return shellAuth;
  const state = getRelayState_();
  if (!state || !Array.isArray(state.queue)) return shellAuth;
  const derived = Object.assign({}, shellAuth);
  const highWater = Number(state.lastConfirmedLedgerHighWater || 0);
  const events = state.queue.slice().sort(function (left, right) {
    return Number(left.deviceSequence) - Number(right.deviceSequence);
  });
  derived.relayAttentionRequired = false;
  for (const event of events) {
    if (event.status === "terminal") {
      derived.relayAttentionRequired = true;
      break;
    }
    if (Number(event.deviceSequence) <= highWater) continue;
    if (event.eventType === "clock_in") {
      derived.currentShift = {
        property: event.property,
        clockInMs: event.submittedAtMs,
        clockInDisplay: "",
      };
    } else if (event.eventType === "clock_out") {
      derived.currentShift = null;
    }
  }
  return derived;
}

function assertLegacyQueueIsEmpty_() {
  if (getShellQueue_().length > 0) {
    throw new Error("Sync the legacy queue before pairing or using Live relay.");
  }
}

function scheduleRelayRetry_(event, nowMs) {
  const attempts = Math.max(1, Number(event.attemptCount || 0));
  const delayMs = Math.min(15 * 60 * 1000, 5 * 1000 * 2 ** Math.max(0, attempts - 1));
  event.status = "retryable";
  event.attemptCount = attempts;
  event.nextAttemptAtMs = nowMs + delayMs;
}

function firstNonAcceptedRelayEvent_(state) {
  return state.queue.slice().sort(function (left, right) {
    return Number(left.deviceSequence) - Number(right.deviceSequence);
  }).find(function (event) {
    return event.status !== "accepted";
  }) || null;
}

function clearRelaySyncTimer_() {
  if (shellSyncTimer) {
    clearTimeout(shellSyncTimer);
    shellSyncTimer = null;
  }
}

function scheduleRelaySyncTimer_(nextAttemptAtMs) {
  clearRelaySyncTimer_();
  const delayMs = Math.max(0, Number(nextAttemptAtMs || 0) - Date.now());
  shellSyncTimer = setTimeout(function () {
    shellSyncTimer = null;
    retryQueuedSyncIfReady_();
  }, delayMs);
}

function scheduleRelayReachabilityRetry_() {
  const state = getRelayState_();
  const event = state ? firstNonAcceptedRelayEvent_(state) : null;
  if (!navigator.onLine || !event || event.status === "terminal") return;
  scheduleRelaySyncTimer_(Date.now() + LIVE_RELAY_REACHABILITY_RETRY_MS);
}

/* begin[live_reconnect_relay_queue_drain] */
function triggerRelayQueueDrainWhenReachable_() {
  if (
    !isLiveRelayEnabledForCleaner_() ||
    relayReachabilityState !== "reachable" ||
    relaySyncInProgress ||
    relaySubmissionInProgress ||
    relayAutoPairingInProgress
  ) {
    return;
  }

  const state = getRelayState_();
  const event = state ? firstNonAcceptedRelayEvent_(state) : null;
  if (!event || event.status === "terminal") return;

  if (Number(event.nextAttemptAtMs || 0) > Date.now()) {
    scheduleRelaySyncTimer_(event.nextAttemptAtMs);
    return;
  }

  syncRelayQueue_(true);
}
/* end[live_reconnect_relay_queue_drain] */

function applyRelaySession_(state, session) {
  verifyRelayHighWater_(state, session.ledgerHighWater.appliedThroughSequence);
  state.lastConfirmedLedgerHighWater = session.ledgerHighWater.appliedThroughSequence;
  state.relayToken = session.relayToken;
  state.relayTokenExpiresAtMs = session.expiresAtMs;
  saveRelayState_(state);
  saveShellAuth_(getShellAuth_() || {});
}

async function ensureRelaySessionLocked_(state) {
  const shellAuth = getShellAuth_() || {};
  if (!state.pairedDeviceId || !shellAuth.sessionToken) {
    throw new Error("Pair this installation and refresh its Apps Script session before relay sync.");
  }
  const nowMs = Date.now();
  const expiresAtMs = Number(state.relayTokenExpiresAtMs || 0);
  if (state.relayToken && expiresAtMs > nowMs + 5 * 60 * 1000) return state;
  const requestBody = {
    appsSessionToken: shellAuth.sessionToken,
    deviceId: state.pairedDeviceId,
  };
  if (state.relayToken && expiresAtMs > nowMs) {
    const renewal = await callRelayJson_("/v1/relay-sessions/renew", requestBody, state.relayToken);
    if (renewal.payload && renewal.payload.error === "authentication_failed") {
      state.relayToken = "";
      state.relayTokenExpiresAtMs = 0;
      saveRelayState_(state);
      const enrollment = await callRelayJson_("/v1/relay-sessions/enroll", requestBody, "");
      applyRelaySession_(state, readRelaySession_(enrollment, state.pairedDeviceId));
      return state;
    }
    applyRelaySession_(state, readRelaySession_(renewal, state.pairedDeviceId));
    return state;
  }
  // Never renew an expired token. One enrollment attempt is allowed instead.
  state.relayToken = "";
  state.relayTokenExpiresAtMs = 0;
  saveRelayState_(state);
  const enrollment = await callRelayJson_("/v1/relay-sessions/enroll", requestBody, "");
  applyRelaySession_(state, readRelaySession_(enrollment, state.pairedDeviceId));
  return state;
}

/* begin[live_automatic_relay_pairing] */
async function pairRelayInstallationAutomatically_() {
  if (!isLiveRelayEnabledForCleaner_() || !navigator.onLine || relayAutoPairingInProgress) return;

  relayAutoPairingInProgress = true;
  setRelayPairingStatus_("Finishing secure phone setup...");
  try {
    if (!(await probeRelayReachability_())) return;
    await withRelayLock_(async function () {
      const state = getRelayState_();
      if (synchronizeExistingRelayInstallationIdentity_(state) || state) return;
      assertLegacyQueueIsEmpty_();
      const deviceId = getOrCreateRelayInstallationId_();
      const shellAuth = getShellAuth_() || {};
      if (!shellAuth.sessionToken) return;
      const result = await callRelayJson_("/v1/relay-sessions/enroll", {
        appsSessionToken: shellAuth.sessionToken,
        deviceId: deviceId,
      });
      const session = readRelaySession_(result, deviceId);
      if (session.ledgerHighWater.appliedThroughSequence !== 0) {
        throw new Error("This phone needs setup attention before it can save entries.");
      }
      saveRelayState_({
        version: 1,
        pairedDeviceId: deviceId,
        relayToken: session.relayToken,
        relayTokenExpiresAtMs: session.expiresAtMs,
        lastConfirmedLedgerHighWater: 0,
        nextSequence: 1,
        highestAllocatedSequence: 0,
        queue: [],
      });
    });
    updateRelayPairingUi_();
    renderRelayStatus_();
  } catch (error) {
    setRelayPairingStatus_("This phone could not finish secure setup. It will try again when online.");
  } finally {
    relayAutoPairingInProgress = false;
    tryLivePwaUpdateReload_();
  }
}
/* end[live_automatic_relay_pairing] */

async function saveRelayEntry_() {
  if (!isLiveRelayEnabledForCleaner_()) return;
  const action = (offlineActionSelect && offlineActionSelect.value || "").trim();
  const note = (offlineNoteInput && offlineNoteInput.value || "").trim();
  const property = String((selectedOfflineProperty && selectedOfflineProperty.name) || "");
  if (relaySubmissionInProgress) return;
  relaySubmissionInProgress = true;
  try {
    if (action === "clock_in" && property) {
      showShellSyncHud_("Saving your clock-in...", "Clocking In");
    } else if (action === "add_note" && property) {
      showShellSyncHud_("Saving your note...", "Saving Note");
    } else if (action === "clock_out" && property) {
      showShellSyncHud_("Saving your clock-out...", "Clocking Out");
    }
    await withRelayLock_(async function () {
      assertLegacyQueueIsEmpty_();
      const shellAuth = getShellAuth_();
      const state = getRelayState_();
      if (!shellAuth || !shellAuth.cleanerName || !action || !property) {
        throw new Error("Complete the cleaner, property, and action before saving.");
      }
      if (!state || !state.pairedDeviceId || !Number.isSafeInteger(state.nextSequence)) {
        throw new Error("Pair this installation with the relay before saving entries.");
      }
      if (shellAuth.relayAttentionRequired || state.queue.some(function (event) { return event.status === "terminal"; })) {
        throw new Error("Some entries need help syncing. Your work is still saved.");
      }
      if (!property.trim() || property.length > 500 || Array.from(note).length > 1000) {
        throw new Error("Property or note exceeds the relay limit.");
      }
      if (action !== "clock_in" && action !== "clock_out" && action !== "add_note") {
        throw new Error("Select a supported action before saving.");
      }
      if (action === "add_note" && !note) throw new Error("Please enter a cleaning note.");
      if (action === "clock_in" && shellAuth.currentShift) {
        throw new Error("You are already clocked in. Add a note or clock out first.");
      }
      if ((action === "add_note" || action === "clock_out") && !shellAuth.currentShift) {
        throw new Error("Clock in before adding a note or clocking out.");
      }
      const submittedAtMs = Date.now();
      const event = {
        eventId: makeRelayEventId_(),
        deviceSequence: state.nextSequence,
        eventType: action,
        submittedAtMs: submittedAtMs,
        property: property,
        note: note,
        status: "queued",
        attemptCount: 0,
        nextAttemptAtMs: submittedAtMs,
      };
      state.queue.push(event);
      state.highestAllocatedSequence = event.deviceSequence;
      state.nextSequence = event.deviceSequence + 1;
      saveRelayState_(state);
      if (action === "clock_in") {
        shellAuth.currentShift = { property: property, clockInMs: submittedAtMs, clockInDisplay: "" };
      } else if (action === "clock_out") {
        shellAuth.currentShift = null;
      }
      saveShellAuth_(shellAuth);
    });
    const currentAuth = getShellAuth_();
    resetOfflineEntryForm_(currentAuth);
    updateShellUi_();
    renderRelayStatus_();
    if (action === "clock_in") {
      showShellActionConfirmation_("Clocked In", property);
    } else if (action === "add_note") {
      showShellActionConfirmation_("Saved Note", property);
    } else {
      showShellActionConfirmation_("Clocked Out", property);
    }
    syncRelayQueue_();
    relaySubmissionInProgress = false;
    tryLivePwaUpdateReload_();
  } catch (error) {
    relaySubmissionInProgress = false;
    showShellFlashHud_((error && error.message) || "Relay entry was not saved.", false);
    hideShellSyncHud_();
    tryLivePwaUpdateReload_();
  }
}

async function syncRelayQueue_(showReconnectHud) {
  if (!isLiveRelayEnabledForCleaner_()) return;
  if (!shellUnlocked) return;
  if (relaySyncInProgress) return;
  relaySyncInProgress = 1;
  let relayDrainHudVisible = false;

  try {
  let nextAttemptAtMs = 0;
  const initialState = getRelayState_();
  const initialEvent = initialState ? firstNonAcceptedRelayEvent_(initialState) : null;
  if (!initialEvent) return;
  if (initialEvent.status !== "terminal") {
    if (Number(initialEvent.nextAttemptAtMs || 0) > Date.now()) {
      scheduleRelaySyncTimer_(initialEvent.nextAttemptAtMs);
      return;
    }
    // This probe intentionally precedes the Web Lock so an unavailable Worker
    // never holds the allocation/synchronization lock or changes event attempts.
    if (!(await probeRelayReachability_())) {
      renderRelayStatus_();
      scheduleRelayReachabilityRetry_();
      return;
    }
  }
  try {
    await withRelayLock_(async function () {
      assertLegacyQueueIsEmpty_();
      const state = getRelayState_();
      if (!state || !state.pairedDeviceId) return;
      const event = firstNonAcceptedRelayEvent_(state);
      if (!event) return;
      if (event.status === "terminal") {
        clearRelaySyncTimer_();
        state.attentionRequired = true;
        saveRelayState_(state);
        saveShellAuth_(getShellAuth_() || {});
        return;
      }
      if (Number(event.nextAttemptAtMs || 0) > Date.now()) {
        nextAttemptAtMs = Number(event.nextAttemptAtMs);
        return;
      }
      if (
        showReconnectHud &&
        !shellActionHudTimer &&
        (!shellFlashHud || shellFlashHud.classList.contains("hidden")) &&
        !relayAttentionRequiresEntryLock_()
      ) {
        showShellSyncHud_("Please wait...", "Syncing Saved Entries");
        relayDrainHudVisible = true;
      }
      event.attemptCount = Number(event.attemptCount || 0) + 1;
      saveRelayState_(state);
      try {
        await ensureRelaySessionLocked_(state);
      } catch (_) {
        scheduleRelayRetry_(event, Date.now());
        saveRelayState_(state);
        nextAttemptAtMs = event.nextAttemptAtMs;
        return;
      }
      try {
        const result = await callRelayJson_("/v1/relay-events", {
          eventId: event.eventId,
          deviceSequence: event.deviceSequence,
          eventType: event.eventType,
          submittedAtMs: event.submittedAtMs,
          property: event.property,
          note: event.note,
        }, state.relayToken);
        if (result.payload && result.payload.ok === true && result.payload.eventId === event.eventId) {
          event.status = "accepted";
          event.nextAttemptAtMs = 0;
          const nextEvent = firstNonAcceptedRelayEvent_(state);
          if (nextEvent) {
            if (nextEvent.status === "terminal") {
              clearRelaySyncTimer_();
              state.attentionRequired = true;
              saveShellAuth_(getShellAuth_() || {});
            } else {
              nextAttemptAtMs = Math.max(
                Date.now(),
                Number(nextEvent.nextAttemptAtMs || 0)
              );
            }
          }
        } else if (result.payload && result.payload.error === "authentication_failed") {
          // Keep the immutable event and make one later enrollment attempt.
          state.relayToken = "";
          state.relayTokenExpiresAtMs = 0;
          scheduleRelayRetry_(event, Date.now());
          nextAttemptAtMs = event.nextAttemptAtMs;
        } else if (result.payload && result.payload.retryable === false) {
          event.status = "terminal";
          event.failure = String(result.payload.error || "terminal_failure");
          state.attentionRequired = true;
          saveShellAuth_(getShellAuth_() || {});
        } else {
          scheduleRelayRetry_(event, Date.now());
          nextAttemptAtMs = event.nextAttemptAtMs;
        }
        saveRelayState_(state);
      } catch (_) {
        scheduleRelayRetry_(event, Date.now());
        saveRelayState_(state);
        nextAttemptAtMs = event.nextAttemptAtMs;
      }
    });
    relayHudAttentionMessage = "";
    renderRelayStatus_();
    if (nextAttemptAtMs > 0) scheduleRelaySyncTimer_(nextAttemptAtMs);
  } catch (error) {
    const detail = (error && error.message) || "Synchronization could not continue.";
    if (/exclusive Web Locks support/i.test(detail)) {
      setRelayHudAttention_(
        "relay requires attention. Event remains saved locally; exclusive browser locking is unavailable."
      );
    } else {
      setRelayHudAttention_(
        "relay requires attention. Event remains saved locally; " + detail
      );
    }
  }
  } finally {
    relaySyncInProgress = 0;
    if (relayDrainHudVisible) hideShellSyncHud_();
    tryLivePwaUpdateReload_();
  }
}

function saveOfflineEntry_() {
  if (isLiveRelayEnabledForCleaner_()) {
    saveRelayEntry_();
    return;
  }
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

  if (action === "clock_in" && shellAuth.currentShift) {
    setOfflineReadyStatusText_("You are already clocked in. Add a note or clock out first.");
    showShellFlashHud_("You are already clocked in. Add a note or clock out first.", false);
    return;
  }

  const queue = getShellQueue_();
  const hasDuplicatePendingItem = hasDuplicatePendingQueueItem_(
    queue,
    shellAuth.cleanerName,
    action,
    selectedOfflineProperty.name
  );
  if (hasDuplicatePendingItem) {
    updateOfflineQueueCount_();
    setOfflineReadyStatusText_("Clock out already saved on phone. Not synced yet.");
    showShellFlashHud_("Clock out is already saved on this phone and waiting to sync.", false);
    return;
  }

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

  console.debug("[shell_queue] push", {
    eventType: action,
    property: selectedOfflineProperty.name,
    cleanerName: shellAuth.cleanerName,
    queueLengthAfterPush: queue.length,
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
    setStatusText_("Saved on phone. Syncing now...");
    setOfflineReadyStatusText_("Saved on phone. Syncing now...");
    syncShellQueue_();
  } else {
    setStatusText_("Saved on phone. Not synced yet.");
    setOfflineReadyStatusText_("Saved on phone. Not synced yet.");
    showShellFlashHud_("Saved on phone. Not synced yet.", true);
  }
}

function hasDuplicatePendingQueueItem_(queue, cleanerName, eventType, propertyName) {
  const normalizedEventType = String(eventType || "").trim().toLowerCase();
  if (normalizedEventType !== "clock_out" && normalizedEventType !== "clock_in") {
    return false;
  }

  const normalizedCleanerName = String(cleanerName || "").trim().toLowerCase();
  const normalizedPropertyName = String(propertyName || "").trim().toLowerCase();

  return (queue || []).some(function (item) {
    const queuedEventType = String(item && item.eventType || "").trim().toLowerCase();
    return (
      queuedEventType === normalizedEventType &&
      String(item && item.cleanerName || "").trim().toLowerCase() === normalizedCleanerName &&
      String(item && item.property || "").trim().toLowerCase() === normalizedPropertyName
    );
  });
}

/* begin[shell_refresh_and_sync_helpers] */
function sleepMs_(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, Number(ms || 0));
  });
}

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
/* begin[local_first_pin_authorization] */
function isDefinitivePinAuthorizationFailure_(message) {
  return /invalid access code|authorization (?:is )?invalid|phone is no longer authorized/i.test(
    String(message || "")
  );
}

function buildShellAuthFromPinValidation_(parsed, pinHash) {
  return {
    cleanerName: String(parsed.cleanerName || ""),
    accessLevel: String(parsed.accessLevel || "LIMITED"),
    currentShift: parsed.currentShift || null,
    properties: Array.isArray(parsed.properties) ? parsed.properties : [],
    sessionToken: String(parsed.sessionToken || ""),
    clientId: String(parsed.clientId || ""),
    pinHash: String(pinHash || ""),
    seededAtMs: Date.now(),
  };
}

async function validateShellPinInBackground_(pin, pinHash) {
  const normalizedPin = String(pin || "").trim();

  if (!normalizedPin || !pinHash) {
    return {
      ok: false,
      message: "Missing access code.",
      definitiveInvalidation: false,
    };
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
          accessCode: normalizedPin,
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
        "PIN refresh HTTP " +
          response.status +
          (rawText ? " — " + rawText.slice(0, 200) : "")
      );
    }

    if (!parsed) {
      throw new Error("PIN refresh returned a non-JSON response.");
    }

    if (!parsed.ok) {
      const message = parsed.message || "Could not refresh live permissions.";
      return {
        ok: false,
        message: message,
        definitiveInvalidation: isDefinitivePinAuthorizationFailure_(message),
      };
    }

    return {
      ok: true,
      payload: buildShellAuthFromPinValidation_(parsed, pinHash),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        "PIN refresh failed: " +
        ((error && error.message) || String(error) || "Unknown error"),
      definitiveInvalidation: false,
    };
  }
}

function shellAuthorizationMatches_(currentShellAuth, expectedShellAuth) {
  return !!(
    currentShellAuth &&
    expectedShellAuth &&
    String(currentShellAuth.pinHash || "") === String(expectedShellAuth.pinHash || "") &&
    String(currentShellAuth.sessionToken || "") === String(expectedShellAuth.sessionToken || "") &&
    Number(currentShellAuth.seededAtMs || 0) === Number(expectedShellAuth.seededAtMs || 0)
  );
}

async function clearRelayAuthorizationPreservingQueue_(invalidationGeneration) {
  if (!navigator.locks || typeof navigator.locks.request !== "function") return false;

  try {
    return await withRelayLock_(async function () {
      if (shellLoginGeneration !== invalidationGeneration || shellUnlocked) return false;

      const relayState = getRelayState_();
      if (!relayState) return true;
      relayState.relayToken = "";
      relayState.relayTokenExpiresAtMs = 0;
      saveRelayState_(relayState);
      return true;
    });
  } catch (_) {
    return false;
  }
}

function invalidateShellAuthorization_(loginGeneration, expectedShellAuth) {
  const currentShellAuth = getShellAuth_() || {};
  if (
    loginGeneration !== shellLoginGeneration ||
    !shellAuthorizationMatches_(currentShellAuth, expectedShellAuth)
  ) {
    return;
  }

  const invalidationGeneration = shellLoginGeneration + 1;
  shellLoginGeneration = invalidationGeneration;
  shellUnlocked = false;
  localStorage.removeItem(SHELL_AUTH_KEY);
  clearShellEntryDraft_();
  selectedOfflineProperty = null;
  hideOfflinePropertyInfo_();
  clearShellPin_();
  hideShellSyncHud_();
  updateShellUi_();
  updateOfflineQueueCount_();
  setOfflineReadyStatusText_("This phone is no longer authorized. Please prepare it again online.");
  setStatusText_("This phone is no longer authorized. Please prepare it again online.");
  showShellFlashHud_("This phone is no longer authorized. Please prepare it again online.", false);
  clearRelayAuthorizationPreservingQueue_(invalidationGeneration);
}

function applyBackgroundPinAuthorization_(freshShellAuth, loginGeneration, expectedShellAuth) {
  const currentShellAuth = getShellAuth_() || {};
  if (
    !shellUnlocked ||
    loginGeneration !== shellLoginGeneration ||
    !freshShellAuth ||
    !freshShellAuth.pinHash ||
    !shellAuthorizationMatches_(currentShellAuth, expectedShellAuth) ||
    String(currentShellAuth.pinHash || "") !== String(freshShellAuth.pinHash)
  ) {
    return false;
  }

  saveShellAuth_(freshShellAuth);
  const effectiveShellAuth = getShellAuth_() || freshShellAuth;
  updateOfflineReadyText_(effectiveShellAuth);
  reconcileShellEntryDraft_(effectiveShellAuth);
  updateOfflineQueueCount_();
  return true;
}

function startShellBackgroundPinValidation_(pin, pinHash, loginGeneration, expectedShellAuth) {
  if (!navigator.onLine || shellBackgroundPinValidationInProgress) return;

  shellBackgroundPinValidationInProgress = true;
  validateShellPinInBackground_(pin, pinHash).then(function (result) {
    if (result && result.ok) {
      applyBackgroundPinAuthorization_(result.payload, loginGeneration, expectedShellAuth);
    } else if (result && result.definitiveInvalidation) {
      invalidateShellAuthorization_(loginGeneration, expectedShellAuth);
    }
  }).catch(function () {
    // A background refresh must never interrupt a locally unlocked shell.
  }).finally(function () {
    shellBackgroundPinValidationInProgress = false;
    tryLivePwaUpdateReload_();
  });
}
/* end[local_first_pin_authorization] */

async function refreshShellAuthWithRetry_(options) {
  const opts = options || {};
  const maxAttempts = Math.max(1, Number(opts.maxAttempts || 3));
  const retryDelayMs = Math.max(0, Number(opts.retryDelayMs || 900));
  const statusPrefix = String(opts.statusPrefix || "Refreshing session");

  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.showStatus !== false) {
      if (attempt === 1) {
        setStatusText_(statusPrefix + "...");
      } else {
        setStatusText_(
          statusPrefix + "... retry " + attempt + " of " + maxAttempts
        );
      }
    }

    lastResult = await refreshShellAuth_();

    if (lastResult && lastResult.ok) {
      return {
        ok: true,
        payload: lastResult.payload || null,
        attemptsUsed: attempt,
      };
    }

    if (lastResult && lastResult.requiresLogin) {
      return {
        ok: false,
        message: lastResult.message || "Session expired. Please log in again.",
        requiresLogin: true,
        attemptsUsed: attempt,
      };
    }

    if (attempt < maxAttempts) {
      await sleepMs_(retryDelayMs);
    }
  }

  return {
    ok: false,
    message:
      (lastResult && lastResult.message) ||
      "Could not refresh shell auth after retrying.",
    requiresLogin: !!(lastResult && lastResult.requiresLogin),
    attemptsUsed: maxAttempts,
  };
}

async function refreshShellAuthOnForegroundIfNeeded_() {
  if (!navigator.onLine) {
    return {
      ok: false,
      skipped: true,
      message: "Offline. Using saved phone data.",
    };
  }

  const shellAuth = getShellAuth_() || {};
  if (!shellAuth || !shellAuth.sessionToken) {
    return {
      ok: false,
      skipped: true,
      message: "No prepared shell session found.",
    };
  }

  const now = Date.now();
  if (now - shellLastForegroundRefreshMs < 4000) {
    return {
      ok: true,
      skipped: true,
      message: "Foreground refresh throttled.",
    };
  }

  shellLastForegroundRefreshMs = now;

  const refreshResult = await refreshShellAuthWithRetry_({
    maxAttempts: 3,
    retryDelayMs: 700,
    statusPrefix: "Refreshing permissions",
    showStatus: false,
  });

  if (refreshResult && refreshResult.ok) {
    const freshShellAuth = getShellAuth_() || {};
    updateOfflineReadyText_(freshShellAuth);
    updateOfflineQueueCount_();
    updateShellUi_();

    return {
      ok: true,
      skipped: false,
      payload: refreshResult.payload || null,
    };
  }

  updateShellUi_();

  return {
    ok: false,
    skipped: true,
    message:
      (refreshResult && refreshResult.message) ||
      "Could not refresh permissions in the background.",
    requiresLogin: !!(refreshResult && refreshResult.requiresLogin),
  };
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
          syncSource: "shell_offline",
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

/* begin[shell_queue_sync_safety_and_logging] */
function logShellQueueSync_(stage, details) {
  const safeDetails = details && typeof details === "object" ? details : {};
  console.debug("[shellQueueSync]", stage, safeDetails);
}

function shouldDropQueuedItemFromResponse_(eventType, message) {
  const msg = String(message || "").toLowerCase();
  const normalizedEventType = String(eventType || "").toLowerCase();

  const isAlreadyClockedIn = /already\s+clocked\s+in/.test(msg);
  if (isAlreadyClockedIn && normalizedEventType !== "clock_in") {
    return false;
  }

  if (normalizedEventType === "clock_out") {
    const isNoOpenShiftClockOut =
      /not\s+currently\s+clocked\s+in/.test(msg) ||
      /no\s+open\s+shift/.test(msg) ||
      /no\s+matching\s+.+\s+shift/.test(msg) ||
      /has\s+no\s+open\s+shift/.test(msg);
    if (isNoOpenShiftClockOut) {
      return true;
    }
  }

  return /already\s+(submitted|exists|recorded)|duplicate|already\s+processed|invalid\s+event|unknown\s+event|missing\s+property|property\s+not\s+found|already\s+clocked\s+in/.test(msg);
}

function removeQueuedEntryById_(queuedId) {
  const queue = getShellQueue_();
  const beforeLength = queue.length;
  const normalizedQueuedId = String(queuedId || "").trim();

  if (!normalizedQueuedId) {
    logShellQueueSync_("item_remove_skip_missing_queued_id", {
      queueLengthBefore: beforeLength,
      queueLengthAfter: beforeLength,
    });

    return {
      beforeLength: beforeLength,
      afterLength: beforeLength,
      removed: false,
    };
  }

  const nextQueue = queue.filter(function (item) {
    return String(item && item.queuedId || "") !== normalizedQueuedId;
  });

  saveShellQueue_(nextQueue);

  return {
    beforeLength: beforeLength,
    afterLength: nextQueue.length,
    removed: nextQueue.length !== beforeLength,
  };
}

async function syncShellQueue_() {
  if (isLiveRelayEnabledForCleaner_()) {
    return syncRelayQueue_(true);
  }
  if (shellSyncInProgress) {
    logShellQueueSync_("skip_in_progress", {
      queueLengthBefore: getShellQueue_().length,
    });
    return;
  }

  const initialQueue = getShellQueue_();
  if (!initialQueue.length) return;

  if (!navigator.onLine) {
    shellSyncInProgress = false;
    hideShellSyncHud_();
    updateOfflineQueueCount_();
    setStatusText_("Offline. Entry saved on phone.");
    setOfflineReadyStatusText_("Saved on phone. Will sync when online.");
    return;
  }

  shellSyncInProgress = true;
  showShellSyncHud_("Please wait...");

  let finalStatusMessage = "";
  let stoppedForNetworkFailure = false;

  try {
    console.debug("[shell_queue] sync start", {
      queueLengthBefore: initialQueue.length,
    });
    logShellQueueSync_("sync_start", {
      queueLengthBefore: initialQueue.length,
    });

    const refreshResult = await refreshShellAuthWithRetry_({
      maxAttempts: 4,
      retryDelayMs: 900,
      statusPrefix: "Refreshing offline authorization",
      showStatus: true,
    });

    if (!refreshResult || !refreshResult.ok) {
      finalStatusMessage =
        (refreshResult && refreshResult.message) ||
        "Could not refresh offline authorization.";

      if (refreshResult && refreshResult.requiresLogin) {
        finalStatusMessage =
          "Offline entries are waiting. Open the live app and log in online.";
      }

      logShellQueueSync_("sync_failure", {
        serverMessage: finalStatusMessage,
        queueLengthAfter: getShellQueue_().length,
      });
      setStatusText_(finalStatusMessage);
      return;
    }

    while (true) {
      const queue = getShellQueue_();
      if (!queue.length) {
        break;
      }

      const nextEntry = queue[0];
      const queuedId = String(nextEntry && nextEntry.queuedId || "");
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

      logShellQueueSync_("item_sync_start", {
        queuedId: queuedId,
        eventType: nextEntry.eventType || "",
        property: nextEntry.property || "",
        queueLengthBefore: queue.length,
      });

      const response = await postShellQueueEntry_(nextEntry);
      const serverMessage = String(response && response.message || "");

      if (!response && navigator.onLine) {
        stoppedForNetworkFailure = true;
        finalStatusMessage = "Network unstable. Entry is still saved on phone.";
        logShellQueueSync_("item_sync_network_failure", {
          queuedId: queuedId,
          eventType: nextEntry.eventType || "",
          property: nextEntry.property || "",
          queueLengthAfter: getShellQueue_().length,
        });
        setStatusText_(finalStatusMessage);
        setOfflineReadyStatusText_("Saved on phone. Will sync when online.");
        break;
      }

      if (!response || !response.ok) {
        const shouldDrop = shouldDropQueuedItemFromResponse_(nextEntry.eventType, serverMessage);

        if (shouldDrop) {
          const dropState = removeQueuedEntryById_(queuedId);
          logShellQueueSync_("item_sync_drop", {
            queuedId: queuedId,
            eventType: nextEntry.eventType || "",
            property: nextEntry.property || "",
            queueLengthBefore: dropState.beforeLength,
            queueLengthAfter: dropState.afterLength,
            serverMessage: serverMessage,
          });
          updateOfflineQueueCount_();

          await refreshShellAuthWithRetry_({
            maxAttempts: 2,
            retryDelayMs: 600,
            statusPrefix: "Refreshing sync state",
            showStatus: false,
          });

          continue;
        }

        finalStatusMessage =
          serverMessage ||
          "Could not sync a queued shell entry yet.";

        if (/session expired|log in again/i.test(finalStatusMessage)) {
          finalStatusMessage =
            "Offline entries are waiting. Open the live app and log in online.";
        }

        logShellQueueSync_("item_sync_failure", {
          queuedId: queuedId,
          eventType: nextEntry.eventType || "",
          property: nextEntry.property || "",
          queueLengthAfter: getShellQueue_().length,
          serverMessage: finalStatusMessage,
        });

        setStatusText_(finalStatusMessage);
        setOfflineReadyStatusText_("Sync failed. Entry is still saved on phone.");
        break;
      }

      const dropState = removeQueuedEntryById_(queuedId);

      const shellAuth = getShellAuth_();
      if (shellAuth) {
        console.debug("[shell_queue] response.currentShift", {
          eventType: nextEntry.eventType || "",
          currentShift: response.currentShift || null,
        });
        if (nextEntry.eventType === "clock_in") {
          if (response.currentShift) {
            shellAuth.currentShift = response.currentShift;
          }
        } else if (nextEntry.eventType === "clock_out") {
          shellAuth.currentShift = response.currentShift || null;
        } else if (nextEntry.eventType === "add_note") {
          if (response.currentShift) {
            shellAuth.currentShift = response.currentShift;
          }
        }
        saveShellAuth_(shellAuth);
        console.debug("[shell_queue] final shellAuth.currentShift", {
          eventType: nextEntry.eventType || "",
          currentShift: shellAuth.currentShift || null,
        });
      }
      console.debug("[shell_queue] sync success", {
        eventType: nextEntry.eventType || "",
        property: nextEntry.property || "",
        queueLengthAfter: dropState.afterLength,
      });

      logShellQueueSync_("item_sync_success", {
        queuedId: queuedId,
        eventType: nextEntry.eventType || "",
        property: nextEntry.property || "",
        queueLengthBefore: dropState.beforeLength,
        queueLengthAfter: dropState.afterLength,
        serverMessage: serverMessage,
      });

      if (nextEntry.eventType === "clock_in") {
        setOfflineReadyStatusText_("Clock in successful.");
      } else if (nextEntry.eventType === "clock_out") {
        setOfflineReadyStatusText_("Clock out successful.");
      } else if (nextEntry.eventType === "add_note") {
        setOfflineReadyStatusText_("Note saved.");
      }

      updateOfflineQueueCount_();
    }

    const remainingQueue = getShellQueue_();
    if (!remainingQueue.length) {
      await refreshShellAuthWithRetry_({
        maxAttempts: 2,
        retryDelayMs: 600,
        statusPrefix: "Refreshing sync state",
        showStatus: false,
      });
      updateShellUi_();
      finalStatusMessage = "Offline entries synced.";
      logShellQueueSync_("sync_success", {
        queueLengthAfter: 0,
      });
      setStatusText_(finalStatusMessage);
    } else if (!finalStatusMessage) {
      finalStatusMessage =
        "Some offline entries are still queued: " + remainingQueue.length;
      setStatusText_(finalStatusMessage);
    }
  } catch (error) {
    if (navigator.onLine) {
      stoppedForNetworkFailure = true;
      setOfflineReadyStatusText_("Saved on phone. Will sync when online.");
    }
    finalStatusMessage =
      (error && error.message) ||
      "Could not sync offline entries yet. They will stay queued.";
    logShellQueueSync_("sync_failure", {
      queueLengthAfter: getShellQueue_().length,
      serverMessage: finalStatusMessage,
    });
    setStatusText_(finalStatusMessage);
  } finally {
    shellSyncInProgress = false;
    tryLivePwaUpdateReload_();
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

      if (queueRemaining > 0) {
        setOfflineReadyStatusText_("Sync failed. Entry is still saved on phone.");
      }
    }

    if (queueRemaining > 0 && navigator.onLine && !stoppedForNetworkFailure) {
      setTimeout(function () {
        retryQueuedSyncIfReady_();
      }, 1500);
    }
  }
}
/* end[shell_queue_sync_safety_and_logging] */
/* end[shell_refresh_and_sync_helpers] */

/* begin[unlock_shell_with_welcome_flash] */
async function unlockShellWithPin_() {
  if (shellPinUnlockInProgress) return;
  shellPinUnlockInProgress = true;

  let enteredPin = shellEnteredPin.trim();

  try {
    const shellAuth = getShellAuth_() || {};

    if (!shellAuth || !shellAuth.pinHash) {
      clearShellPin_();
      hideShellSyncHud_();
      setOfflineReadyStatusText_("");
      setStatusText_("This phone is not ready yet. Go online and prepare it first.");
      return;
    }

    if (!enteredPin) {
      hideShellSyncHud_();
      setOfflineReadyStatusText_("");
      setStatusText_("Please enter your access code.");
      return;
    }

    const enteredHash = await hashShellPin_(enteredPin);

    if (!enteredHash || enteredHash !== String(shellAuth.pinHash || "")) {
      clearShellPin_();
      hideShellSyncHud_();
      setOfflineReadyStatusText_("Invalid access code.");
      setStatusText_("Invalid access code.");
      showShellFlashHud_("Invalid access code.", false);
      return;
    }

    const loginGeneration = shellLoginGeneration + 1;
    shellLoginGeneration = loginGeneration;
    shellUnlocked = true;
    clearShellPin_();
    hideShellSyncHud_();
    updateShellUi_();
    updateOfflineQueueCount_();

    const cleanerName = shellAuth.cleanerName || "Cleaner";
    setOfflineReadyStatusText_("");

    if (!navigator.onLine) {
      setStatusText_("Unlocked for " + cleanerName + " offline.");
    } else {
      setStatusText_("Unlocked for " + cleanerName + " using saved phone data.");
      if (isLiveRelayEnabledForCleaner_() && getRelayState_() && getRelayState_().pairedDeviceId) {
        renderRelayStatus_();
      }
    }
    showShellActionConfirmation_("Logged In", "Ready for " + cleanerName + ".", 500);
    retryQueuedSyncIfReady_();

    if (navigator.onLine) {
      pairRelayInstallationAutomatically_();
      startShellBackgroundPinValidation_(enteredPin, enteredHash, loginGeneration, shellAuth);
    }
    enteredPin = "";
  } catch (error) {
    clearShellPin_();
    hideShellSyncHud_();
    setOfflineReadyStatusText_("PIN check failed.");
    setStatusText_(
      "PIN check failed: " +
        ((error && error.message) || String(error) || "Unknown error")
    );
    showShellFlashHud_("PIN check failed.", false);
  } finally {
    shellPinUnlockInProgress = false;
    tryLivePwaUpdateReload_();
  }
}
/* end[unlock_shell_with_welcome_flash] */
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

  shellPrepInProgress = true;
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
    pairRelayInstallationAutomatically_();
    clearShellEntryDraft_();
    shellLoginGeneration += 1;
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
    shellPrepInProgress = false;
    if (loadPrepBtn) {
      loadPrepBtn.textContent = "Prepare This Phone";
      loadPrepBtn.disabled = false;
    }
    tryLivePwaUpdateReload_();
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

/* begin[shell_work_history_helpers] */
let shellWorkHistoryLoading = false;

function clearShellWorkHistoryUi_() {
  if (shellWorkHistoryWeekLabel) {
    shellWorkHistoryWeekLabel.textContent = "";
  }

  if (shellWorkHistoryContent) {
    shellWorkHistoryContent.innerHTML = "";
  }

  if (shellWorkHistoryTotalValue) {
    shellWorkHistoryTotalValue.textContent = "0:00 (0.00 hrs)";
  }
}

function showShellWorkHistoryModal_() {
  if (!shellWorkHistoryModal) return;
  shellWorkHistoryModal.classList.remove("hidden");
  shellWorkHistoryModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("shellWorkHistoryOpen");
}

function hideShellWorkHistoryModal_() {
  if (!shellWorkHistoryModal) return;
  shellWorkHistoryModal.classList.add("hidden");
  shellWorkHistoryModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("shellWorkHistoryOpen");
}

function renderShellWorkHistory_(data) {
  clearShellWorkHistoryUi_();

  if (!data || !data.ok) {
    if (shellWorkHistoryContent) {
      shellWorkHistoryContent.innerHTML =
        '<div class="shellWorkHistoryEmpty">Could not load work history.</div>';
    }
    return;
  }

  if (shellWorkHistoryWeekLabel) {
    shellWorkHistoryWeekLabel.textContent = data.weekLabel || "";
  }

  if (!data.rows || !data.rows.length) {
    if (shellWorkHistoryContent) {
      shellWorkHistoryContent.innerHTML =
        '<div class="shellWorkHistoryEmpty">No completed shifts yet this week.</div>';
    }

    if (shellWorkHistoryTotalValue) {
      shellWorkHistoryTotalValue.textContent =
        (data.totalHoursText || "0:00") +
        " (" +
        (data.totalHoursDecimal || "0.00") +
        " hrs)";
    }

    return;
  }

  const fragments = [];
  let lastDayHeader = "";

  data.rows.forEach(function (entry) {
    if (entry.type === "shift") {
      if (entry.dayHeader && entry.dayHeader !== lastDayHeader) {
        fragments.push(
          '<div class="shellWorkHistoryDayHeader">' + entry.dayHeader + "</div>"
        );
        lastDayHeader = entry.dayHeader;
      }

      fragments.push(
        '<div class="shellWorkHistoryShiftBlock">' +
          '<div class="shellWorkHistoryProperty">' + (entry.property || "—") + '</div>' +
          '<div class="shellWorkHistoryShiftMeta">' +
            (entry.clockInText || "?") +
            " – " +
            (entry.clockOutText || "?") +
            '<span class="shellWorkHistoryMetaDot">•</span>' +
            (entry.shiftHoursText || "0:00") +
            " (" +
            (entry.shiftHoursDecimal || "0.00") +
            " hrs)" +
          "</div>" +
        "</div>"
      );
      return;
    }

     if (entry.type === "transit") {
      const startText = entry.transitStartText || "?";
      const endText = entry.transitEndText || "?";

      fragments.push(
        '<div class="shellWorkHistoryTransitWrap">' +
          '<div class="shellWorkHistoryTransitLine">Transit</div>' +
          '<div class="shellWorkHistoryTransitMeta">' +
            startText +
            " – " +
            endText +
            '<span class="shellWorkHistoryMetaDot">•</span>' +
            (entry.transitHoursText || "0:00") +
            " (" +
            (entry.transitHoursDecimal || "0.00") +
            " hrs)" +
          "</div>" +
        '</div>'
      );
    }
  });

  if (shellWorkHistoryContent) {
    shellWorkHistoryContent.innerHTML = fragments.join("");
  }

  if (shellWorkHistoryTotalValue) {
    shellWorkHistoryTotalValue.textContent =
      (data.totalHoursText || "0:00") +
      " (" +
      (data.totalHoursDecimal || "0.00") +
      " hrs)";
  }
}

async function loadShellWorkHistory_() {
  if (shellWorkHistoryLoading) return;

  const shellAuth = getShellAuth_() || {};
  const sessionToken = String(shellAuth.sessionToken || "");

  if (!sessionToken) {
    showShellFlashHud_("Session missing. Please log in online again.", false);
    return;
  }

  shellWorkHistoryLoading = true;
  clearShellWorkHistoryUi_();

  if (shellWorkHistoryContent) {
    shellWorkHistoryContent.innerHTML =
      '<div class="shellWorkHistoryEmpty">Loading...</div>';
  }

  showShellWorkHistoryModal_();

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        mode: "getShellWorkHistory",
        payload: {
          sessionToken: sessionToken,
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
        "Shell work history HTTP " +
          response.status +
          (rawText ? " — " + rawText.slice(0, 200) : "")
      );
    }

    if (!parsed) {
      throw new Error("Shell work history returned a non-JSON response.");
    }

    renderShellWorkHistory_(parsed);
  } catch (error) {
    if (shellWorkHistoryContent) {
      shellWorkHistoryContent.innerHTML =
        '<div class="shellWorkHistoryEmpty">' +
        ("Could not load work history: " +
          ((error && error.message) || String(error) || "Unknown error")) +
        '</div>';
    }
  } finally {
    shellWorkHistoryLoading = false;
  }
}
/* end[shell_work_history_helpers] */

function updateShellUi_() {
  const standalone = isStandaloneMode_();
  const online = navigator.onLine;
  const shellAuth = getShellAuth_();

  hideElement_(shellBlueBar);

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

    showElement_(shellBlueBar);
    hideElement_(shellUnlockSection);
    hideElement_(prepSection);
    showElement_(offlineEntrySection);

    if (isLiveRelayEnabledForCleaner_(shellAuth) && shellAuth.relayAttentionRequired) {
      setShellEntryLocked_(true);
      setStatusText_("Some entries need help syncing. Your work is still saved.");
      updateOfflineReadyText_(shellAuth);
      updateOfflineQueueCount_();
      reconcileShellEntryDraft_(shellAuth);
      return;
    }
    setShellEntryLocked_(false);

    const currentShiftText =
      shellAuth.currentShift && shellAuth.currentShift.property
        ? ` Current shift: ${shellAuth.currentShift.property}.`
        : "";

    const queueCount = getShellQueue_().length;
    const queueSuffix =
      queueCount > 0 ? ` Queued entries: ${queueCount}.` : "";

    if (isLiveRelayEnabledForCleaner_(shellAuth) && getRelayState_() && getRelayState_().pairedDeviceId) {
      renderRelayStatus_();
    } else {
      setStatusText_(
        `${online ? "Online" : "Offline"} ready for ${shellAuth.cleanerName}.${currentShiftText}${queueSuffix}`
      );
    }

    updateOfflineReadyText_(shellAuth);
    updateOfflineQueueCount_();
    reconcileShellEntryDraft_(shellAuth);
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

/* begin[clockin_live_pwa_update_lifecycle] */
const LIVE_PWA_UPDATE_RELOAD_GUARD_KEY =
  "ce_clockin_live_pwa_reload_" + LIVE_BUILD_VERSION;
const LIVE_PWA_UPDATE_RELOAD_RETRY_MS = 1000;
const LIVE_PWA_UPDATE_RELOAD_MAX_RETRIES = 30;
let livePwaUpdateReloadPending = false;
let livePwaUpdateReloadRetryCount = 0;
let livePwaUpdateReloadTimer = null;
let livePwaControllerChangeListening = false;
let livePwaServiceWorkerRegistration = null;

function isLivePwaUpdateReloadGuardSet_() {
  try {
    return sessionStorage.getItem(LIVE_PWA_UPDATE_RELOAD_GUARD_KEY) === "1";
  } catch (_) {
    // Without a reliable per-session guard, do not risk a reload loop.
    return true;
  }
}

function setLivePwaUpdateReloadGuard_() {
  try {
    sessionStorage.setItem(LIVE_PWA_UPDATE_RELOAD_GUARD_KEY, "1");
    return true;
  } catch (_) {
    return false;
  }
}

function isLivePwaUpdateReloadSafe_() {
  const centeredHudActive =
    (shellSyncHud && !shellSyncHud.classList.contains("hidden")) ||
    (shellFlashHud && !shellFlashHud.classList.contains("hidden"));

  return !(
    shellUnlocked ||
    shellPinUnlockInProgress ||
    shellBackgroundPinValidationInProgress ||
    shellPrepInProgress ||
    relayAutoPairingInProgress ||
    relaySubmissionInProgress ||
    relaySyncInProgress > 0 ||
    shellSyncInProgress ||
    centeredHudActive
  );
}

function clearLivePwaUpdateReloadTimer_() {
  if (!livePwaUpdateReloadTimer) return;
  clearTimeout(livePwaUpdateReloadTimer);
  livePwaUpdateReloadTimer = null;
}

function tryLivePwaUpdateReload_() {
  if (!livePwaUpdateReloadPending) return;

  if (isLivePwaUpdateReloadGuardSet_()) {
    livePwaUpdateReloadPending = false;
    clearLivePwaUpdateReloadTimer_();
    return;
  }

  if (isLivePwaUpdateReloadSafe_()) {
    if (!setLivePwaUpdateReloadGuard_()) {
      livePwaUpdateReloadPending = false;
      return;
    }
    livePwaUpdateReloadPending = false;
    clearLivePwaUpdateReloadTimer_();
    window.location.reload();
    return;
  }

  if (
    livePwaUpdateReloadTimer ||
    livePwaUpdateReloadRetryCount >= LIVE_PWA_UPDATE_RELOAD_MAX_RETRIES
  ) {
    return;
  }

  livePwaUpdateReloadRetryCount += 1;
  livePwaUpdateReloadTimer = setTimeout(function () {
    livePwaUpdateReloadTimer = null;
    tryLivePwaUpdateReload_();
  }, LIVE_PWA_UPDATE_RELOAD_RETRY_MS);
}

function handleLivePwaControllerChange_() {
  if (livePwaUpdateReloadPending || isLivePwaUpdateReloadGuardSet_()) return;
  livePwaUpdateReloadPending = true;
  livePwaUpdateReloadRetryCount = 0;
  tryLivePwaUpdateReload_();
}

function listenForLivePwaControllerChange_() {
  if (livePwaControllerChangeListening) return;
  livePwaControllerChangeListening = true;
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    handleLivePwaControllerChange_
  );
}

function requestLivePwaServiceWorkerUpdate_() {
  if (!navigator.onLine || !("serviceWorker" in navigator)) return;

  const requestUpdate = function (registration) {
    if (!registration) return;
    registration.update().catch(function () {
      // Update checks are best effort; the installed shell remains usable.
    });
  };

  if (livePwaServiceWorkerRegistration) {
    requestUpdate(livePwaServiceWorkerRegistration);
    return;
  }

  navigator.serviceWorker.getRegistration("/clockin/")
    .then(requestUpdate)
    .catch(function () {
      // A later launch can register or update the shell normally.
    });
}

async function registerServiceWorker_() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  try {
    listenForLivePwaControllerChange_();
    const registration = await navigator.serviceWorker.register(
      "/clockin/service-worker.js",
      { scope: "/clockin/" }
    );
    livePwaServiceWorkerRegistration = registration;

    requestLivePwaServiceWorkerUpdate_();

    return !!registration;
  } catch (error) {
    console.error("Service worker registration failed:", error);
    return false;
  }
}
/* end[clockin_live_pwa_update_lifecycle] */


/* begin[clockin_shell_event_wiring] */
window.addEventListener("online", function () {
  requestLivePwaServiceWorkerUpdate_();
  setRelayReachabilityState_("unknown");
  updateShellUi_();
  if (!isLiveRelayEnabledForCleaner_() || !getRelayState_() || !getRelayState_().pairedDeviceId) {
    setStatusText_("Back online. Syncing saved entries...");
  } else {
    renderRelayStatus_();
  }
  refreshShellAuthOnForegroundIfNeeded_();
  pairRelayInstallationAutomatically_();
  syncShellQueue_();
});

window.addEventListener("offline", function () {
  hideShellSyncHud_();
  shellSyncInProgress = false;
  setRelayReachabilityState_("unknown");
  updateShellUi_();
  if (isLiveRelayEnabledForCleaner_() && getRelayState_() && getRelayState_().pairedDeviceId) {
    renderRelayStatus_();
  } else {
    setStatusText_("Offline. Entries will be saved on phone and synced later.");
    setOfflineReadyStatusText_("Saved on phone. Will sync when online.");
  }
});

function retryQueuedSyncIfReady_() {
  updateShellUi_();

  if (!navigator.onLine) {
    return;
  }

  if (isLiveRelayEnabledForCleaner_()) {
    const state = getRelayState_();
    const event = state ? firstNonAcceptedRelayEvent_(state) : null;
    if (!event) return;
    if (event.status === "terminal") {
      clearRelaySyncTimer_();
      updateShellUi_();
      return;
    }
    if (Number(event.nextAttemptAtMs || 0) > Date.now()) {
      scheduleRelaySyncTimer_(event.nextAttemptAtMs);
      return;
    }
    syncRelayQueue_(true);
    return;
  }

  if (shellSyncInProgress) {
    return;
  }

  const queue = getShellQueue_();
  if (!queue.length) {
    return;
  }

  syncShellQueue_();
}

function handleShellForegroundResume_() {
  updateShellUi_();
  refreshShellAuthOnForegroundIfNeeded_();
  retryQueuedSyncIfReady_();

  setTimeout(function () {
    refreshShellAuthOnForegroundIfNeeded_();
    retryQueuedSyncIfReady_();
  }, 900);
}

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState !== "visible") {
    return;
  }

  handleShellForegroundResume_();
});

window.addEventListener("pageshow", function () {
  handleShellForegroundResume_();
});

window.addEventListener("focus", function () {
  handleShellForegroundResume_();
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

/* begin[offline_property_clear_binding] */
if (offlinePropertyClearBtn) {
  offlinePropertyClearBtn.addEventListener("click", clearOfflinePropertySearch_);
}
/* end[offline_property_clear_binding] */

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

/* begin[offline_action_change_with_guidance_refresh] */
if (offlineActionSelect) {
  offlineActionSelect.addEventListener("change", function () {
    const action = offlineActionSelect.value || "";

    if (action === "add_note") {
      showElement_(offlineNoteWrap);
    } else {
      hideElement_(offlineNoteWrap);
    }

    updateOfflineGuidanceText_(getShellAuth_());
    saveShellEntryDraft_();
  });
}
/* end[offline_action_change_with_guidance_refresh] */

if (offlineNoteInput) {
  offlineNoteInput.addEventListener("input", saveShellEntryDraft_);
}

if (saveOfflineEntryBtn) {
  saveOfflineEntryBtn.addEventListener("click", saveOfflineEntry_);
}

if (shellWorkHistoryBtn) {
  shellWorkHistoryBtn.addEventListener("click", loadShellWorkHistory_);
}

if (shellWorkHistoryBackBtn) {
  shellWorkHistoryBackBtn.addEventListener("click", hideShellWorkHistoryModal_);
}


/* end[clockin_shell_event_wiring] */


/* begin[clockin_shell_init] */
document.addEventListener("DOMContentLoaded", async function () {
  if (isLiveRelayEnabledForCleaner_()) {
    synchronizeExistingRelayInstallationIdentity_(getRelayState_());
  }
  updateRelayPairingUi_();
  shellUnlocked = false;
  clearShellPin_();
  clearPrepPin_();
  setStatusText_("Preparing app shell...");
  await registerServiceWorker_();

  updateShellUi_();
  updateOfflineQueueCount_();
  pairRelayInstallationAutomatically_();
  syncShellQueue_();
});
/* end[clockin_shell_init] */
