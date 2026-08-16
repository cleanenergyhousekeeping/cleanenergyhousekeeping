import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HMAC_KEY = Buffer.alloc(32, 17);
const SECOND_HMAC_KEY = Buffer.alloc(32, 23);
const SUBJECT_KEY = Buffer.alloc(32, 41);
const USER_ONE_ID = "8b3f6e44-580d-4dc4-b15d-f1c8821daf38";
const USER_TWO_ID = "fe2f59f7-df89-40b2-9939-dcfd015ea58c";
const SESSION_TOKEN = "0f43ea8d-eac5-45d8-a64e-2d61a548dadf";
const DEVICE_ID = "device_0000000001";
const LEDGER_HEADERS = [
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

class FakeProperties {
  constructor(initial) {
    this.values = { ...initial };
  }

  getProperties() {
    return { ...this.values };
  }

  getProperty(key) {
    return Object.prototype.hasOwnProperty.call(this.values, key)
      ? this.values[key]
      : null;
  }

  setProperty(key, value) {
    this.values[key] = String(value);
    return this;
  }

  deleteProperty(key) {
    delete this.values[key];
    return this;
  }
}

class FakeRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.getCell(this.row + rowOffset, this.column + columnOffset),
      ),
    );
  }

  getValue() {
    return this.sheet.getCell(this.row, this.column);
  }

  setValues(values) {
    this.sheet.writes.push({
      type: "setValues",
      row: this.row,
      column: this.column,
      rowCount: this.rowCount,
      columnCount: this.columnCount,
      values: values.map((row) => [...row]),
    });
    values.forEach((row, rowOffset) => {
      row.forEach((value, columnOffset) => {
        this.sheet.setCell(this.row + rowOffset, this.column + columnOffset, value);
      });
    });
    return this;
  }

  setValue(value) {
    this.sheet.writes.push({
      type: "setValue",
      row: this.row,
      column: this.column,
      value,
    });
    this.sheet.setCell(this.row, this.column, value);
    return this;
  }
}

class FakeSheet {
  constructor(rows) {
    this.rows = rows.map((row) => [...row]);
    this.writes = [];
  }

  getCell(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? "";
  }

  setCell(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push("");
    this.rows[row - 1][column - 1] = value;
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(this.rows.length, 1), this.getLastColumn());
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  getLastColumn() {
    return Math.max(1, ...this.rows.map((row) => row.length));
  }

  appendRow(row) {
    this.writes.push({ type: "appendRow", values: [...row] });
    this.rows.push([...row]);
    return this;
  }
}

class FakeSpreadsheet {
  constructor(id, sheets) {
    this.id = id;
    this.sheets = sheets;
  }

  getId() {
    return this.id;
  }

  getSheetByName(name) {
    return this.sheets.get(name) ?? null;
  }
}

function signedBytes(bytes) {
  return [...bytes].map((value) => (value > 127 ? value - 256 : value));
}

function makeUtilities() {
  return {
    MacAlgorithm: { HMAC_SHA_256: "HMAC_SHA_256" },
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF-8" },
    base64DecodeWebSafe(value) {
      return signedBytes(Buffer.from(value, "base64url"));
    },
    base64EncodeWebSafe(value) {
      return Buffer.from(value.map((byte) => (byte < 0 ? byte + 256 : byte)))
        .toString("base64url");
    },
    computeDigest(_algorithm, value) {
      const input = Array.isArray(value)
        ? Buffer.from(value.map((byte) => (byte < 0 ? byte + 256 : byte)))
        : Buffer.from(String(value), "utf8");
      return signedBytes(crypto.createHash("sha256").update(input).digest());
    },
    computeHmacSignature(_algorithm, value, key) {
      const input = Array.isArray(value)
        ? Buffer.from(value.map((byte) => (byte < 0 ? byte + 256 : byte)))
        : Buffer.from(String(value), "utf8");
      const keyBytes = Buffer.from(key.map((byte) => (byte < 0 ? byte + 256 : byte)));
      return signedBytes(crypto.createHmac("sha256", keyBytes).update(input).digest());
    },
    newBlob(value) {
      const bytes = Array.isArray(value)
        ? Buffer.from(value.map((byte) => (byte < 0 ? byte + 256 : byte)))
        : Buffer.from(String(value), "utf8");
      return {
        getBytes: () => signedBytes(bytes),
        getDataAsString: () => bytes.toString("utf8"),
      };
    },
  };
}

