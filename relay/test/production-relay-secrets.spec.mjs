import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  SecretHelperError,
  createRecoveryBundle,
  decodeKey,
  deployWorkerWithSecrets,
  encodeKey,
  handOffAppsScriptSecrets,
  parseRecoveryBundle,
  runCommand,
  runSelfTest,
  validateRecoveryBundle,
  workerSecretsFromBundle,
} from "../scripts/production-relay-secrets.mjs";

/* begin[production_relay_secret_helper_tests] */
const TEST_APPS_URL =
  "https://script.google.com/macros/s/synthetic-test-deployment/exec";

function deterministicRandomBytes() {
  let fill = 1;
  return (size) => Buffer.alloc(size, fill++);
}

function syntheticBundle() {
  return createRecoveryBundle(TEST_APPS_URL, deterministicRandomBytes());
}

function allLogicalKeys(bundle) {
  return [
    JSON.parse(bundle.appsScript.CEH_RELAY_HMAC_KEYS_JSON)["production-v1"],
    bundle.appsScript.CEH_RELAY_SUBJECT_HMAC_KEY,
    bundle.worker.CEH_RELAY_TOKEN_HMAC_KEY,
    bundle.worker.CEH_RELAY_EVENT_DIGEST_HMAC_KEY,
    JSON.parse(bundle.worker.CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON)["1"],
  ];
}

