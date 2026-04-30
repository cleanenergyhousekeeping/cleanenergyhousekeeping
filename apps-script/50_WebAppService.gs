function createSessionToken_() {
  return Utilities.getUuid();
}

function getSessionKey_(token) {
  return WEBAPP_SESSION_PREFIX + token;
}

// begin[save_session_with_pin_and_access_level]
function saveSession_(token, cleaner) {
  const props = PropertiesService.getScriptProperties();

  const data = {
    pin: safeStr_(cleaner.pin),
    name: cleaner.name,
    role: safeStr_(cleaner.role || "cleaner"),
    accessLevel: normalizeAccessLevel_(cleaner.accessLevel),
    expires: Date.now() + (WEBAPP_SESSION_TTL_SECONDS * 1000),
  };

  props.setProperty(getSessionKey_(token), JSON.stringify(data));
}
// end[save_session_with_pin_and_access_level]

function getSession_(token) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(getSessionKey_(token));

  if (!raw) return null;

  try {
    const data = JSON.parse(raw);

    if (Date.now() > data.expires) {
      props.deleteProperty(getSessionKey_(token));
      return null;
    }

    return data;
  } catch (e) {
    return null;
  }
}

function deleteSession_(token) {
  PropertiesService.getScriptProperties().deleteProperty(getSessionKey_(token));
}

/**
 * Normalizes a submitted PIN.
 */
function normalizeAccessCode_(code) {
  return safeStr_(code).replace(/\D/g, "").trim();
}

/* begin[shell_pin_hash_helpers] */
function bytesToHex_(bytes) {
  return bytes.map(function (b) {
    const normalized = (b < 0 ? b + 256 : b).toString(16);
    return normalized.length === 1 ? "0" + normalized : normalized;
  }).join("");
}

function buildShellPinHash_(pin) {
  const normalizedPin = normalizeAccessCode_(pin);
  if (!normalizedPin) {
    return "";
  }

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    normalizedPin,
    Utilities.Charset.UTF_8
  );

  return bytesToHex_(digest);
}
/* end[shell_pin_hash_helpers] */

/**
 * Returns the cleaner record for a PIN, or null when invalid.
 */
// begin[get_cleaner_record_with_access_level]
function getCleanerRecordFromPin_(code) {
  const normalizedCode = normalizeAccessCode_(code);
  if (!normalizedCode) {
    return null;
  }

  return getCleanerRecordFromUsersSheet_(normalizedCode);
}
// end[get_cleaner_record_with_access_level]

function getAttemptKey_(clientId) {
  return "attempt_" + safeStr_(clientId || "unknown");
}

function isLockedOut_(clientId) {
  const cache = CacheService.getScriptCache();
  const attempts = Number(cache.get(getAttemptKey_(clientId)) || 0);
  return attempts >= WEBAPP_PIN_ATTEMPT_LIMIT;
}

function recordFailure_(clientId) {
  const cache = CacheService.getScriptCache();
  const key = getAttemptKey_(clientId);
  const attempts = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(attempts), WEBAPP_PIN_LOCKOUT_SECONDS);
}

function clearFailures_(clientId) {
  CacheService.getScriptCache().remove(getAttemptKey_(clientId));
}

// begin[users_sheet_helpers]
function normalizeActiveFlag_(value) {
  const normalized = safeStr_(value).trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1";
}

function getUsersSheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(USERS_SHEET_NAME);
}

function ensureUsersSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
  }

  const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const hasHeaders = USERS_SHEET_COLUMNS.every(function (header, index) {
    return safeStr_(existingHeaders[index]) === header;
  });

  if (!hasHeaders) {
    sheet.clear();
    sheet.getRange(1, 1, 1, USERS_SHEET_COLUMNS.length).setValues([USERS_SHEET_COLUMNS]);
  }

  return sheet;
}

function getCleanerRecordFromUsersSheet_(code) {
  const normalizedCode = normalizeAccessCode_(code);
  if (!normalizedCode) {
    return null;
  }

  const sheet = getUsersSheet_();
  if (!sheet) {
    return null;
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return null;
  }

  const headers = values[0].map(String);
  const rows = values.slice(1);

  const idx = {
    pin: headers.indexOf("PIN"),
    name: headers.indexOf("Name"),
    isActive: headers.indexOf("Is Active"),
    role: headers.indexOf("Role"),
    accessLevel: headers.indexOf("Access Level"),
    email: headers.indexOf("Email"),
  };

  if ([idx.pin, idx.name, idx.isActive, idx.role, idx.accessLevel].includes(-1)) {
    throw new Error('Users sheet is missing one or more required headers.');
  }

  const row = rows.find(function (item) {
    return normalizeAccessCode_(item[idx.pin]) === normalizedCode;
  });

  if (!row) {
    return null;
  }

  if (!normalizeActiveFlag_(row[idx.isActive])) {
    return null;
  }

  return {
    pin: normalizedCode,
    name: safeStr_(row[idx.name]),
    isActive: true,
    role: safeStr_(row[idx.role] || "cleaner"),
    accessLevel: normalizeAccessLevel_(row[idx.accessLevel]),
    email: idx.email === -1 ? "" : safeStr_(row[idx.email]),
  };
}
// end[users_sheet_helpers]

