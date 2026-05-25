/* begin[receipt_control_sheet_setup] */
function ensureReceiptControlSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RECEIPT_CONTROL_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(RECEIPT_CONTROL_SHEET_NAME);
  }

  ensureHeaders_(sheet, RECEIPT_CONTROL_HEADERS);

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const idx = getReceiptControlIndexMap_(sheet);
    sheet.getRange(2, idx["Payment Date"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy");
    sheet.getRange(2, idx["Amount Paid"] + 1, lastRow - 1, 1).setNumberFormat("$0.00");
    sheet.getRange(2, idx["Receipt Created At"] + 1, lastRow - 1, 1).setNumberFormat("m/d/yyyy h:mm:ss");
  }

  sheet.autoResizeColumns(1, RECEIPT_CONTROL_HEADERS.length);
  return sheet;
}

function getReceiptControlIndexMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  return indexMap_(headers, RECEIPT_CONTROL_HEADERS);
}
/* end[receipt_control_sheet_setup] */

/* begin[receipt_invoice_prep_lookup] */
function readInvoicePrepRowsFromSheetByInvoiceNumber_(sheet, invoiceNumber) {
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idx = indexMap_(headers, INVOICE_PREP_HEADERS);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const normalizedInvoiceNumber = safeStr_(invoiceNumber);

  return values
    .map(function (row, offset) {
      const serviceDate = coerceToDate_(row[idx["Service Date"]]);

      return {
        sheetRow: offset + 2,
        prepId: safeStr_(row[idx["Prep ID"]]),
        ready: row[idx["Ready"]],
        invoiced: row[idx["Invoiced"]],
        invoiceNumber: safeStr_(row[idx["Invoice Number"]]),
        client: safeStr_(row[idx["Client"]]),
        invoiceGroup: safeStr_(row[idx["Invoice Group"]]),
        property: safeStr_(row[idx["Property"]]),
        serviceDate: serviceDate ? startOfDay_(serviceDate) : null,
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
        timeTrackerRowKeys: safeStr_(row[idx["Time Tracker Row Keys"]]),
        createdAt: coerceToDate_(row[idx["Created At"]]),
        invoicedAt: coerceToDate_(row[idx["Invoiced At"]]),
        adjustmentNote: safeStr_(row[idx["Adjustment Note"]]),
      };
    })
    .filter(function (row) {
      return row.invoiceNumber === normalizedInvoiceNumber && row.client && row.property && row.serviceDate;
    });
}

function buildReceiptPrepRowDedupeKey_(row) {
  const prepId = safeStr_(row && row.prepId);
  if (prepId) {
    return "prepId::" + prepId;
  }

  const timeTrackerRowKeys = safeStr_(row && row.timeTrackerRowKeys);
  if (timeTrackerRowKeys) {
    return "timeTrackerRowKeys::" + timeTrackerRowKeys;
  }

  const serviceDate = row && row.serviceDate ? formatYMD_(row.serviceDate) : "";
  const finalBilledAmount = Number(row && row.finalBilledAmount || 0).toFixed(2);

  return [
    "fallback",
    serviceDate,
    safeStr_(row && row.client),
    safeStr_(row && row.property),
    finalBilledAmount,
  ].join("::");
}

function dedupeReceiptInvoicePrepRows_(rows) {
  const seen = {};
  const dedupedRows = [];

  rows.forEach(function (row) {
    const key = buildReceiptPrepRowDedupeKey_(row);
    if (seen[key]) {
      return;
    }

    seen[key] = true;
    dedupedRows.push(row);
  });

  return dedupedRows;
}

function getInvoicePrepRowsByInvoiceNumber_(invoiceNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = [];

  const prepSheet = ss.getSheetByName(INVOICE_PREP_SHEET_NAME);
  rows.push.apply(rows, readInvoicePrepRowsFromSheetByInvoiceNumber_(prepSheet, invoiceNumber));

  const archiveSheet = ss.getSheetByName(INVOICE_PREP_ARCHIVE_SHEET_NAME);
  rows.push.apply(rows, readInvoicePrepRowsFromSheetByInvoiceNumber_(archiveSheet, invoiceNumber));

  return dedupeReceiptInvoicePrepRows_(rows).sort(function (a, b) {
    const dateDiff = a.serviceDate.getTime() - b.serviceDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.property.localeCompare(b.property);
  });
}
/* end[receipt_invoice_prep_lookup] */

