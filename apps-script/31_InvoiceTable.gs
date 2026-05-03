/* begin[copy_template_invoice_filename_branding] */
function copyTemplate_({ invoiceNumber, periodStart, periodEnd, clientName }) {
  const templateFile = DriveApp.getFileById(TEMPLATE_DOC_ID);

  const name =
    `Clean Energy Housekeeping Invoice ${invoiceNumber} ` +
    `(${formatDateShort_(periodStart)} - ${formatDateShort_(periodEnd)})` +
    (clientName ? ` - ${clientName}` : "");

  let copy;
  if (INVOICE_FOLDER_ID) {
    const folder = DriveApp.getFolderById(INVOICE_FOLDER_ID);
    copy = templateFile.makeCopy(name, folder);
  } else {
    copy = templateFile.makeCopy(name);
  }

  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();

  replaceAll_(body, "{{INVOICE_NUMBER}}", String(invoiceNumber));
  replaceAll_(body, "{{PERIOD_START}}", formatDateShort_(periodStart));
  replaceAll_(body, "{{PERIOD_END}}", formatDateShort_(periodEnd));
  replaceAll_(body, "{{DATE_RANGE}}", `${formatDateShort_(periodStart)} - ${formatDateShort_(periodEnd)}`);
  replaceAll_(body, "{{CLIENT_NAME}}", clientName || "");

  doc.saveAndClose();
  return copy.getId();
}
/* end[copy_template_invoice_filename_branding] */

function replaceAll_(body, findText, replaceWith) {
  body.replaceText(escapeForRegex_(findText), replaceWith);
}

function escapeForRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setServiceTableColumnWidths_(table) {
  const totalPts = 540;
  const pct = [0.12, 0.56, 0.10, 0.10, 0.12];

  for (let c = 0; c < pct.length; c++) {
    const w = Math.round(totalPts * pct[c]);
    for (let r = 0; r < table.getNumRows(); r++) {
      try { table.getCell(r, c).setWidth(w); } catch (e) {}
    }
  }
}

function insertServiceItemsTable_(body, rows) {
  const found = body.findText(escapeForFindText_("{{SERVICE_ITEMS}}"));
  if (!found) throw new Error("Could not find {{SERVICE_ITEMS}} in the document.");

  const text = found.getElement().asText();
  const startOffset = found.getStartOffset();
  const endOffset = found.getEndOffsetInclusive();
  const parent = text.getParent();
  const parentIndex = body.getChildIndex(parent);

  text.deleteText(startOffset, endOffset);

  /* begin[service_table_support_rate_display_text] */
  const tableData = [["Date", "Details", "Hours", "Rate", "Amount"]];
  for (const r of rows) {
    const rateDisplay =
      r.rateDisplay != null && r.rateDisplay !== ""
        ? String(r.rateDisplay)
        : ((r.rate != null && r.rate !== "") ? money_(r.rate) : "");

    tableData.push([
      r.date || "",
      r.details || "",
      (r.hours != null && r.hours !== "") ? Number(r.hours).toFixed(2) : "",
      rateDisplay,
      r.amountDisplay || ((r.amount != null && r.amount !== "") ? money_(r.amount) : ""),
    ]);
  }
  /* end[service_table_support_rate_display_text] */

  const table = body.insertTable(parentIndex + 1, tableData);
  setServiceTableColumnWidths_(table);
  styleServiceItemsTable_(table);
}

