const INVOICE_CONTROL_SHEET_NAME = "Invoice Control";
const INVOICE_CONTROL_FIELDS = [
  "Starting Invoice Number",
  "Period Start",
  "Period End",
  "Rate Override (Optional)",
  "Client Filter (Optional)",
];

const MICRO_THRESHOLD_HOURS = 0.05; // 3 minutes
const LONG_SHIFT_THRESHOLD_HOURS = 16;


function ensureInvoiceControlSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INVOICE_CONTROL_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(INVOICE_CONTROL_SHEET_NAME);
  }

  const expected = INVOICE_CONTROL_FIELDS;
  const existing = sheet.getRange(1, 1, Math.max(expected.length, 1), 2).getValues();

  const needsSetup = expected.some(function (label, index) {
    return safeStr_(existing[index] && existing[index][0]) !== label;
  });

  if (needsSetup) {
    sheet.clear();
    const rows = [
      ["Starting Invoice Number", "160"],
      ["Period Start", new Date()],
      ["Period End", new Date()],
      ["Rate Override (Optional)", ""],
      ["Client Filter (Optional)", ""],
    ];
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    sheet.getRange(2, 2, 2, 1).setNumberFormat("m/d/yyyy");
  }

  sheet.autoResizeColumns(1, 2);
  return sheet;
}

function getInvoiceControlValues_() {
  const sheet = ensureInvoiceControlSheet_();
  const rows = sheet.getRange(1, 1, INVOICE_CONTROL_FIELDS.length, 2).getValues();

  const map = {};
  rows.forEach(function (row) {
    map[safeStr_(row[0])] = row[1];
  });

  const startingInvoiceNumber = parseInt(map["Starting Invoice Number"], 10);
  const periodStart = coerceToDate_(map["Period Start"]);
  const periodEnd = coerceToDate_(map["Period End"]);
  const rateOverrideRaw = safeStr_(map["Rate Override (Optional)"]);
  const clientFilter = safeStr_(map["Client Filter (Optional)"]);

  if (!startingInvoiceNumber || Number.isNaN(startingInvoiceNumber)) {
    throw new Error("Invoice Control: Starting Invoice Number is required.");
  }

  if (!periodStart || !periodEnd) {
    throw new Error("Invoice Control: Period Start and Period End are required.");
  }

  return {
    startingInvoiceNumber: startingInvoiceNumber,
    periodStart: startOfDay_(periodStart),
    periodEnd: endOfDay_(periodEnd),
    rateOverride: rateOverrideRaw ? Number(rateOverrideRaw) : null,
    clientFilter: clientFilter,
  };
}

/* begin[get_invoice_control_starting_number_only] */
function getInvoiceControlStartingInvoiceNumber_() {
  const sheet = ensureInvoiceControlSheet_();
  const startingInvoiceNumber = parseInt(sheet.getRange(1, 2).getValue(), 10);

  if (!startingInvoiceNumber || Number.isNaN(startingInvoiceNumber)) {
    throw new Error("Invoice Control: Starting Invoice Number is required.");
  }

  return startingInvoiceNumber;
}
/* end[get_invoice_control_starting_number_only] */

/* begin[set_invoice_control_starting_number] */
function setInvoiceControlStartingInvoiceNumber_(nextInvoiceNumber) {
  const sheet = ensureInvoiceControlSheet_();
  sheet.getRange(1, 2).setValue(String(nextInvoiceNumber));
}
/* end[set_invoice_control_starting_number] */


function getClientRateFromProperties_(clientName) {
  const normalizedClient = safeStr_(clientName);
  if (!normalizedClient) {
    return DEFAULT_RATE;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Properties");
  if (!sheet) {
    return DEFAULT_RATE;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return DEFAULT_RATE;
  }

  const headers = data[0].map(String);
  const idx = {
    client: headers.indexOf("Client"),
    clientRate: headers.indexOf("Client Rate"),
  };

  if (idx.client === -1 || idx.clientRate === -1) {
    return DEFAULT_RATE;
  }

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const rowClient = safeStr_(row[idx.client]);

    if (rowClient !== normalizedClient) {
      continue;
    }

    const rate = Number(row[idx.clientRate] || 0);
    if (rate > 0) {
      return rate;
    }
  }

  return DEFAULT_RATE;
}