/* begin[receipt_doc_helpers] */
function buildReceiptNumber_(invoiceNumber, requestedReceiptNumber) {
  const normalizedReceiptNumber = safeStr_(requestedReceiptNumber);
  if (normalizedReceiptNumber) {
    return normalizedReceiptNumber;
  }

  return "R-" + safeStr_(invoiceNumber);
}

function coerceReceiptCurrencyNumber_(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number" && isFinite(value)) {
    return value;
  }

  const raw = safeStr_(value);
  if (!raw) {
    return 0;
  }

  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) {
    return 0;
  }

  const isParenthesizedNegative = /^\(.+\)$/.test(cleaned);
  const numericText = isParenthesizedNegative ? cleaned.slice(1, -1) : cleaned;
  const parsed = Number(numericText);

  if (!isFinite(parsed) || Number.isNaN(parsed)) {
    return 0;
  }

  return isParenthesizedNegative ? -Math.abs(parsed) : parsed;
}

function getReceiptInvoiceDate_(prepRows) {
  const datedRows = prepRows.filter(function (row) {
    return row.invoicedAt || row.createdAt;
  });

  if (!datedRows.length) {
    return new Date();
  }

  return datedRows
    .map(function (row) { return row.invoicedAt || row.createdAt; })
    .sort(function (a, b) { return a.getTime() - b.getTime(); })[0];
}

function getReceiptTotalAmount_(prepRows) {
  return round2_(
    prepRows.reduce(function (sum, row) {
      return sum + Number(row.finalBilledAmount || 0);
    }, 0)
  );
}

function getReceiptTemplateFile_() {
  const templateDocId = safeStr_(typeof RECEIPT_TEMPLATE_DOC_ID !== "undefined" ? RECEIPT_TEMPLATE_DOC_ID : "");

  if (!templateDocId) {
    throw new Error("Missing RECEIPT_TEMPLATE_DOC_ID. Update 00_Config.gs with the receipt template Google Doc ID.");
  }

  try {
    return DriveApp.getFileById(templateDocId);
  } catch (error) {
    throw new Error(
      "Missing/invalid RECEIPT_TEMPLATE_DOC_ID. Update 00_Config.gs with a valid receipt template Google Doc ID. " +
      safeStr_(error && error.message ? error.message : error)
    );
  }
}

function copyReceiptTemplate_({ receiptNumber, invoiceNumber, periodStart, periodEnd, clientName }) {
  const templateFile = getReceiptTemplateFile_();

  const name =
    `Clean Energy Housekeeping Receipt ${receiptNumber} ` +
    `(Invoice ${invoiceNumber}) ` +
    `(${formatDateShort_(periodStart)} - ${formatDateShort_(periodEnd)})` +
    (clientName ? ` - ${clientName}` : "");

  let copy;
  if (RECEIPT_FOLDER_ID) {
    const folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);
    copy = templateFile.makeCopy(name, folder);
  } else if (INVOICE_FOLDER_ID) {
    const folder = DriveApp.getFolderById(INVOICE_FOLDER_ID);
    copy = templateFile.makeCopy(name, folder);
  } else {
    copy = templateFile.makeCopy(name);
  }

  return copy.getId();
}

function createPdfCopyForReceipt_(docId) {
  const docFile = DriveApp.getFileById(docId);
  const pdfName = docFile.getName() + ".pdf";
  const pdfBlob = docFile.getBlob().getAs(MimeType.PDF).setName(pdfName);

  let pdfFile;
  if (RECEIPT_FOLDER_ID) {
    pdfFile = DriveApp.getFolderById(RECEIPT_FOLDER_ID).createFile(pdfBlob);
  } else if (INVOICE_FOLDER_ID) {
    pdfFile = DriveApp.getFolderById(INVOICE_FOLDER_ID).createFile(pdfBlob);
  } else {
    pdfFile = DriveApp.createFile(pdfBlob);
  }

  return pdfFile;
}
/* end[receipt_doc_helpers] */