function defaultUsersRows() {
  return [
    ["PIN", "Name", "Is Active", "Role", "Access Level", "Email", "User ID"],
    ["1234", "Cleaner One", true, "cleaner", "LIMITED", "one@example.test", USER_ONE_ID],
  ];
}

function defaultConfigProperties(spreadsheetId) {
  return {
    CEH_RELAY_ENABLED: "true",
    CEH_RELAY_ENVIRONMENT: "test",
    CEH_RELAY_EXPECTED_SPREADSHEET_ID: spreadsheetId,
    CEH_RELAY_LEDGER_SHEET_NAME: "Relay Event Ledger",
    CEH_RELAY_ACCEPTED_KEY_IDS: "v1,v2",
    CEH_RELAY_HMAC_KEYS_JSON: JSON.stringify({
      v1: HMAC_KEY.toString("base64url"),
      v2: SECOND_HMAC_KEY.toString("base64url"),
    }),
    CEH_RELAY_SUBJECT_HMAC_KEY: SUBJECT_KEY.toString("base64url"),
    CEH_RELAY_MAX_CLOCK_SKEW_SECONDS: "300",
    CEH_RELAY_NONCE_TTL_SECONDS: "600",
    CEH_RELAY_LOCK_TIMEOUT_MS: "5000",
    CEH_RELAY_MAX_NONCE_COUNT: "100",
  };
}

function createHarness(options = {}) {
  const spreadsheetId = options.spreadsheetId ?? "test-spreadsheet-id";
  const usersSheet = new FakeSheet(options.usersRows ?? defaultUsersRows());
  const ledgerSheet = new FakeSheet(options.ledgerRows ?? [LEDGER_HEADERS]);
  const sheets = new Map([
    ["Users", usersSheet],
    ["Relay Event Ledger", ledgerSheet],
  ]);
  const spreadsheet = new FakeSpreadsheet(spreadsheetId, sheets);
  const properties = new FakeProperties({
    ...defaultConfigProperties(spreadsheetId),
    ...(options.properties ?? {}),
  });
  const sessions = new Map([
    [SESSION_TOKEN, {
      pin: "1234",
      name: "Cleaner One",
      expires: Date.now() + 3_600_000,
    }],
  ]);
  const state = {
    spreadsheet,
    sheets,
    usersSheet,
    ledgerSheet,
    properties,
    sessions,
    lockAvailable: options.lockAvailable ?? true,
    lockHeld: false,
    releaseCount: 0,
    flushCount: 0,
    reconciliationCalls: [],
    openShifts: new Map(options.openShifts ?? []),
    reconcile: options.reconcile ?? (() => ({ action: "inserted_clock_in" })),
  };

  const context = vm.createContext({
    Array,
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(text) {
        return {
          text,
          mimeType: "",
          setMimeType(mimeType) {
            this.mimeType = mimeType;
            return this;
          },
        };
      },
    },
    Date,
    JSON,
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            if (!state.lockAvailable || state.lockHeld) return false;
            state.lockHeld = true;
            return true;
          },
          releaseLock() {
            state.lockHeld = false;
            state.releaseCount += 1;
          },
        };
      },
    },
    Math,
    Number,
    Object,
    PropertiesService: {
      getScriptProperties: () => properties,
    },
    RegExp,
    Set,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush() {
        state.flushCount += 1;
      },
    },
    String,
    USERS_SHEET_NAME: "Users",
    Utilities: makeUtilities(),
    console,
    findOpenShiftForCleaner_(cleanerName) {
      return state.openShifts.get(cleanerName) ?? null;
    },
    getSession_(token) {
      return state.sessions.get(token) ?? null;
    },
    logClockInDebug_() {},
    logClockInDebugSafe_() {},
    loginWithPin(accessCode, clientId) {
      return { ok: true, accessCode, clientId, legacy: true };
    },
    normalizeAccessCode_(value) {
      return String(value ?? "").replace(/\D/g, "").trim();
    },
    normalizeActiveFlag_(value) {
      return value === true || ["true", "yes", "1", "active"].includes(
        String(value ?? "").trim().toLowerCase(),
      );
    },
    reconcileQueuedTimeTrackerEntry_(entry) {
      state.reconciliationCalls.push(entry);
      return state.reconcile(entry);
    },
    refreshShellAuth() {
      return { ok: true };
    },
    safeStr_(value) {
      return value == null ? "" : String(value).trim();
    },
    submitWebAppTimeEntry() {
      return { ok: true, legacy: true };
    },
    getShellWeeklyPropertySummary() {
      return { ok: true, legacy: true };
    },
  });

  const sourceFiles = [
    "apps-script/51_RelayConfig.gs",
    "apps-script/52_RelaySecurity.gs",
    "apps-script/53_RelayLedger.gs",
    "apps-script/54_RelayService.gs",
    "apps-script/40_WebApp.gs",
  ];
  for (const relativePath of sourceFiles) {
    const filename = path.join(REPO_ROOT, relativePath);
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  }
  vm.runInContext(`globalThis.__relayTestApi = {
    buildNonceKey: buildRelayNoncePropertyKey_,
    buildSubject: buildRelayCleanerSubject_,
    doPost: doPost,
    handle: handleRelayWorkerRequest_,
    loadConfig: loadRelayConfig_,
    reserveNonce: reserveRelayNonce_,
    verify: verifyRelaySignedEnvelope_
  };`, context);

  return { api: context.__relayTestApi, state };
}

