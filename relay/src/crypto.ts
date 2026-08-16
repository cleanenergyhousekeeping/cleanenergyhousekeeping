import type { EncryptedValue, RelayEnvironment } from "./persistence/types";

/* begin[relay_crypto_utilities] */
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const RELAY_CONTEXT_PREFIX = "ceh-relay";

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError("Value must be unpadded base64url");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical values must contain only finite numbers");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`)
      .join(",")}}`;
  }

  throw new TypeError("Canonical values cannot contain this value type");
}

function requireContextComponent(value: string, label: string): string {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  return value;
}

function encodeAuthenticatedContext(authenticatedContext: string): Uint8Array {
  if (authenticatedContext.length === 0) {
    throw new TypeError("Authenticated encryption context must not be empty");
  }
  return textEncoder.encode(authenticatedContext);
}

function requireEnvironment(environment: RelayEnvironment): RelayEnvironment {
  if (environment !== "test" && environment !== "production") {
    throw new TypeError("Relay environment is invalid");
  }
  return environment;
}

export function eventEncryptionContext(
  environment: RelayEnvironment,
  eventId: string,
): string {
  const contextEventId = requireContextComponent(eventId, "Event ID");
  return `${RELAY_CONTEXT_PREFIX}:${requireEnvironment(environment)}:event:${contextEventId}`;
}

export function stateEncryptionContext(
  environment: RelayEnvironment,
  cleanerSubject: string,
): string {
  const contextCleanerSubject = requireContextComponent(
    cleanerSubject,
    "Cleaner subject",
  );
  return `${RELAY_CONTEXT_PREFIX}:${requireEnvironment(environment)}:state:${contextCleanerSubject}`;
}

export async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function importBase64UrlHmacKey(
  encodedKey: string,
): Promise<CryptoKey> {
  const rawKey = base64UrlToBytes(encodedKey);
  if (rawKey.byteLength !== 32) {
    throw new TypeError("HMAC keys must be 256 bits");
  }
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signBytes(
  value: Uint8Array,
  hmacKey: CryptoKey,
): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", hmacKey, value);
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function hashRelayToken(
  relayToken: string,
  hmacKey: CryptoKey,
  environment: RelayEnvironment,
): Promise<string> {
  return signBytes(
    textEncoder.encode(
      ["ceh-relay-token", "v1", requireEnvironment(environment), relayToken].join(
        "\n",
      ),
    ),
    hmacKey,
  );
}

export async function digestCanonicalEvent(
  event: Record<string, unknown>,
  hmacKey: CryptoKey,
  environment: RelayEnvironment,
): Promise<string> {
  return signBytes(
    textEncoder.encode(
      [
        "ceh-relay-event-digest",
        "v1",
        requireEnvironment(environment),
        canonicalize(event),
      ].join("\n"),
    ),
    hmacKey,
  );
}

export function stringsEqualConstantTime(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function importEncryptionKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (![16, 24, 32].includes(rawKey.byteLength)) {
    throw new TypeError("AES-GCM keys must be 128, 192, or 256 bits");
  }

  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptJson(
  value: unknown,
  key: CryptoKey,
  keyVersion: number,
  authenticatedContext: string,
): Promise<EncryptedValue> {
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new TypeError("Encryption key versions must be positive integers");
  }

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encodeAuthenticatedContext(authenticatedContext),
    },
    key,
    plaintext,
  );

  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
    keyVersion,
  };
}

export async function decryptJson<T>(
  encryptedValue: EncryptedValue,
  keysByVersion: ReadonlyMap<number, CryptoKey>,
  authenticatedContext: string,
): Promise<T> {
  const key = keysByVersion.get(encryptedValue.keyVersion);
  if (key === undefined) {
    throw new Error("Encryption key version is unavailable");
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(encryptedValue.nonce),
      additionalData: encodeAuthenticatedContext(authenticatedContext),
    },
    key,
    base64UrlToBytes(encryptedValue.ciphertext),
  );
  return JSON.parse(textDecoder.decode(plaintext)) as T;
}

export function generateSecureId(prefix: string, byteLength = 24): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(prefix)) {
    throw new TypeError("Secure identifier prefixes must be lowercase labels");
  }
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new TypeError("Secure identifiers require at least 128 random bits");
  }

  return `${prefix}_${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))}`;
}
/* end[relay_crypto_utilities] */
