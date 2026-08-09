/* begin[payroll_constants] */
const PAYROLL_CONTROL_SHEET_NAME = "Payroll Control";
const PAYROLL_PREVIEW_SHEET_NAME = "Payroll Preview";
const PAYROLL_PREP_SHEET_NAME = "Payroll Prep";
const PAYROLL_DEFAULTS_SHEET_NAME = "Payroll Defaults";
const PAYROLL_PDF_TEMP_SHEET_NAME = "Payroll PDF Temp";
const PAYROLL_PDF_FOLDER_NAME = "Clean Energy Payroll PDFs";
const PAYROLL_EDITABLE_SHEET_NAME = "Payroll Summary";
const DEFAULT_PAYROLL_DAILY_MIN_HOURS = 5;

const PAYROLL_PREP_HEADERS = [
  "Cleaner",
  "Period Start",
  "Period End",
  "Pay Rate",
  "Daily Min Hours",
  "Gas",
  "Bonus",
  "Adjustment",
  "Notes",
];

const PAYROLL_DEFAULTS_HEADERS = [
  "Cleaner",
  "Default Pay Rate",
  "Default Daily Min Hours",
];

const PAYROLL_CONTROL_FIELDS = [
  ["Field", "Value"],
  ["Start Date", ""],
  ["End Date", ""],
  ["Cleaner", "All Cleaners"],
  ["Last Generated", ""],
];

const PAYROLL_PREVIEW_HEADERS = [
  "Cleaner",
  "Period Start",
  "Period End",
  "Work Date",
  "Day",
  "Entry Type",
  "Property",
  "Start Time",
  "End Time",
  "Hours",
  "Hours Detail",
  "Rate",
  "Pay",
  "Notes",
];
/* end[payroll_constants] */

/* begin[payroll_prep_reader] */
function getPayrollPrepForCleaner_(cleanerName, startDate, endDate, lookupData) {
  const values = lookupData
    ? lookupData.prepValues
    : getPayrollSheetValues_(PAYROLL_PREP_SHEET_NAME);
  if (values.length < 2) return null;

  const headers = values[0];

  const idx = {
    cleaner: headers.indexOf("Cleaner"),
    start: headers.indexOf("Period Start"),
    end: headers.indexOf("Period End"),
    rate: headers.indexOf("Pay Rate"),
    min: headers.indexOf("Daily Min Hours"),
    gas: headers.indexOf("Gas"),
    bonus: headers.indexOf("Bonus"),
    adj: headers.indexOf("Adjustment"),
    notes: headers.indexOf("Notes"),
  };

  const canonicalNames = lookupData ? lookupData.canonicalNames : null;
  const targetCleaner = normalizePayrollCleanerName_(cleanerName, canonicalNames);

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    if (
      normalizePayrollCleanerName_(row[idx.cleaner], canonicalNames) !== targetCleaner
    ) continue;

    const rowStart = coerceToDate_(row[idx.start]);
    const rowEnd = coerceToDate_(row[idx.end]);

    if (!rowStart || !rowEnd) continue;

    if (
      startOfDay_(rowStart).getTime() === startOfDay_(startDate).getTime() &&
      startOfDay_(rowEnd).getTime() === startOfDay_(endDate).getTime()
    ) {
      return {
        rate: row[idx.rate] === "" ? null : Number(row[idx.rate]),
        minHours: row[idx.min] === "" ? null : Number(row[idx.min]),
        gas: Number(row[idx.gas]) || 0,
        bonus: Number(row[idx.bonus]) || 0,
        adjustment: Number(row[idx.adj]) || 0,
        notes: safeStr_(row[idx.notes]),
      };
    }
  }

  return null;
}
/* end[payroll_prep_reader] */

/* begin[payroll_setup_entry_points] */
function setupPayroll_() {
  const controlSheet = ensurePayrollControlSheet_();
  const previewSheet = ensurePayrollPreviewSheet_();
  ensurePayrollPrepSheet_();
  ensurePayrollDefaultsSheet_();

  seedPayrollDefaultControlValues_(controlSheet);
  refreshPayrollCleanerDropdown_(controlSheet);

  previewSheet.clearContents();
  previewSheet.getRange(1, 1, 1, PAYROLL_PREVIEW_HEADERS.length)
    .setValues([PAYROLL_PREVIEW_HEADERS]);

  previewSheet.setFrozenRows(1);
}

function generatePayrollPreview_() {
  const controlValues = getPayrollControlValues_();
  const payrollData = buildPayrollPreviewData_(controlValues);
  writePayrollPreview_(payrollData, controlValues);
  stampPayrollGeneratedAt_();
}
/* end[payroll_setup_entry_points] */


/* begin[payroll_sheet_setup_helpers] */
function ensurePayrollControlSheet_(shouldFormat) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PAYROLL_CONTROL_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PAYROLL_CONTROL_SHEET_NAME);
  }

  const needsReset =
    sheet.getLastRow() < PAYROLL_CONTROL_FIELDS.length ||
    safeStr_(sheet.getRange(1, 1).getValue()) !== "Field" ||
    safeStr_(sheet.getRange(1, 2).getValue()) !== "Value";

  if (needsReset) {
    sheet.clear();
    sheet.getRange(1, 1, PAYROLL_CONTROL_FIELDS.length, 2)
      .setValues(PAYROLL_CONTROL_FIELDS);
  }

  if (shouldFormat !== false) {
    formatPayrollControlSheet_(sheet);
  }
  return sheet;
}

function ensurePayrollPreviewSheet_(shouldFormat) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PAYROLL_PREVIEW_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PAYROLL_PREVIEW_SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, PAYROLL_PREVIEW_HEADERS.length)
      .setValues([PAYROLL_PREVIEW_HEADERS]);
  }

  if (shouldFormat !== false) {
    formatPayrollPreviewSheet_(sheet);
  }
  return sheet;
}

function ensurePayrollPrepSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PAYROLL_PREP_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PAYROLL_PREP_SHEET_NAME);
  }

  const needsReset =
    sheet.getLastRow() < 1 ||
    safeStr_(sheet.getRange(1, 1).getValue()) !== "Cleaner";

  if (needsReset) {
    sheet.clear();
    sheet.getRange(1, 1, 1, PAYROLL_PREP_HEADERS.length)
      .setValues([PAYROLL_PREP_HEADERS]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, PAYROLL_PREP_HEADERS.length).setFontWeight("bold");
  sheet.getRange("B:C").setNumberFormat("m/d/yyyy");
  sheet.autoResizeColumns(1, PAYROLL_PREP_HEADERS.length);

  return sheet;
}

function ensurePayrollDefaultsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PAYROLL_DEFAULTS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PAYROLL_DEFAULTS_SHEET_NAME);
  }

  const needsReset =
    sheet.getLastRow() < 1 ||
    safeStr_(sheet.getRange(1, 1).getValue()) !== "Cleaner";

  if (needsReset) {
    sheet.clear();
    sheet.getRange(1, 1, 1, PAYROLL_DEFAULTS_HEADERS.length)
      .setValues([PAYROLL_DEFAULTS_HEADERS]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, PAYROLL_DEFAULTS_HEADERS.length).setFontWeight("bold");
  sheet.autoResizeColumns(1, PAYROLL_DEFAULTS_HEADERS.length);

  return sheet;
}

function formatPayrollControlSheet_(sheet) {
  sheet.setColumnWidths(1, 2, 170);
  sheet.getRange("A1:B1").setFontWeight("bold");
  sheet.getRange(1, 1, PAYROLL_CONTROL_FIELDS.length, 1).setFontWeight("bold");
  sheet.getRange("B2:B3").setNumberFormat("m/d/yyyy");
}

function formatPayrollPreviewSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, PAYROLL_PREVIEW_HEADERS.length).setFontWeight("bold");
  sheet.autoResizeColumns(1, PAYROLL_PREVIEW_HEADERS.length);
}

function seedPayrollDefaultControlValues_(sheet) {
  const startCell = sheet.getRange("B2");
  const endCell = sheet.getRange("B3");
  const cleanerCell = sheet.getRange("B4");

  const currentStart = coerceToDate_(startCell.getValue());
  const currentEnd = coerceToDate_(endCell.getValue());
  const currentCleaner = safeStr_(cleanerCell.getValue());

  const today = new Date();
  const defaultStart = getPayrollWeekStartSaturday_(today);
  const defaultEnd = new Date(defaultStart.getTime());
  defaultEnd.setDate(defaultEnd.getDate() + 6);

  if (!currentStart) {
    startCell.setValue(defaultStart);
  }

  if (!currentEnd) {
    endCell.setValue(defaultEnd);
  }

  if (!currentCleaner) {
    cleanerCell.setValue("All Cleaners");
  }
}
/* end[payroll_sheet_setup_helpers] */

/* begin[payroll_prep_population_helpers] */
function getPayrollPrepKey_(cleanerName, startDate, endDate) {
  return [
    normalizePayrollCleanerName_(cleanerName),
    formatYMD_(startOfDay_(startDate)),
    formatYMD_(startOfDay_(endDate)),
  ].join("|");
}

function populatePayrollPrepFromControl_() {
  const controlValues = getPayrollControlValues_();
  const prepSheet = ensurePayrollPrepSheet_();
  const shifts = getPayrollCompletedShifts_(controlValues);

  const cleanerMap = {};

  shifts.forEach(function (shift) {
    const cleanerName = normalizePayrollCleanerName_(shift.cleanerName);
    if (cleanerName) {
      cleanerMap[cleanerName] = true;
    }
  });

  const cleanerNames = Object.keys(cleanerMap).sort();

  if (!cleanerNames.length) {
    return {
      ok: true,
      message: "No completed shifts were found for that payroll period.",
      addedCount: 0,
    };
  }

  const existingValues = prepSheet.getDataRange().getValues();
  const existingKeys = {};

  if (existingValues.length > 1) {
    for (let i = 1; i < existingValues.length; i++) {
      const row = existingValues[i];
      const existingCleaner = normalizePayrollCleanerName_(row[0]);
      const existingStart = coerceToDate_(row[1]);
      const existingEnd = coerceToDate_(row[2]);

      if (!existingCleaner || !existingStart || !existingEnd) continue;

      existingKeys[
        getPayrollPrepKey_(existingCleaner, existingStart, existingEnd)
      ] = true;
    }
  }

  const rowsToAdd = cleanerNames
    .filter(function (cleanerName) {
      const key = getPayrollPrepKey_(
        cleanerName,
        controlValues.startDate,
        controlValues.endDate
      );
      return !existingKeys[key];
    })
    .map(function (cleanerName) {
      const defaults = getPayrollDefaultsForCleaner_(cleanerName);

      return [
        cleanerName,
        startOfDay_(controlValues.startDate),
        startOfDay_(controlValues.endDate),
        defaults.rate == null ? "" : defaults.rate,
        defaults.minHours == null ? "" : defaults.minHours,
        0,
        0,
        0,
        "",
      ];
    });

  if (!rowsToAdd.length) {
    return {
      ok: true,
      message: "Payroll Prep already has rows for all cleaners in that payroll period.",
      addedCount: 0,
    };
  }

  prepSheet
    .getRange(prepSheet.getLastRow() + 1, 1, rowsToAdd.length, PAYROLL_PREP_HEADERS.length)
    .setValues(rowsToAdd);

  prepSheet.getRange("B:C").setNumberFormat("m/d/yyyy");
  prepSheet.autoResizeColumns(1, PAYROLL_PREP_HEADERS.length);

  return {
    ok: true,
    message: "Payroll Prep populated for " + rowsToAdd.length + " cleaner(s).",
    addedCount: rowsToAdd.length,
  };
}
/* end[payroll_prep_population_helpers] */
/* begin[payroll_control_helpers] */
function getPayrollControlValues_() {
  const sheet = ensurePayrollControlSheet_();

  const startDate = coerceToDate_(sheet.getRange("B2").getValue());
  const endDate = coerceToDate_(sheet.getRange("B3").getValue());
  const cleanerName = safeStr_(sheet.getRange("B4").getValue()) || "All Cleaners";

  if (!startDate) {
    throw new Error('Payroll Control B2 "Start Date" is blank or invalid.');
  }

  if (!endDate) {
    throw new Error('Payroll Control B3 "End Date" is blank or invalid.');
  }

  if (startOfDay_(startDate).getTime() > startOfDay_(endDate).getTime()) {
    throw new Error('Payroll Control date range is invalid. Start Date is after End Date.');
  }

  return {
    startDate: startOfDay_(startDate),
    endDate: endOfDay_(endDate),
    cleanerName: cleanerName,
  };
}

function refreshPayrollCleanerDropdown_() {
  const sheet = ensurePayrollControlSheet_();
  const cleanerCell = sheet.getRange("B4");

  const cleanerOptions = ["All Cleaners"].concat(getPayrollCleanerNames_());

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(cleanerOptions, true)
    .setAllowInvalid(false)
    .build();

  cleanerCell.setDataValidation(rule);

  if (!safeStr_(cleanerCell.getValue())) {
    cleanerCell.setValue("All Cleaners");
  }
}