/* begin[receipt_tables] */
function setReceiptServiceTableColumnWidths_(table) {
  const totalPts = 540;
  const pct = [0.14, 0.66, 0.20];

  for (let c = 0; c < pct.length; c++) {
    const w = Math.round(totalPts * pct[c]);
    for (let r = 0; r < table.getNumRows(); r++) {
      try { table.getCell(r, c).setWidth(w); } catch (e) {}
    }
  }
}

function styleReceiptServiceItemsTable_(table) {
  const headerBg = "#333b42";
  const headerText = "#ffffff";
  const borderColor = "#666666";
  const altRow = "#f5f5f5";

  const numRows = table.getNumRows();
  const numCols = table.getRow(0).getNumCells();

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = table.getCell(r, c);
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(6).setPaddingRight(6);

      try { cell.setBorderWidth(1); cell.setBorderColor(borderColor); } catch (_) {}

      if (r === 0) {
        cell.setBackgroundColor(headerBg);

        for (let i = 0; i < cell.getNumChildren(); i++) {
          const child = cell.getChild(i);
          if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

          const p = child.asParagraph();
          const t = p.editAsText();

          t.setFontFamily("Courier New")
            .setFontSize(10)
            .setForegroundColor(headerText)
            .setBold(true);

          p.setAlignment(DocumentApp.HorizontalAlignment.LEFT);
        }

        continue;
      }

      cell.setBackgroundColor((r % 2 === 0) ? altRow : "#ffffff");

      for (let i = 0; i < cell.getNumChildren(); i++) {
        const child = cell.getChild(i);
        if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

        const p = child.asParagraph();
        const t = p.editAsText();
        const line = t.getText() || "";

        p.setAlignment(c === 2 ? DocumentApp.HorizontalAlignment.RIGHT : DocumentApp.HorizontalAlignment.LEFT);

        t.setFontFamily("Courier New")
          .setFontSize(10)
          .setBold(false)
          .setForegroundColor("#000000");

        if (c === 1) {
          const trimmedLine = line.trim();
          const isNoteLine = /^\s+/.test(line);
          const isNotesHeader = trimmedLine === "Notes/extras";
          const isAdjustmentReason = /^(Discount reason:|Fee reason:|Billing note:)/.test(trimmedLine);

          if (isNotesHeader || isAdjustmentReason) {
            t.setBold(true);
          } else if (isNoteLine) {
            t.setBold(false);
          } else if (i === 0) {
            t.setFontSize(11).setBold(true);
          }
        }

        if (c === 2) {
          const trimmedLine = line.trim();
          const isDiscountLine = /^Discount:/.test(trimmedLine);
          const isTotalLine = /^Total:?/.test(trimmedLine);
          const isSingleLineAmount = cell.getNumChildren() === 1;

          if (isTotalLine || (isSingleLineAmount && !isDiscountLine)) {
            t.setBold(true);
          } else {
            t.setBold(false);
          }
        }
      }
    }
  }
}

function insertReceiptServiceItemsTable_(body, rows) {
  const found = body.findText(escapeForRegex_("{{INV_SERVICE_ITEMS}}"));
  if (!found) throw new Error("Could not find {{INV_SERVICE_ITEMS}} in the receipt document.");

  const text = found.getElement().asText();
  const startOffset = found.getStartOffset();
  const endOffset = found.getEndOffsetInclusive();
  const parent = text.getParent();
  const parentIndex = body.getChildIndex(parent);

  text.deleteText(startOffset, endOffset);

  const tableData = [["Date", "Details", "Amount Paid"]];

  rows.forEach(function (row) {
    tableData.push([
      row.date || "",
      row.details || "",
      row.amountDisplay || ((row.amount != null && row.amount !== "") ? money_(row.amount) : ""),
    ]);
  });

  const table = body.insertTable(parentIndex + 1, tableData);
  setReceiptServiceTableColumnWidths_(table);
  styleReceiptServiceItemsTable_(table);
}