let nonceCounter = 0;

function makeEnvelope(operation, payload, options = {}) {
  nonceCounter += 1;
  const keyId = options.keyId ?? "v1";
  const request = {
    version: 1,
    keyId,
    environment: options.environment ?? "test",
    audience: options.audience ?? "ceh-relay:test:apps-script",
    operation,
    timestampMs: options.timestampMs ?? Date.now(),
    nonce: options.nonce ?? `nonce_${String(nonceCounter).padStart(20, "0")}`,
    payload,
  };
  const signedBytesBuffer = Buffer.from(JSON.stringify(request), "utf8");
  const signingKey = options.signingKey ?? (keyId === "v2" ? SECOND_HMAC_KEY : HMAC_KEY);
  const signature = crypto.createHmac("sha256", signingKey).update(signedBytesBuffer).digest();
  return {
    mode: "relayWorkerRequest",
    keyId: options.outerKeyId ?? keyId,
    signedBody: signedBytesBuffer.toString("base64url"),
    signature: (options.signature ?? signature).toString("base64url"),
  };
}

function sessionEnvelope(options = {}) {
  return makeEnvelope("validate_session", {
    sessionToken: options.sessionToken ?? SESSION_TOKEN,
    deviceId: options.deviceId ?? DEVICE_ID,
  }, options);
}

function validDigest(seed = 1) {
  return Buffer.alloc(32, seed).toString("base64url");
}

function makeEvent(api, config, overrides = {}) {
  return {
    eventId: "event_0000000001",
    payloadDigest: validDigest(),
    cleanerSubject: api.buildSubject(config, USER_ONE_ID),
    deviceId: DEVICE_ID,
    deviceSequence: 1,
    eventType: "clock_in",
    submittedAtMs: 1_786_824_000_000,
    property: "Test Property",
    note: "Ready to begin",
    ...overrides,
  };
}

function parseOutput(output) {
  return JSON.parse(output.text);
}

function snapshotRows(rows) {
  return rows.map((row) => row.map((value) =>
    value instanceof Date ? value.getTime() : value,
  ));
}

