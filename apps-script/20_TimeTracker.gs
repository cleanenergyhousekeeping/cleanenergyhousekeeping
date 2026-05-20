function getPropertyClientByName_(propertyName) {
  const normalizedProperty = safeStr_(propertyName);
  if (!normalizedProperty) {
    return "";
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Properties");
  if (!sheet) {
    return "";
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return "";
  }

  const headers = data[0].map(String);
  const idx = {
    propertyName: headers.indexOf("Property Name"),
    client: headers.indexOf("Client"),
  };

  if (idx.propertyName === -1 || idx.client === -1) {
    return "";
  }

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const rowProperty = safeStr_(row[idx.propertyName]);

    if (rowProperty === normalizedProperty) {
      return safeStr_(row[idx.client]);
    }
  }

  return "";
}

function backfillTimeTrackerClientsFromProperties_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);
  }

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return;
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);

  let updatedCount = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const property = safeStr_(row[idx["Property"]]);
    const existingClient = safeStr_(row[idx["Client"]]);

    if (!property || existingClient) {
      continue;
    }

    const lookedUpClient = getPropertyClientByName_(property);
    if (!lookedUpClient) {
      continue;
    }

    sheet.getRange(r + 1, idx["Client"] + 1).setValue(lookedUpClient);
    updatedCount += 1;
  }

  Logger.log(`Backfilled Client on ${updatedCount} Time Tracker row(s).`);
}
function backfillTimeTrackerClientsFromProperties() {
  backfillTimeTrackerClientsFromProperties_();
}

function buildTimeTrackerFlags_(hours) {
  const numericHours = Number(hours || 0);
  const flags = [];

  if (numericHours > 0 && numericHours < 0.05) {
    flags.push("MICRO ENTRY");
  }

  if (numericHours > 24) {
    flags.push("VERY LONG SHIFT");
  } else if (numericHours > 16) {
    flags.push("LONG SHIFT");
  }

  return flags.join(" • ");
}

/* begin[time_tracker_strict_recalc_helpers] */
function recalculateTimeTrackerHoursForRow_(sheet, rowNumber, idx) {
  const inVal = sheet.getRange(rowNumber, idx["Clock In"] + 1).getValue();
  const outVal = sheet.getRange(rowNumber, idx["Clock Out"] + 1).getValue();

  if (!inVal || !outVal) {
    sheet.getRange(rowNumber, idx["Total Hours"] + 1).setValue("");
    sheet.getRange(rowNumber, idx["Flags"] + 1).setValue("");
    return 0;
  }

  const hours = round2_(computeHours_(inVal, outVal, ""));
  sheet.getRange(rowNumber, idx["Total Hours"] + 1).setValue(hours);

  const flags = buildTimeTrackerFlags_(hours);
  sheet.getRange(rowNumber, idx["Flags"] + 1).setValue(flags);

  return hours;
}

function updateTimeTrackerFlagsForRow_(sheet, rowNumber, idx) {
  recalculateTimeTrackerHoursForRow_(sheet, rowNumber, idx);
}

function backfillTimeTrackerHoursAndFlags_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);
  }

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return;
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);

  let updatedCount = 0;

  for (let r = 1; r < data.length; r++) {
    const rowNumber = r + 1;
    const row = data[r];
    const cleanerName = safeStr_(row[idx["Name"]]);
    const rowDate = coerceToDate_(row[idx["Date"]]);

    recalculateTimeTrackerHoursForRow_(sheet, rowNumber, idx);

    if (cleanerName && rowDate) {
      updateTransitForCleanerDay_(cleanerName, startOfDay_(rowDate));
    }

    updatedCount += 1;
  }

  Logger.log(`Backfilled strict Total Hours + Flags on ${updatedCount} Time Tracker row(s).`);
}

function backfillTimeTrackerHoursAndFlags() {
  backfillTimeTrackerHoursAndFlags_();
}

// Keep the old menu-facing name alive in case you already use it somewhere.
function backfillTimeTrackerFlags_() {
  backfillTimeTrackerHoursAndFlags_();
}

function backfillTimeTrackerFlags() {
  backfillTimeTrackerHoursAndFlags_();
}

