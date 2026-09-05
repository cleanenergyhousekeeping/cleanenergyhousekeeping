import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(path.join(repoRoot, "clockin/app.js"), "utf8");
const html = fs.readFileSync(path.join(repoRoot, "clockin/index.html"), "utf8");
const serviceWorker = fs.readFileSync(path.join(repoRoot, "clockin/service-worker.js"), "utf8");
const wranglerConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "relay/wrangler.jsonc"), "utf8"),
);

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
  const listeners = new Map();
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
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type) { (listeners.get(type) || []).forEach((listener) => listener()); },
    click() { if (!this.disabled) this.dispatch("click"); },
    focus() { this.focused = true; this.dispatch("focus"); },
    appendChild(child) { this.children.push(child); },
    children: [],
    setAttribute() {},
    textContent: "",
    value: "",
    disabled: false,
    readOnly: false,
    get innerHTML() { return this.html || ""; },
    set innerHTML(value) { this.html = value; this.children = []; },
    options: [{ value: "" }, { value: "clock_in" }, { value: "add_note" }, { value: "clock_out" }],
  };
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
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
    console: { debug() {}, error() {} },
    document,
    localStorage: storage,
    navigator: { onLine: true, locks, serviceWorker: { addEventListener() {} } },
    window: { navigator: { standalone: false }, matchMedia() { return { matches: false }; }, addEventListener() {} },
    crypto: randomUUID ? { randomUUID } : {},
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === "https://script.google.com/macros/s/AKfycbz9NS-QSV31FZRy1jWDPBEQQ8Ht4x7UIPegNYp01nwASfwgtZ6pGieYsOeYMcQf62G5/exec") {
        const request = JSON.parse(options.body);
        if (request.mode === "refreshShellAuth") {
          return response({
            ok: true,
            payload: {
              cleanerName: "Cleaner One",
              sessionToken: request.payload.sessionToken,
              clientId: request.payload.clientId,
              properties: [],
              currentShift: null,
            },
          });
        }
        if (request.mode === "submitShellQueueEntry") {
          return response({ ok: true, message: "Legacy entry synced.", currentShift: null });
        }
      }
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
  const harnessApp = enableRelay
    ? app
    : app.replace("const LIVE_RELAY_FEATURE_ENABLED = true;", "const LIVE_RELAY_FEATURE_ENABLED = false;");
  vm.runInContext(`${harnessApp}\nglobalThis.__relayIdentityTestApi = { isEnabled: isLiveRelayEnabledForCleaner_, pair: pairRelayInstallationAutomatically_, probe: probeRelayReachability_, reconcileDraft: reconcileShellEntryDraft_, retry: retryQueuedSyncIfReady_, setUnlocked: function (value) { shellUnlocked = !!value; }, sync: syncRelayQueue_, syncShell: syncShellQueue_, getState: getRelayState_, getIdentity: getRelayInstallationId_, getLegacyQueue: getShellQueue_, getEntryState: function () { return { selectedProperty: selectedOfflineProperty && selectedOfflineProperty.name, propertySearch: offlinePropertySearch.value, propertyPanelHidden: offlinePropertyInfoPanel.classList.contains("hidden"), wifi: offlinePropertyInfoWifi.textContent, action: offlineActionSelect.value, note: offlineNoteInput.value, noteHidden: offlineNoteWrap.classList.contains("hidden") }; }, getFetchCalls: function () { return globalThis.__fetchCalls; } };`, context);
  vm.runInContext(`globalThis.__propertySearchTestApi = {
    setEntryLocked: setShellEntryLocked_, resetEntry: resetOfflineEntryForm_,
    reloadSafe: isLivePwaUpdateReloadSafe_,
    directions: function (userAgent, destination) {
      navigator.userAgent = userAgent;
      return getOfflineDirectionsUrl_(destination);
    }
  };`, context);
  return Object.assign(context.__relayIdentityTestApi, context.__propertySearchTestApi, {
    element: (id) => document.getElementById(id),
  });
}

