import {
  base64UrlToBytes,
  importBase64UrlHmacKey,
  importEncryptionKey,
} from "./crypto";
import type { RelayEnvironment } from "./persistence/types";

/* begin[relay_runtime_config] */
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;

export interface RelayConfig {
  environment: RelayEnvironment;
  appsAudience: string;
  appsUrl: string;
  appsActiveKeyId: string;
  appsHmacKeys: ReadonlyMap<string, CryptoKey>;
  relayTokenHmacKey: CryptoKey;
  eventDigestHmacKey: CryptoKey;
  payloadEncryptionKeys: ReadonlyMap<number, CryptoKey>;
  payloadActiveKeyVersion: number;
}

export class RelayConfigurationError extends Error {
  constructor() {
    super("Relay configuration is unavailable");
    this.name = "RelayConfigurationError";
  }
}

function requireEnvironment(value: string): RelayEnvironment {
  if (value !== "test" && value !== "production") {
    throw new RelayConfigurationError();
  }
  return value;
}

function parseKeyRing(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new RelayConfigurationError();
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (
    entries.length === 0 ||
    entries.some(
      ([keyId, encodedKey]) =>
        !KEY_ID_PATTERN.test(keyId) || typeof encodedKey !== "string",
    )
  ) {
    throw new RelayConfigurationError();
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

async function importAppsKeyRing(
  encodedRing: string,
): Promise<ReadonlyMap<string, CryptoKey>> {
  const entries = Object.entries(parseKeyRing(encodedRing));
  return new Map(
    await Promise.all(
      entries.map(async ([keyId, encodedKey]) => [
        keyId,
        await importBase64UrlHmacKey(encodedKey),
      ] as const),
    ),
  );
}

async function importEncryptionKeyRing(
  encodedRing: string,
): Promise<ReadonlyMap<number, CryptoKey>> {
  const entries = Object.entries(parseKeyRing(encodedRing));
  return new Map(
    await Promise.all(
      entries.map(async ([versionText, encodedKey]) => {
        const version = Number(versionText);
        if (!Number.isSafeInteger(version) || version < 1) {
          throw new RelayConfigurationError();
        }
        return [version, await importEncryptionKey(base64UrlToBytes(encodedKey))] as const;
      }),
    ),
  );
}

export async function loadRelayConfig(env: Env): Promise<RelayConfig> {
  try {
    const environment = requireEnvironment(env.CEH_RELAY_ENVIRONMENT);
    const appsUrl = new URL(env.CEH_RELAY_APPS_URL);
    if (appsUrl.protocol !== "https:") {
      throw new RelayConfigurationError();
    }

    const appsActiveKeyId = env.CEH_RELAY_APPS_ACTIVE_KEY_ID;
    if (!KEY_ID_PATTERN.test(appsActiveKeyId)) {
      throw new RelayConfigurationError();
    }
    const payloadActiveKeyVersion = Number(
      env.CEH_RELAY_PAYLOAD_ACTIVE_KEY_VERSION,
    );
    if (!Number.isSafeInteger(payloadActiveKeyVersion) || payloadActiveKeyVersion < 1) {
      throw new RelayConfigurationError();
    }

    const [
      appsHmacKeys,
      relayTokenHmacKey,
      eventDigestHmacKey,
      payloadEncryptionKeys,
    ] = await Promise.all([
      importAppsKeyRing(env.CEH_RELAY_APPS_HMAC_KEYS_JSON),
      importBase64UrlHmacKey(env.CEH_RELAY_TOKEN_HMAC_KEY),
      importBase64UrlHmacKey(env.CEH_RELAY_EVENT_DIGEST_HMAC_KEY),
      importEncryptionKeyRing(env.CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON),
    ]);

    if (
      !appsHmacKeys.has(appsActiveKeyId) ||
      !payloadEncryptionKeys.has(payloadActiveKeyVersion)
    ) {
      throw new RelayConfigurationError();
    }

    return {
      environment,
      appsAudience: `ceh-relay:${environment}:apps-script`,
      appsUrl: appsUrl.toString(),
      appsActiveKeyId,
      appsHmacKeys,
      relayTokenHmacKey,
      eventDigestHmacKey,
      payloadEncryptionKeys,
      payloadActiveKeyVersion,
    };
  } catch (_) {
    throw new RelayConfigurationError();
  }
}
/* end[relay_runtime_config] */
