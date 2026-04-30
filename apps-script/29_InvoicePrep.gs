/* begin[invoice_prep_sheet_setup] */
function ensureInvoicePrepSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INVOICE_PREP_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(INVOICE_PREP_SHEET_NAME);
  }

  ensureHeaders_(sheet, INVOICE_PREP_HEADERS);
  sheet.autoResizeColumns(1, INVOICE_PREP_HEADERS.length);
  return sheet;
}

function ensureInvoicePrepSheet() {
  return ensureInvoicePrepSheet_();
}
/* end[invoice_prep_sheet_setup] */


/* begin[invoice_prep_small_helpers] */
function getInvoicePrepIndexMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  return indexMap_(headers, INVOICE_PREP_HEADERS);
}

function normalizePrepBillingMode_(rawValue) {
  const normalized = safeStr_(rawValue).toUpperCase();
  return normalized === BILLING_TYPE_FLAT ? BILLING_TYPE_FLAT : BILLING_TYPE_HOURLY;
}

function buildInvoicePrepId_(group) {
  return [
    formatYMD_(group.serviceDate),
    safeStr_(group.client),
    safeStr_(group.property)
  ].join(" || ");
}

function buildInvoicePrepGroupValue_(group) {
  return [
    safeStr_(group.client),
    formatYMD_(group.serviceDate)
  ].join(" || ");
}

function buildInvoicePrepTimeTrackerKey_(row) {
  const rowDate = coerceToDate_(row.date);
  const inDate = coerceToDate_(row.clockIn);
  const outDate = coerceToDate_(row.clockOut);

  return [
    safeStr_(row.name),
    safeStr_(row.property),
    rowDate ? formatYMD_(rowDate) : "",
    inDate ? String(inDate.getTime()) : "",
    outDate ? String(outDate.getTime()) : ""
  ].join(" || ");
}

function summarizeCleanerNames_(entries) {
  const seen = {};
  const names = [];

  entries.forEach(function (entry) {
    const name = safeStr_(entry.name);
    if (!name || seen[name]) return;
    seen[name] = true;
    names.push(name);
  });

  return names.join(", ");
}

/* begin[build_cleaner_details_summary] */
function buildCleanerDetailsSummary_(entries) {
  const lines = [];

  entries.forEach(function (entry, index) {
    const inStr = formatTime_(entry.clockIn);
    const outStr = formatTime_(entry.clockOut);
    const hoursStr = Number(entry.workedHours || 0).toFixed(2);

    const timeRange = (inStr || outStr)
      ? `${inStr || "?"}–${outStr || "?"}`
      : "";

    const cleanerLine = [entry.name, timeRange, `(${hoursStr})`]
      .filter(function (part) { return !!part; })
      .join(" ");

    if (index > 0) {
      lines.push("");
    }

    lines.push(cleanerLine);

    const splitLines = safeStr_(entry.clockOutNote)
      .split("\n")
      .map(function (line) { return safeStr_(line).trim(); })
      .filter(function (line) { return !!line; });

    if (splitLines.length) {
      lines.push("Notes/extras");
    }

    splitLines.forEach(function (line) {
      lines.push("   • " + line);
    });
  });

  return lines.join("\n");
}
/* end[build_cleaner_details_summary] */

function calculateInvoicePrepFinalAmount_(workedHours, defaultRate, billingMode, flatRate, rowDiscount, rowFee) {
  const hours = Number(workedHours || 0);
  const rate = Number(defaultRate || 0);
  const flat = Number(flatRate || 0);
  const discount = Math.abs(Number(rowDiscount || 0));
  const fee = Math.abs(Number(rowFee || 0));

  let baseAmount = 0;

  if (normalizePrepBillingMode_(billingMode) === BILLING_TYPE_FLAT && flat > 0) {
    baseAmount = flat;
  } else {
    baseAmount = hours * rate;
  }

  return round2_(baseAmount - discount + fee);
}
/* end[invoice_prep_small_helpers] */