/* begin[invoice_billing_and_adjustment_helpers] */
function ensureInvoiceAdjustmentsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INVOICE_ADJUSTMENTS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(INVOICE_ADJUSTMENTS_SHEET_NAME);
  }

  ensureHeaders_(sheet, INVOICE_ADJUSTMENTS_COLUMNS);
  sheet.autoResizeColumns(1, INVOICE_ADJUSTMENTS_COLUMNS.length);
  return sheet;
}


function normalizeBillingType_(rawValue) {
  const normalized = safeStr_(rawValue).toUpperCase();
  return normalized === BILLING_TYPE_FLAT ? BILLING_TYPE_FLAT : BILLING_TYPE_HOURLY;
}

function normalizeAdjustmentType_(rawValue) {
  return safeStr_(rawValue).toUpperCase();
}

function normalizeAdjustmentAmount_(rawAmount, adjustmentType) {
  const numericAmount = Number(rawAmount || 0);
  if (!isFinite(numericAmount) || numericAmount === 0) {
    return 0;
  }

  const normalizedType = normalizeAdjustmentType_(adjustmentType);

  if (normalizedType === ADJUSTMENT_TYPE_DISCOUNT || normalizedType === ADJUSTMENT_TYPE_CREDIT) {
    return -Math.abs(numericAmount);
  }

  if (normalizedType === ADJUSTMENT_TYPE_FEE) {
    return Math.abs(numericAmount);
  }

  return numericAmount;
}

function isActiveAdjustmentRow_(rawValue) {
  if (rawValue === true) return true;
  const normalized = safeStr_(rawValue).toLowerCase();
  return normalized === "" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "1" ||
    normalized === "active";
}

function getPropertyBillingConfig_(propertyName, clientName, fallbackHourlyRate) {
  const normalizedProperty = safeStr_(propertyName);
  const normalizedClient = safeStr_(clientName);
  const fallbackRate = Number(fallbackHourlyRate || DEFAULT_RATE) || DEFAULT_RATE;

  const defaultConfig = {
    billingType: BILLING_TYPE_HOURLY,
    hourlyRate: fallbackRate,
    flatRate: 0,
  };

  if (!normalizedProperty) {
    return defaultConfig;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROPERTIES_SHEET_NAME);
  if (!sheet) {
    return defaultConfig;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return defaultConfig;
  }

  const headers = data[0].map(String);
  const idx = {
    propertyName: headers.indexOf("Property Name"),
    client: headers.indexOf("Client"),
    clientRate: headers.indexOf("Client Rate"),
    billingType: headers.indexOf("Billing Type"),
    flatRate: headers.indexOf("Flat Rate"),
  };

  if (idx.propertyName === -1) {
    return defaultConfig;
  }

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const rowProperty = safeStr_(row[idx.propertyName]);

    if (rowProperty !== normalizedProperty) {
      continue;
    }

    if (idx.client !== -1) {
      const rowClient = safeStr_(row[idx.client]);
      if (normalizedClient && rowClient && rowClient !== normalizedClient) {
        continue;
      }
    }

    const rowHourlyRate =
      idx.clientRate !== -1 && Number(row[idx.clientRate] || 0) > 0
        ? Number(row[idx.clientRate])
        : fallbackRate;

    const rowBillingType =
      idx.billingType !== -1
        ? normalizeBillingType_(row[idx.billingType])
        : BILLING_TYPE_HOURLY;

    const rowFlatRate =
      idx.flatRate !== -1 && Number(row[idx.flatRate] || 0) > 0
        ? Number(row[idx.flatRate])
        : 0;

    if (rowBillingType === BILLING_TYPE_FLAT && rowFlatRate > 0) {
      return {
        billingType: BILLING_TYPE_FLAT,
        hourlyRate: rowHourlyRate,
        flatRate: rowFlatRate,
      };
    }

    return {
      billingType: BILLING_TYPE_HOURLY,
      hourlyRate: rowHourlyRate,
      flatRate: rowFlatRate,
    };
  }

  return defaultConfig;
}

