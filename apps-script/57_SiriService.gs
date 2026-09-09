/* begin[siri_test_service] */
function validateSiriOperation_(config, operation, payload) {
  if (!siriTestEnabled_(config) || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const keys = Object.keys(payload).sort().join(",");
  if (operation === "siri_shift_status") {
    return keys === "cleanerSubject" && typeof payload.cleanerSubject === "string" &&
      /^cehusr_v1_[A-Za-z0-9_-]{43}$/.test(payload.cleanerSubject) ? payload : null;
  }
  if (operation === "resolve_siri_cleaner") {
    if (keys !== "cleanerName" || typeof payload.cleanerName !== "string" ||
        !payload.cleanerName.trim() || payload.cleanerName.length > 500) return null;
    return payload;
  }
  if (operation !== "reconcile_siri_note" ||
      keys !== "captured_at,cleanerSubject,note,note_type,payloadDigest,request_id" ||
      typeof payload.request_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(payload.request_id) ||
      typeof payload.captured_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.captured_at) ||
      !Number.isFinite(Date.parse(payload.captured_at)) || new Date(payload.captured_at).toISOString() !== payload.captured_at ||
      ["cleaning", "deep_clean", "property"].indexOf(payload.note_type) === -1 ||
      typeof payload.note !== "string" || !payload.note.trim() || Array.from(payload.note).length > 1000 ||
      !/^cehusr_v1_[A-Za-z0-9_-]{43}$/.test(payload.cleanerSubject) ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.payloadDigest)) return null;
  return payload;
}

function resolveSiriCleaner_(config, name, subject) {
  const users = getRelayUserRecords_(config);
  if (!users) return null;
  const matches = users.filter(function (user) { return subject ? user.subject === subject : user.name === name; });
  if (matches.length !== 1 || !matches[0].active || users.filter(function (user) {
    return user.name === matches[0].name;
  }).length !== 1) return null;
  return matches[0];
}

function readSiriTable_(config, name, headers) {
  const sheet = config.spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("Siri table unavailable");
  const values = sheet.getDataRange().getValues();
  const indexes = {};
  headers.forEach(function (header) {
    const matches = values[0].reduce(function (found, value, index) {
      if (String(value) === header) found.push(index);
      return found;
    }, []);
    if (matches.length !== 1) throw new Error("Siri header unavailable");
    indexes[header] = matches[0];
  });
  return { sheet: sheet, rows: values.slice(1), indexes: indexes };
}

function resolveSiriShift_(config, cleaner, input) {
  const table = readSiriTable_(config, TIME_SHEET_NAME, ["Name", "Property", "Clock In", "Clock Out", "Clock Out Note"]);
  const idx = table.indexes;
  const captured = Date.parse(input.captured_at);
  const candidates = [];
  let overlappingOpen = false;
  let invalid = false;
  table.rows.forEach(function (row, index) {
    if (safeStr_(row[idx.Name]) !== cleaner.name) return;
    const start = coerceToDate_(row[idx["Clock In"]]);
    const end = coerceToDate_(row[idx["Clock Out"]]);
    if (!start || (row[idx["Clock Out"]] && !end) || (end && end.getTime() < start.getTime())) { invalid = true; return; }
    if (!end) { if (start.getTime() <= captured) overlappingOpen = true; return; }
    if (start.getTime() <= captured && captured <= end.getTime()) {
      candidates.push({ rowNumber: index + 2, property: safeStr_(row[idx.Property]),
        clockInMs: start.getTime(), clockOutMs: end.getTime() });
    }
  });
  if (invalid || candidates.length > 1 || (candidates.length && overlappingOpen)) return { state: "needs_review" };
  if (!candidates.length) return { state: "waiting_shift" };
  const shift = candidates[0];
  const properties = readSiriTable_(config, "Properties", ["Property Name", "Deep Clean Items"]);
  const matches = [];
  properties.rows.forEach(function (row, index) {
    if (safeStr_(row[properties.indexes["Property Name"]]) === shift.property) matches.push(index + 2);
  });
  if (!shift.property || matches.length !== 1) return { state: "needs_review" };
  return { state: "pinned", table: table, properties: properties, shift: shift, propertyRow: matches[0],
    pin: { spreadsheetId: config.spreadsheet.getId(), timeSheetId: table.sheet.getSheetId(),
      propertySheetId: properties.sheet.getSheetId(), cleanerName: cleaner.name, property: shift.property,
      clockInMs: shift.clockInMs, clockOutMs: shift.clockOutMs } };
}

function siriResult_(operation, record) {
  return buildRelayResult_(operation, true, record.state, false, {
    request_id: record.input.request_id, payloadDigest: record.digest, pin: record.pin || null,
  });
}

function formatSiriNote_(record) {
  return "[" + Utilities.formatDate(new Date(record.input.captured_at), Session.getScriptTimeZone(),
    "yyyy-MM-dd h:mm a") + "] " + record.pin.cleanerName + " — " + record.input.note;
}

function applySiriCleaningNote_(ledger, entry, resolved) {
  const cell = resolved.table.sheet.getRange(resolved.shift.rowNumber, resolved.table.indexes["Clock Out Note"] + 1);
  const existing = String(cell.getValue() ?? "");
  // Preserve existing bytes; request identity, not note-text equality, provides deduplication.
  const after = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + "• " + entry.record.input.note;
  const target = JSON.stringify(["cleaning", entry.record.pin]);
  return applySiriCellMutation_(ledger, entry, cell, target, after);
}