function stampPayrollGeneratedAt_() {
  const sheet = ensurePayrollControlSheet_(false);
  sheet.getRange("B5").setValue(new Date());
  sheet.getRange("B5").setNumberFormat("m/d/yyyy h:mm am/pm");
}

function getPayrollCleanerNames_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);
  }

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return getPayrollCanonicalCleanerNames_();
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);

  const uniqueNames = {};

  data.slice(1).forEach(function (row) {
    const name = normalizePayrollCleanerName_(row[idx["Name"]]);
    if (name) {
      uniqueNames[name] = true;
    }
  });

  getPayrollCanonicalCleanerNames_().forEach(function (name) {
    uniqueNames[name] = true;
  });

  return Object.keys(uniqueNames).sort();
}
/* end[payroll_control_helpers] */

/* begin[payroll_cleaner_name_normalization_helpers] */
function getPayrollCanonicalCleanerNames_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(USERS_SHEET_NAME);

  if (!sheet) {
    return [];
  }

  ensureHeaders_(sheet, USERS_SHEET_COLUMNS);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map(String);
  const idx = {
    name: headers.indexOf("Name"),
    isActive: headers.indexOf("Is Active"),
  };

  if ([idx.name, idx.isActive].includes(-1)) {
    return [];
  }

  const names = [];
  const seen = {};

  values.slice(1).forEach(function (row) {
    if (!normalizeActiveFlag_(row[idx.isActive])) return;

    const name = safeStr_(row[idx.name]).trim();
    if (!name || seen[name]) return;

    seen[name] = true;
    names.push(name);
  });

  return names.sort();
}

function normalizePayrollCleanerToken_(text) {
  return safeStr_(text)
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePayrollCleanerName_(name, canonicalNames) {
  const raw = safeStr_(name).trim();
  if (!raw) return "";

  const availableCanonicalNames = Array.isArray(canonicalNames)
    ? canonicalNames
    : getPayrollCanonicalCleanerNames_();

  const exactMatch = availableCanonicalNames.find(function (candidate) {
    return normalizePayrollCleanerToken_(candidate) === normalizePayrollCleanerToken_(raw);
  });

  if (exactMatch) {
    return exactMatch;
  }

  const parts = raw.replace(/\./g, "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const firstName = parts[0].toLowerCase();
    const lastInitial = parts[1].charAt(0).toLowerCase();

    const initialMatch = availableCanonicalNames.find(function (candidate) {
      const candidateParts = safeStr_(candidate).replace(/\./g, "").split(/\s+/).filter(Boolean);
      if (candidateParts.length < 2) return false;

      return (
        candidateParts[0].toLowerCase() === firstName &&
        candidateParts[1].charAt(0).toLowerCase() === lastInitial
      );
    });

    if (initialMatch) {
      return initialMatch;
    }
  }

  return raw;
}
/* end[payroll_cleaner_name_normalization_helpers] */

/* begin[payroll_rate_helpers] */
function getPayrollSheetValues_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  return sheet ? sheet.getDataRange().getValues() : [];
}

function getPayrollLookupData_() {
  return {
    canonicalNames: getPayrollCanonicalCleanerNames_(),
    prepValues: getPayrollSheetValues_(PAYROLL_PREP_SHEET_NAME),
    defaultsValues: getPayrollSheetValues_(PAYROLL_DEFAULTS_SHEET_NAME),
  };
}

function getPayrollDefaultsForCleaner_(cleanerName, lookupData) {
  const canonicalNames = lookupData ? lookupData.canonicalNames : null;
  const normalizedCleaner = normalizePayrollCleanerName_(
    cleanerName,
    canonicalNames
  );
  if (!normalizedCleaner) {
    return { rate: null, minHours: null };
  }

  const values = lookupData
    ? lookupData.defaultsValues
    : getPayrollSheetValues_(PAYROLL_DEFAULTS_SHEET_NAME);
  if (values.length < 2) {
    return { rate: null, minHours: null };
  }

  const headers = values[0].map(String);
  const idx = {
    cleaner: headers.indexOf("Cleaner"),
    rate: headers.indexOf("Default Pay Rate"),
    min: headers.indexOf("Default Daily Min Hours"),
  };

  if ([idx.cleaner, idx.rate, idx.min].includes(-1)) {
    return { rate: null, minHours: null };
  }

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowCleaner = normalizePayrollCleanerName_(
      row[idx.cleaner],
      canonicalNames
    );

    if (rowCleaner !== normalizedCleaner) continue;

    return {
      rate: row[idx.rate] === "" ? null : Number(row[idx.rate]),
      minHours: row[idx.min] === "" ? null : Number(row[idx.min]),
    };
  }

  return { rate: null, minHours: null };
}

function getPayrollRateForCleaner_(cleanerName, startDate, endDate, lookupData) {
  const prep = getPayrollPrepForCleaner_(
    cleanerName,
    startDate,
    endDate,
    lookupData
  );
  if (prep && prep.rate != null) {
    return prep.rate;
  }

  const defaults = getPayrollDefaultsForCleaner_(cleanerName, lookupData);
  if (defaults.rate != null) {
    return defaults.rate;
  }

  return DEFAULT_RATE;
}

function calculatePayrollAmount_(hours, rate) {
  return round2_(Number(hours || 0) * Number(rate || 0));
}
/* end[payroll_rate_helpers] */

function getPayrollDailyMinimumHoursForCleaner_(cleanerName, startDate, endDate, lookupData) {
  const prep = getPayrollPrepForCleaner_(
    cleanerName,
    startDate,
    endDate,
    lookupData
  );
  if (prep && prep.minHours != null) {
    return prep.minHours;
  }

  const defaults = getPayrollDefaultsForCleaner_(cleanerName, lookupData);
  if (defaults.minHours != null) {
    return defaults.minHours;
  }

  return DEFAULT_PAYROLL_DAILY_MIN_HOURS;
}

function shortPayrollProperty_(property) {
  const text = safeStr_(property);
  if (!text) return "";

  const commaIndex = text.indexOf(",");
  if (commaIndex === -1) {
    return text.trim();
  }

  return text.slice(0, commaIndex).trim();
}

function formatPayrollDecimalHoursDisplay_(actualHours, adjustedHours) {
  const actual = round2_(Number(actualHours || 0));
  const adjusted = adjustedHours === undefined || adjustedHours === null
    ? actual
    : round2_(Number(adjustedHours || 0));

  if (adjusted > actual) {
    return actual.toFixed(2) + " → " + adjusted.toFixed(2);
  }

  return actual.toFixed(2);
}

function formatPayrollMoneyCell_(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }

  return money_(Number(value || 0));
}
function formatPayrollPdfTextCell_(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }

  return "'" + String(value);
}