test("valid session validation returns only the approved identity and shift fields", () => {
  const harness = createHarness({
    openShifts: [["Cleaner One", {
      property: "Test Property",
      clockIn: new Date(1_786_824_000_000),
    }]],
  });
  const config = harness.api.loadConfig();
  const subject = harness.api.buildSubject(config, USER_ONE_ID);
  harness.state.ledgerSheet.rows.push(
    ["event_0000000001", validDigest(1), "APPLIED", subject, DEVICE_ID, 1, "clock_in", 1, new Date(), new Date(), "inserted_clock_in"],
    ["event_0000000003", validDigest(3), "APPLIED", subject, DEVICE_ID, 3, "add_note", 3, new Date(), new Date(), "merged_add_note"],
  );

  const result = harness.api.handle(sessionEnvelope());
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), [
    "appsSessionExpiresAtMs",
    "cleanerDisplayName",
    "cleanerSubject",
    "currentShift",
    "ledgerHighWater",
  ]);
  assert.deepEqual({ ...result.data.currentShift }, {
    open: true,
    property: "Test Property",
    clockInMs: 1_786_824_000_000,
  });
  assert.equal(result.data.ledgerHighWater.appliedThroughSequence, 1);
  assert.equal(JSON.stringify(result).includes(USER_ONE_ID), false);
  for (const forbidden of ["Client", "owner", "wifi", "entrance", "alarm", "house"])
    assert.equal(JSON.stringify(result).toLowerCase().includes(forbidden.toLowerCase()), false);
});

test("a closed shift returns no property or timestamp fields", () => {
  const harness = createHarness();
  const result = harness.api.handle(sessionEnvelope());
  assert.equal(result.ok, true);
  assert.deepEqual({ ...result.data.currentShift }, { open: false });
});

test("cleaner subjects are opaque and environment-separated", () => {
  const harness = createHarness();
  const testConfig = harness.api.loadConfig();
  const productionConfig = { ...testConfig, environment: "production" };
  const testSubject = harness.api.buildSubject(testConfig, USER_ONE_ID);
  const productionSubject = harness.api.buildSubject(productionConfig, USER_ONE_ID);
  assert.notEqual(testSubject, productionSubject);
  assert.equal(testSubject.includes(USER_ONE_ID), false);
  assert.equal(productionSubject.includes(USER_ONE_ID), false);
});

test("invalid signatures, key IDs, environments, and stale timestamps fail closed", () => {
  const harness = createHarness();
  const invalidSignature = sessionEnvelope({ signature: Buffer.alloc(32, 99) });
  assert.equal(harness.api.handle(invalidSignature).result, "authentication_failed");
  assert.equal(harness.api.handle(sessionEnvelope({ keyId: "unknown" })).result, "authentication_failed");
  assert.equal(harness.api.handle(sessionEnvelope({ environment: "production" })).result, "authentication_failed");
  assert.equal(harness.api.handle(sessionEnvelope({ timestampMs: Date.now() - 301_000 })).result, "stale_request");
  assert.equal(harness.api.handle(sessionEnvelope({ timestampMs: Date.now() + 301_000 })).result, "stale_request");
});

test("missing configuration and a wrong spreadsheet binding disable only relay", () => {
  const disabled = createHarness({ properties: { CEH_RELAY_ENABLED: "false" } });
  assert.equal(disabled.api.handle(sessionEnvelope()).result, "authentication_failed");

  const mismatch = createHarness({
    properties: { CEH_RELAY_EXPECTED_SPREADSHEET_ID: "other-spreadsheet" },
  });
  assert.equal(mismatch.api.handle(sessionEnvelope()).result, "authentication_failed");

  const legacyOutput = disabled.api.doPost({
    postData: { contents: JSON.stringify({
      mode: "loginWithPin",
      payload: { accessCode: "1234", clientId: "legacy-client" },
    }) },
  });
  assert.deepEqual(parseOutput(legacyOutput), {
    ok: true,
    accessCode: "1234",
    clientId: "legacy-client",
    legacy: true,
  });
});

test("User ID is mandatory, immutable-looking, unique, and never falls back", () => {
  const missingHeader = defaultUsersRows().map((row) => row.slice(0, -1));
  assert.equal(createHarness({ usersRows: missingHeader }).api.handle(sessionEnvelope()).result, "authentication_failed");

  const blankId = defaultUsersRows();
  blankId[1][6] = "";
  assert.equal(createHarness({ usersRows: blankId }).api.handle(sessionEnvelope()).result, "authentication_failed");

  const malformedId = defaultUsersRows();
  malformedId[1][6] = "not-a-uuid";
  assert.equal(createHarness({ usersRows: malformedId }).api.handle(sessionEnvelope()).result, "authentication_failed");

  const duplicateId = defaultUsersRows();
  duplicateId.push(["5678", "Cleaner Two", true, "cleaner", "LIMITED", "two@example.test", USER_ONE_ID]);
  assert.equal(createHarness({ usersRows: duplicateId }).api.handle(sessionEnvelope()).result, "authentication_failed");
});

