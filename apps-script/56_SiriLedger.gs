/* begin[siri_test_ledger] */
const SIRI_LEDGER_NAME_ = "Siri Note Ledger";
const SIRI_LEDGER_HEADERS_ = ["Request ID", "Payload Digest", "Cleaner Subject", "State", "Record JSON", "Review"];

function siriTestEnabled_(config) {
  return config && config.environment === "test" &&
    config.spreadsheet.getId() !== RELAY_PRODUCTION_CONFIG_.expectedSpreadsheetId;
}

function getSiriLedgerContext_(config) {
  if (!siriTestEnabled_(config)) throw new Error("Siri TEST only");
  let sheet = config.spreadsheet.getSheetByName(SIRI_LEDGER_NAME_);
  if (!sheet) sheet = config.spreadsheet.insertSheet(SIRI_LEDGER_NAME_);
  let values = sheet.getDataRange().getValues();
  // Recover an interruption between creating the dedicated sheet and writing its header.
  if (values.every(function (row) { return row.every(function (value) { return value === ""; }); })) {
    sheet.getRange(1, 1, 1, SIRI_LEDGER_HEADERS_.length).setValues([SIRI_LEDGER_HEADERS_]);
    SpreadsheetApp.flush();
    values = sheet.getDataRange().getValues();
  }
  if (!values.length || values[0].map(String).join("\n") !== SIRI_LEDGER_HEADERS_.join("\n")) {
    throw new Error("Siri ledger schema unavailable");
  }
  return { sheet: sheet, values: values };
}

function findSiriRequest_(ledger, id) {
  const matches = [];
  ledger.values.slice(1).forEach(function (row, index) {
    if (String(row[0]) === id) matches.push({ rowNumber: index + 2, row: row });
  });
  if (matches.length > 1) throw new Error("Siri ledger duplicate");
  if (!matches.length) return null;
  const match = matches[0];
  const record = JSON.parse(match.row[4]);
  if (!record || !record.input || ["accepted", "waiting_shift", "pinned", "completed", "needs_review"].indexOf(record.state) === -1 ||
      ((record.state === "pinned" || record.state === "completed") && !record.pin) ||
      record.input.request_id !== id || record.digest !== match.row[1] ||
      record.subject !== match.row[2] || record.state !== match.row[3]) throw new Error("Siri ledger corrupt");
  return { rowNumber: match.rowNumber, record: record };
}

function saveSiriRecord_(ledger, entry) {
  const record = entry.record;
  ledger.sheet.getRange(entry.rowNumber, 1, 1, SIRI_LEDGER_HEADERS_.length).setValues([[
    record.input.request_id, record.digest, record.subject, record.state, JSON.stringify(record), record.review || "",
  ]]);
  SpreadsheetApp.flush();
}

function siriTextDigest_(text) {
  return encodeRelayBase64Url_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    relayUtf8Bytes_(text)));
}

function siriMutationBlocked_(ledger, entry, target) {
  return ledger.sheet.getDataRange().getValues().slice(1).some(function (row) {
    if (row[0] === entry.record.input.request_id) return false;
    const other = JSON.parse(row[4]);
    return other.mutation && other.mutation.target === target && other.state !== "completed";
  });
}

function applySiriCellMutation_(ledger, entry, cell, target, afterText) {
  const record = entry.record;
  const current = String(cell.getValue() ?? "");
  if (siriMutationBlocked_(ledger, entry, target)) return false;
  if (!record.mutation) {
    record.mutation = { target: target, before: siriTextDigest_(current),
      after: siriTextDigest_(afterText), text: afterText };
    saveSiriRecord_(ledger, entry);
  }
  if (record.mutation.target !== target) {
    record.state = "needs_review";
    saveSiriRecord_(ledger, entry);
    return false;
  }
  const digest = siriTextDigest_(current);
  if (digest === record.mutation.after) return true;
  if (digest !== record.mutation.before) {
    record.state = "needs_review";
    saveSiriRecord_(ledger, entry);
    return false;
  }
  cell.setValue(record.mutation.text);
  SpreadsheetApp.flush();
  return true;
}
/* end[siri_test_ledger] */
