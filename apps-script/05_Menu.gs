/* begin[custom_menu_on_open] */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu("Clean Energy")
    .addSubMenu(
      ui.createMenu("Invoice Flow")
        .addItem("1. Open Time Tracker", "openTimeTrackerSheet")
        .addItem("2. Open Invoice Control", "openInvoiceControlSheet")
        .addItem("3. Rebuild Invoice Prep", "generateInvoicePrepFromTimeTracker")
       .addItem("4. Open Invoice Prep", "openInvoicePrepSheet")
.addSeparator()
.addItem("5. Create Invoices", "createInvoicesFromInvoicePrep")
    )
    .addSubMenu(
      ui.createMenu("Payroll Flow")
        .addItem("1. Open Time Tracker", "openTimeTrackerSheet")
        .addItem("2. Open Payroll Control", "runSetupPayroll")
        .addItem("3. Populate Payroll Prep", "runPopulatePayrollPrep")
        .addItem("4. Open Payroll Prep", "openPayrollPrepSheet")
        .addItem("5. Generate Payroll Preview", "runGeneratePayroll")
        .addItem("6. Open Payroll Preview", "openPayrollPreviewSheet")
        .addSeparator()
        .addItem("7. Generate Payroll PDFs", "runGeneratePayrollPdfs")
    )
    .addSeparator()
    .addItem("Open Properties", "openPropertiesSheet")
    .addItem("Open Users", "openUsersSheet")
    .addToUi();
}
/* end[custom_menu_on_open] */


/* begin[menu_sheet_openers] */
function openSheetByName_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Sheet not found: "' + sheetName + '"');
  }

  ss.setActiveSheet(sheet);
}

function openTimeTrackerSheet() {
  openSheetByName_(TIME_SHEET_NAME);
}

function openInvoiceControlSheet() {
  openSheetByName_(INVOICE_CONTROL_SHEET_NAME);
}

function openInvoicePrepSheet() {
  openSheetByName_(INVOICE_PREP_SHEET_NAME);
}

function openInvoiceAdjustmentsSheet() {
  openSheetByName_(INVOICE_ADJUSTMENTS_SHEET_NAME);
}

function openPayrollPrepSheet() {
  openSheetByName_(PAYROLL_PREP_SHEET_NAME);
}

function openPayrollPreviewSheet() {
  openSheetByName_(PAYROLL_PREVIEW_SHEET_NAME);
}

function openPropertiesSheet() {
  openSheetByName_(PROPERTIES_SHEET_NAME);
}

function openUsersSheet() {
  openSheetByName_(USERS_SHEET_NAME);
}
/* end[menu_sheet_openers] */