function onEdit(e) {
  const range = e && e.range;
  if (!range) return;

  const sheet = range.getSheet();
  if (!sheet || sheet.getName() !== TIME_SHEET_NAME) return;

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);

  const editedRow = range.getRow();
  const editedCol = range.getColumn();

  if (editedRow < 2) return;

  const watchedCols = [
    idx["Date"] + 1,
    idx["Clock In"] + 1,
    idx["Clock Out"] + 1,
    idx["Name"] + 1,
    idx["Property"] + 1,
  ];

  if (watchedCols.indexOf(editedCol) === -1) return;

  recalculateTimeTrackerHoursForRow_(sheet, editedRow, idx);

  const cleanerName = safeStr_(sheet.getRange(editedRow, idx["Name"] + 1).getValue());
  const rowDate = coerceToDate_(sheet.getRange(editedRow, idx["Date"] + 1).getValue());

  if (cleanerName && rowDate) {
    updateTransitForCleanerDay_(cleanerName, startOfDay_(rowDate));
  }
}
/* end[time_tracker_strict_recalc_helpers] */

// ===== BEGIN upsertTimeTrackerRow_ replacement =====
function upsertTimeTrackerRow_({
  timestamp,
  name,
  property,
  eventType,
  clockInNote,
  clockOutNote,
  cleaningNote,
}) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);

  const dateOnly = startOfDay_(timestamp);
  const dateKey = formatYMD_(dateOnly);

  let openRowNumber = null;
  let bestRowNumber = null;

  for (let r = data.length - 1; r >= 1; r--) {
    const row = data[r];
    const rName = safeStr_(row[idx["Name"]]);
    const rProp = safeStr_(row[idx["Property"]]);
    const rDate = coerceToDate_(row[idx["Date"]]);
    if (!rName || !rProp || !rDate) continue;
    if (rName !== name || rProp !== property) continue;
    if (formatYMD_(startOfDay_(rDate)) !== dateKey) continue;

    if (!bestRowNumber) bestRowNumber = r + 1;

    const rClockOut = safeStr_(row[idx["Clock Out"]]);
    if (!rClockOut) {
      openRowNumber = r + 1;
      break;
    }
  }

  // HARD SAFETY: never write into row 1
  const nextSafeRow = Math.max(sheet.getLastRow() + 1, 2);

  // ===== BEGIN clock_in block =====
  if (eventType === "clock_in") {
    sheet.appendRow(Array(headers.length).fill(""));
    const targetRow = sheet.getLastRow();
    const clientName = getPropertyClientByName_(property);
    const rowValues = Array(TIME_TRACKER_COLUMNS.length).fill("");

    rowValues[idx["Name"]] = name;
    rowValues[idx["Property"]] = property;
    rowValues[idx["Date"]] = dateOnly;
    rowValues[idx["Clock In"]] = timestamp;
    rowValues[idx["Clock In Note"]] = clockInNote || "";
    rowValues[idx["Clock Out"]] = "";
    rowValues[idx["Total Hours"]] = "";
    rowValues[idx["Clock Out Note"]] = "";
    rowValues[idx["Client"]] = clientName;
    rowValues[idx["Flags"]] = "";
    rowValues[idx["Transit Hours"]] = "";
    rowValues[idx["Transit Alert Sent"]] = "";
    rowValues[idx["Transit Minutes"]] = "";

    sheet.getRange(targetRow, 1, 1, TIME_TRACKER_COLUMNS.length).setValues([rowValues]);

    updateTransitForCleanerDay_(name, dateOnly);
    return;
  }
  // ===== END clock_in block =====

  // ===== BEGIN add_note block =====
  if (eventType === "add_note") {
    const openShift = findOpenShiftForCleaner_(name);

    if (!openShift) {
      throw new Error(
        `${name} is not currently clocked in, so a cleaning note could not be added.`
      );
    }

    const targetRow = openShift.rowNumber;
    const openProperty = safeStr_(openShift.property);

    if (openProperty !== property) {
      throw new Error(
        `${name} is currently clocked in at ${openProperty}, not ${property}. ` +
        `Please select the open property before adding a cleaning note.`
      );
    }

    const existingNote = safeStr_(
      sheet.getRange(targetRow, idx["Clock Out Note"] + 1).getValue()
    );
    const newNote = safeStr_(cleaningNote);

    if (!newNote) {
      throw new Error("Cleaning note is blank.");
    }

    const combinedNote = existingNote
      ? `${existingNote}\n• ${newNote}`
      : `• ${newNote}`;

    // For now, store in Clock Out Note column so invoices can continue using current logic.
    sheet.getRange(targetRow, idx["Clock Out Note"] + 1).setValue(combinedNote);

    updateTransitForCleanerDay_(name, startOfDay_(openShift.clockIn || timestamp));
    return;
  }
  // ===== END add_note block =====

  // ===== BEGIN clock_out block =====
  if (eventType === "clock_out") {
    // Only close a real open shift for this cleaner.
    // Never create a new row from a clock-out.
    // Never reuse a closed row.
    const openShift = findOpenShiftForCleaner_(name);

    if (!openShift) {
      throw new Error(
        `${name} has no open shift to clock out of. Clock-out was blocked.`
      );
    }

    const targetRow = openShift.rowNumber;
    const openProperty = safeStr_(openShift.property);

    // Safety: submitted property must match the open shift property.
    if (openProperty !== property) {
      throw new Error(
        `${name} is currently clocked in at ${openProperty}, not ${property}. ` +
        `They must clock out of the open property first.`
      );
    }

    sheet.getRange(targetRow, idx["Clock Out"] + 1).setValue(timestamp);

    // Append any clock-out note into the same practical cleaning-note column.
    const existingNote = safeStr_(
      sheet.getRange(targetRow, idx["Clock Out Note"] + 1).getValue()
    );
    const newClockOutNote = safeStr_(clockOutNote);

    if (newClockOutNote) {
      const combinedNote = existingNote
        ? `${existingNote}\n• ${newClockOutNote}`
        : `• ${newClockOutNote}`;

      sheet.getRange(targetRow, idx["Clock Out Note"] + 1).setValue(combinedNote);
    }

    const inVal = sheet.getRange(targetRow, idx["Clock In"] + 1).getValue();
    const outVal = sheet.getRange(targetRow, idx["Clock Out"] + 1).getValue();
    const hrs = round2_(computeHours_(inVal, outVal, ""));
    sheet.getRange(targetRow, idx["Total Hours"] + 1).setValue(hrs);

    updateTimeTrackerFlagsForRow_(sheet, targetRow, idx);
    updateTransitForCleanerDay_(name, startOfDay_(openShift.clockIn || timestamp));
    return;
  }
  // ===== END clock_out block =====
}
// ===== END upsertTimeTrackerRow_ replacement =====