/* begin[invoice_prep_group_builder] */
function buildInvoicePrepGroupsFromTimeTracker_(options) {
  const settings = options || {};
  const periodStart = settings.periodStart ? startOfDay_(settings.periodStart) : null;
  const periodEnd = settings.periodEnd ? endOfDay_(settings.periodEnd) : null;
  const clientFilter = safeStr_(settings.clientFilter);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) {
    throw new Error("Sheet not found: " + TIME_SHEET_NAME);
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return [];
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, [
    "Name",
    "Property",
    "Date",
    "Clock In",
    "Clock Out",
    "Total Hours",
    "Clock Out Note",
    "Client"
  ]);

  const grouped = {};

  for (let r = 1; r < data.length; r++) {
    const row = data[r];

    const name = safeStr_(row[idx["Name"]]);
    const property = safeStr_(row[idx["Property"]]);
    const client = safeStr_(row[idx["Client"]]);
    const serviceDate = coerceToDate_(row[idx["Date"]]);

    if (!name || !property || !client || !serviceDate) {
      continue;
    }

    const dateOnly = startOfDay_(serviceDate);

    if (periodStart && dateOnly < periodStart) continue;
    if (periodEnd && dateOnly > periodEnd) continue;
    if (clientFilter && client !== clientFilter) continue;

    const clockIn = row[idx["Clock In"]];
    const clockOut = row[idx["Clock Out"]];
    const totalHoursCell = row[idx["Total Hours"]];
    const workedHours = round2_(computeHours_(clockIn, clockOut, totalHoursCell));

    if (!(workedHours > 0)) {
      continue;
    }

    const groupKey = [
      formatYMD_(dateOnly),
      client,
      property
    ].join(" || ");

    if (!grouped[groupKey]) {
      const defaultHourlyRate = getClientRateFromProperties_(client);
      const propertyBillingConfig = getPropertyBillingConfig_(property, client, defaultHourlyRate);

      grouped[groupKey] = {
        client: client,
        property: property,
        serviceDate: dateOnly,
        entries: [],
        workedHours: 0,
        defaultHourlyRate: Number(propertyBillingConfig.hourlyRate || defaultHourlyRate || DEFAULT_RATE),
        billingMode: normalizePrepBillingMode_(propertyBillingConfig.billingType),
        flatRate: Number(propertyBillingConfig.flatRate || 0)
      };
    }

    const entry = {
      rowNumber: r + 1,
      name: name,
      property: property,
      date: dateOnly,
      clockIn: clockIn,
      clockOut: clockOut,
      clockOutNote: row[idx["Clock Out Note"]],
      workedHours: workedHours
    };

    grouped[groupKey].entries.push(entry);
    grouped[groupKey].workedHours = round2_(grouped[groupKey].workedHours + workedHours);
  }

  const groups = Object.keys(grouped).map(function (key) {
    const group = grouped[key];

    group.entries = sortRowsByDateThenStart_(group.entries);
    group.prepId = buildInvoicePrepId_(group);
    group.invoiceGroup = buildInvoicePrepGroupValue_(group);
    group.cleanerNames = summarizeCleanerNames_(group.entries);
    group.cleanerDetailsSummary = buildCleanerDetailsSummary_(group.entries);
    group.timeTrackerRowKeys = group.entries.map(buildInvoicePrepTimeTrackerKey_).join("\n");
    group.finalBilledAmount = calculateInvoicePrepFinalAmount_(
      group.workedHours,
      group.defaultHourlyRate,
      group.billingMode,
      group.flatRate,
      0,
      0
    );

    return group;
  });

  return groups.sort(function (a, b) {
    const dateDiff = a.serviceDate.getTime() - b.serviceDate.getTime();
    if (dateDiff !== 0) return dateDiff;

    const clientDiff = a.client.localeCompare(b.client);
    if (clientDiff !== 0) return clientDiff;

    return a.property.localeCompare(b.property);
  });
}
/* end[invoice_prep_group_builder] */


