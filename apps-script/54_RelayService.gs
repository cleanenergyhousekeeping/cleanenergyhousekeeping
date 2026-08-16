/* begin[relay_worker_service] */
const RELAY_EVENT_TYPES_ = ["clock_in", "clock_out", "add_note"];
const RELAY_RECONCILIATION_RESULTS_ = [
  "duplicate_clock_in",
  "ignored_clock_in_already_open",
  "inserted_clock_in",
  "merged_add_note",
  "merged_clock_out",
];

function buildRelayResult_(operation, ok, result, retryable, data) {
  const response = {
    ok: !!ok,
    operation: safeStr_(operation),
    result: result,
    retryable: !!retryable,
  };
  if (data !== undefined) {
    response.data = data;
  }
  return response;
}

function buildRelayFailure_(operation, result, retryable) {
  return buildRelayResult_(operation, false, result, retryable);
}

function createRelayJsonOutput_(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function countRelayCodePoints_(value) {
  return Array.from(value).length;
}

function validateRelayOperation_(request) {
  const operation = safeStr_(request.operation);
  const payload = request.payload;
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return buildRelayFailure_(operation, "invalid_event", false);
  }

  if (operation === "validate_session") {
    const sessionToken = safeStr_(payload.sessionToken);
    const deviceId = safeStr_(payload.deviceId);
    if (
      !/^[A-Za-z0-9_-]{16,256}$/.test(sessionToken) ||
      !/^[A-Za-z][A-Za-z0-9._:-]{15,127}$/.test(deviceId)
    ) {
      return buildRelayFailure_(operation, "invalid_event", false);
    }
    return {
      ok: true,
      operation: operation,
      payload: {
        sessionToken: sessionToken,
        deviceId: deviceId,
      },
    };
  }

  if (operation === "submit_event") {
    const eventId = safeStr_(payload.eventId);
    const payloadDigest = safeStr_(payload.payloadDigest);
    const cleanerSubject = safeStr_(payload.cleanerSubject);
    const deviceId = safeStr_(payload.deviceId);
    const eventType = safeStr_(payload.eventType);
    const property = safeStr_(payload.property);
    const note = typeof payload.note === "string" ? payload.note.trim() : "";
    const deviceSequence = Number(payload.deviceSequence);
    const submittedAtMs = Number(payload.submittedAtMs);

    if (
      !/^[A-Za-z][A-Za-z0-9._:-]{15,127}$/.test(eventId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(payloadDigest) ||
      !/^cehusr_v1_[A-Za-z0-9_-]{43}$/.test(cleanerSubject) ||
      !/^[A-Za-z][A-Za-z0-9._:-]{15,127}$/.test(deviceId) ||
      !Number.isSafeInteger(deviceSequence) ||
      deviceSequence < 1 ||
      RELAY_EVENT_TYPES_.indexOf(eventType) === -1 ||
      !Number.isSafeInteger(submittedAtMs) ||
      submittedAtMs <= 0 ||
      !property ||
      property.length > 500 ||
      countRelayCodePoints_(note) > 1000 ||
      (eventType === "add_note" && !note)
    ) {
      return buildRelayFailure_(operation, "invalid_event", false);
    }

    return {
      ok: true,
      operation: operation,
      payload: {
        eventId: eventId,
        payloadDigest: payloadDigest,
        cleanerSubject: cleanerSubject,
        deviceId: deviceId,
        deviceSequence: deviceSequence,
        eventType: eventType,
        submittedAtMs: submittedAtMs,
        property: property,
        note: note,
      },
    };
  }

  return buildRelayFailure_(operation, "invalid_event", false);
}

function findRelaySessionCleaner_(config, sessionToken) {
  const records = getRelayUserRecords_(config);
  const session = getSession_(sessionToken);
  if (!records || !session) {
    return null;
  }

  const sessionPin = normalizeAccessCode_(session.pin);
  const sessionName = safeStr_(session.name);
  const matches = records.filter(function (record) {
    return record.active && record.pin === sessionPin && record.name === sessionName;
  });
  if (matches.length !== 1) {
    return null;
  }
  return {
    record: matches[0],
    expiresAtMs: Number(session.expires),
  };
}

function buildRestrictedRelayCurrentShift_(cleanerName) {
  const openShift = findOpenShiftForCleaner_(cleanerName);
  if (!openShift || !openShift.clockIn) {
    return { open: false };
  }
  return {
    open: true,
    property: safeStr_(openShift.property),
    clockInMs: openShift.clockIn.getTime(),
  };
}

function processRelaySessionValidation_(config, operation, payload, nowMs) {
  const cleaner = findRelaySessionCleaner_(config, payload.sessionToken);
  if (
    !cleaner ||
    !Number.isSafeInteger(cleaner.expiresAtMs) ||
    cleaner.expiresAtMs <= nowMs
  ) {
    return buildRelayFailure_(operation, "authentication_failed", false);
  }

  const ledger = getRelayLedgerContext_(config);
  if (!ledger) {
    return buildRelayFailure_(operation, "internal_error", true);
  }

  return buildRelayResult_(operation, true, "applied", false, {
    cleanerSubject: cleaner.record.subject,
    cleanerDisplayName: cleaner.record.name,
    appsSessionExpiresAtMs: cleaner.expiresAtMs,
    currentShift: buildRestrictedRelayCurrentShift_(cleaner.record.name),
    ledgerHighWater: {
      deviceId: payload.deviceId,
      appliedThroughSequence: getRelayContiguousAppliedSequence_(
        ledger,
        cleaner.record.subject,
        payload.deviceId
      ),
    },
  });
}

function classifyRelayReconciliationError_(error) {
  const message = error && error.message ? String(error.message) : "";
  const businessPatterns = [
    / has an open shift at .* was blocked\.$/,
    / has no matching .* shift for this queued .* entry\.$/,
    / has a queued .* earlier than the matched clock-in\.$/,
  ];
  if (businessPatterns.some(function (pattern) { return pattern.test(message); })) {
    return { result: "business_rejected", retryable: false };
  }

  const temporaryPatterns = [
    /service invoked too many times/i,
    /service spreadsheets failed/i,
    /internal error/i,
    /timed? out/i,
    /timeout/i,
    /maximum execution time/i,
    /temporar/i,
    /rate limit/i,
    /\b429\b/,
    /\b5\d\d\b/,
  ];
  if (temporaryPatterns.some(function (pattern) { return pattern.test(message); })) {
    return { result: "temporary_google_failure", retryable: true };
  }
  return { result: "internal_error", retryable: true };
}

function reconcileRelayEvent_(event) {
  return reconcileQueuedTimeTrackerEntry_({
    timestamp: new Date(event.submittedAtMs),
    name: event.cleanerName,
    property: event.property,
    eventType: event.eventType,
    clockInNote: event.eventType === "clock_in" ? event.note : "",
    clockOutNote: event.eventType === "clock_out" ? event.note : "",
    cleaningNote: event.eventType === "add_note" ? event.note : "",
  });
}

function relayLedgerIdentityMatches_(existing, payload) {
  return existing.payloadDigest === payload.payloadDigest &&
    existing.cleanerSubject === payload.cleanerSubject &&
    existing.deviceId === payload.deviceId &&
    existing.deviceSequence === payload.deviceSequence &&
    existing.eventType === payload.eventType &&
    existing.clientTimestamp === payload.submittedAtMs;
}

function processRelayEvent_(config, operation, payload, nowMs) {
  const ledger = getRelayLedgerContext_(config);
  if (!ledger) {
    return buildRelayFailure_(operation, "internal_error", true);
  }

  const existing = findRelayLedgerEvent_(ledger, payload.eventId);
  if (existing && existing.corrupt) {
    return buildRelayFailure_(operation, "internal_error", true);
  }
  if (existing && !relayLedgerIdentityMatches_(existing, payload)) {
    return buildRelayFailure_(operation, "event_conflict", false);
  }

  const users = getRelayUserRecords_(config);
  if (!users) {
    return buildRelayFailure_(operation, "authentication_failed", false);
  }
  const cleanerMatches = users.filter(function (record) {
    return record.active && record.subject === payload.cleanerSubject;
  });
  if (cleanerMatches.length !== 1) {
    return buildRelayFailure_(operation, "authentication_failed", false);
  }

  if (existing && existing.state === RELAY_LEDGER_STATE_APPLIED_) {
    return buildRelayResult_(operation, true, "already_applied", false, {
      eventId: payload.eventId,
      resultCode: existing.resultCode,
    });
  }
  if (existing && existing.state === RELAY_LEDGER_STATE_REJECTED_) {
    return buildRelayFailure_(operation, "business_rejected", false);
  }
  if (existing && existing.state !== RELAY_LEDGER_STATE_PROCESSING_) {
    return buildRelayFailure_(operation, "internal_error", true);
  }

  const event = Object.assign({}, payload, {
    cleanerName: cleanerMatches[0].name,
  });
  let ledgerRowNumber = existing ? existing.rowNumber : null;
  if (!ledgerRowNumber) {
    ledgerRowNumber = appendRelayProcessingEvent_(ledger, event, nowMs);
    SpreadsheetApp.flush();
  }

  let reconciliationResult;
  try {
    reconciliationResult = reconcileRelayEvent_(event);
    if (
      !reconciliationResult ||
      RELAY_RECONCILIATION_RESULTS_.indexOf(reconciliationResult.action) === -1
    ) {
      return buildRelayFailure_(operation, "internal_error", true);
    }
    SpreadsheetApp.flush();
  } catch (error) {
    const classified = classifyRelayReconciliationError_(error);
    if (classified.result === "business_rejected") {
      setRelayLedgerOutcome_(
        ledger,
        ledgerRowNumber,
        RELAY_LEDGER_STATE_REJECTED_,
        classified.result,
        nowMs
      );
      SpreadsheetApp.flush();
    }
    return buildRelayFailure_(operation, classified.result, classified.retryable);
  }

  setRelayLedgerOutcome_(
    ledger,
    ledgerRowNumber,
    RELAY_LEDGER_STATE_APPLIED_,
    reconciliationResult.action,
    nowMs
  );
  SpreadsheetApp.flush();
  return buildRelayResult_(operation, true, "applied", false, {
    eventId: payload.eventId,
    resultCode: reconciliationResult.action,
  });
}

function handleRelayWorkerRequest_(outerBody) {
  let operation = "";
  try {
    const config = loadRelayConfig_();
    if (!config) {
      return buildRelayFailure_(operation, "authentication_failed", false);
    }

    const nowMs = Date.now();
    const verified = verifyRelaySignedEnvelope_(outerBody, config, nowMs);
    if (!verified.ok) {
      return buildRelayFailure_(operation, verified.result, verified.retryable);
    }

    const validated = validateRelayOperation_(verified.request);
    operation = safeStr_(verified.request.operation);
    if (!validated.ok) {
      return validated;
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(config.lockTimeoutMs)) {
      return buildRelayFailure_(operation, "lock_busy", true);
    }

    try {
      const nonceReservation = reserveRelayNonce_(
        config,
        verified.keyId,
        verified.nonce,
        nowMs
      );
      if (!nonceReservation.ok) {
        return buildRelayFailure_(
          operation,
          nonceReservation.result,
          nonceReservation.retryable
        );
      }

      if (operation === "validate_session") {
        return processRelaySessionValidation_(
          config,
          operation,
          validated.payload,
          nowMs
        );
      }
      return processRelayEvent_(config, operation, validated.payload, nowMs);
    } finally {
      try {
        SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
    }
  } catch (_) {
    return buildRelayFailure_(operation, "internal_error", true);
  }
}
/* end[relay_worker_service] */