function styleServiceItemsTable_(table) {
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
      } else {
        cell.setBackgroundColor((r % 2 === 0) ? altRow : "#ffffff");

        for (let i = 0; i < cell.getNumChildren(); i++) {
          const child = cell.getChild(i);
          if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

          const p = child.asParagraph();
          const t = p.editAsText();
          const line = t.getText() || "";

          p.setAlignment(c >= 2 ? DocumentApp.HorizontalAlignment.RIGHT : DocumentApp.HorizontalAlignment.LEFT);

          // Default body style
          t.setFontFamily("Courier New")
            .setFontSize(10)
            .setBold(false)
            .setForegroundColor("#000000");

          // Special styling for the Details column only
          if (c === 1) {
            const trimmedLine = line.trim();
            const isNoteLine = /^\s+/.test(line);
            const isNotesHeader = trimmedLine === "Notes/extras";
            const isAdjustmentReason = /^(Discount reason:|Fee reason:)/.test(trimmedLine);

            if (isNotesHeader || isAdjustmentReason) {
              t.setFontFamily("Courier New")
                .setFontSize(10)
                .setBold(true);
            } else if (isNoteLine) {
              t.setFontFamily("Courier New")
                .setFontSize(10)
                .setBold(false);
            } else if (i === 0) {
              // First paragraph is the property/address
              t.setFontFamily("Courier New")
                .setFontSize(11)
                .setBold(true);
            } else {
              // Cleaner + time lines
              t.setFontFamily("Courier New")
                .setFontSize(10)
                .setBold(false);
            }
          }
        }
      }
    }
  }
}