function preparedStorage(extra = {}) {
  return makeStorage({
    ce_shell_auth_v1: JSON.stringify({ cleanerName: "Cleaner One", sessionToken: "prepared-session" }),
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
  assert.doesNotMatch(app, /ceh-relay-test\.kyle-405\.workers\.dev/);
  assert.match(app, /const LIVE_RELAY_WORKER_URL = "https:\/\/ceh-relay-production\.kyle-405\.workers\.dev"/);
  assert.doesNotMatch(app, /ce_shell_test_relay_(state|installation_id)_v1/);
  assert.doesNotMatch(app, /\/clockin-test(?:\/|\b)/);
  assert.match(app, /const LIVE_RELAY_STATE_KEY = "ce_shell_live_relay_state_v1"/);
  assert.match(app, /const LIVE_RELAY_INSTALLATION_ID_KEY = "ce_shell_live_relay_installation_id_v1"/);
  assert.match(app, /const LIVE_RELAY_LOCK_NAME = "ce-shell-live-relay-v1"/);
  assert.match(app, /const SHELL_AUTH_KEY = "ce_shell_auth_v1"/);
  assert.match(app, /const SHELL_QUEUE_KEY = "ce_shell_queue_v1"/);
  assert.match(app, /const SHELL_ENTRY_DRAFT_KEY = "ce_shell_entry_draft_v1"/);
});

test("production Workers.dev ingress and every-minute cron are enabled while previews remain off", () => {
  assert.equal(wranglerConfig.env.production.name, "ceh-relay-production");
  assert.equal(wranglerConfig.env.production.workers_dev, true);
  assert.equal(wranglerConfig.env.production.preview_urls, false);
  assert.deepEqual(wranglerConfig.env.production.triggers.crons, ["* * * * *"]);
});

test("TEST Wrangler settings remain unchanged", () => {
  assert.equal(wranglerConfig.name, "ceh-relay-test");
  assert.equal(wranglerConfig.workers_dev, true);
  assert.equal(wranglerConfig.preview_urls, false);
  assert.deepEqual(wranglerConfig.triggers.crons, ["* * * * *"]);
  assert.deepEqual(wranglerConfig.vars, {
    CEH_RELAY_ENVIRONMENT: "test",
    CEH_RELAY_APPS_ACTIVE_KEY_ID: "test-v1",
    CEH_RELAY_PAYLOAD_ACTIVE_KEY_VERSION: "1",
  });
  assert.equal(wranglerConfig.d1_databases[0].database_name, "ceh-relay-test-db");
  assert.equal(wranglerConfig.d1_databases[0].database_id, "8804b3a1-8af0-413d-a0c3-37830e0988a0");
});

test("Live build and service-worker cache versions agree", () => {
  const buildVersion = app.match(/const LIVE_BUILD_VERSION = "v(\d+)";/u)?.[1];
  const cacheVersion = serviceWorker.match(/const CACHE_NAME = "ce-clockin-shell-v(\d+)";/u)?.[1];
  assert.equal(buildVersion, "254");
  assert.equal(cacheVersion, buildVersion);
});

test("the global Live relay switch can deliberately preserve the legacy path", async () => {
  const legacyEntry = {
    queuedId: "legacy-entry-1",
    eventType: "clock_out",
    property: "Legacy Property",
    note: "",
    submittedAtMs: 1,
  };
  const relayState = {
    version: 1,
    pairedDeviceId: "production-relay-existing-device",
    relayToken: "must-not-be-used",
    relayTokenExpiresAtMs: 2_000_000_000_000,
    lastConfirmedLedgerHighWater: 0,
    nextSequence: 1,
    highestAllocatedSequence: 0,
    queue: [],
  };
  const harness = makeHarness({
    storage: makeStorage({
      ce_shell_auth_v1: JSON.stringify({
        cleanerName: "Cleaner One",
        sessionToken: "legacy-session",
        clientId: "legacy-client",
      }),
      ce_shell_queue_v1: JSON.stringify([legacyEntry]),
      ce_shell_live_relay_state_v1: JSON.stringify(relayState),
    }),
    locks: makeLocks(),
    randomUUID: () => "unused",
    enroll: () => { throw new Error("disabled relay must not enroll"); },
    relayEvent: () => { throw new Error("disabled relay must not submit"); },
    enableRelay: false,
  });
  assert.equal(harness.isEnabled(), false);
  await harness.pair();
  await harness.probe();
  await harness.syncShell();

  const fetchCalls = harness.getFetchCalls();
  assert.equal(fetchCalls.length >= 2, true);
  assert.equal(fetchCalls.every((call) => call.url.includes("script.google.com/macros/s/")), true);
  assert.equal(fetchCalls.some((call) => call.url.includes("workers.dev")), false);
  assert.deepEqual(harness.getLegacyQueue(), []);
  assert.deepEqual(harness.getState(), relayState);
  assert.match(app, /const LIVE_RELAY_FEATURE_ENABLED = true;/);
  assert.match(app, /function saveOfflineEntry_\(\) \{\s+if \(isLiveRelayEnabledForCleaner_\(\)\) \{[\s\S]*?\n  const shellAuth = getShellAuth_\(\);/u);
});

test("no Kyle-specific Live relay pilot gate remains", () => {
  assert.match(app, /function isLiveRelayEnabledForCleaner_\(shellAuth\)/);
  assert.doesNotMatch(app, /Kyle Wescott|LIVE_RELAY_PILOT_CLEANER_NAME|isLiveRelayPilotCleaner_|live_relay_pilot_gate/u);
  assert.doesNotMatch(app, /\bpilot\b/iu);
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

/* begin[live_property_clear_tests] */
function propertySearchHarness(currentShift = null) {
  const properties = [
    { name: "10 Oak Street", wifiNetwork: "Oak 10", houseNotes: "First property" },
    { name: "12 Oak Street", wifiNetwork: "Oak 12", houseNotes: "Second property" },
  ];
  const auth = { cleanerName: "Cleaner One", sessionToken: "prepared-session", properties, currentShift };
  const storage = makeStorage({
    ce_shell_auth_v1: JSON.stringify(auth),
    ce_shell_queue_v1: JSON.stringify([{ queuedId: "keep-this-entry" }]),
  });
  const harness = makeHarness({ storage, enableRelay: false });
  harness.setUnlocked(true);
  harness.reconcileDraft(auth);
  harness.element("offlineCleanerDisplay").value = auth.cleanerName;
  return { harness, storage, auth };
}

function searchProperty(harness, query) {
  const input = harness.element("offlinePropertySearch");
  input.value = query;
  input.dispatch("input");
  return harness.element("offlinePropertyResults").children;
}

test("Live Clear removes only the property and supports immediate search and reselection", () => {
  const { harness, storage, auth } = propertySearchHarness();
  const clear = harness.element("offlinePropertyClearBtn");
  const results = harness.element("offlinePropertyResults");
  const action = harness.element("offlineActionSelect");
  const note = harness.element("offlineNoteInput");
  const queueBefore = storage.getItem("ce_shell_queue_v1");

  assert.equal(clear.disabled, false);
  assert.equal(searchProperty(harness, "oAk").length, 2);
  results.children[0].click();
  assert.equal(harness.getEntryState().selectedProperty, "10 Oak Street");
  assert.equal(harness.getEntryState().propertyPanelHidden, false);
  assert.equal(harness.getEntryState().wifi, "Oak 10");
  action.value = "clock_in";
  action.dispatch("change");
  note.value = "Keep this entry note";
  note.dispatch("input");
  const noteHiddenBefore = harness.getEntryState().noteHidden;
  harness.element("offlinePropertySearch").focus();
  assert.equal(results.classList.contains("hidden"), false);

  clear.click();

  assert.equal(harness.getEntryState().selectedProperty, null);
  assert.equal(harness.getEntryState().propertySearch, "");
  assert.equal(harness.getEntryState().propertyPanelHidden, true);
  assert.equal(harness.getEntryState().wifi, "");
  assert.equal(harness.element("offlinePropertyInfoNotes").textContent, "");
  assert.equal(harness.element("offlineDirectionsBtn").classList.contains("hidden"), true);
  assert.equal(results.children.length, 0);
  assert.equal(results.classList.contains("hidden"), true);
  assert.equal(harness.element("offlinePropertySearch").focused, true);
  assert.equal(harness.element("offlineGuidanceText").textContent, "Action selected. Now choose a property from the list.");
  assert.equal(harness.element("offlineCleanerDisplay").value, auth.cleanerName);
  assert.equal(storage.getItem("ce_shell_auth_v1"), JSON.stringify(auth));
  assert.equal(storage.getItem("ce_shell_queue_v1"), queueBefore);
  assert.equal(action.value, "clock_in");
  assert.equal(note.value, "Keep this entry note");
  assert.equal(harness.getEntryState().noteHidden, noteHiddenBefore);
  assert.deepEqual(JSON.parse(storage.getItem("ce_shell_entry_draft_v1")), {
    cleanerName: auth.cleanerName, propertyName: "", action: "clock_in", note: "Keep this entry note",
  });

  searchProperty(harness, "12 Oak")[0].click();
  assert.equal(harness.getEntryState().selectedProperty, "12 Oak Street");
  assert.equal(harness.getEntryState().propertySearch, "12 Oak Street");
  assert.equal(harness.getEntryState().propertyPanelHidden, false);
  assert.equal(harness.getEntryState().wifi, "Oak 12");
  assert.equal(results.classList.contains("hidden"), true);
  assert.equal(JSON.parse(storage.getItem("ce_shell_entry_draft_v1")).propertyName, "12 Oak Street");

  // Manual erasing, unmatched searches, and Clear without a selection still work.
  searchProperty(harness, "");
  assert.equal(harness.getEntryState().selectedProperty, null);
  assert.equal(harness.getEntryState().propertyPanelHidden, true);
  assert.equal(searchProperty(harness, "Unknown Street").length, 0);
  clear.click();
  assert.equal(harness.getEntryState().propertySearch, "");
});

test("Live Clear is disabled and guarded for an active shift, including after entry unlock", () => {
  const { harness, storage, auth } = propertySearchHarness({ property: "10 Oak Street", clockInMs: 1 });
  const clear = harness.element("offlinePropertyClearBtn");
  const input = harness.element("offlinePropertySearch");
  const before = harness.getEntryState();
  const draftBefore = storage.getItem("ce_shell_entry_draft_v1");

  assert.equal(input.readOnly, true);
  assert.equal(input.classList.contains("lockedProperty"), true);
  assert.equal(clear.disabled, true);
  clear.click();
  clear.dispatch("click"); // The handler also rejects synthetic clicks on a disabled button.
  harness.setEntryLocked(true);
  harness.setEntryLocked(false);
  assert.equal(clear.disabled, true);
  assert.deepEqual(harness.getEntryState(), before);
  assert.equal(storage.getItem("ce_shell_entry_draft_v1"), draftBefore);

  // Auth remains authoritative even if the input's read-only flag is stale.
  input.readOnly = false;
  clear.dispatch("click");
  assert.deepEqual(harness.getEntryState(), before);
  harness.resetEntry(auth);
  assert.equal(input.readOnly, true);
  assert.equal(clear.disabled, true);

  const endedAuth = { ...auth, currentShift: null };
  storage.setItem("ce_shell_auth_v1", JSON.stringify(endedAuth));
  harness.resetEntry(endedAuth);
  assert.equal(input.readOnly, false);
  assert.equal(clear.disabled, false);
  searchProperty(harness, "12 Oak")[0].click();
  clear.click();
  assert.equal(harness.getEntryState().selectedProperty, null);
});

test("Live Clear respects entry locks and a locked shell", () => {
  const { harness } = propertySearchHarness();
  const clear = harness.element("offlinePropertyClearBtn");
  searchProperty(harness, "10 Oak")[0].click();
  const before = harness.getEntryState();
  harness.setEntryLocked(true);
  assert.equal(clear.disabled, true);
  clear.dispatch("click");
  assert.deepEqual(harness.getEntryState(), before);
  harness.setEntryLocked(false);
  assert.equal(clear.disabled, false);
  harness.setUnlocked(false);
  clear.dispatch("click");
  assert.deepEqual(harness.getEntryState(), before);
});
/* end[live_property_clear_tests] */

test("TEST runtime remains isolated from Live relay identifiers", () => {
  const testApp = fs.readFileSync(path.join(repoRoot, "clockin-test/app.js"), "utf8");
  assert.match(testApp, /ceh-relay-test\.kyle-405\.workers\.dev/);
  assert.match(testApp, /ce_shell_test_relay_state_v1/);
  assert.doesNotMatch(testApp, /ce_shell_live_relay_state_v1/);
  assert.doesNotMatch(testApp, /\/clockin\/(?:service-worker|app)\.js/);
});

test("ordinary authenticated Live cleaners use production relay and concurrent contexts enroll one stable installation identity", async () => {
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

  assert.equal(first.isEnabled(), true);
  assert.equal(second.isEnabled(), true);
  assert.equal(first.isEnabled({ cleanerName: "Cleaner Two", sessionToken: "another-session" }), true);
  assert.equal(first.isEnabled({ cleanerName: "Unprepared Cleaner" }), false);
  assert.equal(first.isEnabled({ cleanerName: "", sessionToken: "missing-cleaner" }), false);
  await Promise.all([first.pair(), second.pair()]);

  const state = first.getState();
  assert.equal(enrollmentIds.length, 1);
  assert.equal(first.getIdentity(), enrollmentIds[0]);
  assert.equal(second.getIdentity(), enrollmentIds[0]);
  assert.equal(state.pairedDeviceId, enrollmentIds[0]);
  assert.equal(state.nextSequence, 1);
  assert.equal(
    first.getFetchCalls().some((call) =>
      call.url === "https://ceh-relay-production.kyle-405.workers.dev/v1/relay-sessions/enroll"
    ),
    true,
  );
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

/* begin[live_pwa_polish_tests] */
test("background reconciliation preserves typing, results and a selected clock-in action", () => {
  const { harness, auth } = propertySearchHarness();
  const matches = searchProperty(harness, "oAk");
  harness.element("offlineActionSelect").value = "clock_in";
  harness.reconcileDraft(auth);
  harness.reconcileDraft({ ...auth, properties: [...auth.properties] });
  assert.equal(harness.getEntryState().propertySearch, "oAk");
  assert.equal(harness.getEntryState().action, "clock_in");
  assert.equal(harness.element("offlinePropertyResults").children[0], matches[0]);
  matches[0].click();
  harness.reconcileDraft(auth);
  assert.equal(harness.getEntryState().selectedProperty, "10 Oak Street");
  assert.equal(harness.getEntryState().action, "clock_in");
});

test("shift changes and explicit resets still clear the previous property entry", () => {
  const { harness, auth } = propertySearchHarness();
  searchProperty(harness, "12 Oak")[0].click();
  const active = { ...auth, currentShift: { property: "10 Oak Street", clockInMs: 123 } };
  harness.reconcileDraft(active);
  assert.equal(harness.getEntryState().propertySearch, "10 Oak Street");
  assert.equal(harness.element("offlinePropertySearch").readOnly, true);
  harness.reconcileDraft(auth);
  assert.equal(harness.getEntryState().propertySearch, "");
  searchProperty(harness, "12 Oak")[0].click();
  harness.resetEntry(auth);
  harness.reconcileDraft(auth);
  assert.equal(harness.getEntryState().propertySearch, "");
});

test("automatic update reload is deferred throughout an unlocked session", () => {
  const { harness } = propertySearchHarness();
  harness.element("shellSyncHud").classList.add("hidden");
  harness.element("shellFlashHud").classList.add("hidden");
  assert.equal(harness.reloadSafe(), false);
  harness.setUnlocked(false);
  assert.equal(harness.reloadSafe(), true);
});

test("directions uses platform handlers and safely encodes the destination", () => {
  const { harness } = propertySearchHarness();
  const destination = "10 Oak Street & Main #2";
  const fallback = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
  assert.equal(harness.directions("iPhone", destination), "https://maps.apple.com/?daddr=" + encodeURIComponent(destination));
  const android = harness.directions("Android", destination);
  assert.ok(android.startsWith("intent:0,0?q=" + encodeURIComponent(destination) + "#Intent;"));
  assert.ok(android.includes("S.browser_fallback_url=" + encodeURIComponent(fallback)));
  assert.ok(!android.includes("package="));
  assert.equal(harness.directions("Desktop", destination), fallback);
});
/* end[live_pwa_polish_tests] */