/* begin[queued_time_entry_reconciliation_helpers] */
function appendUniqueBulletNote_(existingText, newText) {
  const existing = safeStr_(existingText).trim();
  const incoming = safeStr_(newText).trim();

  if (!incoming) {
    return existing;
  }

  const bulletLine = `• ${incoming}`;

  if (!existing) {
    return bulletLine;
  }

  const existingLines = existing
    .split("\n")
    .map(function (line) {
      return safeStr_(line).trim();
    })
    .filter(function (line) {
      return !!line;
    });

  if (existingLines.indexOf(bulletLine) !== -1) {
    return existing;
  }

  return existing + "\n" + bulletLine;
}

function findExactQueuedClockInRow_({
  data,
  idx,
  name,
  property,
  timestamp,
}) {
  const targetMs = timestamp instanceof Date ? timestamp.getTime() : NaN;
  if (!Number.isFinite(targetMs)) return null;

  for (let r = data.length - 1; r >= 1; r--) {
    const row = data[r];
    const rowName = safeStr_(row[idx["Name"]]);
    const rowProperty = safeStr_(row[idx["Property"]]);
    const rowClockIn = coerceToDate_(row[idx["Clock In"]]);

    if (rowName !== name) continue;
    if (rowProperty !== property) continue;
    if (!rowClockIn) continue;

    if (rowClockIn.getTime() === targetMs) {
      return {
        rowNumber: r + 1,
        clockIn: rowClockIn,
      };
    }
  }

  return null;
}

function findQueuedShiftRowForTimestamp_({
  data,
  idx,
  name,
  property,
  timestamp,
}) {
  const targetMs = timestamp instanceof Date ? timestamp.getTime() : NaN;
  if (!Number.isFinite(targetMs)) return null;

  let bestMatch = null;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const rowName = safeStr_(row[idx["Name"]]);
    const rowProperty = safeStr_(row[idx["Property"]]);
    const rowClockIn = coerceToDate_(row[idx["Clock In"]]);
    const rowClockOut = coerceToDate_(row[idx["Clock Out"]]);
    const rowDate = coerceToDate_(row[idx["Date"]]);

    if (rowName !== name) continue;
    if (rowProperty !== property) continue;
    if (!rowClockIn) continue;

    const inMs = rowClockIn.getTime();
    const outMs = rowClockOut ? rowClockOut.getTime() : null;

    if (inMs > targetMs) continue;
    if (outMs !== null && outMs < targetMs) continue;

    if (!bestMatch || inMs > bestMatch.clockIn.getTime()) {
      bestMatch = {
        rowNumber: r + 1,
        date: rowDate,
        clockIn: rowClockIn,
        clockOut: rowClockOut,
      };
    }
  }

  return bestMatch;
}