/* begin[invoice_prep_existing_row_map] */
function getExistingOpenInvoicePrepRowsByPrepId_(sheet, idx) {
  const lastRow = sheet.getLastRow();
  const existingMap = {};

  if (lastRow < 2) {
    return existingMap;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  values.forEach(function (row, offset) {
    const sheetRow = offset + 2;
    const prepId = safeStr_(row[idx["Prep ID"]]);
    const invoiced = String(row[idx["Invoiced"]] || "").toUpperCase() === "TRUE";

    if (!prepId || invoiced) {
      return;
    }

    existingMap[prepId] = {
      rowNumber: sheetRow,
      rowValues: row
    };
  });

  return existingMap;
}
/* end[invoice_prep_existing_row_map] */


/* begin[invoice_prep_row_writer] */
function writeInvoicePrepRowToSheet_(sheet, idx, rowNumber, group, preserveUserBillingValues) {
  const existingRow = rowNumber
    ? sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]
    : null;

  const billingMode = preserveUserBillingValues && existingRow
    ? normalizePrepBillingMode_(existingRow[idx["Billing Mode"]])
    : group.billingMode;

  const flatRate = preserveUserBillingValues && existingRow
    ? Number(existingRow[idx["Flat Rate"]] || 0)
    : Number(group.flatRate || 0);

  const rowDiscount = preserveUserBillingValues && existingRow
    ? Math.abs(Number(existingRow[idx["Row Discount"]] || 0))
    : 0;

  const rowFee = preserveUserBillingValues && existingRow
    ? Math.abs(Number(existingRow[idx["Row Fee"]] || 0))
    : 0;

  const billingNote = preserveUserBillingValues && existingRow
    ? safeStr_(existingRow[idx["Billing Note"]])
    : "";

  const adjustmentNote = preserveUserBillingValues && existingRow
    ? safeStr_(existingRow[idx["Adjustment Note"]])
    : "";

  const readyValue = preserveUserBillingValues && existingRow
    ? existingRow[idx["Ready"]]
    : "TRUE";

  const invoicedValue = preserveUserBillingValues && existingRow
    ? existingRow[idx["Invoiced"]]
    : "";

  const invoiceNumberValue = preserveUserBillingValues && existingRow
    ? existingRow[idx["Invoice Number"]]
    : "";

  const createdAtValue = preserveUserBillingValues && existingRow && existingRow[idx["Created At"]]
    ? existingRow[idx["Created At"]]
    : new Date();

  const invoicedAtValue = preserveUserBillingValues && existingRow
    ? existingRow[idx["Invoiced At"]]
    : "";

  const finalBilledAmount = calculateInvoicePrepFinalAmount_(
    group.workedHours,
    group.defaultHourlyRate,
    billingMode,
    flatRate,
    rowDiscount,
    rowFee
  );

  const rowOut = new Array(INVOICE_PREP_HEADERS.length).fill("");

  rowOut[idx["Prep ID"]] = group.prepId;
  rowOut[idx["Ready"]] = readyValue;
  rowOut[idx["Invoiced"]] = invoicedValue;
  rowOut[idx["Invoice Number"]] = invoiceNumberValue;
  rowOut[idx["Invoice Group"]] = group.invoiceGroup;
  rowOut[idx["Client"]] = group.client;
  rowOut[idx["Property"]] = group.property;
  rowOut[idx["Service Date"]] = group.serviceDate;
  rowOut[idx["Cleaner Names"]] = group.cleanerNames;
  rowOut[idx["Worked Hours"]] = group.workedHours;
  rowOut[idx["Default Hourly Rate"]] = group.defaultHourlyRate;
  rowOut[idx["Billing Mode"]] = billingMode;
  rowOut[idx["Flat Rate"]] = flatRate > 0 ? flatRate : "";
  rowOut[idx["Row Discount"]] = rowDiscount > 0 ? rowDiscount : "";
  rowOut[idx["Row Fee"]] = rowFee > 0 ? rowFee : "";
  rowOut[idx["Final Billed Amount"]] = finalBilledAmount;
  rowOut[idx["Billing Note"]] = billingNote;
  rowOut[idx["Cleaner Details Summary"]] = group.cleanerDetailsSummary;
  rowOut[idx["Time Tracker Row Keys"]] = group.timeTrackerRowKeys;
  rowOut[idx["Created At"]] = createdAtValue;
  rowOut[idx["Invoiced At"]] = invoicedAtValue;
  rowOut[idx["Adjustment Note"]] = adjustmentNote;

  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, rowOut.length).setValues([rowOut]);
  } else {
    sheet.appendRow(rowOut);
  }
}

