/* begin[relay_event_ledger] */
const RELAY_LEDGER_HEADERS_ = [
  "Event ID",
  "Payload Digest",
  "State",
  "Cleaner Subject",
  "Device ID",
  "Device Sequence",
  "Event Type",
  "Client Timestamp",
  "Received At",
  "Applied At",
  "Result Code",
];

const RELAY_LEDGER_STATE_PROCESSING_ = "PROCESSING";
const RELAY_LEDGER_STATE_APPLIED_ = "APPLIED";
const RELAY_LEDGER_STATE_REJECTED_ = "REJECTED";

function getRelayLedgerContext_(config) {
  const sheet = config.spreadsheet.getSheetByName(config.ledgerSheetName);
  if (!sheet || sheet.getLastColumn() !== RELAY_LEDGER_HEADERS_.length) {
    return null;
  }

  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    return null;
  }
  const headers = values[0].map(function (header) {
    return safeStr_(header);
  });
  if (headers.join("\n") !== RELAY_LEDGER_HEADERS_.join("\n")) {
    return null;
  }

  const indexes = {};
  RELAY_LEDGER_HEADERS_.forEach(function (header, index) {
    indexes[header] = index;
  });
  return {
    sheet: sheet,
    indexes: indexes,
    values: values,
  };
}

function findRelayLedgerEvent_(context, eventId) {
  const matches = [];
  for (let rowIndex = 1; rowIndex < context.values.length; rowIndex += 1) {
    if (safeStr_(context.values[rowIndex][context.indexes["Event ID"]]) === eventId) {
      matches.push({
        rowNumber: rowIndex + 1,
        values: context.values[rowIndex],
      });
    }
  }
  if (matches.length > 1) {
    return { corrupt: true };
  }
  if (!matches.length) {
    return null;
  }

  const match = matches[0];
  return {
    corrupt: false,
    rowNumber: match.rowNumber,
    eventId: safeStr_(match.values[context.indexes["Event ID"]]),
    payloadDigest: safeStr_(match.values[context.indexes["Payload Digest"]]),
    cleanerSubject: safeStr_(match.values[context.indexes["Cleaner Subject"]]),
    deviceId: safeStr_(match.values[context.indexes["Device ID"]]),
    deviceSequence: Number(match.values[context.indexes["Device Sequence"]]),
    eventType: safeStr_(match.values[context.indexes["Event Type"]]),
    clientTimestamp: Number(match.values[context.indexes["Client Timestamp"]]),
    state: safeStr_(match.values[context.indexes.State]),
    resultCode: safeStr_(match.values[context.indexes["Result Code"]]),
  };
}

function appendRelayProcessingEvent_(context, event, nowMs) {
  const rowNumber = context.values.length + 1;
  context.sheet.appendRow([
    event.eventId,
    event.payloadDigest,
    RELAY_LEDGER_STATE_PROCESSING_,
    event.cleanerSubject,
    event.deviceId,
    event.deviceSequence,
    event.eventType,
    event.submittedAtMs,
    new Date(nowMs),
    "",
    "",
  ]);
  return rowNumber;
}

function setRelayLedgerOutcome_(context, rowNumber, state, resultCode, nowMs) {
  const rowRange = context.sheet.getRange(
    rowNumber,
    1,
    1,
    RELAY_LEDGER_HEADERS_.length
  );
  const rowValues = rowRange.getValues()[0];
  rowValues[context.indexes.State] = state;
  rowValues[context.indexes["Applied At"]] =
    state === RELAY_LEDGER_STATE_APPLIED_ ? new Date(nowMs) : "";
  rowValues[context.indexes["Result Code"]] = resultCode;
  rowRange.setValues([rowValues]);
}

function getRelayContiguousAppliedSequence_(context, cleanerSubject, deviceId) {
  const appliedSequences = new Set();
  for (let rowIndex = 1; rowIndex < context.values.length; rowIndex += 1) {
    const row = context.values[rowIndex];
    if (
      safeStr_(row[context.indexes["Cleaner Subject"]]) !== cleanerSubject ||
      safeStr_(row[context.indexes["Device ID"]]) !== deviceId ||
      safeStr_(row[context.indexes.State]) !== RELAY_LEDGER_STATE_APPLIED_
    ) {
      continue;
    }
    const sequence = Number(row[context.indexes["Device Sequence"]]);
    if (Number.isSafeInteger(sequence) && sequence > 0) {
      appliedSequences.add(sequence);
    }
  }

  let contiguousSequence = 0;
  while (appliedSequences.has(contiguousSequence + 1)) {
    contiguousSequence += 1;
  }
  return contiguousSequence;
}
/* end[relay_event_ledger] */