function reconcileQueuedTimeTrackerEntry_({
  timestamp,
  name,
  property,
  eventType,
  clockInNote,
  clockOutNote,
  cleaningNote,
}) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);
  const dateOnly = startOfDay_(timestamp);
  const timestampMs = timestamp instanceof Date ? timestamp.getTime() : NaN;

  if (!Number.isFinite(timestampMs)) {
    throw new Error("Queued entry timestamp is invalid.");
  }

  // ===== BEGIN queued clock_in block =====
  if (eventType === "clock_in") {
    const duplicateClockIn = findExactQueuedClockInRow_({
      data: data,
      idx: idx,
      name: name,
      property: property,
      timestamp: timestamp,
    });

    if (duplicateClockIn) {
      logClockInDebug_("queued_clock_in_duplicate", {
        name: name,
        property: property,
        rowNumber: duplicateClockIn.rowNumber,
      });
      return {
        action: "duplicate_clock_in",
        rowNumber: duplicateClockIn.rowNumber,
      };
    }

    const openShift = findOpenShiftForCleaner_(name);
    if (openShift) {
      const openProperty = safeStr_(openShift.property);

      if (openProperty === property) {
        logClockInDebug_("queued_clock_in_ignored_already_open", {
          name: name,
          property: property,
          rowNumber: openShift.rowNumber,
        });
        return {
          action: "ignored_clock_in_already_open",
          rowNumber: openShift.rowNumber,
        };
      }

      logClockInDebug_("queued_clock_in_blocked_different_property", {
        name: name,
        property: property,
        openProperty: openProperty,
        rowNumber: openShift.rowNumber,
      });
      throw new Error(
        `${name} has an open shift at ${openProperty}. Queued clock-in at ${property} was blocked.`
      );
    }

    sheet.appendRow(Array(headers.length).fill(""));
    const targetRow = sheet.getLastRow();
    const clientName = getPropertyClientByName_(property);
    const rowValues = Array(TIME_TRACKER_COLUMNS.length).fill("");

    rowValues[idx["Name"]] = name;
    rowValues[idx["Property"]] = property;
    rowValues[idx["Date"]] = dateOnly;
    rowValues[idx["Clock In"]] = timestamp;
    rowValues[idx["Clock In Note"]] = clockInNote || "";
    rowValues[idx["Clock Out"]] = "";
    rowValues[idx["Total Hours"]] = "";
    rowValues[idx["Clock Out Note"]] = "";
    rowValues[idx["Client"]] = clientName;
    rowValues[idx["Flags"]] = "";
    rowValues[idx["Transit Hours"]] = "";
    rowValues[idx["Transit Alert Sent"]] = "";
    rowValues[idx["Transit Minutes"]] = "";

    sheet.getRange(targetRow, 1, 1, TIME_TRACKER_COLUMNS.length).setValues([rowValues]);

    logClockInDebug_("queued_clock_in_inserted", {
      name: name,
      property: property,
      rowNumber: targetRow,
    });

    updateTimeTrackerFlagsForRow_(sheet, targetRow, idx);
    updateTransitForCleanerDay_(name, dateOnly);

    return {
      action: "inserted_clock_in",
      rowNumber: targetRow,
    };
  }
  // ===== END queued clock_in block =====

  const targetShift = findQueuedShiftRowForTimestamp_({
    data: data,
    idx: idx,
    name: name,
    property: property,
    timestamp: timestamp,
  });

  if (!targetShift) {
    throw new Error(
      `${name} has no matching ${property} shift for this queued ${eventType.replace("_", " ")} entry.`
    );
  }

  if (timestampMs < targetShift.clockIn.getTime()) {
    throw new Error(
      `${name} has a queued ${eventType.replace("_", " ")} earlier than the matched clock-in.`
    );
  }

  // ===== BEGIN queued add_note block =====
  if (eventType === "add_note") {
    const existingNote = safeStr_(
      sheet.getRange(targetShift.rowNumber, idx["Clock Out Note"] + 1).getValue()
    );
    const mergedNote = appendUniqueBulletNote_(existingNote, cleaningNote);

    if (mergedNote !== existingNote) {
      sheet.getRange(targetShift.rowNumber, idx["Clock Out Note"] + 1).setValue(mergedNote);
    }

    updateTimeTrackerFlagsForRow_(sheet, targetShift.rowNumber, idx);
    updateTransitForCleanerDay_(name, startOfDay_(targetShift.clockIn || timestamp));

    return {
      action: "merged_add_note",
      rowNumber: targetShift.rowNumber,
    };
  }
  // ===== END queued add_note block =====

  // ===== BEGIN queued clock_out block =====
  if (eventType === "clock_out") {
    const existingClockOut = coerceToDate_(
      sheet.getRange(targetShift.rowNumber, idx["Clock Out"] + 1).getValue()
    );

    if (!existingClockOut || timestampMs < existingClockOut.getTime()) {
      sheet.getRange(targetShift.rowNumber, idx["Clock Out"] + 1).setValue(timestamp);
    }

    const existingNote = safeStr_(
      sheet.getRange(targetShift.rowNumber, idx["Clock Out Note"] + 1).getValue()
    );
    const mergedClockOutNote = appendUniqueBulletNote_(existingNote, clockOutNote);

    if (mergedClockOutNote !== existingNote) {
      sheet.getRange(targetShift.rowNumber, idx["Clock Out Note"] + 1).setValue(mergedClockOutNote);
    }

    const inVal = sheet.getRange(targetShift.rowNumber, idx["Clock In"] + 1).getValue();
    const outVal = sheet.getRange(targetShift.rowNumber, idx["Clock Out"] + 1).getValue();
    const hrs = round2_(computeHours_(inVal, outVal, ""));
    sheet.getRange(targetShift.rowNumber, idx["Total Hours"] + 1).setValue(hrs);

    updateTimeTrackerFlagsForRow_(sheet, targetShift.rowNumber, idx);
    updateTransitForCleanerDay_(name, startOfDay_(targetShift.clockIn || timestamp));

    return {
      action: "merged_clock_out",
      rowNumber: targetShift.rowNumber,
    };
  }
  // ===== END queued clock_out block =====

  throw new Error(`Unsupported queued event type: ${eventType}`);
}
/* end[queued_time_entry_reconciliation_helpers] */

