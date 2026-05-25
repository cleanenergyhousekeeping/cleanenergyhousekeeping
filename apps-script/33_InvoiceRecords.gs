/* begin[invoice_records_helpers] */
function ensureInvoiceRecordsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INVOICE_RECORDS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(INVOICE_RECORDS_SHEET_NAME);
  }

  ensureHeaders_(sheet, INVOICE_RECORDS_HEADERS);

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const idx = getInvoiceRecordsIndexMap_(sheet);
    sheet.getRange(2, idx["Period Start"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy");
    sheet.getRange(2, idx["Period End"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy");
    sheet.getRange(2, idx["Invoice Date"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy");
    sheet.getRange(2, idx["Total Hours"] + 1, lastRow - 1, 1).setNumberFormat("0.00");
    sheet.getRange(2, idx["Invoice Total"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
    sheet.getRange(2, idx["Recorded At"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy h:mm:ss");
    sheet.getRange(2, idx["Updated At"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy h:mm:ss");
  }

  sheet.autoResizeColumns(1, INVOICE_RECORDS_HEADERS.length);
  return sheet;
}

function getInvoiceRecordsIndexMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  return indexMap_(headers, INVOICE_RECORDS_HEADERS);
}

function buildInvoiceRecordFromPrepInvoice_(payload) {
  return {
    invoiceNumber: safeStr_(payload.invoiceNumber),
    client: safeStr_(payload.clientName),
    periodStart: payload.periodStart || null,
    periodEnd: payload.periodEnd || null,
    invoiceDate: payload.invoiceDate || new Date(),
    totalHours: Number(payload.totalHours || 0),
    invoiceTotal: Number(payload.invoiceTotal || 0),
    invoiceDocLink: safeStr_(payload.invoiceDocLink),
    invoiceSource: safeStr_(payload.invoiceSource) || "Invoice Prep",
    serviceRowsJson: JSON.stringify(payload.serviceRows || []),
  };
}

function upsertInvoiceRecord_(record) {
  const invoiceNumber = safeStr_(record && record.invoiceNumber);
  if (!invoiceNumber) {
    throw new Error("Invoice record requires Invoice Number.");
  }

  const sheet = ensureInvoiceRecordsSheet_();
  const idx = getInvoiceRecordsIndexMap_(sheet);
  const now = new Date();
  const lastRow = sheet.getLastRow();
  const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues() : [];

  let existingSheetRow = -1;
  for (let i = 0; i < values.length; i++) {
    if (safeStr_(values[i][idx["Invoice Number"]]) === invoiceNumber) {
      existingSheetRow = i + 2;
      break;
    }
  }

  const rowValues = new Array(INVOICE_RECORDS_HEADERS.length).fill("");
  rowValues[idx["Invoice Number"]] = invoiceNumber;
  rowValues[idx["Client"]] = safeStr_(record.client);
  rowValues[idx["Period Start"]] = record.periodStart || "";
  rowValues[idx["Period End"]] = record.periodEnd || "";
  rowValues[idx["Invoice Date"]] = record.invoiceDate || "";
  rowValues[idx["Total Hours"]] = Number(record.totalHours || 0);
  rowValues[idx["Invoice Total"]] = Number(record.invoiceTotal || 0);
  rowValues[idx["Invoice Doc Link"]] = safeStr_(record.invoiceDocLink);
  rowValues[idx["Invoice Source"]] = safeStr_(record.invoiceSource);
  rowValues[idx["Service Rows JSON"]] = safeStr_(record.serviceRowsJson);
  rowValues[idx["Updated At"]] = now;

  if (existingSheetRow !== -1) {
    const existingRow = sheet.getRange(existingSheetRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    rowValues[idx["Recorded At"]] = existingRow[idx["Recorded At"]] || now;
    sheet.getRange(existingSheetRow, 1, 1, rowValues.length).setValues([rowValues]);
    return existingSheetRow;
  }

  rowValues[idx["Recorded At"]] = now;
  sheet.appendRow(rowValues);
  return sheet.getLastRow();
}

function getInvoiceRecordByInvoiceNumber_(invoiceNumber) {
  const normalizedInvoiceNumber = safeStr_(invoiceNumber);
  if (!normalizedInvoiceNumber) {
    return null;
  }

  const sheet = ensureInvoiceRecordsSheet_();
  if (sheet.getLastRow() < 2) {
    return null;
  }

  const idx = getInvoiceRecordsIndexMap_(sheet);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (safeStr_(row[idx["Invoice Number"]]) !== normalizedInvoiceNumber) {
      continue;
    }

    return {
      sheetRow: i + 2,
      invoiceNumber: safeStr_(row[idx["Invoice Number"]]),
      client: safeStr_(row[idx["Client"]]),
      periodStart: coerceToDate_(row[idx["Period Start"]]),
      periodEnd: coerceToDate_(row[idx["Period End"]]),
      invoiceDate: coerceToDate_(row[idx["Invoice Date"]]),
      totalHours: Number(row[idx["Total Hours"]] || 0),
      invoiceTotal: Number(row[idx["Invoice Total"]] || 0),
      invoiceDocLink: safeStr_(row[idx["Invoice Doc Link"]]),
      invoiceSource: safeStr_(row[idx["Invoice Source"]]),
      serviceRowsJson: safeStr_(row[idx["Service Rows JSON"]]),
      recordedAt: coerceToDate_(row[idx["Recorded At"]]),
      updatedAt: coerceToDate_(row[idx["Updated At"]]),
    };
  }

  return null;
}

function parseInvoiceRecordServiceRows_(invoiceRecord) {
  try {
    const parsed = JSON.parse(safeStr_(invoiceRecord && invoiceRecord.serviceRowsJson) || "[]");
    if (!Array.isArray(parsed)) {
      throw new Error("Service Rows JSON is not an array.");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      "Invoice Records Service Rows JSON is invalid for invoice " +
      safeStr_(invoiceRecord && invoiceRecord.invoiceNumber) +
      ". " +
      safeStr_(error && error.message ? error.message : error)
    );
  }
}

function openInvoiceRecordsSheet() {
  const sheet = ensureInvoiceRecordsSheet_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
}

function backfillInvoiceRecordsFromInvoicePrepArchive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const archiveSheet = ss.getSheetByName(INVOICE_PREP_ARCHIVE_SHEET_NAME);

  if (!archiveSheet || archiveSheet.getLastRow() < 2) {
    Logger.log("Invoice Records backfill: no archive rows found.");
    return;
  }

  const headers = archiveSheet.getRange(1, 1, 1, archiveSheet.getLastColumn()).getValues()[0].map(String);
  const idx = indexMap_(headers, INVOICE_PREP_HEADERS);
  const values = archiveSheet.getRange(2, 1, archiveSheet.getLastRow() - 1, archiveSheet.getLastColumn()).getValues();
  const grouped = {};

  values.forEach(function (row) {
    const invoiceNumber = safeStr_(row[idx["Invoice Number"]]);
    if (!invoiceNumber) return;

    if (!grouped[invoiceNumber]) grouped[invoiceNumber] = [];

    grouped[invoiceNumber].push({
      invoiceNumber: invoiceNumber,
      client: safeStr_(row[idx["Client"]]),
      property: safeStr_(row[idx["Property"]]),
      serviceDate: coerceToDate_(row[idx["Service Date"]]),
      cleanerNames: safeStr_(row[idx["Cleaner Names"]]),
      workedHours: Number(row[idx["Worked Hours"]] || 0),
      defaultHourlyRate: Number(row[idx["Default Hourly Rate"]] || 0),
      billingMode: normalizePrepBillingMode_(row[idx["Billing Mode"]]),
      flatRate: Number(row[idx["Flat Rate"]] || 0),
      rowDiscount: Math.abs(Number(row[idx["Row Discount"]] || 0)),
      rowFee: Math.abs(Number(row[idx["Row Fee"]] || 0)),
      finalBilledAmount: Number(row[idx["Final Billed Amount"]] || 0),
      billingNote: safeStr_(row[idx["Billing Note"]]),
      cleanerDetailsSummary: safeStr_(row[idx["Cleaner Details Summary"]]),
      adjustmentNote: safeStr_(row[idx["Adjustment Note"]]),
      createdAt: coerceToDate_(row[idx["Created At"]]),
      invoicedAt: coerceToDate_(row[idx["Invoiced At"]]),
    });
  });

  const invoiceNumbers = Object.keys(grouped);
  let createdOrUpdated = 0;

  invoiceNumbers.forEach(function (invoiceNumber) {
    const prepRows = grouped[invoiceNumber].filter(function (row) {
      return row.client && row.property && row.serviceDate;
    });

    if (!prepRows.length) return;

    prepRows.sort(function (a, b) {
      const dateDiff = a.serviceDate.getTime() - b.serviceDate.getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.property.localeCompare(b.property);
    });

    const existing = getInvoiceRecordByInvoiceNumber_(invoiceNumber);
    const shouldSkip = existing && existing.client && existing.periodStart && existing.periodEnd && existing.invoiceTotal > 0 && existing.serviceRowsJson;
    if (shouldSkip) return;

    const serviceRows = buildServiceRowsFromInvoicePrepRows_(prepRows);
    const invoiceTotal = round2_(prepRows.reduce(function (sum, row) { return sum + Number(row.finalBilledAmount || 0); }, 0));
    const totalHours = round2_(prepRows.reduce(function (sum, row) { return sum + Number(row.workedHours || 0); }, 0));
    const invoiceDate = prepRows.map(function (row) { return row.invoicedAt || row.createdAt; }).filter(Boolean).sort(function (a, b) { return a.getTime() - b.getTime(); })[0] || new Date();

    const record = buildInvoiceRecordFromPrepInvoice_({
      invoiceNumber: invoiceNumber,
      clientName: prepRows[0].client,
      periodStart: prepRows[0].serviceDate,
      periodEnd: prepRows[prepRows.length - 1].serviceDate,
      invoiceDate: invoiceDate,
      totalHours: totalHours,
      invoiceTotal: invoiceTotal,
      invoiceDocLink: existing && existing.invoiceDocLink ? existing.invoiceDocLink : "",
      invoiceSource: "Invoice Prep Archive Backfill",
      serviceRows: serviceRows,
    });

    upsertInvoiceRecord_(record);
    createdOrUpdated += 1;
  });

  Logger.log("Invoice Records backfill complete. Invoice groups processed: " + invoiceNumbers.length + ". Records created/updated: " + createdOrUpdated + ".");
}
/* end[invoice_records_helpers] */