function getInvoiceAdjustmentsForClientPeriod_({ periodStart, periodEnd, clientName }) {
  const sheet = ensureInvoiceAdjustmentsSheet_();
  const data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return [];
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, INVOICE_ADJUSTMENTS_COLUMNS);

  const start = startOfDay_(periodStart);
  const end = endOfDay_(periodEnd);
  const normalizedClient = safeStr_(clientName);

  const adjustments = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];

    const active = isActiveAdjustmentRow_(row[idx["Active"]]);
    if (!active) {
      continue;
    }

    const rowClient = safeStr_(row[idx["Client"]]);
    if (!rowClient || rowClient !== normalizedClient) {
      continue;
    }

    const serviceDate = coerceToDate_(row[idx["Service Date"]]);
    if (serviceDate) {
      const dateOnly = startOfDay_(serviceDate);
      if (dateOnly < start || dateOnly > end) {
        continue;
      }
    }

    const adjustmentType = normalizeAdjustmentType_(row[idx["Adjustment Type"]]);
    const description = safeStr_(row[idx["Description"]]);
    const property = safeStr_(row[idx["Property"]]);
    const notes = safeStr_(row[idx["Notes"]]);
    const amount = normalizeAdjustmentAmount_(row[idx["Amount"]], adjustmentType);

    if (!description || amount === 0) {
      continue;
    }

    adjustments.push({
      invoiceNumber: safeStr_(row[idx["Invoice Number"]]),
      client: rowClient,
      property: property,
      serviceDate: serviceDate ? startOfDay_(serviceDate) : null,
      adjustmentType: adjustmentType,
      description: description,
      amount: amount,
      notes: notes,
    });
  }

  return adjustments.sort(function (a, b) {
    const aTime = a.serviceDate ? a.serviceDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.serviceDate ? b.serviceDate.getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });
}
/* end[invoice_billing_and_adjustment_helpers] */

function getUniqueClientsForInvoicePeriod_({ periodStart, periodEnd, clientFilter }) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map(String);
  const idx = indexMap_(headers, ["Date", "Property", "Client", "Total Hours"]);

  const start = startOfDay_(periodStart);
  const end = endOfDay_(periodEnd);
  const clients = new Set();

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const dateObj = coerceToDate_(row[idx["Date"]]);
    const clientName = safeStr_(row[idx["Client"]]);
    const property = safeStr_(row[idx["Property"]]);
    const totalHours = Number(row[idx["Total Hours"]] || 0);

    if (!dateObj || !property) continue;
    if (!clientName) continue;
    if (totalHours <= 0) continue;

    const dateOnly = startOfDay_(dateObj);
    if (dateOnly < start || dateOnly > end) continue;

    if (clientFilter && clientName !== clientFilter) continue;

    clients.add(clientName);
  }

  return Array.from(clients).sort(function (a, b) {
    return a.localeCompare(b);
  });
}

/* begin[create_invoices_from_control_with_auto_increment] */
function createInvoicesFromControlSheet() {
  const control = getInvoiceControlValues_();

  const clients = getUniqueClientsForInvoicePeriod_(control);
  if (!clients.length) {
    throw new Error("No invoiceable clients found for the selected period.");
  }

  const created = [];
  let invoiceNumber = control.startingInvoiceNumber;

  clients.forEach(function (clientName) {
    const effectiveRate =
      control.rateOverride != null && !Number.isNaN(control.rateOverride)
        ? control.rateOverride
        : getClientRateFromProperties_(clientName);

    createInvoiceFromTimeTracker_({
      invoiceNumber: String(invoiceNumber),
      periodStart: control.periodStart,
      periodEnd: control.periodEnd,
      clientName: clientName,
      rate: effectiveRate,
    });

    created.push({
      invoiceNumber: String(invoiceNumber),
      clientName: clientName,
      rate: effectiveRate,
    });

    invoiceNumber += 1;
  });

  setInvoiceControlStartingInvoiceNumber_(invoiceNumber);

  Logger.log("Created invoices: " + JSON.stringify(created, null, 2));

  const summary = created
    .map(function (item) {
      return `Invoice ${item.invoiceNumber} — ${item.clientName} @ ${money_(item.rate)}/hr`;
    })
    .join("\n");

  Logger.log("Invoices created summary:\n" + summary);
}
/* end[create_invoices_from_control_with_auto_increment] */