function sortRowsByDateThenStart_(rows) {
  return rows.sort((a, b) => {
    const dA = new Date(a.date);
    const dB = new Date(b.date);

    // Primary: date
    if (dA.getTime() !== dB.getTime()) {
      return dA - dB;
    }

    // Secondary: clock-in time
    const tA = a.clockIn ? new Date(a.clockIn).getTime() : 0;
    const tB = b.clockIn ? new Date(b.clockIn).getTime() : 0;
    return tA - tB;
  });
}

// NOTE: Call sortRowsByDateThenStart_(rows) right before your grouping step
// inside the invoice generation flow (wherever you currently build the rows array).

/**
 * Finds the user's most recent open shift anywhere in the Time Tracker.
 * An open shift is any row with a Clock In value and no Clock Out value.
 *
 * Returns null when no open shift exists.
 */
function findOpenShiftForCleaner_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);

  // Walk upward from the bottom so the first match is the newest open shift.
  for (let r = data.length - 1; r >= 1; r--) {
    const row = data[r];
    const rowName = safeStr_(row[idx["Name"]]);
    const property = safeStr_(row[idx["Property"]]);
    const dateValue = row[idx["Date"]];
    const clockInValue = row[idx["Clock In"]];
    const clockOutValue = row[idx["Clock Out"]];

    if (rowName !== name) continue;
    if (!clockInValue) continue;
    if (clockOutValue) continue;

    return {
      rowNumber: r + 1,
      name: rowName,
      property,
      date: coerceToDate_(dateValue),
      clockIn: coerceToDate_(clockInValue),
    };
  }

  return null;
}

/**
 * Throws an error if a cleaner tries to clock into a different property
 * while still having an open shift.
 *
 * Same-property repeat clock-ins are also blocked so we do not overwrite
 * the existing open Clock In time by accident.
 */
 