function groupPayrollShiftsByWorkDate_(cleanerShifts) {
  const grouped = {};

  cleanerShifts.forEach(function (shift) {
    const key = safeStr_(shift.workDateKey);
    if (!grouped[key]) {
      grouped[key] = [];
    }

    grouped[key].push(shift);
  });

  return Object.keys(grouped)
    .sort()
    .map(function (key) {
      const dayShifts = grouped[key].slice().sort(function (a, b) {
        return a.clockIn.getTime() - b.clockIn.getTime();
      });

      return {
        workDateKey: key,
        shifts: dayShifts,
      };
    });
}

function buildPayrollDailySummaries_(cleanerShifts, hourlyRate, cleanerName, startDate, endDate, lookupData) {
  const dailyMinimumHours = getPayrollDailyMinimumHoursForCleaner_(
    cleanerName,
    startDate,
    endDate,
    lookupData
  );

  return groupPayrollShiftsByWorkDate_(cleanerShifts).map(function (dayGroup) {
    const dayShiftHours = round2_(dayGroup.shifts.reduce(function (sum, shift) {
      return sum + Number(shift.shiftHours || 0);
    }, 0));

    const dayTransitHours = round2_(dayGroup.shifts.reduce(function (sum, shift) {
      return sum + Number(shift.transitHours || 0);
    }, 0));

    const dayActualHours = round2_(dayShiftHours + dayTransitHours);
    const dayPaidHours = round2_(Math.max(dayActualHours, dailyMinimumHours));
    const dayGuaranteeHours = round2_(dayPaidHours - dayActualHours);

    return {
      workDateKey: dayGroup.workDateKey,
      shifts: dayGroup.shifts,
      dailyMinimumHours: dailyMinimumHours,
      dayShiftHours: dayShiftHours,
      dayTransitHours: dayTransitHours,
      dayActualHours: dayActualHours,
      dayPaidHours: dayPaidHours,
      dayGuaranteeHours: dayGuaranteeHours,
      dayShiftPayActual: calculatePayrollAmount_(dayShiftHours, hourlyRate),
      dayTransitPayActual: calculatePayrollAmount_(dayTransitHours, hourlyRate),
      dayActualPay: calculatePayrollAmount_(dayActualHours, hourlyRate),
      dayPaidPay: calculatePayrollAmount_(dayPaidHours, hourlyRate),
      dayGuaranteePay: calculatePayrollAmount_(dayGuaranteeHours, hourlyRate),
    };
  });
}
/* end[payroll_display_and_minimum_helpers] */

/* begin[payroll_data_builders] */
function buildPayrollPreviewData_(controlValues) {
  const lookupData = getPayrollLookupData_();
  const shifts = getPayrollCompletedShifts_(controlValues, lookupData);
  const grouped = groupPayrollShiftsByCleaner_(shifts);

  return Object.keys(grouped).sort().map(function (cleanerName) {
    const cleanerShifts = grouped[cleanerName];
    const hourlyRate = getPayrollRateForCleaner_(
      cleanerName,
      controlValues.startDate,
      controlValues.endDate,
      lookupData
    );
    const rows = buildPayrollRowsForCleaner_(
      cleanerShifts,
      controlValues,
      hourlyRate,
      lookupData
    );
    const totals = buildPayrollTotalsForCleaner_(
      cleanerShifts,
      hourlyRate,
      controlValues.startDate,
      controlValues.endDate,
      lookupData
    );

    return {
      cleanerName: cleanerName,
      hourlyRate: hourlyRate,
      rows: rows,
      totals: totals,
    };
  });
}

function getPayrollCompletedShifts_(controlValues, lookupData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);
  }

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);
  ensureTransitColumns_(sheet);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return [];
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);
  const transitIdx = getTransitColumnIndexes_(headers);
  const canonicalCleanerNames = lookupData
    ? lookupData.canonicalNames
    : getPayrollCanonicalCleanerNames_();
  const selectedCleaner = controlValues.cleanerName === "All Cleaners"
    ? ""
    : normalizePayrollCleanerName_(
      controlValues.cleanerName,
      canonicalCleanerNames
    );

  return data.slice(1)
    .map(function (row) {
      const name = normalizePayrollCleanerName_(
        row[idx["Name"]],
        canonicalCleanerNames
      );
      const property = safeStr_(row[idx["Property"]]);
      const dateValue = coerceToDate_(row[idx["Date"]]);
      const clockIn = coerceToDate_(row[idx["Clock In"]]);
      const clockOut = coerceToDate_(row[idx["Clock Out"]]);
      const totalHoursCell = row[idx["Total Hours"]];
      const outNote = safeStr_(row[idx["Clock Out Note"]]);

      if (!name || !property || !dateValue || !clockIn || !clockOut) {
        return null;
      }

      const rowDay = startOfDay_(dateValue);
      if (rowDay.getTime() < startOfDay_(controlValues.startDate).getTime()) {
        return null;
      }

      if (rowDay.getTime() > startOfDay_(controlValues.endDate).getTime()) {
        return null;
      }

      if (
        selectedCleaner &&
        name !== selectedCleaner
      ) {
        return null;
      }

      const shiftHours = round2_(computeHours_(clockIn, clockOut, totalHoursCell));
      const transitMinutes = Math.round(Number(row[transitIdx.minutes] || 0));
      const transitHours = round2_(Number(row[transitIdx.hours] || 0));

      return {
        cleanerName: name,
        property: property,
        workDate: rowDay,
        workDateKey: formatYMD_(rowDay),
        dayLabel: Utilities.formatDate(rowDay, Session.getScriptTimeZone(), "EEE"),
        clockIn: clockIn,
        clockOut: clockOut,
        clockInText: formatTime_(clockIn),
        clockOutText: formatTime_(clockOut),
        shiftHours: shiftHours,
        shiftHoursText: formatHoursHMM_(shiftHours),
        transitMinutes: transitMinutes,
        transitHours: transitHours,
        transitHoursText: formatHoursHMM_(transitHours),
        notes: outNote,
      };
    })
    .filter(function (entry) {
      return !!entry;
    })
    .sort(function (a, b) {
      if (a.cleanerName !== b.cleanerName) {
        return a.cleanerName.localeCompare(b.cleanerName);
      }

      if (a.workDate.getTime() !== b.workDate.getTime()) {
        return a.workDate.getTime() - b.workDate.getTime();
      }

      return a.clockIn.getTime() - b.clockIn.getTime();
    });
}

function groupPayrollShiftsByCleaner_(shifts) {
  const grouped = {};

  shifts.forEach(function (shift) {
    if (!grouped[shift.cleanerName]) {
      grouped[shift.cleanerName] = [];
    }

    grouped[shift.cleanerName].push(shift);
  });

  return grouped;
}