function insertTotalsSection_(body, totals, zelleQrFileId) {
  const found = body.findText(escapeForRegex_("{{TOTALS_SECTION}}"));
  if (!found) throw new Error("Could not find {{TOTALS_SECTION}} in the document.");

  const text = found.getElement().asText();
  const startOffset = found.getStartOffset();
  const endOffset = found.getEndOffsetInclusive();
  const parent = text.getParent();
  const parentIndex = body.getChildIndex(parent);

  text.deleteText(startOffset, endOffset);

  const table = body.insertTable(parentIndex + 1, [["", "", ""]]);

  // Make footer width match the service table above
  const leftColWidth = 360;
  const middleColWidth = 110;
  const rightColWidth = 70;
  const colWidths = [leftColWidth, middleColWidth, rightColWidth];

  // Border strategy: white border is more reliable in PDF than zero width
  try {
    table.setBorderWidth(1);
    table.setBorderColor("#ffffff");
  } catch (_) {}

  for (let c = 0; c < 3; c++) {
    const cell = table.getCell(0, c);

    cell.setPaddingTop(2)
      .setPaddingBottom(2)
      .setPaddingLeft(4)
      .setPaddingRight(4);

    try { cell.setWidth(colWidths[c]); } catch (_) {}
    try { cell.setBorderWidth(1); } catch (_) {}
    try { cell.setBorderColor("#ffffff"); } catch (_) {}
  }

  // LEFT COLUMN
  const leftCell = table.getCell(0, 0);
  leftCell.clear();

  const paymentTable = leftCell.appendTable([["", ""]]);

  try {
    paymentTable.setBorderWidth(1);
    paymentTable.setBorderColor("#ffffff");
  } catch (_) {}

  const qrCell = paymentTable.getCell(0, 0);
  const paymentTextCell = paymentTable.getCell(0, 1);

  try { qrCell.setWidth(55); } catch (_) {}
  try { paymentTextCell.setWidth(305); } catch (_) {}

  qrCell.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
  paymentTextCell.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(9).setPaddingRight(0);

  qrCell.setVerticalAlignment(DocumentApp.VerticalAlignment.TOP);
  paymentTextCell.setVerticalAlignment(DocumentApp.VerticalAlignment.TOP);

  try { qrCell.setBorderWidth(1); } catch (_) {}
  try { qrCell.setBorderColor("#ffffff"); } catch (_) {}
  try { paymentTextCell.setBorderWidth(1); } catch (_) {}
  try { paymentTextCell.setBorderColor("#ffffff"); } catch (_) {}

  /* begin[qr_alignment_with_payment_info_fix] */
  // Optional QR image
  if (zelleQrFileId) {
    try {
      const qrBlob = DriveApp.getFileById(zelleQrFileId).getBlob();

      const qrParagraph = qrCell.getChild(0).asParagraph();
      qrParagraph.setSpacingBefore(0);
      qrParagraph.setSpacingAfter(0);
      qrParagraph.setAlignment(DocumentApp.HorizontalAlignment.LEFT);

      const qrImage = qrParagraph.appendInlineImage(qrBlob);
      qrImage.setWidth(72).setHeight(72);
    } catch (error) {
      Logger.log("Could not insert Zelle QR image: " + error);
    }
  }
  /* end[qr_alignment_with_payment_info_fix] */

  const leftPaymentHeader = paymentTextCell.getChild(0).asParagraph();
  leftPaymentHeader.setText("Payment info:");
  leftPaymentHeader.setSpacingBefore(0);
  leftPaymentHeader.setSpacingAfter(0);
  leftPaymentHeader.editAsText()
    .setFontFamily("Courier New")
    .setFontSize(10)
    .setForegroundColor("#666666")
    .setBold(true);
  leftPaymentHeader.setAlignment(DocumentApp.HorizontalAlignment.LEFT);

  const leftLine1 = paymentTextCell.appendParagraph("Please Zelle to");
  leftLine1.setSpacingBefore(0);
  leftLine1.setSpacingAfter(0);
  leftLine1.editAsText()
    .setFontFamily("Courier New")
    .setFontSize(10)
    .setForegroundColor("#666666")
    .setBold(false);
  leftLine1.setAlignment(DocumentApp.HorizontalAlignment.LEFT);

  const leftLine2 = paymentTextCell.appendParagraph("kyle@cleanenergyhousekeeping.com");
  leftLine2.setSpacingBefore(0);
  leftLine2.setSpacingAfter(0);
  leftLine2.editAsText()
    .setFontFamily("Courier New")
    .setFontSize(10)
    .setForegroundColor("#666666")
    .setBold(true);
  leftLine2.setAlignment(DocumentApp.HorizontalAlignment.LEFT);

  

  const leftLine3 = paymentTextCell.appendParagraph("If needed, please email Kyle for more options.");
  leftLine3.setSpacingBefore(0);
  leftLine3.setSpacingAfter(0);
  leftLine3.editAsText()
    .setFontFamily("Courier New")
    .setFontSize(10)
    .setForegroundColor("#666666")
    .setBold(false);
  leftLine3.setAlignment(DocumentApp.HorizontalAlignment.LEFT);

  /* begin[totals_section_support_adjustments_line] */
  // MIDDLE COLUMN: labels
  const middleCell = table.getCell(0, 1);
  middleCell.clear();

  const serviceSubtotalValue =
    totals.serviceSubtotal != null ? Number(totals.serviceSubtotal) : Number(totals.subtotal || 0);
  const adjustmentsValue = Number(totals.adjustments || 0);

  const middleLines = [
    "Total Hours:",
    "Service subtotal:",
  ];

  if (adjustmentsValue !== 0) {
    middleLines.push("Adjustments:");
  }

  middleLines.push("Total tax:");
  middleLines.push("Total amount:");

  middleLines.forEach(function (line) {
    const p = middleCell.appendParagraph(line);
    p.editAsText()
      .setFontFamily("Courier New")
      .setFontSize(10)
      .setForegroundColor("#666666")
      .setBold(false);
    p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  });

  // RIGHT COLUMN: values
  const rightCell = table.getCell(0, 2);
  rightCell.clear();

  const rightLines = [
    safeStr_(totals.hours),
    money_(serviceSubtotalValue),
  ];

  if (adjustmentsValue !== 0) {
    rightLines.push(money_(adjustmentsValue));
  }

  rightLines.push(money_(totals.tax));
  rightLines.push(money_(totals.total));

  rightLines.forEach(function (line) {
    const p = rightCell.appendParagraph(line);
    p.editAsText()
      .setFontFamily("Courier New")
      .setFontSize(10)
      .setForegroundColor("#666666")
      .setBold(false);
    p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  });
  /* end[totals_section_support_adjustments_line] */
}