/* begin[get_current_shift_and_properties_for_cleaner] */
function getCurrentShiftForCleaner_(name) {
  const openShift = findOpenShiftForCleaner_(name);
  if (!openShift) {
    return null;
  }

  const clockInDate = openShift.clockIn instanceof Date
    ? openShift.clockIn
    : coerceToDate_(openShift.clockIn);

  return {
    property: safeStr_(openShift.property),
    clockInMs: clockInDate ? clockInDate.getTime() : "",
    clockInDisplay: clockInDate
      ? Utilities.formatDate(
          clockInDate,
          Session.getScriptTimeZone(),
          "h:mm a"
        )
      : "",
  };
}

function getPropertiesForCleaner_(name, accessLevel) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Properties");

  if (!sheet) {
    return [];
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return [];
  }

  const headers = data[0].map(String);
  const idx = {
    name: headers.indexOf("Property Name"),
    entranceInfo: headers.indexOf("Entrance Info"),
    alarmInfo: headers.indexOf("Alarm Info"),
    wifiNetwork: headers.indexOf("WiFi Network"),
    wifiPassword: headers.indexOf("WiFi Password"),
    houseNotes: headers.indexOf("House Notes"),
    ownerNames: headers.indexOf("Owner Names"),
  };

  if (idx.name === -1) {
    throw new Error('Properties sheet is missing required header: "Property Name"');
  }

  const normalizedAccessLevel =
    String(accessLevel || "LIMITED").trim().toUpperCase() === "FULL"
      ? "FULL"
      : "LIMITED";

  return data
    .slice(1)
    .filter(function (row) {
      return !!safeStr_(row[idx.name]);
    })
    .map(function (row) {
      const property = {
        name: safeStr_(row[idx.name]),
        entranceInfo: idx.entranceInfo !== -1 ? safeStr_(row[idx.entranceInfo]) : "",
        alarmInfo: idx.alarmInfo !== -1 ? safeStr_(row[idx.alarmInfo]) : "",
        wifiNetwork: idx.wifiNetwork !== -1 ? safeStr_(row[idx.wifiNetwork]) : "",
        wifiPassword: idx.wifiPassword !== -1 ? safeStr_(row[idx.wifiPassword]) : "",
        houseNotes: idx.houseNotes !== -1 ? safeStr_(row[idx.houseNotes]) : "",
        ownerNames: idx.ownerNames !== -1 ? safeStr_(row[idx.ownerNames]) : "",
      };

      if (normalizedAccessLevel !== "FULL") {
        property.entranceInfo = "";
        property.alarmInfo = "";
      }

      return property;
    });
}
/* end[get_current_shift_and_properties_for_cleaner] */
function assertNoOpenShiftConflict_({ name, property }) {
  const openShift = findOpenShiftForCleaner_(name);
  if (!openShift) return;

  const openProperty = safeStr_(openShift.property);
  const clockInText = openShift.clockIn
    ? Utilities.formatDate(openShift.clockIn, Session.getScriptTimeZone(), "MMM d, yyyy h:mm a")
    : "unknown time";

  if (openProperty === property) {
    throw new Error(
      `${name} is already clocked in at ${property} since ${clockInText}. ` +
      `They must clock out before clocking in again.`
    );
  }

  throw new Error(
    `${name} is still clocked in at ${openProperty} since ${clockInText}. ` +
    `They must clock out there before clocking into ${property}.`
  );
}

/**
 * Ensures the Time Tracker has the optional transit columns needed for payroll.
 *
 * These columns are intentionally separate from invoice hours so transit can be
 * paid internally without ever affecting client billing.
 */
function ensureTransitColumns_(sheet) {
  const transitHeaders = [
    "Transit Minutes",
    "Transit Hours",
    "Transit Alert Sent",
  ];

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (value) {
    return String(value || "").trim();
  });

  let nextCol = headerRow.length + 1;

  transitHeaders.forEach(function (header) {
    if (headerRow.indexOf(header) !== -1) return;
    sheet.getRange(1, nextCol).setValue(header);
    headerRow.push(header);
    nextCol += 1;
  });
}

/**
 * Rebuilds all transit values for one cleaner on one day.
 *
 * Rule requested:
 * - count every gap between one completed shift and the next shift on the same day
 * - send an alert email only when a gap is greater than 35 minutes
 *
 * Transit is stored on the EARLIER shift row as the time it took to reach the next job.
 */