// begin[access_level_helpers]
function normalizeAccessLevel_(level) {
  const normalized = safeStr_(level).toUpperCase();
  return normalized === ACCESS_LEVEL_FULL ? ACCESS_LEVEL_FULL : ACCESS_LEVEL_LIMITED;
}

function isFullAccessLevel_(level) {
  return normalizeAccessLevel_(level) === ACCESS_LEVEL_FULL;
}

function sanitizePropertyForAccess_(property, accessLevel) {
  const cleaned = Object.assign({}, property);

  if (!isFullAccessLevel_(accessLevel)) {
    cleaned.entranceInfo = "";
    cleaned.alarmInfo = "";
  }

  return cleaned;
}

function buildCurrentShiftStatusForWebApp_(cleanerName) {
  const openShift = findOpenShiftForCleaner_(cleanerName);
  if (!openShift || !openShift.clockIn) {
    return null;
  }

  return {
    property: safeStr_(openShift.property),
    clockInMs: openShift.clockIn.getTime(),
    clockInDisplay: Utilities.formatDate(
      openShift.clockIn,
      Session.getScriptTimeZone(),
      "h:mm a"
    ),
  };
}

function seedUsersSheetFromConfig_() {
  throw new Error(
    'seedUsersSheetFromConfig_ is retired. Users sheet is now the source of truth. Edit the "Users" sheet directly.'
  );
}
// end[access_level_helpers]




// begin[login_with_access_level]
function loginWithPin(pin, clientId) {
  const normalizedPin = normalizeAccessCode_(pin);

  if (!normalizedPin) {
    return { ok: false, message: "Please enter your access code." };
  }

  if (isLockedOut_(clientId)) {
    return { ok: false, message: "Too many attempts. Please wait a minute and try again." };
  }

  const cleaner = getCleanerRecordFromPin_(normalizedPin);

  if (!cleaner) {
    recordFailure_(clientId);
    Utilities.sleep(800);
    return { ok: false, message: "Invalid access code." };
  }

  clearFailures_(clientId);

  const token = createSessionToken_();
  saveSession_(token, cleaner);

  return {
    ok: true,
    sessionToken: token,
    cleanerName: cleaner.name,
    accessLevel: cleaner.accessLevel,
    properties: getPropertiesForWebApp_(cleaner.accessLevel),
    currentShift: buildCurrentShiftStatusForWebApp_(cleaner.name),
  };
}
// end[login_with_access_level]


// begin[bootstrap_with_current_cleaner_access]
function bootstrapFromSession(token) {
  const session = getSession_(token);

  if (!session) {
    return { ok: false };
  }

  const sessionPin = safeStr_(session.pin);
  if (!sessionPin) {
    return { ok: false };
  }

  const cleaner = getCleanerRecordFromPin_(sessionPin);
  if (!cleaner) {
    return { ok: false };
  }

  return {
    ok: true,
    cleanerName: cleaner.name,
    accessLevel: normalizeAccessLevel_(cleaner.accessLevel),
    properties: getPropertiesForWebApp_(cleaner.accessLevel),
    currentShift: buildCurrentShiftStatusForWebApp_(cleaner.name),
  };
}
// end[bootstrap_with_current_cleaner_access]


/**
 * Returns property names.
 */
// begin[get_properties_for_webapp_with_access_filter]
function getPropertiesForWebApp_(accessLevel) {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Properties");
  if (!sheet) {
    throw new Error("Properties sheet not found.");
  }

  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1);

  const idx = {
    name: headers.indexOf("Property Name"),
    client: headers.indexOf("Client"),
    rate: headers.indexOf("Client Rate"),
    entranceInfo: headers.indexOf("Entrance Info"),
    alarmInfo: headers.indexOf("Alarm Info"),
    wifiNetwork: headers.indexOf("WiFi Network"),
    wifiPassword: headers.indexOf("WiFi Password"),
    houseNotes: headers.indexOf("House Notes"),
    deepCleanItems: headers.indexOf("Deep Clean Items"),
    ownerNames: headers.indexOf("Owner Names"),
  };

  if (idx.name === -1) {
    throw new Error('Properties sheet is missing required header: "Property Name"');
  }

  return rows
    .filter(function (row) {
      return !!row[idx.name];
    })
    .map(function (row) {
      const property = {
        name: row[idx.name],
        client: idx.client !== -1 ? row[idx.client] : "",
        rate: idx.rate !== -1 ? row[idx.rate] : "",
        entranceInfo: idx.entranceInfo !== -1 ? row[idx.entranceInfo] : "",
        alarmInfo: idx.alarmInfo !== -1 ? row[idx.alarmInfo] : "",
        wifiNetwork: idx.wifiNetwork !== -1 ? row[idx.wifiNetwork] : "",
        wifiPassword: idx.wifiPassword !== -1 ? row[idx.wifiPassword] : "",
        houseNotes: idx.houseNotes !== -1 ? row[idx.houseNotes] : "",
        deepCleanItems: idx.deepCleanItems !== -1 ? row[idx.deepCleanItems] : "",
        ownerNames: idx.ownerNames !== -1 ? row[idx.ownerNames] : "",
      };

      return sanitizePropertyForAccess_(property, accessLevel);
    });
}
// end[get_properties_for_webapp_with_access_filter]

