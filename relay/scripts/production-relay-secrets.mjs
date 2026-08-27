#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

/* begin[production_relay_secret_helper] */
const APPS_KEY_ID = "production-v1";
const PAYLOAD_KEY_VERSION = "1";
const ENCODED_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_RECOVERY_BUNDLE_BYTES = 64 * 1024;
const RELAY_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_DESCRIPTOR_NUMBER = 3;
const SECRET_DESCRIPTOR_PATH = `/dev/fd/${SECRET_DESCRIPTOR_NUMBER}`;

const APPS_SCRIPT_SECRET_NAMES = [
  "CEH_RELAY_HMAC_KEYS_JSON",
  "CEH_RELAY_SUBJECT_HMAC_KEY",
];
const WORKER_SECRET_NAMES = [
  "CEH_RELAY_APPS_URL",
  "CEH_RELAY_APPS_HMAC_KEYS_JSON",
  "CEH_RELAY_TOKEN_HMAC_KEY",
  "CEH_RELAY_EVENT_DIGEST_HMAC_KEY",
  "CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON",
];

let clipboardContainsSensitiveMaterial = false;

export class SecretHelperError extends Error {
  constructor(message) {
    super(message);
    this.name = "SecretHelperError";
  }
}

function requirePlainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new SecretHelperError("Invalid recovery bundle");
  }
  return value;
}

function requireExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(requirePlainObject(value)).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new SecretHelperError("Invalid recovery bundle");
  }
}

export function encodeKey(rawKey) {
  if (!(rawKey instanceof Uint8Array) || rawKey.byteLength !== 32) {
    throw new SecretHelperError("Key material must be exactly 32 bytes");
  }
  const encoded = Buffer.from(rawKey).toString("base64url");
  validateEncodedKey(encoded);
  return encoded;
}

export function decodeKey(encodedKey) {
  validateEncodedKey(encodedKey);
  const decoded = Buffer.from(encodedKey, "base64url");
  if (
    decoded.byteLength !== 32 ||
    decoded.toString("base64url") !== encodedKey
  ) {
    throw new SecretHelperError("Invalid encoded key material");
  }
  return decoded;
}

export function validateEncodedKey(encodedKey) {
  if (
    typeof encodedKey !== "string" ||
    encodedKey.includes("=") ||
    !ENCODED_KEY_PATTERN.test(encodedKey)
  ) {
    throw new SecretHelperError("Invalid encoded key material");
  }
}

export function validateProductionAppsUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SecretHelperError("Production Apps Script URL is required");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new SecretHelperError("Invalid production Apps Script URL");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/u.test(parsed.pathname) ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new SecretHelperError("Invalid production Apps Script URL");
  }
  return parsed.toString();
}

export function generateLogicalKeys(randomBytesFunction = randomBytes) {
  const encodedKeys = Array.from({ length: 5 }, () =>
    encodeKey(randomBytesFunction(32)),
  );
  if (new Set(encodedKeys).size !== encodedKeys.length) {
    throw new SecretHelperError("Generated keys must be independent");
  }

  const [sharedSigning, subjectHmac, relayTokenHmac, eventDigestHmac, payload] =
    encodedKeys;
  return {
    eventDigestHmac,
    payload,
    relayTokenHmac,
    sharedSigning,
    subjectHmac,
  };
}

export function createRecoveryBundle(appsUrl, randomBytesFunction = randomBytes) {
  const normalizedAppsUrl = validateProductionAppsUrl(appsUrl);
  const keys = generateLogicalKeys(randomBytesFunction);
  const signingRing = JSON.stringify({ [APPS_KEY_ID]: keys.sharedSigning });
  const payloadRing = JSON.stringify({ [PAYLOAD_KEY_VERSION]: keys.payload });

  const bundle = {
    schemaVersion: 1,
    environment: "production",
    appsScript: {
      CEH_RELAY_HMAC_KEYS_JSON: signingRing,
      CEH_RELAY_SUBJECT_HMAC_KEY: keys.subjectHmac,
    },
    worker: {
      CEH_RELAY_APPS_URL: normalizedAppsUrl,
      CEH_RELAY_APPS_HMAC_KEYS_JSON: signingRing,
      CEH_RELAY_TOKEN_HMAC_KEY: keys.relayTokenHmac,
      CEH_RELAY_EVENT_DIGEST_HMAC_KEY: keys.eventDigestHmac,
      CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON: payloadRing,
    },
  };
  validateRecoveryBundle(bundle);
  return bundle;
}

function parseKeyRing(value, expectedKey) {
  if (typeof value !== "string") {
    throw new SecretHelperError("Invalid recovery bundle");
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SecretHelperError("Invalid recovery bundle");
  }
  requireExactKeys(parsed, [expectedKey]);
  const encodedKey = parsed[expectedKey];
  decodeKey(encodedKey);
  return encodedKey;
}