function updateTransitForCleanerDay_(name, dateOnly) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);
  const transitIdx = getTransitColumnIndexes_(headers);
  const dateKey = formatYMD_(startOfDay_(dateOnly));

  const dayRows = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const rowName = safeStr_(row[idx["Name"]]);
    const rowDate = coerceToDate_(row[idx["Date"]]);
    const rowClockIn = coerceToDate_(row[idx["Clock In"]]);
    const rowClockOut = coerceToDate_(row[idx["Clock Out"]]);

    if (rowName !== name) continue;
    if (!rowDate) continue;
    if (formatYMD_(startOfDay_(rowDate)) !== dateKey) continue;
    if (!rowClockIn) continue;

    dayRows.push({
      rowNumber: r + 1,
      property: safeStr_(row[idx["Property"]]),
      clockIn: rowClockIn,
      clockOut: rowClockOut,
      transitAlertSent: isTruthyCell_(row[transitIdx.alertSent]),
    });
  }

  if (!dayRows.length) return;

  dayRows.sort(function (a, b) {
    return a.clockIn.getTime() - b.clockIn.getTime();
  });

  // First clear transit values so stale gaps do not survive edits or reordering.
  dayRows.forEach(function (entry) {
    sheet.getRange(entry.rowNumber, transitIdx.minutes + 1).setValue("");
    sheet.getRange(entry.rowNumber, transitIdx.hours + 1).setValue("");

    // Reset alert flags up front. Any active over-threshold gap below will turn it back on.
    sheet.getRange(entry.rowNumber, transitIdx.alertSent + 1).setValue("");
  });

  for (let i = 0; i < dayRows.length - 1; i++) {
    const current = dayRows[i];
    const next = dayRows[i + 1];

    // Transit is only measurable once the earlier job has a real clock-out.
    if (!current.clockOut || !next.clockIn) continue;

    const gapMs = next.clockIn.getTime() - current.clockOut.getTime();
    if (gapMs < 0) continue;

    const transitMinutes = Math.round(gapMs / 60000);
    const transitHours = round2_(transitMinutes / 60);

    sheet.getRange(current.rowNumber, transitIdx.minutes + 1).setValue(transitMinutes);
    sheet.getRange(current.rowNumber, transitIdx.hours + 1).setValue(transitHours);

    if (transitMinutes > 35) {
      sheet.getRange(current.rowNumber, transitIdx.alertSent + 1).setValue("YES");

      if (!current.transitAlertSent) {
        sendTransitAlertEmail_({
          name: name,
          dateOnly: dateOnly,
          fromProperty: current.property,
          toProperty: next.property,
          clockOut: current.clockOut,
          nextClockIn: next.clockIn,
          transitMinutes: transitMinutes,
        });
      }
    }
  }
}

/**
 * Returns the indexes for the optional transit columns.
 */
function getTransitColumnIndexes_(headers) {
  return {
    minutes: headers.indexOf("Transit Minutes"),
    hours: headers.indexOf("Transit Hours"),
    alertSent: headers.indexOf("Transit Alert Sent"),
  };
}

/**
 * Interprets common truthy sheet values safely.
 */
function isTruthyCell_(value) {
  const text = safeStr_(value).toLowerCase();
  return text === "true" || text === "yes" || text === "y" || text === "1";
}

/**
 * Sends an email when transit exceeds the requested threshold.
 */
function sendTransitAlertEmail_({
  name,
  dateOnly,
  fromProperty,
  toProperty,
  clockOut,
  nextClockIn,
  transitMinutes,
}) {
  const timeZone = Session.getScriptTimeZone();
  const dateText = Utilities.formatDate(startOfDay_(dateOnly), timeZone, "MMM d, yyyy");
  const clockOutText = Utilities.formatDate(clockOut, timeZone, "h:mm a");
  const nextClockInText = Utilities.formatDate(nextClockIn, timeZone, "h:mm a");

  const subject = `🚗 Transit alert: ${name} gap exceeded 35 minutes`;
  const body =
    `A same-day gap between jobs exceeded the 35-minute transit threshold.\n\n` +
    `Cleaner: ${name}\n` +
    `Date: ${dateText}\n` +
    `From: ${fromProperty || "[Unknown property]"}\n` +
    `To: ${toProperty || "[Unknown property]"}\n` +
    `Clock-out: ${clockOutText}\n` +
    `Next clock-in: ${nextClockInText}\n` +
    `Transit minutes: ${transitMinutes}`;

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: subject,
    body: body,
  });
}