// begin[webapp_time_entry_email_helpers]
function getTimeEntryEventLabel_(eventType) {
  if (eventType === "clock_in") return "Check-In";
  if (eventType === "clock_out") return "Check-Out";
  if (eventType === "add_note") return "Cleaning Note";
  return "Unknown Submission";
}

function getTimeEntryEmailSubject_(eventType, name) {
  if (eventType === "clock_in") return `✅ Check-In from ${name}`;
  if (eventType === "clock_out") return `🚪 Check-Out from ${name}`;
  if (eventType === "add_note") return `📝 Cleaning Note from ${name}`;
  return `⚠️ Unknown Submission from ${name}`;
}

function getTimeEntryEmailBody_({
  eventType,
  name,
  property,
  timestamp,
  note,
}) {
  const timeZone = Session.getScriptTimeZone();
  const dateText = Utilities.formatDate(timestamp, timeZone, "MMM d, yyyy");
  const timeText = Utilities.formatDate(timestamp, timeZone, "h:mm a");
  const eventLabel = getTimeEntryEventLabel_(eventType);

  return (
    `⏱️ ${eventLabel} Alert\n\n` +
    `Name: ${name}\n` +
    `Property: ${property}\n` +
    `Date: ${dateText}\n` +
    `Time: ${timeText}`
  );
}

function sendTimeEntryNotificationEmail_({
  eventType,
  name,
  property,
  timestamp,
  note,
}) {
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: getTimeEntryEmailSubject_(eventType, name),
    body: getTimeEntryEmailBody_({
      eventType: eventType,
      name: name,
      property: property,
      timestamp: timestamp,
      note: note,
    }),
  });
}

function sendBlockedTimeEntryEmail_({
  eventType,
  name,
  property,
  timestamp,
  note,
  reason,
}) {
  const timeZone = Session.getScriptTimeZone();
  const dateText = Utilities.formatDate(timestamp, timeZone, "MMM d, yyyy");
  const timeText = Utilities.formatDate(timestamp, timeZone, "h:mm a");

  let body =
    `A web app submission was blocked.\n\n` +
    `Name: ${name}\n` +
    `Property: ${property}\n` +
    `Action: ${eventType}\n` +
    `Date: ${dateText}\n` +
    `Time: ${timeText}\n\n` +
    `Reason: ${reason || "[No reason provided]"}`;

  if (eventType === "clock_in") {
    body += `\n\nClock-In Note: ${note || "[No clock-in note]"}`;
  } else if (eventType === "clock_out") {
    body += `\n\nClock-Out Note: ${note || "[No clock-out note]"}`;
  } else if (eventType === "add_note") {
    body += `\n\nCleaning Note: ${note || "[No cleaning note]"}`;
  }

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: `⛔ Blocked Time Entry for ${name}`,
    body: body,
  });
}

function getCleanerEmailByName_(cleanerName) {
  const sheet = getUsersSheet_();
  if (!sheet) {
    return "";
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return "";
  }

  const headers = values[0].map(String);
  const rows = values.slice(1);

  const idx = {
    name: headers.indexOf("Name"),
    isActive: headers.indexOf("Is Active"),
    email: headers.indexOf("Email"),
  };

  if ([idx.name, idx.isActive, idx.email].includes(-1)) {
    return "";
  }

  const row = rows.find(function (item) {
    return safeStr_(item[idx.name]) === safeStr_(cleanerName);
  });

  if (!row) {
    return "";
  }

  if (!normalizeActiveFlag_(row[idx.isActive])) {
    return "";
  }

  return safeStr_(row[idx.email]);
}

function getPayrollWeekStartSaturday_(dateValue) {
  const d = startOfDay_(coerceToDate_(dateValue) || new Date());
  const day = d.getDay();
  const daysSinceSaturday = (day + 1) % 7;
  d.setDate(d.getDate() - daysSinceSaturday);
  return d;
}

function formatHoursForCleanerEmail_(hoursValue) {
  const hours = round2_(hoursValue || 0);
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (wholeHours > 0) {
    return `${hours.toFixed(2)} hours (${wholeHours}h ${minutes}m)`;
  }

  return `${hours.toFixed(2)} hours (${minutes}m)`;
}