test("invalid and inactive sessions are rejected", () => {
  const invalid = createHarness();
  assert.equal(invalid.api.handle(sessionEnvelope({ sessionToken: "aaaaaaaaaaaaaaaa" })).result, "authentication_failed");

  const inactiveRows = defaultUsersRows();
  inactiveRows[1][2] = false;
  assert.equal(createHarness({ usersRows: inactiveRows }).api.handle(sessionEnvelope()).result, "authentication_failed");
});

test("an explicitly expired session fails closed without sensitive data", () => {
  const harness = createHarness();
  harness.state.sessions.set(SESSION_TOKEN, {
    pin: "1234",
    name: "Cleaner One",
    expires: Date.now() - 1,
  });
  const result = harness.api.handle(sessionEnvelope());
  assert.equal(result.result, "authentication_failed");
  assert.equal(result.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "data"), false);
  assert.equal(JSON.stringify(result).includes(SESSION_TOKEN), false);
  assert.equal(JSON.stringify(result).includes(USER_ONE_ID), false);
});

test("nonce replay is rejected and raw nonce material is not stored", () => {
  const harness = createHarness();
  const envelope = sessionEnvelope({ nonce: "nonce_replay_00000000000001" });
  assert.equal(harness.api.handle(envelope).ok, true);
  assert.equal(harness.api.handle(envelope).result, "replay_detected");
  const stored = harness.state.properties.getProperties();
  assert.equal(JSON.stringify(stored).includes("nonce_replay_00000000000001"), false);
  assert.equal(JSON.stringify(stored).includes(envelope.signedBody), false);
});

test("nonce cleanup is bounded and leaves non-relay properties untouched", () => {
  const harness = createHarness();
  const config = harness.api.loadConfig();
  const now = Date.now();
  harness.state.properties.setProperty("ce_session_do-not-delete", "legacy-session-value");
  harness.state.properties.setProperty("ceh_relay_nonce_v1_test_v1_expired", String(now - 1));
  harness.state.properties.setProperty("ceh_relay_nonce_v1_test_v1_malformed", "bad");
  assert.equal(harness.api.reserveNonce(config, "v1", "nonce_cleanup_0000000000001", now).ok, true);
  assert.equal(harness.state.properties.getProperty("ceh_relay_nonce_v1_test_v1_expired"), null);
  assert.equal(harness.state.properties.getProperty("ceh_relay_nonce_v1_test_v1_malformed"), null);
  assert.equal(harness.state.properties.getProperty("ce_session_do-not-delete"), "legacy-session-value");

  config.maxNonceCount = 2;
  const fullHarness = createHarness();
  const fullConfig = fullHarness.api.loadConfig();
  fullConfig.maxNonceCount = 2;
  assert.equal(fullHarness.api.reserveNonce(fullConfig, "v1", "nonce_bound_000000000000001", now).ok, true);
  assert.equal(fullHarness.api.reserveNonce(fullConfig, "v1", "nonce_bound_000000000000002", now).ok, true);
  const fullResult = fullHarness.api.reserveNonce(fullConfig, "v1", "nonce_bound_000000000000003", now);
  assert.deepEqual({ ...fullResult }, { ok: false, result: "internal_error", retryable: true });
});

test("nonce hashing separates environments and key IDs", () => {
  const harness = createHarness();
  const nonce = "nonce_separation_00000000001";
  const testV1 = harness.api.buildNonceKey("test", "v1", nonce);
  const testV2 = harness.api.buildNonceKey("test", "v2", nonce);
  const productionV1 = harness.api.buildNonceKey("production", "v1", nonce);
  assert.notEqual(testV1, testV2);
  assert.notEqual(testV1, productionV1);
  assert.equal(testV1.includes(nonce), false);
});