function appendSiriDeepCleanNote_(ledger, entry, resolved) {
  const cell = resolved.properties.sheet.getRange(resolved.propertyRow, resolved.properties.indexes["Deep Clean Items"] + 1);
  const existing = String(cell.getValue() ?? "");
  const after = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + formatSiriNote_(entry.record);
  const target = JSON.stringify(["deep_clean", entry.record.pin.spreadsheetId,
    entry.record.pin.propertySheetId, entry.record.pin.property]);
  return applySiriCellMutation_(ledger, entry, cell, target, after);
}

function deliverSiriPropertyEmail_(ledger, entry) {
  const record = entry.record;
  if (!record.review) {
    record.review = formatSiriNote_(record) + "\nProperty: " + record.pin.property;
    record.email = "pending";
    saveSiriRecord_(ledger, entry);
  }
  if (record.email !== "pending") return;
  // Quota failure before send remains retryable. Every ambiguous send is held, never resent automatically.
  if (MailApp.getRemainingDailyQuota() < 1) return;
  record.email = "uncertain";
  saveSiriRecord_(ledger, entry);
  try {
    MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: "Property note for review", body: record.review });
  } catch (_) { return; }
  record.email = "sent";
  saveSiriRecord_(ledger, entry);
}

function processSiriNote_(config, operation, payload, nowMs) {
  if (!siriTestEnabled_(config)) return buildRelayFailure_(operation, "invalid_event", false);
  if (operation === "resolve_siri_cleaner") {
    const cleaner = resolveSiriCleaner_(config, payload.cleanerName, null);
    return cleaner ? buildRelayResult_(operation, true, "resolved", false,
      { cleanerName: cleaner.name, cleanerSubject: cleaner.subject }) : buildRelayFailure_(operation, "cleaner_ambiguous_or_inactive", false);
  }
  const ledger = getSiriLedgerContext_(config);
  let entry = findSiriRequest_(ledger, payload.request_id);
  const input = { request_id: payload.request_id, captured_at: payload.captured_at, note_type: payload.note_type, note: payload.note };
  if (entry && (entry.record.digest !== payload.payloadDigest || entry.record.subject !== payload.cleanerSubject ||
      JSON.stringify(entry.record.input) !== JSON.stringify(input))) return buildRelayFailure_(operation, "event_conflict", false);
  if (!entry) {
    entry = { rowNumber: ledger.values.length + 1, record: { input: input, digest: payload.payloadDigest,
      subject: payload.cleanerSubject, state: "accepted", receivedAtMs: nowMs, pin: null } };
    saveSiriRecord_(ledger, entry);
  }
  const record = entry.record;
  if (record.state === "completed" || record.state === "needs_review") return siriResult_(operation, record);
  const cleaner = resolveSiriCleaner_(config, null, payload.cleanerSubject);
  const resolved = cleaner ? resolveSiriShift_(config, cleaner, input) : { state: "needs_review" };
  if (record.pin && (!resolved.pin || JSON.stringify(record.pin) !== JSON.stringify(resolved.pin))) {
    record.state = "needs_review";
    saveSiriRecord_(ledger, entry);
    return siriResult_(operation, record);
  }
  if (!record.pin) {
    record.state = resolved.state;
    if (resolved.pin) record.pin = resolved.pin;
    saveSiriRecord_(ledger, entry);
  }
  if (record.state !== "pinned") return siriResult_(operation, record);
  if (input.note_type === "cleaning" && !applySiriCleaningNote_(ledger, entry, resolved)) return siriResult_(operation, record);
  if (input.note_type === "deep_clean" && !appendSiriDeepCleanNote_(ledger, entry, resolved)) return siriResult_(operation, record);
  if (input.note_type === "property") {
    deliverSiriPropertyEmail_(ledger, entry);
    if (record.email === "pending") return siriResult_(operation, record);
  }
  if (record.state === "pinned") {
    record.state = "completed";
    record.completedAtMs = nowMs;
    saveSiriRecord_(ledger, entry);
  }
  return siriResult_(operation, record);
}
/* end[siri_test_service] */

/* begin[siri_active_shift_preflight] */
function processSiriShiftStatus_(config, operation, payload, nowMs) {
  if (!siriTestEnabled_(config)) return buildRelayFailure_(operation, "invalid_event", false);
  const cleaner = resolveSiriCleaner_(config, null, payload.cleanerSubject);
  if (!cleaner) return buildRelayResult_(operation, true, "no_active_shift", false);
  const table = readSiriTable_(config, TIME_SHEET_NAME, ["Name", "Property", "Clock In", "Clock Out"]);
  const idx = table.indexes;
  let openCount = 0;
  let invalid = false;
  table.rows.forEach(function (row) {
    if (safeStr_(row[idx.Name]) !== cleaner.name) return;
    // Match Time Tracker's raw Clock Out presence check before validating open rows.
    if (row[idx["Clock Out"]]) return;
    const start = coerceToDate_(row[idx["Clock In"]]);
    if (!start || !Number.isFinite(start.getTime()) || start.getTime() > nowMs ||
        !safeStr_(row[idx.Property])) {
      invalid = true;
      return;
    }
    openCount++;
  });
  return buildRelayResult_(operation, true,
    !invalid && openCount === 1 ? "active_shift" : "no_active_shift", false);
}
/* end[siri_active_shift_preflight] */