function buildCleanerShiftSummaryEmailData_(cleanerName, clockOutTimestamp) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);
  }

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return null;
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);
  const transitIdx = getTransitColumnIndexes_(headers);

  const today = startOfDay_(clockOutTimestamp);
  const todayKey = formatYMD_(today);
  const weekStart = getPayrollWeekStartSaturday_(clockOutTimestamp);
  const weekStartKey = formatYMD_(weekStart);

  const completedWeekShifts = data
    .slice(1)
    .map(function (row) {
      const name = safeStr_(row[idx["Name"]]);
      const property = safeStr_(row[idx["Property"]]);
      const date = coerceToDate_(row[idx["Date"]]);
      const clockIn = coerceToDate_(row[idx["Clock In"]]);
      const clockOut = coerceToDate_(row[idx["Clock Out"]]);

      if (!name || name !== cleanerName) return null;
      if (!date || !clockIn || !clockOut) return null;
      if (formatYMD_(startOfDay_(date)) < weekStartKey) return null;

      const shiftHours = round2_(computeHours_(clockIn, clockOut, row[idx["Total Hours"]]));
      const transitHours = round2_(Number(row[transitIdx.hours] || 0));
      const transitMinutes = Math.round(Number(row[transitIdx.minutes] || 0));

      return {
        property: property,
        date: startOfDay_(date),
        dateKey: formatYMD_(startOfDay_(date)),
        clockIn: clockIn,
        clockOut: clockOut,
        shiftHours: shiftHours,
        transitHours: transitHours,
        transitMinutes: transitMinutes,
      };
    })
    .filter(function (entry) {
      return !!entry;
    })
    .sort(function (a, b) {
      if (a.date.getTime() !== b.date.getTime()) {
        return a.date.getTime() - b.date.getTime();
      }
      return a.clockIn.getTime() - b.clockIn.getTime();
    });

  if (!completedWeekShifts.length) {
    return null;
  }

  const completedDayShifts = completedWeekShifts.filter(function (entry) {
    return entry.dateKey === todayKey;
  });

  const dayShiftHours = round2_(completedDayShifts.reduce(function (sum, entry) {
    return sum + entry.shiftHours;
  }, 0));

  const dayTransitHours = round2_(completedDayShifts.reduce(function (sum, entry) {
    return sum + entry.transitHours;
  }, 0));

  const weekShiftHours = round2_(completedWeekShifts.reduce(function (sum, entry) {
    return sum + entry.shiftHours;
  }, 0));

  const weekTransitHours = round2_(completedWeekShifts.reduce(function (sum, entry) {
    return sum + entry.transitHours;
  }, 0));

  return {
    cleanerName: cleanerName,
    clockOutTimestamp: clockOutTimestamp,
    today: today,
    dayShifts: completedDayShifts,
    dayTotalHours: round2_(dayShiftHours + dayTransitHours),
    weekTotalHours: round2_(weekShiftHours + weekTransitHours),
  };
}

function sendCleanerShiftSummaryEmail_(cleanerName, clockOutTimestamp) {
  const cleanerEmail = getCleanerEmailByName_(cleanerName);
  if (!cleanerEmail) {
    return;
  }

  const summary = buildCleanerShiftSummaryEmailData_(cleanerName, clockOutTimestamp);
  if (!summary) {
    return;
  }

  const lines = [];
  lines.push(`Hi ${summary.cleanerName},`);
  lines.push("");
  lines.push(`Here is your updated shift summary for ${formatDateShort_(summary.today)}.`);
  lines.push("");

  summary.dayShifts.forEach(function (shift, index) {
    lines.push(`Shift ${index + 1} — ${shift.property}`);
    lines.push(`Clock in: ${formatTime_(shift.clockIn)}`);
    lines.push(`Clock out: ${formatTime_(shift.clockOut)}`);
    lines.push(`Total hours for shift: ${formatHoursForCleanerEmail_(shift.shiftHours)}`);

    if (shift.transitMinutes > 0) {
      lines.push(""); 
      lines.push(`Transit time to next shift: ${shift.transitMinutes}m (${shift.transitHours.toFixed(2)} hours)`);
    }

    lines.push("");
  });

  lines.push(`Total hours for the day: ${formatHoursForCleanerEmail_(summary.dayTotalHours)}`);
  lines.push(`Total hours for the week (Sat–Fri): ${formatHoursForCleanerEmail_(summary.weekTotalHours)}`);
  lines.push("");
  lines.push("Thank you!");

  MailApp.sendEmail({
    to: cleanerEmail,
    subject: `Shift Summary — ${formatDateShort_(summary.today)}`,
    body: lines.join("\n"),
  });
}
// end[webapp_time_entry_email_helpers]

/* begin[webapp_weekly_history_modal_helpers] */
function formatHoursHMM_(hoursValue) {
  const hours = round2_(hoursValue || 0);
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return wholeHours + ":" + String(minutes).padStart(2, "0");
}

