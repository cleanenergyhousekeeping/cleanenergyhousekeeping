import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(path.join(repoRoot, "clockin/app.js"), "utf8");
const html = fs.readFileSync(path.join(repoRoot, "clockin/index.html"), "utf8");

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function makeLocks() {
  let pending = Promise.resolve();
  return {
    request(_name, _options, callback) {
      const run = pending.then(callback);
      pending = run.catch(function () {});
      return run;
    },
  };
}

function makeElement() {
  const classes = new Set();
  return {
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name);
          else classes.add(name);
        } else if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
      contains(name) { return classes.has(name); },
    },
    addEventListener() {},
    setAttribute() {},
    textContent: "",
    value: "",
    disabled: false,
    readOnly: false,
    innerHTML: "",
    options: [{ value: "" }, { value: "clock_in" }, { value: "add_note" }, { value: "clock_out" }],
  };
}

function response(payload) {
  return { status: 200, json: async () => payload };
}

function makeHarness({ storage, locks, randomUUID, enroll, relayEvent, enableRelay = true }) {
  const elements = new Map();
  const fetchCalls = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement() { return makeElement(); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const context = {
    AbortController,
    JSON,
    Promise,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Error,
    setTimeout,
    clearTimeout,
    __fetchCalls: fetchCalls,
    console: { error() {} },
    document,
    localStorage: storage,
    navigator: { onLine: true, locks, serviceWorker: { addEventListener() {} } },
    window: { navigator: { standalone: false }, matchMedia() { return { matches: false }; }, addEventListener() {} },
    crypto: randomUUID ? { randomUUID } : {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.endsWith("/health")) {
        return response({ ok: true, service: "ceh-relay", environment: "production", storage: "ok" });
      }
      if (url.endsWith("/v1/relay-sessions/enroll")) {
        return enroll(JSON.parse(options.body).deviceId);
      }
      if (url.endsWith("/v1/relay-events")) {
        return relayEvent(JSON.parse(options.body));
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  };
  vm.createContext(context);
  const runtimeApp = enableRelay
    ? app
      .replace("const LIVE_RELAY_FEATURE_ENABLED = false;", "const LIVE_RELAY_FEATURE_ENABLED = true;")
      .replace("const LIVE_RELAY_WORKER_URL = \"\";", "const LIVE_RELAY_WORKER_URL = \"https://relay-production.example.test\";")
    : app;
  vm.runInContext(`${runtimeApp}\nglobalThis.__relayIdentityTestApi = { pair: pairRelayInstallationAutomatically_, probe: probeRelayReachability_, reconcileDraft: reconcileShellEntryDraft_, retry: retryQueuedSyncIfReady_, setUnlocked: function (value) { shellUnlocked = !!value; }, sync: syncRelayQueue_, getState: getRelayState_, getIdentity: getRelayInstallationId_, getEntryState: function () { return { selectedProperty: selectedOfflineProperty && selectedOfflineProperty.name, propertySearch: offlinePropertySearch.value, propertyPanelHidden: offlinePropertyInfoPanel.classList.contains("hidden"), wifi: offlinePropertyInfoWifi.textContent, action: offlineActionSelect.value, note: offlineNoteInput.value, noteHidden: offlineNoteWrap.classList.contains("hidden") }; }, getFetchCalls: function () { return globalThis.__fetchCalls; } };`, context);
  return context.__relayIdentityTestApi;
}

function preparedStorage(extra = {}) {
  return makeStorage({
    ce_shell_auth_v1: JSON.stringify({ sessionToken: "prepared-session" }),
    ...extra,
  });
}

function enrolledSession(deviceId, highWater = 0) {
  return response({
    ok: true,
    session: {
      deviceId,
      relayToken: "relay-token",
      expiresAtMs: 2_000_000_000_000,
      ledgerHighWater: { deviceId, appliedThroughSequence: highWater },
    },
  });
}

test("Live relay runtime is isolated from TEST and existing Live shell storage", () => {
  assert.doesNotMatch(app, /ceh-relay-test\.kyle-405\.workers\.dev|ceh-relay-production\.kyle-405\.workers\.dev/);
  assert.doesNotMatch(app, /ce_shell_test_relay_(state|installation_id)_v1/);
  assert.doesNotMatch(app, /\/clockin-test(?:\/|\b)/);
  assert.match(app, /const LIVE_RELAY_STATE_KEY = "ce_shell_live_relay_state_v1"/);
  assert.match(app, /const LIVE_RELAY_INSTALLATION_ID_KEY = "ce_shell_live_relay_installation_id_v1"/);
  assert.match(app, /const LIVE_RELAY_LOCK_NAME = "ce-shell-live-relay-v1"/);
  assert.match(app, /const SHELL_AUTH_KEY = "ce_shell_auth_v1"/);
  assert.match(app, /const SHELL_QUEUE_KEY = "ce_shell_queue_v1"/);
  assert.match(app, /const SHELL_ENTRY_DRAFT_KEY = "ce_shell_entry_draft_v1"/);
});

test("Live relay is inactive by default and never probes or enrolls", async () => {
  const harness = makeHarness({
    storage: preparedStorage(),
    locks: makeLocks(),
    randomUUID: () => "unused",
    enableRelay: false,
    enroll: () => { throw new Error("inactive relay must not enroll"); },
    relayEvent: () => { throw new Error("inactive relay must not submit"); },
  });
  await harness.pair();
  await harness.probe();
  assert.deepEqual(harness.getFetchCalls(), []);
  assert.equal(harness.getState(), null);
  assert.match(app, /const LIVE_RELAY_FEATURE_ENABLED = false;/);
  assert.match(app, /const LIVE_RELAY_WORKER_URL = "";/);
});

function assertBlankEntryState(harness) {
  assert.deepEqual({ ...harness.getEntryState() }, {
    selectedProperty: null, propertySearch: "", propertyPanelHidden: true, wifi: "", action: "", note: "", noteHidden: true,
  });
}

test("no active shift clears a completed clock-out draft to the default entry state", () => {
  const property = {
    name: "Completed Property",
    wifiNetwork: "stale-wifi",
    wifiPassword: "stale-password",
    ownerNames: "Stale Owner",
    houseNotes: "Stale notes",
  };
  const auth = { cleanerName: "Cleaner", properties: [property], currentShift: null };
  const staleHarness = makeHarness({
    storage: makeStorage({
      ce_shell_auth_v1: JSON.stringify(auth),
      ce_shell_entry_draft_v1: JSON.stringify({ cleanerName: "Cleaner", propertyName: property.name, action: "clock_out", note: "" }),
    }),
    locks: makeLocks(), randomUUID: () => "unused", enableRelay: false,
    enroll: () => { throw new Error("inactive relay must not enroll"); },
    relayEvent: () => { throw new Error("inactive relay must not submit"); },
  });
  staleHarness.reconcileDraft(auth);
  assertBlankEntryState(staleHarness);
});

test("no active shift clears an unfinished clock-in draft to the default entry state", () => {
  const property = { name: "Unfinished Draft Property", wifiNetwork: "draft-wifi" };
  const auth = { cleanerName: "Cleaner", properties: [property], currentShift: null };
  const draftHarness = makeHarness({
    storage: makeStorage({
      ce_shell_auth_v1: JSON.stringify(auth),
      ce_shell_entry_draft_v1: JSON.stringify({ cleanerName: "Cleaner", propertyName: property.name, action: "clock_in", note: "" }),
    }),
    locks: makeLocks(), randomUUID: () => "unused", enableRelay: false,
    enroll: () => { throw new Error("inactive relay must not enroll"); },
    relayEvent: () => { throw new Error("inactive relay must not submit"); },
  });
  draftHarness.reconcileDraft(auth);
  assertBlankEntryState(draftHarness);
});

test("an active shift restores its current property instead of a saved draft property", () => {
  const property = { name: "Current Shift Property", wifiNetwork: "current-wifi" };
  const otherProperty = { name: "Other Draft Property" };
  const activeAuth = {
    cleanerName: "Cleaner",
    properties: [property, otherProperty],
    currentShift: { property: property.name, clockInMs: 1 },
  };
  const activeHarness = makeHarness({
    storage: makeStorage({
      ce_shell_auth_v1: JSON.stringify(activeAuth),
      ce_shell_entry_draft_v1: JSON.stringify({ cleanerName: "Cleaner", propertyName: otherProperty.name, action: "clock_out", note: "" }),
    }),
    locks: makeLocks(), randomUUID: () => "unused", enableRelay: false,
    enroll: () => { throw new Error("inactive relay must not enroll"); },
    relayEvent: () => { throw new Error("inactive relay must not submit"); },
  });
  activeHarness.reconcileDraft(activeAuth);
  assert.equal(activeHarness.getEntryState().selectedProperty, property.name);
  assert.equal(activeHarness.getEntryState().propertySearch, property.name);
  assert.equal(activeHarness.getEntryState().propertyPanelHidden, false);
  assert.equal(activeHarness.getEntryState().wifi, "current-wifi");
});

test("TEST runtime remains isolated from Live relay identifiers", () => {
  const testApp = fs.readFileSync(path.join(repoRoot, "clockin-test/app.js"), "utf8");
  assert.match(testApp, /ceh-relay-test\.kyle-405\.workers\.dev/);
  assert.match(testApp, /ce_shell_test_relay_state_v1/);
  assert.doesNotMatch(testApp, /ce_shell_live_relay_state_v1/);
  assert.doesNotMatch(testApp, /\/clockin\/(?:service-worker|app)\.js/);
});

test("two concurrent browser contexts create and enroll one stable installation identity", async () => {
  const storage = preparedStorage();
  const locks = makeLocks();
  const enrollmentIds = [];
  const first = makeHarness({ storage, locks, randomUUID: () => "uuid-first", enroll: (id) => {
    enrollmentIds.push(id);
    return enrolledSession(id);
  } });
  const second = makeHarness({ storage, locks, randomUUID: () => "uuid-second", enroll: (id) => {
    enrollmentIds.push(id);
    return enrolledSession(id);
  } });

  await Promise.all([first.pair(), second.pair()]);

  const state = first.getState();
  assert.equal(enrollmentIds.length, 1);
  assert.equal(first.getIdentity(), enrollmentIds[0]);
  assert.equal(second.getIdentity(), enrollmentIds[0]);
  assert.equal(state.pairedDeviceId, enrollmentIds[0]);
  assert.equal(state.nextSequence, 1);
});

test("a lost enrollment response retries with the same persisted identity", async () => {
  const storage = preparedStorage();
  const enrollmentIds = [];
  let attempt = 0;
  const harness = makeHarness({
    storage,
    locks: makeLocks(),
    randomUUID: () => "uuid-stable",
    enroll: (id) => {
      enrollmentIds.push(id);
      attempt += 1;
      if (attempt === 1) throw new Error("lost response");
      return enrolledSession(id);
    },
  });

  await harness.pair();
  assert.equal(harness.getState(), null);
  await harness.pair();
  assert.deepEqual(enrollmentIds, ["production-relay-uuid-stable", "production-relay-uuid-stable"]);
  assert.equal(harness.getState().pairedDeviceId, "production-relay-uuid-stable");
});

test("existing paired state, nonzero high-water, failures, and missing crypto never reset relay state", async () => {
  const paired = {
    version: 1, pairedDeviceId: "production-relay-existing-device", relayToken: "old", relayTokenExpiresAtMs: 1,
    lastConfirmedLedgerHighWater: 7, nextSequence: 8, highestAllocatedSequence: 7, queue: [{ eventId: "kept" }],
  };
  const pairedStorage = preparedStorage({ ce_shell_live_relay_state_v1: JSON.stringify(paired) });
  const pairedHarness = makeHarness({ storage: pairedStorage, locks: makeLocks(), randomUUID: () => "unused", enroll: () => {
    throw new Error("existing pairing must not enroll");
  } });
  await pairedHarness.pair();
  assert.deepEqual(pairedHarness.getState(), paired);

  const nonzeroHarness = makeHarness({ storage: preparedStorage(), locks: makeLocks(), randomUUID: () => "nonzero", enroll: (id) => enrolledSession(id, 2) });
  await nonzeroHarness.pair();
  assert.equal(nonzeroHarness.getState(), null);

  const legacyQueue = JSON.stringify([{ id: "legacy-unchanged" }]);
  const failureStorage = preparedStorage({ ce_shell_queue_v1: legacyQueue });
  const failureHarness = makeHarness({ storage: failureStorage, locks: makeLocks(), randomUUID: () => "unused", enroll: () => {
    throw new Error("legacy queue must not enroll");
  } });
  await failureHarness.pair();
  assert.equal(failureStorage.getItem("ce_shell_queue_v1"), legacyQueue);
  assert.equal(failureHarness.getState(), null);

  const cryptoHarness = makeHarness({ storage: preparedStorage(), locks: makeLocks(), enroll: () => {
    throw new Error("missing crypto must not enroll");
  } });
  await cryptoHarness.pair();
  assert.equal(cryptoHarness.getState(), null);
});

test("manual device-ID controls are absent from the cleaner interface", () => {
  assert.doesNotMatch(html, /relayDeviceIdInput|relayPairingConfirm|relayPairingBtn|Confirm Relay Pairing/);
  assert.doesNotMatch(app, /relayDeviceIdInput|relayPairingConfirm|relayPairingBtn|pairRelayInstallation_\(/);
});

function readyQueuedRelayState_() {
  return {
    version: 1,
    pairedDeviceId: "production-relay-reconnect-device",
    relayToken: "relay-token",
    relayTokenExpiresAtMs: 2_000_000_000_000,
    lastConfirmedLedgerHighWater: 0,
    nextSequence: 2,
    highestAllocatedSequence: 1,
    queue: [{
      eventId: "relay-event-reconnect",
      deviceSequence: 1,
      eventType: "add_note",
      submittedAtMs: 1,
      property: "Test property",
      note: "Saved offline",
      status: "retryable",
      attemptCount: 1,
      nextAttemptAtMs: 0,
    }],
  };
}

function reconnectHarness_(eventIds) {
  return makeHarness({
    storage: preparedStorage({ ce_shell_live_relay_state_v1: JSON.stringify(readyQueuedRelayState_()) }),
    locks: makeLocks(),
    randomUUID: () => "unused",
    enroll: () => { throw new Error("existing token must not enroll"); },
    relayEvent: (event) => {
      eventIds.push(event.eventId);
      return response({ ok: true, eventId: event.eventId });
    },
  });
}

test("confirmed LIVE relay reachability drains one ready queued event through the serialized path after unlock", async () => {
  const eventIds = [];
  const harness = reconnectHarness_(eventIds);
  harness.setUnlocked(true);

  await harness.probe();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(eventIds, ["relay-event-reconnect"]);
  assert.equal(harness.getState().queue[0].status, "accepted");
});

test("locked-shell reconnect keeps the ready relay event queued until unlock retries it", async () => {
  const eventIds = [];
  const harness = reconnectHarness_(eventIds);

  await harness.probe();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(eventIds, []);
  assert.equal(harness.getState().queue[0].status, "retryable");

  harness.setUnlocked(true);
  harness.retry();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(eventIds, ["relay-event-reconnect"]);
  assert.equal(harness.getState().queue[0].status, "accepted");
});

test("reconnect drain keeps a single in-progress gate and only shows the sync HUD inside the locked attempt", () => {
  assert.match(app, /if \(!shellUnlocked\) return;\s+if \(relaySyncInProgress\) return;/);
  assert.match(app, /if \(relaySyncInProgress\) return;\s+relaySyncInProgress = 1;/);
  assert.match(app, /setTimeout\(triggerRelayQueueDrainWhenReachable_, 0\)/);
  assert.match(app, /showShellSyncHud_\("Please wait\.\.\.", "Syncing Saved Entries"\)/);
  assert.match(app, /await withRelayLock_\(async function \(\) \{[\s\S]*showShellSyncHud_/);
  assert.match(app, /showShellActionConfirmation_\("Logged In",[\s\S]*?retryQueuedSyncIfReady_\(\);/);
});