function buildPayrollRowsForCleaner_(cleanerShifts, controlValues, hourlyRate, lookupData) {
  const rows = [];
  const cleanerName = cleanerShifts.length ? cleanerShifts[0].cleanerName : "";
  const dailySummaries = buildPayrollDailySummaries_(
  cleanerShifts,
  hourlyRate,
  cleanerName,
  controlValues.startDate,
  controlValues.endDate,
  lookupData
);
  const periodStartText = Utilities.formatDate(
    controlValues.startDate,
    Session.getScriptTimeZone(),
    "M/d/yyyy"
  );
  const periodEndText = Utilities.formatDate(
    startOfDay_(controlValues.endDate),
    Session.getScriptTimeZone(),
    "M/d/yyyy"
  );

  dailySummaries.forEach(function (daySummary) {
    const dayRows = [];

    daySummary.shifts.forEach(function (shift, index) {
      const workDateText = Utilities.formatDate(
        shift.workDate,
        Session.getScriptTimeZone(),
        "M/d"
      );

      dayRows.push([
        shift.cleanerName,
        periodStartText,
        periodEndText,
        workDateText,
        shift.dayLabel,
        "Shift",
        shortPayrollProperty_(shift.property),
        shift.clockInText,
        shift.clockOutText,
        shift.shiftHours,
        formatPayrollDecimalHoursDisplay_(shift.shiftHours),
        hourlyRate,
        calculatePayrollAmount_(shift.shiftHours, hourlyRate),
        shift.notes,
      ]);

      if (shift.transitMinutes > 0) {
        const nextShift = daySummary.shifts[index + 1];
        const transitEndText =
          nextShift &&
          nextShift.workDateKey === shift.workDateKey &&
          nextShift.clockInText
            ? nextShift.clockInText
            : "";

        dayRows.push([
          shift.cleanerName,
          periodStartText,
          periodEndText,
          workDateText,
          shift.dayLabel,
          "Transit",
          "",
          shift.clockOutText,
          transitEndText,
          shift.transitHours,
          formatPayrollDecimalHoursDisplay_(shift.transitHours),
          hourlyRate,
          calculatePayrollAmount_(shift.transitHours, hourlyRate),
          "",
        ]);
      }
    });

    if (daySummary.dayGuaranteeHours > 0 && dayRows.length) {
      let targetIndex = -1;

      for (let i = dayRows.length - 1; i >= 0; i--) {
        if (dayRows[i][5] === "Shift") {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) {
        targetIndex = dayRows.length - 1;
      }

      dayRows.forEach(function (row, index) {
        row[12] = index === targetIndex ? daySummary.dayPaidPay : "";
      });

      dayRows[targetIndex][10] = formatPayrollDecimalHoursDisplay_(
        daySummary.dayActualHours,
        daySummary.dayPaidHours
      );
    }

    dayRows.forEach(function (row) {
      rows.push(row);
    });
  });

  return rows;
}

function buildPayrollTotalsForCleaner_(cleanerShifts, hourlyRate, startDate, endDate, lookupData) {
  const cleanerName = cleanerShifts.length ? cleanerShifts[0].cleanerName : "";
const dailySummaries = buildPayrollDailySummaries_(
  cleanerShifts,
  hourlyRate,
  cleanerName,
  startDate,
  endDate,
  lookupData
);

  const shiftHours = round2_(dailySummaries.reduce(function (sum, daySummary) {
    return sum + Number(daySummary.dayShiftHours || 0);
  }, 0));

  const transitHours = round2_(dailySummaries.reduce(function (sum, daySummary) {
    return sum + Number(daySummary.dayTransitHours || 0);
  }, 0));

  const actualHours = round2_(dailySummaries.reduce(function (sum, daySummary) {
    return sum + Number(daySummary.dayActualHours || 0);
  }, 0));

  const paidHours = round2_(dailySummaries.reduce(function (sum, daySummary) {
    return sum + Number(daySummary.dayPaidHours || 0);
  }, 0));

  const minimumGuaranteeHours = round2_(paidHours - actualHours);

  const prep = getPayrollPrepForCleaner_(
    cleanerName,
    startDate,
    endDate,
    lookupData
  );
  const gas = prep ? prep.gas : 0;
  const bonus = prep ? prep.bonus : 0;
  const adjustment = prep ? prep.adjustment : 0;

  const shiftPayActual = calculatePayrollAmount_(shiftHours, hourlyRate);
  const transitPayActual = calculatePayrollAmount_(transitHours, hourlyRate);
  const subtotalActual = calculatePayrollAmount_(actualHours, hourlyRate);
  const minimumGuaranteePay = calculatePayrollAmount_(minimumGuaranteeHours, hourlyRate);
  const totalPay = round2_(subtotalActual + minimumGuaranteePay + gas + bonus + adjustment);

  return {
    hourlyRate: round2_(hourlyRate),
    dailyMinimumHours: getPayrollDailyMinimumHoursForCleaner_(
      cleanerName,
      startDate,
      endDate,
      lookupData
    ),
    shiftHours: shiftHours,
    transitHours: transitHours,
    actualHours: actualHours,
    paidHours: paidHours,
    minimumGuaranteeHours: minimumGuaranteeHours,
    gas: gas,
    bonus: bonus,
    adjustment: adjustment,
    shiftPayActual: shiftPayActual,
    transitPayActual: transitPayActual,
    subtotalActual: subtotalActual,
    minimumGuaranteePay: minimumGuaranteePay,
    totalPay: totalPay,
    shiftHoursText: formatHoursHMM_(shiftHours),
    transitHoursText: formatHoursHMM_(transitHours),
    actualHoursText: formatHoursHMM_(actualHours),
    paidHoursText: formatHoursHMM_(paidHours),
    minimumGuaranteeHoursText: formatHoursHMM_(minimumGuaranteeHours),
  };
}
/* end[payroll_data_builders] */


/* begin[payroll_preview_writer] */
function writePayrollPreview_(payrollData, controlValues) {
  const sheet = ensurePayrollPreviewSheet_(false);
  const previousRowCount = Math.max(sheet.getLastRow(), 1);
  sheet.getRange(1, 1, previousRowCount, PAYROLL_PREVIEW_HEADERS.length)
    .clearContent();

  let outputRows = [];
  outputRows.push(PAYROLL_PREVIEW_HEADERS);

  if (!payrollData.length) {
    outputRows.push([
      "",
      Utilities.formatDate(controlValues.startDate, Session.getScriptTimeZone(), "M/d/yyyy"),
      Utilities.formatDate(startOfDay_(controlValues.endDate), Session.getScriptTimeZone(), "M/d/yyyy"),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "No completed shifts found for this payroll range.",
    ]);

    sheet.getRange(1, 1, outputRows.length, PAYROLL_PREVIEW_HEADERS.length)
      .setValues(outputRows);

    formatWrittenPayrollPreviewSheet_(sheet, outputRows.length);
    return;
  }

  payrollData.forEach(function (cleanerBlock) {
    outputRows.push([
      cleanerBlock.cleanerName,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);

    cleanerBlock.rows.forEach(function (row) {
      outputRows.push(row);
    });

    outputRows.push([
      cleanerBlock.cleanerName,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      cleanerBlock.totals.shiftHours,
      "Shift Pay (Actual)",
      cleanerBlock.totals.hourlyRate,
      cleanerBlock.totals.shiftPayActual,
      "",
    ]);

   if (cleanerBlock.totals.transitPayActual > 0) {
  outputRows.push([
    cleanerBlock.cleanerName,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    cleanerBlock.totals.transitHours,
    "Transit Pay (Actual)",
    cleanerBlock.totals.hourlyRate,
    cleanerBlock.totals.transitPayActual,
    "",
  ]);
}

    outputRows.push([
      cleanerBlock.cleanerName,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      cleanerBlock.totals.actualHours,
      "Subtotal (Actual)",
      cleanerBlock.totals.hourlyRate,
      cleanerBlock.totals.subtotalActual,
      "",
    ]);

    outputRows.push([
      cleanerBlock.cleanerName,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      cleanerBlock.totals.minimumGuaranteeHours,
      "Minimum Guarantee Added",
      cleanerBlock.totals.hourlyRate,
      cleanerBlock.totals.minimumGuaranteePay,
      "",
    ]);

    outputRows.push([
      cleanerBlock.cleanerName,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Gas",
      "",
      cleanerBlock.totals.gas,
      "",
    ]);

    outputRows.push([
      cleanerBlock.cleanerName,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Bonus",
      "",
      cleanerBlock.totals.bonus,
      "",
    ]);

    outputRows.push([
      cleanerBlock.cleanerName,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Adjustment",
      "",
      cleanerBlock.totals.adjustment,
      "",
    ]);

    outputRows.push([
      cleanerBlock.cleanerName,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      cleanerBlock.totals.paidHours,
      "Total Pay",
      cleanerBlock.totals.hourlyRate,
      cleanerBlock.totals.totalPay,
      "",
    ]);

    outputRows.push(new Array(PAYROLL_PREVIEW_HEADERS.length).fill(""));
  });

  sheet.getRange(1, 1, outputRows.length, PAYROLL_PREVIEW_HEADERS.length)
    .setValues(outputRows);

  formatWrittenPayrollPreviewSheet_(sheet, outputRows.length);
}

function formatWrittenPayrollPreviewSheet_(sheet, rowCount) {
  sheet.setFrozenRows(1);

  sheet.getRange(1, 1, 1, PAYROLL_PREVIEW_HEADERS.length).setFontWeight("bold");
  if (rowCount > 1) {
    const dataRowCount = rowCount - 1;
    sheet.getRange(2, 2, dataRowCount, 2).setNumberFormat("m/d/yyyy");
    sheet.getRange(2, 12, dataRowCount, 2).setNumberFormat("$0.00");
    sheet.getRange(2, 10, dataRowCount, 4).setHorizontalAlignment("right");
  }
  sheet.autoResizeColumns(1, PAYROLL_PREVIEW_HEADERS.length);
}
/* end[payroll_preview_writer] */


/* begin[payroll_pdf_generation] */
function generatePayrollPdfs_() {
  const controlValues = getPayrollControlValues_();
  const payrollData = buildPayrollPreviewData_(controlValues);

  if (!payrollData.length) {
    throw new Error("No completed shifts found for this payroll range.");
  }

  const folder = getOrCreatePayrollPdfFolder_();
  const tempSheet = ensurePayrollPdfTempSheet_();
  const createdFiles = [];
  const wasHidden = tempSheet.isSheetHidden();

  try {
    if (wasHidden) {
      tempSheet.showSheet();
    }

    payrollData.forEach(function (cleanerBlock) {
      buildPayrollPdfSheetForCleaner_(tempSheet, cleanerBlock, controlValues);
      SpreadsheetApp.flush();
      Utilities.sleep(1200);

      const fileName = buildPayrollPdfFileName_(cleanerBlock, controlValues);
      const createdFile = createPayrollOutputFile_(tempSheet, folder, fileName);
      createdFiles.push(createdFile);
    });
  } finally {
    if (wasHidden && !tempSheet.isSheetHidden()) {
      tempSheet.hideSheet();
    }
  }

  stampPayrollGeneratedAt_();

  return createdFiles.map(function (file) {
    return {
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
    };
  });
}

function getOrCreatePayrollPdfFolder_() {
  const folders = DriveApp.getFoldersByName(PAYROLL_PDF_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }

  return DriveApp.createFolder(PAYROLL_PDF_FOLDER_NAME);
}

function ensurePayrollPdfTempSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PAYROLL_PDF_TEMP_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PAYROLL_PDF_TEMP_SHEET_NAME);
  }

  sheet.hideSheet();
  return sheet;
}