function getCurrentCleanerWeeklyWorkHistory(sessionToken) {
  const session = getSession_(safeStr_(sessionToken));
  if (!session || !session.pin) {
    return { ok: false, message: "Session expired. Please log in again." };
  }

  const cleaner = getCleanerRecordFromPin_(session.pin);
  if (!cleaner) {
    return { ok: false, message: "Cleaner session is no longer valid." };
  }

  const cleanerName = safeStr_(cleaner.name);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);
  }

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return {
      ok: true,
      cleanerName: cleanerName,
      weekLabel: "",
      days: [],
      totalHoursDecimal: 0,
      totalHoursText: "0:00",
    };
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);
  const transitIdx = getTransitColumnIndexes_(headers);

  const today = startOfDay_(new Date());
  const weekStart = getPayrollWeekStartSaturday_(today);
  const weekStartKey = formatYMD_(weekStart);
  const weekEnd = new Date(weekStart.getTime());
  weekEnd.setDate(weekEnd.getDate() + 6);

  const shifts = data
    .slice(1)
    .map(function (row) {
      const rowName = safeStr_(row[idx["Name"]]);
      const property = safeStr_(row[idx["Property"]]);
      const date = coerceToDate_(row[idx["Date"]]);
      const clockIn = coerceToDate_(row[idx["Clock In"]]);
      const clockOut = coerceToDate_(row[idx["Clock Out"]]);

      if (!rowName || rowName !== cleanerName) return null;
      if (!date || !clockIn || !clockOut) return null;
      if (formatYMD_(startOfDay_(date)) < weekStartKey) return null;

      const shiftHours = round2_(computeHours_(clockIn, clockOut, row[idx["Total Hours"]]));
      const transitHours = round2_(Number(row[transitIdx.hours] || 0));
      const transitMinutes = Math.round(Number(row[transitIdx.minutes] || 0));

      return {
        property: property,
        date: startOfDay_(date),
        dateKey: formatYMD_(startOfDay_(date)),
        dayLabel: Utilities.formatDate(startOfDay_(date), Session.getScriptTimeZone(), "EEE"),
        dateLabel: Utilities.formatDate(startOfDay_(date), Session.getScriptTimeZone(), "MMM d"),
        clockIn: clockIn,
        clockOut: clockOut,
        clockInText: formatTime_(clockIn),
        clockOutText: formatTime_(clockOut),
        shiftHours: shiftHours,
        shiftHoursDecimal: shiftHours.toFixed(2),
        shiftHoursText: formatHoursHMM_(shiftHours),
        transitHours: transitHours,
        transitHoursDecimal: transitHours.toFixed(2),
        transitHoursText: formatHoursHMM_(transitHours),
        transitMinutes: transitMinutes,
      };
    })
    .filter(function (entry) {
      return !!entry;
    })
    .sort(function (a, b) {
      if (a.date.getTime() !== b.date.getTime()) {
        return a.date.getTime() - b.date.getTime();
      }
      return a.clockIn.getTime() - b.clockIn.getTime();
    });

  const daysMap = {};
  shifts.forEach(function (shift) {
    if (!daysMap[shift.dateKey]) {
      daysMap[shift.dateKey] = {
        dateKey: shift.dateKey,
        header: shift.dayLabel + " (" + shift.dateLabel + ")",
        entries: [],
      };
    }

    daysMap[shift.dateKey].entries.push({
      type: "shift",
      property: shift.property,
      clockInText: shift.clockInText,
      clockOutText: shift.clockOutText,
      shiftHoursText: shift.shiftHoursText,
      shiftHoursDecimal: shift.shiftHoursDecimal,
    });

    if (shift.transitMinutes > 0) {
      daysMap[shift.dateKey].entries.push({
        type: "transit",
        transitMinutes: shift.transitMinutes,
        transitHoursText: shift.transitHoursText,
        transitHoursDecimal: shift.transitHoursDecimal,
      });
    }
  });

  const orderedDays = Object.keys(daysMap)
    .sort()
    .map(function (key) {
      return daysMap[key];
    });

  const totalShiftHours = round2_(shifts.reduce(function (sum, shift) {
    return sum + shift.shiftHours;
  }, 0));

  const totalTransitHours = round2_(shifts.reduce(function (sum, shift) {
    return sum + shift.transitHours;
  }, 0));

  const totalHours = round2_(totalShiftHours + totalTransitHours);

  return {
    ok: true,
    cleanerName: cleanerName,
    weekLabel:
      Utilities.formatDate(weekStart, Session.getScriptTimeZone(), "MMM d") +
      " – " +
      Utilities.formatDate(weekEnd, Session.getScriptTimeZone(), "MMM d"),
    days: orderedDays,
    totalHoursDecimal: totalHours.toFixed(2),
    totalHoursText: formatHoursHMM_(totalHours),
  };
}
/* end[webapp_weekly_history_modal_helpers] */