export function validateRecoveryBundle(value) {
  const bundle = requirePlainObject(value);
  requireExactKeys(bundle, [
    "schemaVersion",
    "environment",
    "appsScript",
    "worker",
  ]);
  if (bundle.schemaVersion !== 1 || bundle.environment !== "production") {
    throw new SecretHelperError("Invalid recovery bundle");
  }

  requireExactKeys(bundle.appsScript, APPS_SCRIPT_SECRET_NAMES);
  requireExactKeys(bundle.worker, WORKER_SECRET_NAMES);
  validateProductionAppsUrl(bundle.worker.CEH_RELAY_APPS_URL);

  const appsSigningKey = parseKeyRing(
    bundle.appsScript.CEH_RELAY_HMAC_KEYS_JSON,
    APPS_KEY_ID,
  );
  const workerSigningKey = parseKeyRing(
    bundle.worker.CEH_RELAY_APPS_HMAC_KEYS_JSON,
    APPS_KEY_ID,
  );
  if (appsSigningKey !== workerSigningKey) {
    throw new SecretHelperError("Shared signing material does not match");
  }

  const logicalKeys = [
    appsSigningKey,
    bundle.appsScript.CEH_RELAY_SUBJECT_HMAC_KEY,
    bundle.worker.CEH_RELAY_TOKEN_HMAC_KEY,
    bundle.worker.CEH_RELAY_EVENT_DIGEST_HMAC_KEY,
    parseKeyRing(
      bundle.worker.CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON,
      PAYLOAD_KEY_VERSION,
    ),
  ];
  logicalKeys.forEach(decodeKey);
  if (new Set(logicalKeys).size !== logicalKeys.length) {
    throw new SecretHelperError("Logical keys must be independent");
  }
  return bundle;
}

export function parseRecoveryBundle(serializedBundle) {
  if (typeof serializedBundle !== "string") {
    throw new SecretHelperError("Invalid recovery bundle");
  }
  try {
    return validateRecoveryBundle(JSON.parse(serializedBundle));
  } catch (error) {
    if (error instanceof SecretHelperError) {
      throw error;
    }
    throw new SecretHelperError("Invalid recovery bundle");
  }
}

function writeClipboard(value) {
  const result = spawnSync("/usr/bin/pbcopy", [], {
    input: value,
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (result.status !== 0) {
    throw new SecretHelperError("Clipboard operation failed");
  }
}

export function clearClipboard(writeClipboardFunction = writeClipboard) {
  writeClipboardFunction("");
  clipboardContainsSensitiveMaterial = false;
}

async function promptOnTty(prompt) {
  const input = createReadStream("/dev/tty");
  const output = createWriteStream("/dev/tty");
  const readline = createInterface({ input, output });
  try {
    return await readline.question(prompt);
  } finally {
    readline.close();
    input.destroy();
    output.end();
  }
}

export async function handOffClipboardValue(
  value,
  prompt,
  {
    promptFunction = promptOnTty,
    writeClipboardFunction = writeClipboard,
  } = {},
) {
  clipboardContainsSensitiveMaterial = true;
  try {
    writeClipboardFunction(value);
    await promptFunction(prompt);
  } finally {
    clearClipboard(writeClipboardFunction);
  }
}

export async function handOffAppsScriptSecrets(bundle, dependencies = {}) {
  const validated = validateRecoveryBundle(bundle);
  for (const secretName of APPS_SCRIPT_SECRET_NAMES) {
    await handOffClipboardValue(
      validated.appsScript[secretName],
      `Paste ${secretName} into the matching field in the owner-operated ` +
        "modal, then press Enter to clear the clipboard: ",
      dependencies,
    );
  }
}

export function workerSecretsFromBundle(bundle) {
  const validated = validateRecoveryBundle(bundle);
  return Object.fromEntries(
    WORKER_SECRET_NAMES.map((name) => [name, validated.worker[name]]),
  );
}

export async function deployWorkerWithSecrets(
  workerSecrets,
  {
    args = [
      "deploy",
      "--env",
      "production",
      "--strict",
      "--secrets-file",
      SECRET_DESCRIPTOR_PATH,
      "--config",
      resolve(RELAY_DIRECTORY, "wrangler.jsonc"),
    ],
    command = resolve(RELAY_DIRECTORY, "node_modules/.bin/wrangler"),
    cwd = RELAY_DIRECTORY,
    spawnFunction = spawn,
  } = {},
) {
  requireExactKeys(workerSecrets, WORKER_SECRET_NAMES);
  const serializedSecrets = JSON.stringify(workerSecrets);

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawnFunction(command, args, {
      cwd,
      stdio: ["ignore", "ignore", "ignore", "pipe"],
    });
    child.once("error", () =>
      rejectPromise(new SecretHelperError("Worker secret transport failed")),
    );
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new SecretHelperError("Worker secret transport failed"));
      }
    });
    const secretDescriptor = child.stdio[SECRET_DESCRIPTOR_NUMBER];
    if (secretDescriptor === undefined || secretDescriptor === null) {
      rejectPromise(new SecretHelperError("Worker secret transport failed"));
      return;
    }
    secretDescriptor.once("error", () =>
      rejectPromise(new SecretHelperError("Worker secret transport failed")),
    );
    secretDescriptor.end(serializedSecrets);
  });
}