function formatInvoicePrepSheetAfterWrite_(sheet, idx) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  sheet.getRange(2, idx["Service Date"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy");
  sheet.getRange(2, idx["Worked Hours"] + 1, lastRow - 1, 1).setNumberFormat("0.00");
  sheet.getRange(2, idx["Default Hourly Rate"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  sheet.getRange(2, idx["Flat Rate"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  sheet.getRange(2, idx["Row Discount"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  sheet.getRange(2, idx["Row Fee"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  sheet.getRange(2, idx["Final Billed Amount"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  sheet.getRange(2, idx["Created At"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy h:mm:ss");
  sheet.getRange(2, idx["Invoiced At"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy h:mm:ss");

  sheet.autoResizeColumns(1, INVOICE_PREP_HEADERS.length);
}
/* end[invoice_prep_row_writer] */


/* begin[invoice_prep_generator] */
function generateInvoicePrepFromTimeTracker_() {
  const control = getInvoiceControlValues_();

  const prepSheet = ensureInvoicePrepSheet_();
  const prepIdx = getInvoicePrepIndexMap_(prepSheet);

  const lastRow = prepSheet.getLastRow();
  const lastColumn = prepSheet.getLastColumn();

  if (lastRow > 1) {
    prepSheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
  }

  const groups = buildInvoicePrepGroupsFromTimeTracker_({
    periodStart: control.periodStart,
    periodEnd: control.periodEnd,
    clientFilter: control.clientFilter,
  });

  groups.forEach(function (group) {
    writeInvoicePrepRowToSheet_(prepSheet, prepIdx, null, group, false);
  });

  formatInvoicePrepSheetAfterWrite_(prepSheet, prepIdx);

  Logger.log(
    "Invoice Prep rebuilt from Invoice Control date range. Inserted: " +
      groups.length +
      " | Period: " +
      formatYMD_(control.periodStart) +
      " to " +
      formatYMD_(control.periodEnd)
  );
}

function generateInvoicePrepFromTimeTracker() {
  return generateInvoicePrepFromTimeTracker_();
}
/* end[invoice_prep_generator] */

/* begin[invoice_prep_ready_helpers] */
function isTruthyInvoicePrepValue_(value) {
  if (value === true) return true;

  const normalized = safeStr_(value).trim().toUpperCase();
  return (
    normalized === "TRUE" ||
    normalized === "YES" ||
    normalized === "Y" ||
    normalized === "1" ||
    normalized === "READY"
  );
}

function getOpenReadyInvoicePrepGroups_() {
  const prepSheet = ensureInvoicePrepSheet_();
  const prepIdx = getInvoicePrepIndexMap_(prepSheet);
  const lastRow = prepSheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const values = prepSheet.getRange(2, 1, lastRow - 1, prepSheet.getLastColumn()).getValues();
  const grouped = {};

  values.forEach(function (row, offset) {
    const sheetRow = offset + 2;

    const ready = isTruthyInvoicePrepValue_(row[prepIdx["Ready"]]);
    const invoiced = isTruthyInvoicePrepValue_(row[prepIdx["Invoiced"]]);

    if (!ready || invoiced) {
      return;
    }

    const client = safeStr_(row[prepIdx["Client"]]);
    const invoiceGroup = safeStr_(row[prepIdx["Invoice Group"]]);
    const property = safeStr_(row[prepIdx["Property"]]);
    const serviceDate = coerceToDate_(row[prepIdx["Service Date"]]);

    if (!client || !invoiceGroup || !property || !serviceDate) {
      return;
    }

    const groupKey = client + " || " + invoiceGroup;

    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        clientName: client,
        invoiceGroup: invoiceGroup,
        rows: [],
      };
    }

    grouped[groupKey].rows.push({
      sheetRow: sheetRow,
      prepId: safeStr_(row[prepIdx["Prep ID"]]),
      ready: row[prepIdx["Ready"]],
      invoiced: row[prepIdx["Invoiced"]],
      invoiceNumber: safeStr_(row[prepIdx["Invoice Number"]]),
      client: client,
      invoiceGroup: invoiceGroup,
      property: property,
      serviceDate: startOfDay_(serviceDate),
      cleanerNames: safeStr_(row[prepIdx["Cleaner Names"]]),
      workedHours: Number(row[prepIdx["Worked Hours"]] || 0),
      defaultHourlyRate: Number(row[prepIdx["Default Hourly Rate"]] || 0),
      billingMode: normalizePrepBillingMode_(row[prepIdx["Billing Mode"]]),
      flatRate: Number(row[prepIdx["Flat Rate"]] || 0),
      rowDiscount: Math.abs(Number(row[prepIdx["Row Discount"]] || 0)),
      rowFee: Math.abs(Number(row[prepIdx["Row Fee"]] || 0)),
      finalBilledAmount: Number(row[prepIdx["Final Billed Amount"]] || 0),
      billingNote: safeStr_(row[prepIdx["Billing Note"]]),
      cleanerDetailsSummary: safeStr_(row[prepIdx["Cleaner Details Summary"]]),
      timeTrackerRowKeys: safeStr_(row[prepIdx["Time Tracker Row Keys"]]),
      adjustmentNote: safeStr_(row[prepIdx["Adjustment Note"]]),
    });
  });

  return Object.keys(grouped)
    .map(function (key) {
      const group = grouped[key];

      group.rows.sort(function (a, b) {
        const dateDiff = a.serviceDate.getTime() - b.serviceDate.getTime();
        if (dateDiff !== 0) return dateDiff;
        return a.property.localeCompare(b.property);
      });

      return group;
    })
    .sort(function (a, b) {
      const clientDiff = a.clientName.localeCompare(b.clientName);
      if (clientDiff !== 0) return clientDiff;

      const aDate = a.rows.length ? a.rows[0].serviceDate.getTime() : 0;
      const bDate = b.rows.length ? b.rows[0].serviceDate.getTime() : 0;
      return aDate - bDate;
    });
}
/* end[invoice_prep_ready_helpers] */

/* begin[invoice_prep_archive_and_reset_tools] */
function ensureInvoicePrepArchiveSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INVOICE_PREP_ARCHIVE_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(INVOICE_PREP_ARCHIVE_SHEET_NAME);
  }

  const archiveHeaders = INVOICE_PREP_HEADERS.concat([
    "Archived At",
    "Archive Reason"
  ]);

  ensureHeaders_(sheet, archiveHeaders);
  sheet.autoResizeColumns(1, archiveHeaders.length);
  return sheet;
}

function getInvoicedInvoicePrepRowsForArchive_(sheet, idx) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  return values
    .map(function (row, offset) {
      return {
        rowNumber: offset + 2,
        rowValues: row,
      };
    })
    .filter(function (item) {
      return isTruthyInvoicePrepValue_(item.rowValues[idx["Invoiced"]]);
    });
}

function appendInvoicePrepRowsToArchive_(archiveSheet, rowsToArchive, archiveReason) {
  if (!rowsToArchive.length) {
    return;
  }

  const archivedAt = new Date();
  const archiveRows = rowsToArchive.map(function (item) {
    return item.rowValues.concat([
      archivedAt,
      safeStr_(archiveReason) || "Archived from Invoice Prep"
    ]);
  });

  const startRow = archiveSheet.getLastRow() + 1;
  archiveSheet.getRange(startRow, 1, archiveRows.length, archiveRows[0].length).setValues(archiveRows);
}

function deleteInvoicePrepRowsByRowNumberDesc_(sheet, rowsToArchive) {
  rowsToArchive
    .slice()
    .sort(function (a, b) {
      return b.rowNumber - a.rowNumber;
    })
    .forEach(function (item) {
      sheet.deleteRow(item.rowNumber);
    });
}

function formatInvoicePrepArchiveSheetAfterWrite_(archiveSheet) {
  const lastRow = archiveSheet.getLastRow();
  if (lastRow < 2) return;

  const archiveIdx = indexMap_(
    archiveSheet.getRange(1, 1, 1, archiveSheet.getLastColumn()).getValues()[0].map(String),
    INVOICE_PREP_HEADERS.concat(["Archived At", "Archive Reason"])
  );

  archiveSheet.getRange(2, archiveIdx["Service Date"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy");
  archiveSheet.getRange(2, archiveIdx["Worked Hours"] + 1, lastRow - 1, 1).setNumberFormat("0.00");
  archiveSheet.getRange(2, archiveIdx["Default Hourly Rate"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  archiveSheet.getRange(2, archiveIdx["Flat Rate"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  archiveSheet.getRange(2, archiveIdx["Row Discount"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  archiveSheet.getRange(2, archiveIdx["Row Fee"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  archiveSheet.getRange(2, archiveIdx["Final Billed Amount"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
  archiveSheet.getRange(2, archiveIdx["Created At"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy h:mm:ss");
  archiveSheet.getRange(2, archiveIdx["Invoiced At"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy h:mm:ss");
  archiveSheet.getRange(2, archiveIdx["Archived At"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy h:mm:ss");

  archiveSheet.autoResizeColumns(1, archiveSheet.getLastColumn());
}

function archiveInvoicedInvoicePrepRows_(archiveReason) {
  const prepSheet = ensureInvoicePrepSheet_();
  const archiveSheet = ensureInvoicePrepArchiveSheet_();
  const prepIdx = getInvoicePrepIndexMap_(prepSheet);
  const rowsToArchive = getInvoicedInvoicePrepRowsForArchive_(prepSheet, prepIdx);

  if (!rowsToArchive.length) {
    return {
      archivedCount: 0,
      message: "No invoiced Invoice Prep rows were found to archive."
    };
  }

  appendInvoicePrepRowsToArchive_(archiveSheet, rowsToArchive, archiveReason);
  deleteInvoicePrepRowsByRowNumberDesc_(prepSheet, rowsToArchive);
  formatInvoicePrepSheetAfterWrite_(prepSheet, getInvoicePrepIndexMap_(prepSheet));
  formatInvoicePrepArchiveSheetAfterWrite_(archiveSheet);

  return {
    archivedCount: rowsToArchive.length,
    message: "Archived " + rowsToArchive.length + " invoiced Invoice Prep row(s)."
  };
}

function archiveInvoicedInvoicePrepRowsAndResetStartingNumber_(nextInvoiceNumber, archiveReason) {
  const parsedInvoiceNumber = parseInt(nextInvoiceNumber, 10);

  if (!parsedInvoiceNumber || Number.isNaN(parsedInvoiceNumber)) {
    throw new Error("A valid starting invoice number is required.");
  }

  const archiveResult = archiveInvoicedInvoicePrepRows_(archiveReason);
  setInvoiceControlStartingInvoiceNumber_(parsedInvoiceNumber);

  const message = archiveResult.message + " Starting Invoice Number reset to " + parsedInvoiceNumber + ".";
  Logger.log(message);

  return {
    archivedCount: archiveResult.archivedCount,
    startingInvoiceNumber: parsedInvoiceNumber,
    message: message
  };
}

function archiveInvoicedInvoicePrepRowsAndResetStartingNumber() {
  const RESET_TO_INVOICE_NUMBER = 112;
  const ARCHIVE_REASON = "Test cleanup before reusing invoice numbers";

  return archiveInvoicedInvoicePrepRowsAndResetStartingNumber_(
    RESET_TO_INVOICE_NUMBER,
    ARCHIVE_REASON
  );
}
/* end[invoice_prep_archive_and_reset_tools] */