/* begin[shell_weekly_property_summary_helpers] */
function getShellWeeklyPropertySummary(sessionToken) {
  const session = getSession_(safeStr_(sessionToken));
  if (!session || !session.pin) {
    return { ok: false, message: "Session expired. Please log in again." };
  }

  const cleaner = getCleanerRecordFromPin_(session.pin);
  if (!cleaner) {
    return { ok: false, message: "Cleaner session is no longer valid." };
  }

  const cleanerName = safeStr_(cleaner.name);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);
  }

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return {
      ok: true,
      cleanerName: cleanerName,
      weekLabel: "",
      rows: [],
      totalHoursDecimal: "0.00",
      totalHoursText: "0:00",
    };
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);
  const transitIdx = getTransitColumnIndexes_(headers);

  const today = startOfDay_(new Date());
  const weekStart = getPayrollWeekStartSaturday_(today);
  const weekEnd = new Date(weekStart.getTime());
  weekEnd.setDate(weekEnd.getDate() + 6);

  const weekStartKey = formatYMD_(weekStart);
  const weekEndKey = formatYMD_(startOfDay_(weekEnd));

  const shifts = data
    .slice(1)
    .map(function (row) {
      const rowName = safeStr_(row[idx["Name"]]);
      const property = safeStr_(row[idx["Property"]]);
      const date = coerceToDate_(row[idx["Date"]]);
      const clockIn = coerceToDate_(row[idx["Clock In"]]);
      const clockOut = coerceToDate_(row[idx["Clock Out"]]);

      if (!rowName || rowName !== cleanerName) return null;
      if (!property || !date || !clockIn || !clockOut) return null;

      const dateKey = formatYMD_(startOfDay_(date));
      if (dateKey < weekStartKey || dateKey > weekEndKey) return null;

      const shiftHours = round2_(
        computeHours_(clockIn, clockOut, row[idx["Total Hours"]])
      );

      const transitMinutes =
        transitIdx.minutes !== -1 ? Number(row[transitIdx.minutes] || 0) : 0;
      const transitHours =
        transitIdx.hours !== -1 ? round2_(Number(row[transitIdx.hours] || 0)) : 0;

      return {
        property: property,
        date: startOfDay_(date),
        dateKey: dateKey,
        dayLabel: Utilities.formatDate(startOfDay_(date), Session.getScriptTimeZone(), "EEE"),
        dateLabel: Utilities.formatDate(startOfDay_(date), Session.getScriptTimeZone(), "MMM d"),
        clockIn: clockIn,
        clockOut: clockOut,
        clockInText: formatTime_(clockIn),
        clockOutText: formatTime_(clockOut),
        shiftHours: shiftHours,
        shiftHoursDecimal: shiftHours.toFixed(2),
        shiftHoursText: formatHoursHMM_(shiftHours),
        transitMinutes: transitMinutes,
        transitHours: transitHours,
        transitHoursDecimal: transitHours.toFixed(2),
        transitHoursText: formatHoursHMM_(transitHours),
      };
    })
    .filter(function (entry) {
      return !!entry;
    })
    .sort(function (a, b) {
      if (a.date.getTime() !== b.date.getTime()) {
        return a.date.getTime() - b.date.getTime();
      }
      return a.clockIn.getTime() - b.clockIn.getTime();
    });

  const rows = [];
  let totalShiftHours = 0;
  let totalTransitHours = 0;

  shifts.forEach(function (shift, index) {
    rows.push({
      type: "shift",
      dayHeader: shift.dayLabel + " (" + shift.dateLabel + ")",
      property: shift.property,
      clockInText: shift.clockInText,
      clockOutText: shift.clockOutText,
      shiftHoursText: shift.shiftHoursText,
      shiftHoursDecimal: shift.shiftHoursDecimal,
    });

    totalShiftHours = round2_(totalShiftHours + shift.shiftHours);
    totalTransitHours = round2_(totalTransitHours + shift.transitHours);

    if (shift.transitMinutes > 0) {
      const nextShift = shifts[index + 1];

      rows.push({
        type: "transit",
        fromProperty: shift.property,
        toProperty: nextShift && nextShift.dateKey === shift.dateKey ? nextShift.property : "",
        transitStartText: shift.clockOutText,
        transitEndText:
          nextShift && nextShift.dateKey === shift.dateKey ? nextShift.clockInText : "",
        transitMinutes: shift.transitMinutes,
        transitHoursText: shift.transitHoursText,
        transitHoursDecimal: shift.transitHoursDecimal,
      });
    }
  });

  const totalHours = round2_(totalShiftHours + totalTransitHours);

  return {
    ok: true,
    cleanerName: cleanerName,
    weekLabel:
      Utilities.formatDate(weekStart, Session.getScriptTimeZone(), "MMM d") +
      " – " +
      Utilities.formatDate(weekEnd, Session.getScriptTimeZone(), "MMM d"),
    rows: rows,
    totalHoursDecimal: totalHours.toFixed(2),
    totalHoursText: formatHoursHMM_(totalHours),
  };
}
/* end[shell_weekly_property_summary_helpers] */