function insertReceiptTotalsSection_(body, totals) {
  const found = body.findText(escapeForRegex_("{{INV_TOTALS_SECTION}}"));
  if (!found) throw new Error("Could not find {{INV_TOTALS_SECTION}} in the receipt document.");

  const text = found.getElement().asText();
  const startOffset = found.getStartOffset();
  const endOffset = found.getEndOffsetInclusive();
  const parent = text.getParent();
  const parentIndex = body.getChildIndex(parent);

  text.deleteText(startOffset, endOffset);

  const table = body.insertTable(parentIndex + 1, [["", ""]]);

  try {
    table.setBorderWidth(1);
    table.setBorderColor("#ffffff");
  } catch (_) {}

  const labelCell = table.getCell(0, 0);
  const valueCell = table.getCell(0, 1);

  labelCell.clear();
  valueCell.clear();

  try { labelCell.setWidth(430); } catch (_) {}
  try { valueCell.setWidth(110); } catch (_) {}

  [labelCell, valueCell].forEach(function (cell) {
    cell.setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(4).setPaddingRight(4);
    try { cell.setBorderWidth(1); } catch (_) {}
    try { cell.setBorderColor("#ffffff"); } catch (_) {}
  });

  const labels = [
    "Invoice Total:",
    "Amount Paid:",
    "Balance Due:",
  ];

  const values = [
    money_(totals.invoiceTotal),
    money_(totals.amountPaid),
    money_(totals.balanceDue),
  ];

  labels.forEach(function (line, index) {
    const isBalanceDue = line === "Balance Due:";

    const labelParagraph = labelCell.appendParagraph(line);
    labelParagraph.editAsText()
      .setFontFamily("Courier New")
      .setFontSize(10)
      .setForegroundColor("#000000")
      .setBold(isBalanceDue);
    labelParagraph.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

    const valueParagraph = valueCell.appendParagraph(values[index]);
    valueParagraph.editAsText()
      .setFontFamily("Courier New")
      .setFontSize(10)
      .setForegroundColor("#000000")
      .setBold(isBalanceDue);
    valueParagraph.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  });
}
/* end[receipt_tables] */

/* begin[receipt_creation] */
function createReceiptFromInvoicePrepRows_({ invoiceNumber, receiptNumber, paymentDate, paymentMethod, amountPaid, prepRows }) {
  if (!prepRows || !prepRows.length) {
    throw new Error("No invoiced Invoice Prep rows found for invoice " + invoiceNumber + ".");
  }

  const sortedRows = prepRows.slice().sort(function (a, b) {
    const dateDiff = a.serviceDate.getTime() - b.serviceDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.property.localeCompare(b.property);
  });

  const clientName = sortedRows[0].client;
  const periodStart = sortedRows[0].serviceDate;
  const periodEnd = sortedRows[sortedRows.length - 1].serviceDate;
  const invoiceDate = getReceiptInvoiceDate_(sortedRows);
  const invoiceTotal = getReceiptTotalAmount_(sortedRows);
  const effectiveAmountPaid = amountPaid > 0 ? round2_(amountPaid) : invoiceTotal;
  const balanceDue = Math.max(0, round2_(invoiceTotal - effectiveAmountPaid));
  const effectiveReceiptNumber = buildReceiptNumber_(invoiceNumber, receiptNumber);
  const effectivePaymentDate = paymentDate || new Date();
  const effectivePaymentMethod = safeStr_(paymentMethod) || "Payment received";

  const serviceRows = buildServiceRowsFromInvoicePrepRows_(sortedRows);

  const docId = copyReceiptTemplate_({
    receiptNumber: effectiveReceiptNumber,
    invoiceNumber: invoiceNumber,
    periodStart: periodStart,
    periodEnd: periodEnd,
    clientName: clientName,
  });

  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();

  replaceAll_(body, "{{RECEIPT_NUMBER}}", effectiveReceiptNumber);
  replaceAll_(body, "{{INVOICE_NUMBER}}", safeStr_(invoiceNumber));
  replaceAll_(body, "{{DATE_RANGE}}", `${formatDateShort_(periodStart)} - ${formatDateShort_(periodEnd)}`);
  replaceAll_(body, "{{INV_DATE}}", formatDateShort_(invoiceDate));
  replaceAll_(body, "{{PAY_DATE}}", formatDateShort_(effectivePaymentDate));
  replaceAll_(body, "{{PAYMENT_METHOD}}", effectivePaymentMethod);
  replaceAll_(body, "{{CLIENT_NAME}}", clientName || "");

  insertReceiptServiceItemsTable_(body, serviceRows);
  insertReceiptTotalsSection_(body, {
    invoiceTotal: invoiceTotal,
    amountPaid: effectiveAmountPaid,
    balanceDue: balanceDue,
  });

  doc.saveAndClose();

  const pdfFile = createPdfCopyForReceipt_(docId);

  return {
    receiptNumber: effectiveReceiptNumber,
    invoiceNumber: safeStr_(invoiceNumber),
    docId: docId,
    docUrl: DriveApp.getFileById(docId).getUrl(),
    pdfId: pdfFile.getId(),
    pdfUrl: pdfFile.getUrl(),
    amountPaid: effectiveAmountPaid,
    balanceDue: balanceDue,
  };
}