describe("production relay secret helper", () => {
  it("generates independent, canonical 32-byte base64url keys", () => {
    const bundle = syntheticBundle();
    const keys = allLogicalKeys(bundle);

    expect(new Set(keys)).toHaveLength(5);
    for (const key of keys) {
      expect(key).toHaveLength(43);
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(key).not.toContain("=");
      expect(decodeKey(key)).toHaveLength(32);
      expect(encodeKey(decodeKey(key))).toBe(key);
    }
  });

  it("uses the same signing ring and payload version one", () => {
    const bundle = syntheticBundle();

    expect(bundle.appsScript.CEH_RELAY_HMAC_KEYS_JSON).toBe(
      bundle.worker.CEH_RELAY_APPS_HMAC_KEYS_JSON,
    );
    expect(Object.keys(JSON.parse(bundle.appsScript.CEH_RELAY_HMAC_KEYS_JSON))).toEqual([
      "production-v1",
    ]);
    expect(
      Object.keys(JSON.parse(bundle.worker.CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON)),
    ).toEqual(["1"]);
  });

  it("rejects malformed, padded, reused, and mismatched key material", () => {
    const bundle = syntheticBundle();
    expect(() => encodeKey(Buffer.alloc(31))).toThrow(
      "Key material must be exactly 32 bytes",
    );
    expect(() => decodeKey("!".repeat(43))).toThrow(SecretHelperError);
    expect(() => decodeKey(`${allLogicalKeys(bundle)[0]}=`)).toThrow(SecretHelperError);

    const mismatched = structuredClone(bundle);
    mismatched.worker.CEH_RELAY_APPS_HMAC_KEYS_JSON = JSON.stringify({
      "production-v1": allLogicalKeys(bundle)[1],
    });
    expect(() => validateRecoveryBundle(mismatched)).toThrow(
      "Shared signing material does not match",
    );

    const reused = structuredClone(bundle);
    reused.worker.CEH_RELAY_TOKEN_HMAC_KEY = allLogicalKeys(bundle)[0];
    expect(() => validateRecoveryBundle(reused)).toThrow(
      "Logical keys must be independent",
    );

    const wrongPayloadVersion = structuredClone(bundle);
    wrongPayloadVersion.worker.CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON =
      JSON.stringify({ "2": allLogicalKeys(bundle)[4] });
    expect(() => validateRecoveryBundle(wrongPayloadVersion)).toThrow(
      "Invalid recovery bundle",
    );
    expect(() => parseRecoveryBundle("not-json")).toThrow(SecretHelperError);
  });

  it("requires a production Apps Script exec URL", () => {
    expect(() => createRecoveryBundle("", deterministicRandomBytes())).toThrow(
      "Production Apps Script URL is required",
    );
    expect(() =>
      createRecoveryBundle("http://script.google.com/macros/s/id/exec", deterministicRandomBytes()),
    ).toThrow("Invalid production Apps Script URL");
  });

  it("hands synthetic Apps Script values through a clearing clipboard transport", async () => {
    const bundle = syntheticBundle();
    const writes = [];
    const prompts = [];

    await handOffAppsScriptSecrets(bundle, {
      promptFunction: async (prompt) => prompts.push(prompt),
      writeClipboardFunction: (value) => writes.push(value),
    });

    expect(writes).toEqual([
      bundle.appsScript.CEH_RELAY_HMAC_KEYS_JSON,
      "",
      bundle.appsScript.CEH_RELAY_SUBJECT_HMAC_KEY,
      "",
    ]);
    expect(prompts).toHaveLength(2);
    for (const key of allLogicalKeys(bundle)) {
      expect(prompts.join(" ")).not.toContain(key);
    }
  });

  it("constructs exactly the five Worker secrets without temporary files", () => {
    const bundle = syntheticBundle();
    const workerSecrets = workerSecretsFromBundle(bundle);

    expect(Object.keys(workerSecrets).sort()).toEqual([
      "CEH_RELAY_APPS_HMAC_KEYS_JSON",
      "CEH_RELAY_APPS_URL",
      "CEH_RELAY_EVENT_DIGEST_HMAC_KEY",
      "CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON",
      "CEH_RELAY_TOKEN_HMAC_KEY",
    ]);
    expect(workerSecrets.CEH_RELAY_APPS_URL).toBe(TEST_APPS_URL);
  });

  it("uses a dark production deploy and sends secrets only through closed fd 3", async () => {
    const workerSecrets = workerSecretsFromBundle(syntheticBundle());
    let received = "";
    let spawnArgs;
    let spawnCommand;
    let spawnOptions;
    let secretDescriptor;
    const spawnFunction = (command, args, options) => {
      spawnCommand = command;
      spawnArgs = args;
      spawnOptions = options;
      const child = new EventEmitter();
      secretDescriptor = new Writable({
        write(chunk, _encoding, callback) {
          received += chunk.toString();
          callback();
        },
        final(callback) {
          callback();
          queueMicrotask(() => child.emit("close", 0));
        },
      });
      child.stdio = [null, null, null, secretDescriptor];
      return child;
    };

    await deployWorkerWithSecrets(workerSecrets, { spawnFunction });

    expect(JSON.parse(received)).toEqual(workerSecrets);
    expect(spawnCommand).toMatch(/node_modules\/\.bin\/wrangler$/u);
    expect(spawnArgs.slice(0, 7)).toEqual([
      "deploy",
      "--env",
      "production",
      "--strict",
      "--secrets-file",
      "/dev/fd/3",
      "--config",
    ]);
    expect(spawnArgs).toHaveLength(8);
    expect(spawnArgs[7]).toMatch(/wrangler\.jsonc$/u);
    expect(spawnArgs).not.toContain("secret");
    expect(spawnArgs).not.toContain("bulk");
    expect(spawnOptions.stdio).toEqual(["ignore", "ignore", "ignore", "pipe"]);
    expect(spawnOptions).not.toHaveProperty("env");
    expect(secretDescriptor.writableEnded).toBe(true);
    const commandLine = [spawnCommand, ...spawnArgs].join(" ");
    for (const value of Object.values(workerSecrets)) {
      expect(commandLine).not.toContain(value);
    }
  });

  it("uses only a local Node consumer in synthetic test mode", async () => {
    let spawnArgs;
    let spawnCommand;
    const spawnFunction = (command, args) => {
      spawnCommand = command;
      spawnArgs = args;
      const child = new EventEmitter();
      const descriptor = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
        final(callback) {
          callback();
          queueMicrotask(() => child.emit("close", 0));
        },
      });
      child.stdio = [null, null, null, descriptor];
      return child;
    };

    await runSelfTest({ spawnFunction });

    expect(spawnCommand).toBe(process.execPath);
    expect(spawnArgs[0]).toBe("-e");
    expect(spawnCommand).not.toMatch(/wrangler/u);
  });

  it("refuses an unsafe output mode", async () => {
    await expect(runCommand("print")).rejects.toThrow(
      "Unsafe or unknown output mode refused",
    );
  });
});
/* end[production_relay_secret_helper_tests] */