// ===== BEGIN submitWebAppTimeEntry replacement =====
/* begin[submit_webapp_time_entry_with_client_timestamp] */
function submitWebAppTimeEntry(payload) {
  const accessCode = normalizeAccessCode_(payload.accessCode);
  const sessionToken = safeStr_(payload.sessionToken);
  const clientId = safeStr_(payload.clientId);
  const property = safeStr_(payload.property);
  const eventType = safeStr_(payload.eventType);
  const note = safeStr_(payload.note);
  const submittedAtMs = Number(payload.submittedAtMs || 0);
  const syncSource = safeStr_(payload.syncSource).trim().toLowerCase();

  const isQueuedSync =
    syncSource === "live_queue" ||
    syncSource === "shell_queue" ||
    syncSource === "live_webapp" ||
    syncSource === "shell_offline";

  let timestamp = new Date();
  if (submittedAtMs && Number.isFinite(submittedAtMs)) {
    const submittedAtDate = new Date(submittedAtMs);
    if (!Number.isNaN(submittedAtDate.getTime())) {
      timestamp = submittedAtDate;
    }
  }

  let cleanerName = null;

  const session = getSession_(sessionToken);

  if (session) {
    cleanerName = session.name;
  } else {
    if (!accessCode) {
      return { ok: false, message: "Please enter your access code." };
    }

    if (isLockedOut_(clientId)) {
      return {
        ok: false,
        message: "Too many attempts. Please wait a minute and try again.",
      };
    }

    const cleaner = getCleanerRecordFromPin_(accessCode);

    if (!cleaner) {
      recordFailure_(clientId);
      Utilities.sleep(800);
      return { ok: false, message: "Invalid access code." };
    }

    clearFailures_(clientId);
    cleanerName = cleaner.name;
  }

  const name = cleanerName;

  if (!property) {
    return { ok: false, message: "Please select a property." };
  }

  if (eventType !== "clock_in" && eventType !== "clock_out" && eventType !== "add_note") {
    return {
      ok: false,
      message: "Please choose Clock In, Add Cleaning Note, or Clock Out.",
    };
  }

  if (eventType === "add_note" && !note) {
    return {
      ok: false,
      message: "Please enter a cleaning note before submitting.",
    };
  }

  try {
    if (isQueuedSync) {
      reconcileQueuedTimeTrackerEntry_({
        timestamp: timestamp,
        name: name,
        property: property,
        eventType: eventType,
        clockInNote: eventType === "clock_in" ? note : "",
        clockOutNote: eventType === "clock_out" ? note : "",
        cleaningNote: eventType === "add_note" ? note : "",
      });

      const currentShift = buildCurrentShiftStatusForWebApp_(name);
      const queuedActionLabel =
        eventType === "clock_in"
          ? "queued clock-in"
          : eventType === "clock_out"
          ? "queued clock-out"
          : "queued cleaning note";

      return {
        ok: true,
        cleanerName: name,
        message: `Synced ${queuedActionLabel} for ${property}.`,
        currentShift: currentShift,
      };
    }

    if (eventType === "clock_in") {
      assertNoOpenShiftConflict_({ name, property });
    }

    if (eventType === "clock_out" || eventType === "add_note") {
      const openShift = findOpenShiftForCleaner_(name);

      if (!openShift) {
        if (eventType === "clock_out") {
          Logger.log("[clock_out_rejection] " + JSON.stringify({
            cleanerName: safeStr_(name),
            property: safeStr_(property),
            reason: "no_open_shift",
          }));
        }
        return {
          ok: false,
          message: `${name}, you are not currently clocked in.`,
        };
      }

      if (safeStr_(openShift.property) !== property) {
        if (eventType === "clock_out") {
          Logger.log("[clock_out_rejection] " + JSON.stringify({
            cleanerName: safeStr_(name),
            property: safeStr_(property),
            openProperty: safeStr_(openShift.property),
            reason: "property_mismatch",
          }));
        }
        return {
          ok: false,
          message: `${name}, you are currently clocked in at ${openShift.property}, not ${property}.`,
        };
      }
    }

    upsertTimeTrackerRow_({
      timestamp,
      name,
      property,
      eventType,
      clockInNote: eventType === "clock_in" ? note : "",
      clockOutNote: eventType === "clock_out" ? note : "",
      cleaningNote: eventType === "add_note" ? note : "",
    });

    if (eventType === "clock_in" || eventType === "clock_out") {
      sendTimeEntryNotificationEmail_({
        eventType: eventType,
        name: name,
        property: property,
        timestamp: timestamp,
        note: note,
      });
    }

    if (eventType === "clock_out") {
      try {
        sendCleanerShiftSummaryEmail_(name, timestamp);
      } catch (emailError) {
        Logger.log("Cleaner shift summary email failed: " + emailError);
      }
    }

    let successMessage = "";
    const currentShift = buildCurrentShiftStatusForWebApp_(name);

    if (eventType === "clock_in") {
      successMessage = `Clocked in successfully at ${property}.`;
    } else if (eventType === "clock_out") {
      successMessage = `Clocked out successfully at ${property}.`;
    } else if (eventType === "add_note") {
      successMessage = `Cleaning note added for ${property}.`;
    }

    return {
      ok: true,
      cleanerName: name,
      message: successMessage,
      currentShift: currentShift,
    };

  } catch (error) {
    sendBlockedTimeEntryEmail_({
      eventType: eventType,
      name: name || "[Unknown cleaner]",
      property: property || "[Unknown property]",
      timestamp: timestamp,
      note: note,
      reason: error && error.message ? error.message : "Unknown error",
    });

    return {
      ok: false,
      message: error.message || "Something went wrong while saving your entry.",
    };
  }
}
/* end[submit_webapp_time_entry_with_client_timestamp] */
// ===== END submitWebAppTimeEntry replacement =====

/* begin[offline_shell_prep_token_store] */
const OFFLINE_SHELL_PREP_PREFIX = "offline_shell_prep_";
const OFFLINE_SHELL_PREP_TTL_SECONDS = 60 * 10; // 10 minutes

function createOfflineShellPrepToken(payload, sessionToken) {
  const safeSessionToken = safeStr_(sessionToken);
  const session = getSession_(safeSessionToken);

  if (!session || !session.name) {
    return { ok: false, message: "Session expired. Please log in again." };
  }

  const cleanerName = safeStr_(session.name);
  const token = Utilities.getUuid();

  const preparedPayload = {
    cleanerName: cleanerName,
    accessLevel: safeStr_((payload && payload.accessLevel) || session.accessLevel || "LIMITED"),
    currentShift: payload && payload.currentShift ? payload.currentShift : null,
    properties: Array.isArray(payload && payload.properties) ? payload.properties : [],
    sessionToken: safeStr_((payload && payload.sessionToken) || safeSessionToken),
    clientId: safeStr_((payload && payload.clientId) || ""),
    pinHash: buildShellPinHash_(session.pin || ""),
    seededAtMs: Date.now(),
  };

  const cache = CacheService.getScriptCache();
  cache.put(
    OFFLINE_SHELL_PREP_PREFIX + token,
    JSON.stringify(preparedPayload),
    OFFLINE_SHELL_PREP_TTL_SECONDS
  );

  return {
    ok: true,
    token: token,
    cleanerName: cleanerName,
  };
}