test("first event applies once and writes only the approved ledger columns", () => {
  const harness = createHarness();
  const config = harness.api.loadConfig();
  const event = makeEvent(harness.api, config);
  const result = harness.api.handle(makeEnvelope("submit_event", event));
  assert.equal(result.result, "applied");
  assert.equal(harness.state.reconciliationCalls.length, 1);
  assert.equal(harness.state.reconciliationCalls[0].timestamp.getTime(), event.submittedAtMs);
  assert.deepEqual(harness.state.ledgerSheet.rows[0], LEDGER_HEADERS);
  assert.equal(harness.state.ledgerSheet.rows[1][2], "APPLIED");
  assert.equal(harness.state.ledgerSheet.rows[1][10], "inserted_clock_in");
  assert.equal(JSON.stringify(harness.state.ledgerSheet.rows).includes(event.property), false);
  assert.equal(JSON.stringify(harness.state.ledgerSheet.rows).includes(event.note), false);
  assert.equal(JSON.stringify(harness.state.ledgerSheet.rows).includes("Cleaner One"), false);
  assert.equal(JSON.stringify(harness.state.ledgerSheet.rows).includes(USER_ONE_ID), false);
});

test("identical retries and lost responses converge without another mutation", () => {
  const harness = createHarness();
  const config = harness.api.loadConfig();
  const event = makeEvent(harness.api, config);
  const first = harness.api.handle(makeEnvelope("submit_event", event));
  assert.equal(first.result, "applied");

  const retry = harness.api.handle(makeEnvelope("submit_event", event));
  assert.equal(retry.result, "already_applied");
  assert.equal(harness.state.reconciliationCalls.length, 1);
  assert.equal(harness.state.ledgerSheet.rows.length, 2);
});

test("a reused event ID with a different digest is a permanent conflict", () => {
  const harness = createHarness();
  const config = harness.api.loadConfig();
  const event = makeEvent(harness.api, config);
  assert.equal(harness.api.handle(makeEnvelope("submit_event", event)).result, "applied");
  const conflict = { ...event, payloadDigest: validDigest(9) };
  const result = harness.api.handle(makeEnvelope("submit_event", conflict));
  assert.deepEqual({ result: result.result, retryable: result.retryable }, {
    result: "event_conflict",
    retryable: false,
  });
  assert.equal(harness.state.reconciliationCalls.length, 1);
});

test("existing event IDs reject every immutable identity mismatch without mutation", () => {
  const usersRows = defaultUsersRows();
  usersRows.push(["5678", "Cleaner Two", true, "cleaner", "LIMITED", "two@example.test", USER_TWO_ID]);
  const cases = [
    {
      label: "cleaner subject",
      change: (event, api, config) => ({
        ...event,
        cleanerSubject: api.buildSubject(config, USER_TWO_ID),
      }),
    },
    {
      label: "device ID",
      change: (event) => ({ ...event, deviceId: "device_0000000002" }),
    },
    {
      label: "device sequence",
      change: (event) => ({ ...event, deviceSequence: 2 }),
    },
    {
      label: "event type",
      change: (event) => ({ ...event, eventType: "clock_out" }),
    },
    {
      label: "client timestamp",
      change: (event) => ({ ...event, submittedAtMs: event.submittedAtMs + 1 }),
    },
  ];

  for (const conflictCase of cases) {
    const harness = createHarness({ usersRows });
    const config = harness.api.loadConfig();
    const originalEvent = makeEvent(harness.api, config);
    harness.state.ledgerSheet.rows.push([
      originalEvent.eventId,
      originalEvent.payloadDigest,
      "APPLIED",
      originalEvent.cleanerSubject,
      originalEvent.deviceId,
      originalEvent.deviceSequence,
      originalEvent.eventType,
      originalEvent.submittedAtMs,
      new Date(1_786_824_001_000),
      new Date(1_786_824_002_000),
      "inserted_clock_in",
    ]);
    const beforeRows = snapshotRows(harness.state.ledgerSheet.rows);
    const conflictingEvent = conflictCase.change(originalEvent, harness.api, config);
    const result = harness.api.handle(makeEnvelope("submit_event", conflictingEvent));

    assert.equal(result.result, "event_conflict", conflictCase.label);
    assert.equal(result.retryable, false, conflictCase.label);
    assert.equal(harness.state.reconciliationCalls.length, 0, conflictCase.label);
    assert.deepEqual(snapshotRows(harness.state.ledgerSheet.rows), beforeRows, conflictCase.label);
    assert.equal(harness.state.ledgerSheet.writes.length, 0, conflictCase.label);
  }
});

