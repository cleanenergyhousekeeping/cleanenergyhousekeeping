function ensureHeaders_(sheet, requiredHeaders) {
  const lastCol = Math.max(sheet.getLastColumn(), requiredHeaders.length);
  const row1 = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || "").trim());

  const expected = requiredHeaders.slice();

  // If row 1 is blank OR clearly not the header row, force-write headers into row 1
  const row1IsBlank = row1.every(v => v === "");
  const looksLikeHeader =
    row1.slice(0, expected.length).join("||") === expected.join("||");

  if (row1IsBlank || !looksLikeHeader) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  }
}

function indexMap_(headers, required) {
  const out = {};
  for (const h of required) {
    const i = headers.indexOf(h);
    if (i === -1) throw new Error(`Missing required column: ${h}`);
    out[h] = i;
  }
  return out;
}

function safeStr_(v) {
  if (v == null) return "";
  return String(v).trim();
}

function coerceToDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;

  if (typeof v === "number" && isFinite(v)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = v * 24 * 60 * 60 * 1000;
    const d = new Date(epoch.getTime() + ms);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof v === "string" && v.trim()) {
    let d = new Date(v);
    if (!isNaN(d.getTime())) return d;

    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  }

  return null;
}

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
}

function endOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
}

/* begin[strict_time_tracker_hours_mode] */
function computeHours_(clockIn, clockOut, totalHoursCell) {
  const inD = coerceToDate_(clockIn);
  const outD = coerceToDate_(clockOut);

  // Strict mode:
  // If both timestamps exist and are valid, they are the source of truth.
  if (inD && outD) {
    const ms = outD.getTime() - inD.getTime();
    if (ms >= 0) {
      return ms / (1000 * 60 * 60);
    }
  }

  // Fallback only when one or both timestamps are missing/invalid.
  const hasExistingValue =
    totalHoursCell !== "" &&
    totalHoursCell !== null &&
    totalHoursCell !== undefined;

  const n = Number(totalHoursCell);
  if (hasExistingValue && !isNaN(n) && isFinite(n) && n >= 0) {
    return n;
  }

  return 0;
}
/* end[strict_time_tracker_hours_mode] */

function formatDateShort_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "MMM d, yyyy");
}

function formatYMD_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function formatTime_(v) {
  const d = coerceToDate_(v);
  if (!d) return "";
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "h:mm a");
}

function round2_(n) {
  return Math.round(Number(n) * 100) / 100;
}

function money_(n) {
  const num = Number(n) || 0;
  return "$" + num.toFixed(2);
}

function escapeForFindText_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* begin[clock_in_debug_log_helpers] */
const CLOCK_IN_DEBUG_LOG_SHEET_NAME = "Clock In Debug Log";
const CLOCK_IN_DEBUG_LOG_HEADERS = [
  "Timestamp",
  "Event",
  "Context",
  "Cleaner Name",
  "Property",
  "Event Type",
  "Sync Source",
  "Session Present",
  "Client ID",
  "Result",
  "Message",
];

function logClockInDebug_(entry) {
  try {
    const payload = entry || {};
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;

    let sheet = ss.getSheetByName(CLOCK_IN_DEBUG_LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(CLOCK_IN_DEBUG_LOG_SHEET_NAME);
    }

    ensureHeaders_(sheet, CLOCK_IN_DEBUG_LOG_HEADERS);

    sheet.appendRow([
      new Date(),
      safeStr_(payload.event),
      safeStr_(payload.context),
      safeStr_(payload.cleanerName),
      safeStr_(payload.property),
      safeStr_(payload.eventType),
      safeStr_(payload.syncSource),
      payload.sessionPresent ? "yes" : "no",
      safeStr_(payload.clientId),
      safeStr_(payload.result),
      safeStr_(payload.message),
    ]);
  } catch (_) {}
}
/* end[clock_in_debug_log_helpers] */

/* begin[seed_users_sheet] */
/* begin[seed_users_sheet_from_config] */
function seedUsersSheetFromConfig_() {
  throw new Error(
    'seedUsersSheetFromConfig_ is retired. Users sheet is now the source of truth. Edit the "Users" sheet directly.'
  );
}

function seedUsersSheetFromConfig() {
  seedUsersSheetFromConfig_();
}
/* end[seed_users_sheet_from_config] */


/* end[seed_users_sheet] */