async function readStandardInput() {
  if (process.stdin.isTTY) {
    throw new SecretHelperError("Recovery bundle must be supplied through stdin");
  }
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of process.stdin) {
    byteLength += chunk.byteLength;
    if (byteLength > MAX_RECOVERY_BUNDLE_BYTES) {
      throw new SecretHelperError("Recovery bundle is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function loadRecoveryBundleFromStdin() {
  let serializedBundle;
  try {
    serializedBundle = await readStandardInput();
  } finally {
    clearClipboard();
  }
  return parseRecoveryBundle(serializedBundle);
}

function syntheticRandomBytes() {
  let nextByte = 1;
  return (size) => {
    if (size !== 32) {
      throw new SecretHelperError("Synthetic RNG received an invalid size");
    }
    return Buffer.alloc(size, nextByte++);
  };
}

export async function runSelfTest({ spawnFunction = spawn } = {}) {
  const testUrl = "https://script.google.com/macros/s/synthetic-test-id/exec";
  const randomBundle = createRecoveryBundle(testUrl);
  validateRecoveryBundle(randomBundle);

  const syntheticBundle = createRecoveryBundle(testUrl, syntheticRandomBytes());
  const clipboardWrites = [];
  await handOffAppsScriptSecrets(syntheticBundle, {
    promptFunction: async () => undefined,
    writeClipboardFunction: (value) => clipboardWrites.push(value),
  });
  if (
    clipboardWrites.length !== 4 ||
    clipboardWrites[1] !== "" ||
    clipboardWrites[3] !== ""
  ) {
    throw new SecretHelperError("Synthetic clipboard transport failed");
  }

  const consumerScript = [
    "const { readFileSync } = require('node:fs');",
    "const parsed = JSON.parse(readFileSync('/dev/fd/3', 'utf8'));",
    `const expected = ${JSON.stringify(WORKER_SECRET_NAMES)};`,
    "const actual = Object.keys(parsed).sort();",
    "if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) process.exitCode = 2;",
  ].join("\n");
  await deployWorkerWithSecrets(workerSecretsFromBundle(syntheticBundle), {
    args: ["-e", consumerScript],
    command: process.execPath,
    cwd: RELAY_DIRECTORY,
    spawnFunction,
  });
}

function installSignalCleanup() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (clipboardContainsSensitiveMaterial) {
        try {
          clearClipboard();
        } catch {
          // Exit without reporting clipboard or secret content.
        }
      }
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}

export async function runCommand(command) {
  if (command === "test") {
    await runSelfTest();
    process.stdout.write("Synthetic relay secret helper test passed; no secret material was printed.\n");
    return;
  }

  if (command === "generate") {
    const appsUrl = (await promptOnTty("Enter the production Apps Script /exec URL: ")).trim();
    const bundle = createRecoveryBundle(appsUrl);
    await handOffClipboardValue(
      JSON.stringify(bundle),
      "Save the recovery bundle in a password-manager secure note, then press Enter to clear the clipboard: ",
    );
    process.stdout.write("Recovery handoff completed and the clipboard was cleared.\n");
    return;
  }

  if (command === "apps-script-modal") {
    const bundle = await loadRecoveryBundleFromStdin();
    await handOffAppsScriptSecrets(bundle);
    process.stdout.write("Apps Script modal handoff completed and the clipboard was cleared.\n");
    return;
  }

  if (command === "worker-bootstrap") {
    const bundle = await loadRecoveryBundleFromStdin();
    const confirmation = await promptOnTty(
      "Type DEPLOY to create the dark production Worker with all required secrets: ",
    );
    if (confirmation !== "DEPLOY") {
      throw new SecretHelperError("Dark production deployment was not confirmed");
    }
    await deployWorkerWithSecrets(workerSecretsFromBundle(bundle));
    process.stdout.write("Wrangler reported a successful dark production deployment.\n");
    return;
  }

  throw new SecretHelperError("Unsafe or unknown output mode refused");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  installSignalCleanup();
  if (process.argv.length !== 3) {
    process.stderr.write("Relay secret helper failed closed; no secret material was printed.\n");
    process.exitCode = 1;
  } else {
    runCommand(process.argv[2]).catch(() => {
      if (clipboardContainsSensitiveMaterial) {
        try {
          clearClipboard();
        } catch {
          // Preserve the generic failure path.
        }
      }
      process.stderr.write("Relay secret helper failed closed; no secret material was printed.\n");
      process.exitCode = 1;
    });
  }
}
/* end[production_relay_secret_helper] */