test("PROCESSING events safely re-enter reconciliation", () => {
  const harness = createHarness();
  const config = harness.api.loadConfig();
  const event = makeEvent(harness.api, config);
  harness.state.ledgerSheet.rows.push([
    event.eventId,
    event.payloadDigest,
    "PROCESSING",
    event.cleanerSubject,
    event.deviceId,
    event.deviceSequence,
    event.eventType,
    event.submittedAtMs,
    new Date(),
    "",
    "",
  ]);
  const result = harness.api.handle(makeEnvelope("submit_event", event));
  assert.equal(result.result, "applied");
  assert.equal(harness.state.reconciliationCalls.length, 1);
  assert.equal(harness.state.ledgerSheet.rows[1][2], "APPLIED");
});

test("APPLIED finalization writes the full row once and preserves immutable metadata", () => {
  const harness = createHarness();
  const config = harness.api.loadConfig();
  const event = makeEvent(harness.api, config);
  const receivedAt = new Date(1_786_824_001_000);
  harness.state.ledgerSheet.rows.push([
    event.eventId,
    event.payloadDigest,
    "PROCESSING",
    event.cleanerSubject,
    event.deviceId,
    event.deviceSequence,
    event.eventType,
    event.submittedAtMs,
    receivedAt,
    "",
    "",
  ]);
  const immutableIndexes = [0, 1, 3, 4, 5, 6, 7, 8];
  const beforeMetadata = immutableIndexes.map((index) => harness.state.ledgerSheet.rows[1][index]);

  const result = harness.api.handle(makeEnvelope("submit_event", event));
  const outcomeWrites = harness.state.ledgerSheet.writes.filter((write) =>
    write.type === "setValues",
  );
  assert.equal(result.result, "applied");
  assert.equal(outcomeWrites.length, 1);
  assert.equal(outcomeWrites[0].column, 1);
  assert.equal(outcomeWrites[0].columnCount, LEDGER_HEADERS.length);
  assert.equal(harness.state.ledgerSheet.writes.some((write) => write.type === "setValue"), false);
  assert.equal(harness.state.ledgerSheet.rows[1][2], "APPLIED");
  assert.equal(harness.state.ledgerSheet.rows[1][9] instanceof Date, true);
  assert.equal(harness.state.ledgerSheet.rows[1][10], "inserted_clock_in");
  assert.deepEqual(
    immutableIndexes.map((index) => harness.state.ledgerSheet.rows[1][index]),
    beforeMetadata,
  );
});

test("REJECTED finalization writes the full row once with blank Applied At", () => {
  const harness = createHarness({
    reconcile: () => { throw new Error("Cleaner One has no matching Test Property shift for this queued clock out entry."); },
  });
  const config = harness.api.loadConfig();
  const event = makeEvent(harness.api, config, { eventType: "clock_out" });
  const receivedAt = new Date(1_786_824_001_000);
  harness.state.ledgerSheet.rows.push([
    event.eventId,
    event.payloadDigest,
    "PROCESSING",
    event.cleanerSubject,
    event.deviceId,
    event.deviceSequence,
    event.eventType,
    event.submittedAtMs,
    receivedAt,
    "",
    "",
  ]);
  const immutableIndexes = [0, 1, 3, 4, 5, 6, 7, 8];
  const beforeMetadata = immutableIndexes.map((index) => harness.state.ledgerSheet.rows[1][index]);

  const result = harness.api.handle(makeEnvelope("submit_event", event));
  const outcomeWrites = harness.state.ledgerSheet.writes.filter((write) =>
    write.type === "setValues",
  );
  assert.equal(result.result, "business_rejected");
  assert.equal(outcomeWrites.length, 1);
  assert.equal(outcomeWrites[0].column, 1);
  assert.equal(outcomeWrites[0].columnCount, LEDGER_HEADERS.length);
  assert.equal(harness.state.ledgerSheet.writes.some((write) => write.type === "setValue"), false);
  assert.equal(harness.state.ledgerSheet.rows[1][2], "REJECTED");
  assert.equal(harness.state.ledgerSheet.rows[1][9], "");
  assert.equal(harness.state.ledgerSheet.rows[1][10], "business_rejected");
  assert.deepEqual(
    immutableIndexes.map((index) => harness.state.ledgerSheet.rows[1][index]),
    beforeMetadata,
  );
});

