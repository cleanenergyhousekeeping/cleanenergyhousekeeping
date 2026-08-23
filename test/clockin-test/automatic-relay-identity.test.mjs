import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(path.join(repoRoot, "clockin-test/app.js"), "utf8");
const html = fs.readFileSync(path.join(repoRoot, "clockin-test/index.html"), "utf8");

function section(name) {
  const match = app.match(new RegExp(`/\\* begin\\[${name}\\] \\*/([\\s\\S]*?)/\\* end\\[${name}\\] \\*/`));
  assert.ok(match, `missing ${name} section`);
  return match[1];
}

test("paired TEST installations stay authoritative and do not enroll again", () => {
  const pairing = section("test_automatic_relay_pairing");
  assert.match(pairing, /synchronizeExistingRelayInstallationIdentity_\(existingState\)\) return;/);
  assert.match(pairing, /if \(synchronizeExistingRelayInstallationIdentity_\(state\) \|\| state\) return;/);
  assert.match(section("test_automatic_relay_installation_identity"), /saveRelayInstallationId_\(state\.pairedDeviceId\)/);
});

test("a new TEST identity is securely persisted before enrollment and reused", () => {
  const identity = section("test_automatic_relay_installation_identity");
  const pairing = section("test_automatic_relay_pairing");
  assert.match(identity, /typeof crypto === "undefined" \|\| typeof crypto\.randomUUID !== "function"/);
  assert.match(identity, /"test-relay-" \+ crypto\.randomUUID\(\)/);
  assert.ok(identity.indexOf("const existingDeviceId = getRelayInstallationId_()") < identity.indexOf("crypto.randomUUID()"));
  assert.ok(pairing.indexOf("getOrCreateRelayInstallationId_()") < pairing.indexOf('"/v1/relay-sessions/enroll"'));
});

test("only a confirmed zero high-water initializes the first relay sequence", () => {
  const pairing = section("test_automatic_relay_pairing");
  assert.match(pairing, /appliedThroughSequence !== 0/);
  assert.match(pairing, /lastConfirmedLedgerHighWater: 0/);
  assert.match(pairing, /nextSequence: 1/);
  assert.match(pairing, /highestAllocatedSequence: 0/);
  assert.doesNotMatch(pairing, /TEST_RELAY_INITIAL_HIGH_WATER|nextSequence: 3/);
});

test("automatic pairing serializes triggers and leaves relay state untouched on temporary failure", () => {
  const pairing = section("test_automatic_relay_pairing");
  assert.match(pairing, /relayAutoPairingInProgress\) return/);
  assert.match(pairing, /await withRelayLock_\(async function/);
  assert.equal((pairing.match(/saveRelayState_/g) || []).length, 1);
  assert.doesNotMatch(pairing, /attemptCount|nextAttemptAtMs|\.queue\./);
  assert.match(app, /relayAutoPairingInProgress \|\|/);
});

test("manual device-ID controls are absent from the cleaner interface", () => {
  assert.doesNotMatch(html, /relayDeviceIdInput|relayPairingConfirm|relayPairingBtn|Confirm TEST Relay Pairing/);
  assert.doesNotMatch(app, /relayDeviceIdInput|relayPairingConfirm|relayPairingBtn|pairRelayInstallation_\(/);
});