function getOfflineShellPrepByToken(token) {
  const safeToken = safeStr_(token);
  if (!safeToken) {
    return { ok: false, message: "Missing prep token." };
  }

  const cache = CacheService.getScriptCache();
  const raw = cache.get(OFFLINE_SHELL_PREP_PREFIX + safeToken);

  if (!raw) {
    return { ok: false, message: "Prep token expired or was not found." };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      payload: parsed,
    };
  } catch (error) {
    return { ok: false, message: "Prep token payload could not be read." };
  }
}
/* end[offline_shell_prep_token_store] */

/* begin[offline_shell_prep_code_store] */
const OFFLINE_SHELL_PREP_CODE_PREFIX = "offline_shell_prep_code_";
const OFFLINE_SHELL_PREP_CODE_TTL_SECONDS = 60 * 10; // 10 minutes

function createOfflineShellPrepCode(payload, sessionToken) {
  const session = getSession_(safeStr_(sessionToken));
  if (!session || !session.name) {
    return { ok: false, message: "Session expired. Please log in again." };
  }

  const cleanerName = safeStr_(session.name);
  const code = String(Math.floor(100000 + Math.random() * 900000));

    const preparedPayload = {
    cleanerName: cleanerName,
    accessLevel: safeStr_((payload && payload.accessLevel) || "LIMITED"),
    currentShift: payload && payload.currentShift ? payload.currentShift : null,
    properties: Array.isArray(payload && payload.properties) ? payload.properties : [],
    sessionToken: safeStr_((payload && payload.sessionToken) || sessionToken || ""),
    clientId: safeStr_((payload && payload.clientId) || ""),
    pinHash: buildShellPinHash_(session.pin || ""),
    seededAtMs: Date.now(),
  };

  const cache = CacheService.getScriptCache();
  cache.put(
    OFFLINE_SHELL_PREP_CODE_PREFIX + code,
    JSON.stringify(preparedPayload),
    OFFLINE_SHELL_PREP_CODE_TTL_SECONDS
  );

  return {
    ok: true,
    code: code,
    cleanerName: cleanerName,
  };
}

function getOfflineShellPrepByCode(code) {
  const safeCode = safeStr_(code).trim();
  if (!safeCode) {
    return { ok: false, message: "Missing prep code." };
  }

  const cache = CacheService.getScriptCache();
  const raw = cache.get(OFFLINE_SHELL_PREP_CODE_PREFIX + safeCode);

  if (!raw) {
    return { ok: false, message: "Prep code expired or was not found." };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      payload: parsed,
    };
  } catch (error) {
    return { ok: false, message: "Prep code payload could not be read." };
  }
}
/* end[offline_shell_prep_code_store] */


/* begin[refresh_shell_auth] */
function refreshShellAuth(sessionToken, clientId) {
  const safeSessionToken = safeStr_(sessionToken);
  const safeClientId = safeStr_(clientId);

  if (!safeSessionToken) {
    Logger.log("[auth_refresh_failure] " + JSON.stringify({
      reason: "missing_session_token",
      clientId: safeClientId,
    }));
    return { ok: false, message: "Missing session token." };
  }

  const session = getSession_(safeSessionToken);
  if (!session || !session.name) {
    Logger.log("[auth_refresh_failure] " + JSON.stringify({
      reason: "session_expired",
      clientId: safeClientId,
    }));
    return { ok: false, message: "Session expired. Please log in again." };
  }

  const sessionPin = safeStr_(session.pin);
  if (!sessionPin) {
    Logger.log("[auth_refresh_failure] " + JSON.stringify({
      reason: "missing_session_pin",
      clientId: safeClientId,
    }));
    return { ok: false, message: "Session expired. Please log in again." };
  }

  const cleaner = getCleanerRecordFromPin_(sessionPin);
  if (!cleaner) {
    Logger.log("[auth_refresh_failure] " + JSON.stringify({
      reason: "cleaner_not_found",
      clientId: safeClientId,
    }));
    return { ok: false, message: "Cleaner record not found. Please log in again." };
  }

  const cleanerName = safeStr_(cleaner.name);
  const accessLevel = normalizeAccessLevel_(cleaner.accessLevel);
  const currentShift = getCurrentShiftForCleaner_(cleanerName);

  const preparedPayload = {
    cleanerName: cleanerName,
    accessLevel: accessLevel,
    currentShift: currentShift || null,
    properties: getPropertiesForCleaner_(cleanerName, accessLevel),
    sessionToken: safeSessionToken,
    clientId: safeClientId,
    pinHash: buildShellPinHash_(sessionPin),
    seededAtMs: Date.now(),
  };

  return {
    ok: true,
    payload: preparedPayload,
  };
}
/* end[refresh_shell_auth] */
