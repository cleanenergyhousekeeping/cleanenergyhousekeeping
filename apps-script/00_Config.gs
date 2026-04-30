const TEMPLATE_DOC_ID = "1R9dXwNwg96dxsW5E04-3IQLheIHenBcPimofD3252y4";
const TIME_SHEET_NAME = "Time Tracker";
const DEFAULT_RATE = 50;
const INVOICE_FOLDER_ID = "";
const NOTIFY_EMAIL = "kyle@cleanenergyhousekeeping.com";

const TIME_TRACKER_COLUMNS = [
  "Name",
  "Property",
  "Date",
  "Clock In",
  "Clock Out",
  "Total Hours",
  "Clock In Note",
  "Clock Out Note",
  "Client",
  "Flags",
];

const FORM_COL_TIMESTAMP = "Timestamp";
const FORM_COL_NAME = "Name";
const FORM_COL_PROPERTY = "Property";
const FORM_COL_ACTION = "Clock In / Clock Out";
const FORM_COL_IN_NOTE = "Clock In Note (Optional)";
const FORM_COL_OUT_NOTE = "Clock Out Note (Optional)";
const WEBAPP_PIN_ATTEMPT_LIMIT = 5;
const WEBAPP_PIN_LOCKOUT_SECONDS = 60;
const USERS_SHEET_NAME = "Users";

const USERS_SHEET_COLUMNS = [
  "PIN",
  "Name",
  "Is Active",
  "Role",
  "Access Level",
  "Email",
];

/* begin[invoice_billing_mode_and_adjustment_constants] */
const PROPERTIES_SHEET_NAME = "Properties";
const INVOICE_ADJUSTMENTS_SHEET_NAME = "Invoice Adjustments";

const INVOICE_ADJUSTMENTS_COLUMNS = [
  "Invoice Number",
  "Client",
  "Property",
  "Service Date",
  "Adjustment Type",
  "Description",
  "Amount",
  "Active",
  "Notes",
];

const BILLING_TYPE_HOURLY = "HOURLY";
const BILLING_TYPE_FLAT = "FLAT";

const ADJUSTMENT_TYPE_DISCOUNT = "DISCOUNT";
const ADJUSTMENT_TYPE_CREDIT = "CREDIT";
const ADJUSTMENT_TYPE_FEE = "FEE";
/* end[invoice_billing_mode_and_adjustment_constants] */

/* begin[invoice_prep_config] */
const INVOICE_PREP_SHEET_NAME = "Invoice Prep";
const INVOICE_PREP_ARCHIVE_SHEET_NAME = "Invoice Prep Archive";

const INVOICE_PREP_HEADERS = [
  "Prep ID",
  "Ready",
  "Invoiced",
  "Invoice Number",
  "Invoice Group",
  "Client",
  "Property",
  "Service Date",
  "Cleaner Names",
  "Worked Hours",
  "Default Hourly Rate",
  "Billing Mode",
  "Flat Rate",
  "Row Discount",
  "Row Fee",
  "Final Billed Amount",
  "Billing Note",
  "Cleaner Details Summary",
  "Time Tracker Row Keys",
  "Created At",
  "Invoiced At",
  "Adjustment Note"
];
/* end[invoice_prep_config] */

// begin[webapp_access_levels]
const ACCESS_LEVEL_FULL = "FULL";
const ACCESS_LEVEL_LIMITED = "LIMITED";
// end[webapp_access_levels]

const WEBAPP_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const WEBAPP_SESSION_PREFIX = "ce_session_";