/* begin[create_invoice_with_flat_rate_and_adjustments] */
function createInvoiceFromTimeTracker_({ invoiceNumber, periodStart, periodEnd, clientName, rate }) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${TIME_SHEET_NAME}`);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("No data rows found in Time Tracker.");

  const headers = data[0].map(String);
  const idx = indexMap_(headers, [
    "Name", "Property", "Date", "Clock In", "Clock Out", "Total Hours",
    "Clock In Note", "Clock Out Note", "Client"
  ]);

  const start = startOfDay_(periodStart);
  const end = endOfDay_(periodEnd);
  const groups = new Map();

  for (let r = 1; r < data.length; r++) {
    const row = data[r];

    const name = safeStr_(row[idx["Name"]]);
    const property = safeStr_(row[idx["Property"]]);
    const dateVal = row[idx["Date"]];
    if (!name || !property || !dateVal) continue;

    const dateObj = coerceToDate_(dateVal);
    if (!dateObj) continue;

    const dateOnly = startOfDay_(dateObj);
    if (dateOnly < start || dateOnly > end) continue;

    const rowClient = safeStr_(row[idx["Client"]]);
    if (clientName && rowClient && rowClient !== clientName) continue;

    const clockIn = row[idx["Clock In"]];
    const clockOut = row[idx["Clock Out"]];
    const totalHoursCell = row[idx["Total Hours"]];
    const cout = safeStr_(row[idx["Clock Out Note"]]);

    const hours = computeHours_(clockIn, clockOut, totalHoursCell);
    const isMicroEntry = hours > 0 && hours < MICRO_THRESHOLD_HOURS;
    const isLongShift = hours > LONG_SHIFT_THRESHOLD_HOURS;
    const key = `${formatYMD_(dateOnly)}__${property}`;

    if (!groups.has(key)) {
      groups.set(key, { date: dateOnly, property, client: rowClient, entries: [] });
    }

    const g = groups.get(key);
    g.entries.push({
      date: dateOnly,
      name,
      clockIn,
      clockOut,
      hours,
      noteText: cout,
      excludeFromInvoice: isMicroEntry,
      flags: isLongShift ? ["LONG SHIFT ⚠️"] : [],
    });
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    const dateDiff = a.date - b.date;
    if (dateDiff !== 0) return dateDiff;

    const aFirstStart = Math.min(
      ...a.entries.map(e =>
        e.clockIn ? new Date(e.clockIn).getTime() : Number.POSITIVE_INFINITY
      )
    );

    const bFirstStart = Math.min(
      ...b.entries.map(e =>
        e.clockIn ? new Date(e.clockIn).getTime() : Number.POSITIVE_INFINITY
      )
    );

    if (aFirstStart !== bFirstStart) {
      return aFirstStart - bFirstStart;
    }

    return a.property.localeCompare(b.property);
  });

  const serviceRows = [];
  let serviceSubtotal = 0;

  if (sortedGroups.length === 0) {
    serviceRows.push({
      date: "",
      details: "No services found in this period (check date range + Time Tracker Date column).",
      hours: "",
      rateDisplay: "",
      amount: "",
    });
  } else {
    for (const g of sortedGroups) {
      g.entries = sortRowsByDateThenStart_(g.entries);

      const invoiceableEntries = g.entries.filter(function (e) {
        return !e.excludeFromInvoice && (e.hours || 0) > 0;
      });

      const totalHours = round2_(
        invoiceableEntries.reduce(function (sum, e) {
          return sum + (e.hours || 0);
        }, 0)
      );

      if (totalHours <= 0) continue;

      const billingConfig = getPropertyBillingConfig_(g.property, clientName, rate);

      let amount = 0;
      let rateValue = "";
      let rateDisplay = "";

      if (billingConfig.billingType === BILLING_TYPE_FLAT && billingConfig.flatRate > 0) {
        amount = round2_(billingConfig.flatRate);
        rateDisplay = "Flat";
      } else {
        amount = round2_(totalHours * billingConfig.hourlyRate);
        rateValue = billingConfig.hourlyRate;
        rateDisplay = money_(billingConfig.hourlyRate);
      }

      serviceSubtotal += amount;

      const lines = [];
      lines.push(g.property);

      invoiceableEntries.forEach(function (e) {
        const inStr = formatTime_(e.clockIn);
        const outStr = formatTime_(e.clockOut);
        const hStr = (e.hours != null) ? `(${round2_(e.hours).toFixed(2)})` : "";
        const timeRange = (inStr || outStr) ? `${inStr || "?"}–${outStr || "?"}` : "";

        lines.push(`${e.name} ${timeRange} ${hStr}`.trim());

        const noteLines = safeStr_(e.noteText)
          .split("\n")
          .map(function (line) { return safeStr_(line).trim(); })
          .filter(function (line) { return !!line; })
          .reverse();

        noteLines.forEach(function (line) {
          lines.push(`   ${line}`);
        });
      });

      serviceRows.push({
        date: formatDateShort_(g.date),
        details: lines.join("\n"),
        hours: totalHours,
        rate: rateValue,
        rateDisplay: rateDisplay,
        amount: amount,
      });
    }
  }

  const adjustments = getInvoiceAdjustmentsForClientPeriod_({
    periodStart: periodStart,
    periodEnd: periodEnd,
    clientName: clientName,
  });

  adjustments.forEach(function (adjustment) {
    const adjustmentLines = [];
    adjustmentLines.push(`${adjustment.adjustmentType}: ${adjustment.description}`);

    if (adjustment.property) {
      adjustmentLines.push(`   ${adjustment.property}`);
    }

    if (adjustment.notes) {
      adjustmentLines.push(`   ${adjustment.notes}`);
    }

    serviceRows.push({
      date: adjustment.serviceDate ? formatDateShort_(adjustment.serviceDate) : "",
      details: adjustmentLines.join("\n"),
      hours: "",
      rateDisplay: "",
      amount: adjustment.amount,
    });
  });

  const adjustmentsTotal = round2_(
    adjustments.reduce(function (sum, item) {
      return sum + Number(item.amount || 0);
    }, 0)
  );

  const docId = copyTemplate_({ invoiceNumber, periodStart, periodEnd, clientName });
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();

  const totalHoursForInvoice = round2_(
    serviceRows.reduce(function (sum, row) {
      return sum + Number(row.hours || 0);
    }, 0)
  );

  const subtotal = round2_(serviceSubtotal + adjustmentsTotal);
  const tax = 0;
  const totalAmount = round2_(subtotal + tax);

  replaceAll_(body, "{{TOTAL_AMOUNT}}", money_(totalAmount));
  replaceAll_(body, "{{DATE_RANGE}}", `${formatDateShort_(periodStart)} - ${formatDateShort_(periodEnd)}`);
  replaceAll_(body, "{{CLIENT_NAME}}", clientName || "");

  const zelleQrFileId = "1dEWeUMFvkEnY_1oJZVtNaNvUaTXRYZBS";

  insertServiceItemsTable_(body, serviceRows);

  insertTotalsSection_(body, {
    hours: totalHoursForInvoice.toFixed(2),
    serviceSubtotal: serviceSubtotal,
    adjustments: adjustmentsTotal,
    subtotal: subtotal,
    tax: tax,
    total: totalAmount,
  }, zelleQrFileId);

  doc.saveAndClose();
  Logger.log("Invoice created: " + doc.getUrl());
}
/* end[create_invoice_with_flat_rate_and_adjustments] */

/* begin[invoice_cleaner_name_privacy_helpers] */
function formatCleanerNamesForInvoice_(value) {
  return safeStr_(value).replace(/\b([A-Z][a-zA-Z'’-]+)\s+([A-Z])[a-zA-Z'’-]+\b/g, "$1 $2.");
}
/* end[invoice_cleaner_name_privacy_helpers] */

/* begin[build_service_rows_from_invoice_prep_rows] */
function buildInvoicePrepBaseAmount_(row) {
  if (row.billingMode === BILLING_TYPE_FLAT && row.flatRate > 0) {
    return round2_(row.flatRate);
  }

  return round2_(Number(row.workedHours || 0) * Number(row.defaultHourlyRate || 0));
}

function buildInvoicePrepAmountDisplay_(row, baseAmount, finalAmount) {
  const lines = [money_(baseAmount)];

  if (row.rowDiscount > 0) {
    lines.push("Discount: -" + money_(row.rowDiscount));
  }

  if (row.rowFee > 0) {
    lines.push("Fee: +" + money_(row.rowFee));
  }

  if (row.rowDiscount > 0 || row.rowFee > 0) {
    lines.push("Total: " + money_(finalAmount));
  }

  return lines.join("\n");
}

function buildServiceRowsFromInvoicePrepRows_(prepRows) {
  return prepRows.map(function (row) {
    const baseAmount = buildInvoicePrepBaseAmount_(row);

    const finalAmount = calculateInvoicePrepFinalAmount_(
      row.workedHours,
      row.defaultHourlyRate,
      row.billingMode,
      row.flatRate,
      row.rowDiscount,
      row.rowFee
    );

    const detailLines = [];
    detailLines.push(row.property);

    if (row.cleanerDetailsSummary) {
      row.cleanerDetailsSummary.split("\n").forEach(function (line) {
        const cleanLine = formatCleanerNamesForInvoice_(safeStr_(line));
        if (cleanLine) {
          detailLines.push(cleanLine);
        }
      });
    } else {
      const fallbackLineParts = [];
      if (row.cleanerNames) {
        fallbackLineParts.push(formatCleanerNamesForInvoice_(row.cleanerNames));
      }
      if (row.workedHours > 0) {
        fallbackLineParts.push("(" + Number(row.workedHours).toFixed(2) + " hrs)");
      }
      if (fallbackLineParts.length) {
        detailLines.push(fallbackLineParts.join(" "));
      }
    }

    if (row.billingNote) {
      detailLines.push("Billing note: " + row.billingNote);
    }

    if (row.adjustmentNote && row.rowDiscount > 0) {
      detailLines.push("Discount reason: " + row.adjustmentNote);
    }

    if (row.adjustmentNote && row.rowFee > 0) {
      detailLines.push("Fee reason: " + row.adjustmentNote);
    }

    let rateDisplay = "";
    let rateValue = "";

    if (row.billingMode === BILLING_TYPE_FLAT && row.flatRate > 0) {
      rateDisplay = "Flat";
    } else {
      rateValue = row.defaultHourlyRate;
      rateDisplay = money_(row.defaultHourlyRate);
    }

    return {
      date: formatDateShort_(row.serviceDate),
      details: detailLines.join("\n"),
      hours: row.workedHours,
      rate: rateValue,
      rateDisplay: rateDisplay,
      amount: finalAmount,
      amountDisplay: buildInvoicePrepAmountDisplay_(row, baseAmount, finalAmount),
    };
  });
}
/* end[build_service_rows_from_invoice_prep_rows] */

function markInvoicePrepRowsInvoiced_(prepRows, invoiceNumber) {
  const prepSheet = ensureInvoicePrepSheet_();
  const prepIdx = getInvoicePrepIndexMap_(prepSheet);
  const invoicedAt = new Date();

  prepRows.forEach(function (row) {
    prepSheet.getRange(row.sheetRow, prepIdx["Invoiced"] + 1).setValue("TRUE");
    prepSheet.getRange(row.sheetRow, prepIdx["Invoice Number"] + 1).setValue(String(invoiceNumber));
    prepSheet.getRange(row.sheetRow, prepIdx["Invoiced At"] + 1).setValue(invoicedAt);

    const refreshedFinalAmount = calculateInvoicePrepFinalAmount_(
      row.workedHours,
      row.defaultHourlyRate,
      row.billingMode,
      row.flatRate,
      row.rowDiscount,
      row.rowFee
    );

    prepSheet.getRange(row.sheetRow, prepIdx["Final Billed Amount"] + 1).setValue(refreshedFinalAmount);
  });

  formatInvoicePrepSheetAfterWrite_(prepSheet, prepIdx);
}

function createInvoiceFromInvoicePrepGroup_({ invoiceNumber, clientName, prepRows }) {
  if (!prepRows || !prepRows.length) {
    throw new Error("No Invoice Prep rows supplied.");
  }

  const sortedRows = prepRows.slice().sort(function (a, b) {
    const dateDiff = a.serviceDate.getTime() - b.serviceDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.property.localeCompare(b.property);
  });

  const periodStart = sortedRows[0].serviceDate;
  const periodEnd = sortedRows[sortedRows.length - 1].serviceDate;

  const serviceRows = buildServiceRowsFromInvoicePrepRows_(sortedRows);

  const totalHoursForInvoice = round2_(
    sortedRows.reduce(function (sum, row) {
      return sum + Number(row.workedHours || 0);
    }, 0)
  );

  const serviceSubtotal = round2_(
    sortedRows.reduce(function (sum, row) {
      return sum + calculateInvoicePrepFinalAmount_(
        row.workedHours,
        row.defaultHourlyRate,
        row.billingMode,
        row.flatRate,
        row.rowDiscount,
        row.rowFee
      );
    }, 0)
  );

  const tax = 0;
  const totalAmount = round2_(serviceSubtotal + tax);

  const docId = copyTemplate_({ invoiceNumber, periodStart, periodEnd, clientName });
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();

  replaceAll_(body, "{{TOTAL_AMOUNT}}", money_(totalAmount));
  replaceAll_(body, "{{DATE_RANGE}}", `${formatDateShort_(periodStart)} - ${formatDateShort_(periodEnd)}`);
  replaceAll_(body, "{{CLIENT_NAME}}", clientName || "");

  const zelleQrFileId = "1dEWeUMFvkEnY_1oJZVtNaNvUaTXRYZBS";

  insertServiceItemsTable_(body, serviceRows);

  insertTotalsSection_(body, {
    hours: totalHoursForInvoice.toFixed(2),
    serviceSubtotal: serviceSubtotal,
    adjustments: 0,
    subtotal: serviceSubtotal,
    tax: tax,
    total: totalAmount,
  }, zelleQrFileId);

  doc.saveAndClose();
  Logger.log("Invoice created from Invoice Prep: " + doc.getUrl());

  markInvoicePrepRowsInvoiced_(sortedRows, invoiceNumber);
}

/* begin[create_invoices_from_invoice_prep_with_auto_increment] */
function createInvoicesFromInvoicePrep_() {
  const groups = getOpenReadyInvoicePrepGroups_();

  if (!groups.length) {
    throw new Error("No ready, uninvoiced Invoice Prep rows found.");
  }

  const created = [];
  let invoiceNumber = getInvoiceControlStartingInvoiceNumber_();

  groups.forEach(function (group) {
    createInvoiceFromInvoicePrepGroup_({
      invoiceNumber: String(invoiceNumber),
      clientName: group.clientName,
      prepRows: group.rows,
    });

    created.push({
      invoiceNumber: String(invoiceNumber),
      clientName: group.clientName,
      rowCount: group.rows.length,
      invoiceGroup: group.invoiceGroup,
    });

    invoiceNumber += 1;
  });

  setInvoiceControlStartingInvoiceNumber_(invoiceNumber);

  Logger.log("Created Invoice Prep invoices: " + JSON.stringify(created, null, 2));

  const summary = created
    .map(function (item) {
      return "Invoice " + item.invoiceNumber + " — " + item.clientName + " (" + item.rowCount + " prep row(s))";
    })
    .join("\n");

  Logger.log("Invoice Prep created summary:\n" + summary);
}
/* end[create_invoices_from_invoice_prep_with_auto_increment] */

function createInvoicesFromInvoicePrep() {
  return createInvoicesFromInvoicePrep_();
}
/* end[invoice_creation_from_invoice_prep] */