import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(path.join(repoRoot, "clockin-test/app.js"), "utf8");
const html = fs.readFileSync(path.join(repoRoot, "clockin-test/index.html"), "utf8");

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
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    setAttribute() {},
    textContent: "",
    value: "",
    disabled: false,
  };
}

function response(payload) {
  return { status: 200, json: async () => payload };
}

function makeHarness({ storage, locks, randomUUID, enroll, relayEvent }) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
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
    console: { error() {} },
    document,
    localStorage: storage,
    navigator: { onLine: true, locks, serviceWorker: { addEventListener() {} } },
    window: { navigator: { standalone: false }, matchMedia() { return { matches: false }; }, addEventListener() {} },
    crypto: randomUUID ? { randomUUID } : {},
    fetch: async (url, options = {}) => {
      if (url.endsWith("/health")) {
        return response({ ok: true, service: "ceh-relay", environment: "test", storage: "ok" });
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
  vm.runInContext(`${app}\nglobalThis.__relayIdentityTestApi = { pair: pairRelayInstallationAutomatically_, probe: probeRelayReachability_, sync: syncRelayQueue_, getState: getRelayState_, getIdentity: getRelayInstallationId_ };`, context);
  return context.__relayIdentityTestApi;
}

function preparedStorage(extra = {}) {
  return makeStorage({
    ce_shell_test_auth_v1: JSON.stringify({ sessionToken: "prepared-session" }),
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
  assert.deepEqual(enrollmentIds, ["test-relay-uuid-stable", "test-relay-uuid-stable"]);
  assert.equal(harness.getState().pairedDeviceId, "test-relay-uuid-stable");
});

test("existing paired state, nonzero high-water, failures, and missing crypto never reset relay state", async () => {
  const paired = {
    version: 1, pairedDeviceId: "test-relay-existing-device", relayToken: "old", relayTokenExpiresAtMs: 1,
    lastConfirmedLedgerHighWater: 7, nextSequence: 8, highestAllocatedSequence: 7, queue: [{ eventId: "kept" }],
  };
  const pairedStorage = preparedStorage({ ce_shell_test_relay_state_v1: JSON.stringify(paired) });
  const pairedHarness = makeHarness({ storage: pairedStorage, locks: makeLocks(), randomUUID: () => "unused", enroll: () => {
    throw new Error("existing pairing must not enroll");
  } });
  await pairedHarness.pair();
  assert.deepEqual(pairedHarness.getState(), paired);

  const nonzeroHarness = makeHarness({ storage: preparedStorage(), locks: makeLocks(), randomUUID: () => "nonzero", enroll: (id) => enrolledSession(id, 2) });
  await nonzeroHarness.pair();
  assert.equal(nonzeroHarness.getState(), null);

  const legacyQueue = JSON.stringify([{ id: "legacy-unchanged" }]);
  const failureStorage = preparedStorage({ ce_shell_test_queue_v1: legacyQueue });
  const failureHarness = makeHarness({ storage: failureStorage, locks: makeLocks(), randomUUID: () => "unused", enroll: () => {
    throw new Error("legacy queue must not enroll");
  } });
  await failureHarness.pair();
  assert.equal(failureStorage.getItem("ce_shell_test_queue_v1"), legacyQueue);
  assert.equal(failureHarness.getState(), null);

  const cryptoHarness = makeHarness({ storage: preparedStorage(), locks: makeLocks(), enroll: () => {
    throw new Error("missing crypto must not enroll");
  } });
  await cryptoHarness.pair();
  assert.equal(cryptoHarness.getState(), null);
});

test("manual device-ID controls are absent from the cleaner interface", () => {
  assert.doesNotMatch(html, /relayDeviceIdInput|relayPairingConfirm|relayPairingBtn|Confirm TEST Relay Pairing/);
  assert.doesNotMatch(app, /relayDeviceIdInput|relayPairingConfirm|relayPairingBtn|pairRelayInstallation_\(/);
});

test("confirmed TEST relay reachability drains one ready queued event through the serialized path", async () => {
  const eventIds = [];
  const queuedState = {
    version: 1,
    pairedDeviceId: "test-relay-reconnect-device",
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
  const harness = makeHarness({
    storage: preparedStorage({ ce_shell_test_relay_state_v1: JSON.stringify(queuedState) }),
    locks: makeLocks(),
    randomUUID: () => "unused",
    enroll: () => { throw new Error("existing token must not enroll"); },
    relayEvent: (event) => {
      eventIds.push(event.eventId);
      return response({ ok: true, eventId: event.eventId });
    },
  });

  await harness.probe();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(eventIds, ["relay-event-reconnect"]);
  assert.equal(harness.getState().queue[0].status, "accepted");
});

test("reconnect drain keeps a single in-progress gate and only shows the sync HUD inside the locked attempt", () => {
  assert.match(app, /if \(relaySyncInProgress\) return;\s+relaySyncInProgress = 1;/);
  assert.match(app, /setTimeout\(triggerRelayQueueDrainWhenReachable_, 0\)/);
  assert.match(app, /showShellSyncHud_\("Please wait\.\.\.", "Syncing Saved Entries"\)/);
  assert.match(app, /await withRelayLock_\(async function \(\) \{[\s\S]*showShellSyncHud_/);
});