function buildPayrollPdfSheetForCleaner_(sheet, cleanerBlock, controlValues) {
  sheet.clear();
  sheet.clearFormats();

  const periodStartText = Utilities.formatDate(
    controlValues.startDate,
    Session.getScriptTimeZone(),
    "M/d/yyyy"
  );
  const periodEndText = Utilities.formatDate(
    startOfDay_(controlValues.endDate),
    Session.getScriptTimeZone(),
    "M/d/yyyy"
  );

  const title = "Payroll Summary";
  const cleanerName = cleanerBlock.cleanerName;
  const totals = cleanerBlock.totals;

  const headerRows = [
    ["Clean Energy Housekeeping, LLC", "", "", "", "", "", "", ""],
    [title, "", "", "", "", "", "", ""],
    ["Cleaner: " + cleanerName, "", "", "", "", "", "", ""],
    ["Period: " + periodStartText + " - " + periodEndText, "", "", "", "", "", "", ""],
    ["Hourly: " + money_(totals.hourlyRate), "", "", "", "", "", "", ""],
    ["Daily Minimum: " + totals.dailyMinimumHours.toFixed(2) + " hrs", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["Date", "Day", "Type", "Property", "Start", "End", "Hours", "Pay"],
  ];

  sheet.getRange(1, 1, headerRows.length, 8).setValues(headerRows);

  let previousWorkDate = "";
  let previousDay = "";

  const detailRows = cleanerBlock.rows.map(function (row) {
    const workDate = String(row[3] || "");
    const dayText = String(row[4] || "");
    const isSameDay = workDate === previousWorkDate && dayText === previousDay;

    const outputRow = [
      isSameDay ? "" : workDate,
      isSameDay ? "" : dayText,
      row[5],
      row[6],
      String(row[7] || ""),
      String(row[8] || ""),
      formatPayrollPdfTextCell_(row[10]),
      formatPayrollPdfTextCell_(formatPayrollMoneyCell_(row[12])),
    ];

    previousWorkDate = workDate;
    previousDay = dayText;

    return outputRow;
  });

  const tableHeaderRow = headerRows.length;
  const detailStartRow = tableHeaderRow + 1;

  if (detailRows.length) {
    sheet.getRange(detailStartRow, 1, detailRows.length, 8).setValues(detailRows);
    sheet.getRange(detailStartRow, 7, detailRows.length, 2).setNumberFormat("@");
  } else {
    sheet.getRange(detailStartRow, 1, 1, 8).setValues([
      ["", "", "", "", "", "", "No entries found.", ""]
    ]);
    sheet.getRange(detailStartRow, 7, 1, 2).setNumberFormat("@");
  }

  const hasMinimumGuaranteeAdjustment = Number(totals.minimumGuaranteePay || 0) !== 0;

  const summaryRows = [];

  if (hasMinimumGuaranteeAdjustment) {
    summaryRows.push([
      "", "", "", "", "", "Total Hours (Actual)", "",
      formatPayrollPdfTextCell_(totals.actualHours.toFixed(2) + " hrs")
    ]);
  }

 summaryRows.push(
  ["", "", "", "", "", hasMinimumGuaranteeAdjustment ? "Total Hours (Paid)" : "Total Hours", "", formatPayrollPdfTextCell_(totals.paidHours.toFixed(2) + " hrs")],
  ["", "", "", "", "", "Shift Pay (Actual)", "", formatPayrollPdfTextCell_(money_(totals.shiftPayActual))]
);

if (Number(totals.transitPayActual || 0) !== 0) {
  summaryRows.push([
    "", "", "", "", "", "Transit Pay (Actual)", "",
    formatPayrollPdfTextCell_(money_(totals.transitPayActual))
  ]);
}

summaryRows.push(
  ["", "", "", "", "", "Subtotal (Actual)", "", formatPayrollPdfTextCell_(money_(totals.subtotalActual))]
);
  if (Number(totals.minimumGuaranteePay || 0) !== 0) {
    summaryRows.push(["", "", "", "", "", "Minimum Guarantee Added", "", formatPayrollPdfTextCell_(money_(totals.minimumGuaranteePay))]);
  }

  if (Number(totals.gas || 0) !== 0) {
    summaryRows.push(["", "", "", "", "", "Gas", "", formatPayrollPdfTextCell_(money_(totals.gas))]);
  }

  if (Number(totals.bonus || 0) !== 0) {
    summaryRows.push(["", "", "", "", "", "Bonus", "", formatPayrollPdfTextCell_(money_(totals.bonus))]);
  }

  if (Number(totals.adjustment || 0) !== 0) {
    summaryRows.push(["", "", "", "", "", "Adjustment", "", formatPayrollPdfTextCell_(money_(totals.adjustment))]);
  }

  summaryRows.push(["", "", "", "", "", "Total Pay", "", formatPayrollPdfTextCell_(money_(totals.totalPay))]);

  const summaryStartRow = detailStartRow + Math.max(detailRows.length, 1) + 1;
  sheet.getRange(summaryStartRow, 1, summaryRows.length, 8).setValues(summaryRows);
  sheet.getRange(summaryStartRow, 7, summaryRows.length, 2).setNumberFormat("@");

  formatPayrollPdfSheet_(sheet, tableHeaderRow, detailStartRow, summaryStartRow, summaryRows.length);
}


function padRowsToWidth_(rows, width) {
  return rows.map(function (row) {
    const copy = row.slice();
    while (copy.length < width) {
      copy.push("");
    }
    return copy;
  });
}

function formatPayrollPdfSheet_(sheet, tableHeaderRow, detailStartRow, summaryStartRow, summaryRowCount) {
  const lastDataRow = summaryStartRow + summaryRowCount - 1;
  const detailRowCount = Math.max(summaryStartRow - detailStartRow - 1, 1);

  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(tableHeaderRow);

  sheet.setColumnWidths(1, 1, 42);   // Date
  sheet.setColumnWidths(2, 1, 56);   // Day
  sheet.setColumnWidths(3, 1, 63);   // Type
  sheet.setColumnWidths(4, 1, 200);  // Property
  sheet.setColumnWidths(5, 1, 82);   // Start
  sheet.setColumnWidths(6, 1, 82);   // End
  sheet.setColumnWidths(7, 1, 108);  // Hours
  sheet.setColumnWidths(8, 1, 88);   // Pay

  sheet.getRange("A1:H1")
    .merge()
    .setFontSize(15)
    .setFontWeight("bold")
    .setHorizontalAlignment("left");

  sheet.getRange("A2:H2")
    .merge()
    .setFontSize(18)
    .setFontWeight("bold")
    .setHorizontalAlignment("left");

  sheet.getRange("A3:H6")
    .mergeAcross()
    .setFontWeight("normal")
    .setFontSize(11)
    .setHorizontalAlignment("left")
    .setWrap(true);

  sheet.getRange(tableHeaderRow, 1, 1, 8)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#23343b")
    .setWrap(true)
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle")
    .setFontSize(11);

  if (detailRowCount > 0) {
    sheet.getRange(detailStartRow, 1, detailRowCount, 8)
      .setVerticalAlignment("middle")
      .setWrap(true)
      .setFontFamily("Arial")
      .setFontSize(10);
  }

  sheet.getRange(detailStartRow, 5, detailRowCount, 2).setNumberFormat("@");
  sheet.getRange(detailStartRow, 7, detailRowCount, 2).setHorizontalAlignment("right");
  sheet.getRange(detailStartRow, 1, detailRowCount, 6).setHorizontalAlignment("left");
  sheet.getRange(detailStartRow, 7, detailRowCount, 1).setWrap(false);
  sheet.getRange(detailStartRow, 8, detailRowCount, 1).setWrap(false);

  sheet.getRange(1, 1, lastDataRow, 8).setFontFamily("Arial");

  sheet.getRange(tableHeaderRow, 1, 1, 8)
    .setBorder(true, true, true, true, true, true);

  if (detailRowCount > 0) {
    sheet.getRange(detailStartRow, 1, detailRowCount, 8)
      .setBorder(false, false, false, false, true, true);
  }

  const effectiveDayKeys = [];
  let lastSeenDateText = "";
  let lastSeenDayText = "";

  for (let row = detailStartRow; row < detailStartRow + detailRowCount; row++) {
    const rawDateText = safeStr_(sheet.getRange(row, 1).getDisplayValue());
    const rawDayText = safeStr_(sheet.getRange(row, 2).getDisplayValue());

    if (rawDateText) {
      lastSeenDateText = rawDateText;
    }

    if (rawDayText) {
      lastSeenDayText = rawDayText;
    }

    effectiveDayKeys.push(lastSeenDateText + "|" + lastSeenDayText);
  }

  let groupStartOffset = 0;
  let shadeToggle = false;

  while (groupStartOffset < detailRowCount) {
    const groupKey = effectiveDayKeys[groupStartOffset];
    let groupEndOffset = groupStartOffset;

    while (
      groupEndOffset + 1 < detailRowCount &&
      effectiveDayKeys[groupEndOffset + 1] === groupKey
    ) {
      groupEndOffset++;
    }

    shadeToggle = !shadeToggle;
    const rowBackground = shadeToggle ? "#ececec" : "#ffffff";

    for (let offset = groupStartOffset; offset <= groupEndOffset; offset++) {
      const row = detailStartRow + offset;
      const entryType = safeStr_(sheet.getRange(row, 3).getDisplayValue());

      sheet.getRange(row, 1, 1, 8).setBackground(rowBackground);

      if (entryType === "Transit") {
        sheet.getRange(row, 1, 1, 8)
          .setFontStyle("italic")
          .setFontColor("#666666");
      } else {
        sheet.getRange(row, 1, 1, 8)
          .setFontStyle("normal")
          .setFontColor("#000000");
      }

      const isFirstRowInGroup = offset === groupStartOffset;
      const isLastRowInGroup = offset === groupEndOffset;

      sheet.getRange(row, 1, 1, 8).setBorder(
        isFirstRowInGroup,
        true,
        isLastRowInGroup,
        true,
        true,
        false
      );
    }

    groupStartOffset = groupEndOffset + 1;
  }

  if (detailRowCount > 0) {
    sheet.autoResizeRows(detailStartRow, detailRowCount);
  }

  sheet.setRowHeight(tableHeaderRow, 21);

  for (let i = 0; i < summaryRowCount; i++) {
    const row = summaryStartRow + i;
    const isTotalRow = i === summaryRowCount - 1;

    sheet.getRange(row, 6, 1, 2).merge();

    sheet.getRange(row, 6)
      .setFontWeight(isTotalRow ? "bold" : "normal")
      .setHorizontalAlignment("left")
      .setBackground("#ffffff")
      .setFontSize(isTotalRow ? 11 : 10);

    sheet.getRange(row, 8)
      .setFontWeight(isTotalRow ? "bold" : "normal")
      .setHorizontalAlignment("right")
      .setBackground("#ffffff")
      .setFontSize(isTotalRow ? 11 : 10);
  }

  sheet.getRange(summaryStartRow, 1, summaryRowCount, 8)
    .setBorder(false, false, false, false, false, false);

  sheet.getRange(summaryStartRow + summaryRowCount - 1, 6, 1, 3)
    .setBorder(true, false, false, false, false, false);

  sheet.autoResizeRows(summaryStartRow, summaryRowCount);
}

function buildPayrollPdfFileName_(cleanerBlock, controlValues) {
  const periodStartText = Utilities.formatDate(
    controlValues.startDate,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );
  const periodEndText = Utilities.formatDate(
    startOfDay_(controlValues.endDate),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );

  const cleanerSafe = String(cleanerBlock.cleanerName || "Cleaner")
    .replace(/[\\\/:*?"<>|#]+/g, "")
    .trim();

  return "Payroll - " + cleanerSafe + " - " + periodStartText + " to " + periodEndText;
}


function createPayrollOutputFile_(tempSheet, folder, fileNameBase) {
  if (CREATE_PAYROLL_PDFS) {
    const pdfBlob = exportSingleSheetToPdfBlob_(tempSheet, fileNameBase + ".pdf");
    return folder.createFile(pdfBlob);
  }

  return createPayrollEditableSheetFile_(tempSheet, folder, fileNameBase);
}

function createPayrollEditableSheetFile_(tempSheet, folder, fileNameBase) {
  const newSpreadsheet = SpreadsheetApp.create(fileNameBase);
  const destinationSheet = tempSheet.copyTo(newSpreadsheet).setName(PAYROLL_EDITABLE_SHEET_NAME);

  const defaultSheet = newSpreadsheet.getSheets()[0];
  if (defaultSheet.getSheetId() !== destinationSheet.getSheetId()) {
    newSpreadsheet.deleteSheet(defaultSheet);
  }

  const file = DriveApp.getFileById(newSpreadsheet.getId());
  const existingParents = file.getParents();
  while (existingParents.hasNext()) {
    existingParents.next().removeFile(file);
  }
  folder.addFile(file);

  return file;
}

function exportSingleSheetToPdfBlob_(sheet, fileName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const exportUrl =
    "https://docs.google.com/spreadsheets/d/" +
    ss.getId() +
    "/export" +
    "?format=pdf" +
    "&exportFormat=pdf" +
    "&single=true" +
    "&gid=" + sheet.getSheetId() +
    "&portrait=true" +
    "&size=letter" +
    "&fitw=true" +
    "&sheetnames=false" +
    "&printtitle=false" +
    "&pagenumbers=false" +
    "&gridlines=false" +
    "&fzr=false" +
    "&top_margin=0.50" +
    "&bottom_margin=0.50" +
    "&left_margin=0.50" +
    "&right_margin=0.50";

  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(exportUrl, {
    headers: {
      Authorization: "Bearer " + token,
    },
    muteHttpExceptions: false,
  });

  const contentType = String(response.getHeaders()["Content-Type"] || "").toLowerCase();

  if (response.getResponseCode() !== 200) {
    throw new Error(
      "Payroll PDF export failed with HTTP " + response.getResponseCode() + "."
    );
  }

  if (contentType.indexOf("application/pdf") === -1) {
    const bodyText = response.getContentText().slice(0, 300);
    throw new Error(
      "Payroll PDF export did not return a PDF. Response started with: " + bodyText
    );
  }

  return response.getBlob().setName(fileName);
}
/* end[payroll_pdf_generation] */


/* begin[payroll_run_wrappers] */
function runSetupPayroll() {
  setupPayroll_();
}

function runPopulatePayrollPrep() {
  return populatePayrollPrepFromControl_();
}

function runGeneratePayroll() {
  generatePayrollPreview_();
}

function runGeneratePayrollPdfs() {
  return generatePayrollPdfs_();
}
/* end[payroll_run_wrappers] */