/* begin[receipt_creation_from_invoice_records] */

function hasUsableInvoiceRecordForReceipt_(invoiceRecord) {
  if (!invoiceRecord) {
    return false;
  }

  if (Number(invoiceRecord.invoiceTotal || 0) <= 0) {
    return false;
  }

  try {
    const parsed = parseInvoiceRecordServiceRows_(invoiceRecord);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch (error) {
    return false;
  }
}


function createReceiptFromInvoiceRecord_({ invoiceRecord, invoiceNumber, receiptNumber, paymentDate, paymentMethod, amountPaid }) {
  if (!invoiceRecord) {
    throw new Error("Invoice Record not found for invoice " + invoiceNumber + ".");
  }

  const serviceRows = parseInvoiceRecordServiceRows_(invoiceRecord);
  const periodStart = invoiceRecord.periodStart || new Date();
  const periodEnd = invoiceRecord.periodEnd || periodStart;
  const invoiceDate = invoiceRecord.invoiceDate || periodEnd;
  const invoiceTotal = round2_(Number(invoiceRecord.invoiceTotal || 0));
  const effectiveAmountPaid = amountPaid > 0 ? round2_(amountPaid) : invoiceTotal;
  const balanceDue = Math.max(0, round2_(invoiceTotal - effectiveAmountPaid));
  const effectiveReceiptNumber = buildReceiptNumber_(invoiceNumber, receiptNumber);
  const effectivePaymentDate = paymentDate || new Date();
  const effectivePaymentMethod = safeStr_(paymentMethod) || "Payment received";

  const docId = copyReceiptTemplate_({
    receiptNumber: effectiveReceiptNumber,
    invoiceNumber: invoiceNumber,
    periodStart: periodStart,
    periodEnd: periodEnd,
    clientName: invoiceRecord.client,
  });

  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();

  replaceAll_(body, "{{RECEIPT_NUMBER}}", effectiveReceiptNumber);
  replaceAll_(body, "{{INVOICE_NUMBER}}", safeStr_(invoiceNumber));
  replaceAll_(body, "{{DATE_RANGE}}", `${formatDateShort_(periodStart)} - ${formatDateShort_(periodEnd)}`);
  replaceAll_(body, "{{INV_DATE}}", formatDateShort_(invoiceDate));
  replaceAll_(body, "{{PAY_DATE}}", formatDateShort_(effectivePaymentDate));
  replaceAll_(body, "{{PAYMENT_METHOD}}", effectivePaymentMethod);
  replaceAll_(body, "{{CLIENT_NAME}}", invoiceRecord.client || "");

  insertReceiptServiceItemsTable_(body, serviceRows);
  insertReceiptTotalsSection_(body, {
    invoiceTotal: invoiceTotal,
    amountPaid: effectiveAmountPaid,
    balanceDue: balanceDue,
  });

  doc.saveAndClose();

  const pdfFile = createPdfCopyForReceipt_(docId);

  return {
    receiptNumber: effectiveReceiptNumber,
    invoiceNumber: safeStr_(invoiceNumber),
    docId: docId,
    docUrl: DriveApp.getFileById(docId).getUrl(),
    pdfId: pdfFile.getId(),
    pdfUrl: pdfFile.getUrl(),
    amountPaid: effectiveAmountPaid,
    balanceDue: balanceDue,
  };
}

/* end[receipt_creation_from_invoice_records] */

function writeReceiptControlRowFailure_(sheet, idx, sheetRow, error) {
  const message = safeStr_(error && error.message ? error.message : error);
  sheet.getRange(sheetRow, idx["Receipt Created"] + 1).setValue(false);
  sheet.getRange(sheetRow, idx["Notes"] + 1).setValue("Receipt error: " + message);
}

function createReceiptsFromReceiptControl_() {
  const controlSheet = ensureReceiptControlSheet_();
  const idx = getReceiptControlIndexMap_(controlSheet);
  const lastRow = controlSheet.getLastRow();

  if (lastRow < 2) {
    throw new Error("Receipt Control has no receipt rows. Add at least an Invoice Number first.");
  }

  const values = controlSheet.getRange(2, 1, lastRow - 1, controlSheet.getLastColumn()).getValues();
  const created = [];
  const failures = [];

  values.forEach(function (row, offset) {
    const sheetRow = offset + 2;
    const invoiceNumber = safeStr_(row[idx["Invoice Number"]]);
    const alreadyCreated = isTruthyInvoicePrepValue_(row[idx["Receipt Created"]]);

    if (!invoiceNumber || alreadyCreated) {
      return;
    }

    try {
      const invoiceRecord = getInvoiceRecordByInvoiceNumber_(invoiceNumber);
      const useInvoiceRecord = hasUsableInvoiceRecordForReceipt_(invoiceRecord);
      const prepRows = useInvoiceRecord ? [] : getInvoicePrepRowsByInvoiceNumber_(invoiceNumber);
      const receiptNumber = safeStr_(row[idx["Receipt Number"]]);
      const paymentDate = coerceToDate_(row[idx["Payment Date"]]) || new Date();
      const paymentMethod = safeStr_(row[idx["Payment Method"]]);
      const amountPaid = coerceReceiptCurrencyNumber_(row[idx["Amount Paid"]]);

      const result = useInvoiceRecord
        ? createReceiptFromInvoiceRecord_({
          invoiceRecord: invoiceRecord,
          invoiceNumber: invoiceNumber,
          receiptNumber: receiptNumber,
          paymentDate: paymentDate,
          paymentMethod: paymentMethod,
          amountPaid: amountPaid,
        })
        : createReceiptFromInvoicePrepRows_({
          invoiceNumber: invoiceNumber,
          receiptNumber: receiptNumber,
          paymentDate: paymentDate,
          paymentMethod: paymentMethod,
          amountPaid: amountPaid,
          prepRows: prepRows,
        });

      controlSheet.getRange(sheetRow, idx["Receipt Number"] + 1).setValue(result.receiptNumber);
      controlSheet.getRange(sheetRow, idx["Payment Date"] + 1).setValue(paymentDate);
      controlSheet.getRange(sheetRow, idx["Amount Paid"] + 1).setValue(result.amountPaid);
      controlSheet.getRange(sheetRow, idx["Receipt Created"] + 1).setValue(true);
      controlSheet.getRange(sheetRow, idx["Receipt PDF Link"] + 1).setValue(result.pdfUrl);
      controlSheet.getRange(sheetRow, idx["Receipt Doc Link"] + 1).setValue(result.docUrl);
      controlSheet.getRange(sheetRow, idx["Receipt Created At"] + 1).setValue(new Date());
      controlSheet.getRange(sheetRow, idx["Notes"] + 1).setValue("");

      created.push(result);
    } catch (error) {
      writeReceiptControlRowFailure_(controlSheet, idx, sheetRow, error);
      failures.push("Row " + sheetRow + ": " + safeStr_(error && error.message ? error.message : error));
    }
  });

  ensureReceiptControlSheet_();

  if (failures.length) {
    Logger.log("Receipt creation failures: " + JSON.stringify(failures, null, 2));
  }

  if (!created.length && failures.length) {
    throw new Error("No receipts created. " + failures.join(" | "));
  }

  if (!created.length) {
    throw new Error("No receipts created. Add an Invoice Number or clear Receipt Created for a row you want to rerun.");
  }

  Logger.log("Receipts created: " + JSON.stringify(created, null, 2));
  return created;
}

function createReceiptsFromReceiptControl() {
  return createReceiptsFromReceiptControl_();
}
/* end[receipt_creation] */