test("lock contention is retryable and does not mutate the ledger", () => {
  const harness = createHarness({ lockAvailable: false });
  const config = harness.api.loadConfig();
  const result = harness.api.handle(makeEnvelope("submit_event", makeEvent(harness.api, config)));
  assert.deepEqual({ result: result.result, retryable: result.retryable }, {
    result: "lock_busy",
    retryable: true,
  });
  assert.equal(harness.state.ledgerSheet.rows.length, 1);
  assert.equal(harness.state.reconciliationCalls.length, 0);
});

test("different-cleaner contention returns safely and both events later converge", () => {
  const usersRows = defaultUsersRows();
  usersRows.push(["5678", "Cleaner Two", true, "cleaner", "LIMITED", "two@example.test", USER_TWO_ID]);
  const harness = createHarness({ usersRows });
  const config = harness.api.loadConfig();
  const first = makeEvent(harness.api, config);
  const second = makeEvent(harness.api, config, {
    eventId: "event_0000000002",
    payloadDigest: validDigest(2),
    cleanerSubject: harness.api.buildSubject(config, USER_TWO_ID),
    deviceId: "device_0000000002",
  });

  harness.state.lockAvailable = false;
  assert.equal(harness.api.handle(makeEnvelope("submit_event", second)).result, "lock_busy");
  harness.state.lockAvailable = true;
  assert.equal(harness.api.handle(makeEnvelope("submit_event", first)).result, "applied");
  assert.equal(harness.api.handle(makeEnvelope("submit_event", second)).result, "applied");
  assert.equal(harness.state.ledgerSheet.rows.length, 3);
});

test("oversized notes are rejected without truncation or legacy changes", () => {
  const harness = createHarness();
  const config = harness.api.loadConfig();
  const oversized = makeEvent(harness.api, config, {
    eventType: "add_note",
    note: "x".repeat(1001),
  });
  const result = harness.api.handle(makeEnvelope("submit_event", oversized));
  assert.equal(result.result, "invalid_event");
  assert.equal(harness.state.ledgerSheet.rows.length, 1);
  assert.equal(harness.state.reconciliationCalls.length, 0);
});

test("business rejection is durable while temporary and raw errors remain sanitized", () => {
  const business = createHarness({
    reconcile: () => { throw new Error("Cleaner One has no matching Test Property shift for this queued clock out entry."); },
  });
  const businessConfig = business.api.loadConfig();
  const businessEvent = makeEvent(business.api, businessConfig, { eventType: "clock_out" });
  const businessResult = business.api.handle(makeEnvelope("submit_event", businessEvent));
  assert.equal(businessResult.result, "business_rejected");
  assert.equal(business.state.ledgerSheet.rows[1][2], "REJECTED");

  const secretText = "raw-token-and-stack-must-never-escape";
  const temporary = createHarness({
    reconcile: () => { throw new Error(`Service Spreadsheets failed: ${secretText}`); },
  });
  const temporaryConfig = temporary.api.loadConfig();
  const temporaryResult = temporary.api.handle(makeEnvelope(
    "submit_event",
    makeEvent(temporary.api, temporaryConfig),
  ));
  assert.equal(temporaryResult.result, "temporary_google_failure");
  assert.equal(temporaryResult.retryable, true);
  assert.equal(JSON.stringify(temporaryResult).includes(secretText), false);
  assert.equal(temporary.state.ledgerSheet.rows[1][2], "PROCESSING");
});
