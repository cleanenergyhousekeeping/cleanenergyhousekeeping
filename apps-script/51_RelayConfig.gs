/* begin[relay_environment_config] */
const RELAY_CONFIG_KEYS_ = {
  enabled: "CEH_RELAY_ENABLED",
  environment: "CEH_RELAY_ENVIRONMENT",
  expectedSpreadsheetId: "CEH_RELAY_EXPECTED_SPREADSHEET_ID",
  ledgerSheetName: "CEH_RELAY_LEDGER_SHEET_NAME",
  acceptedKeyIds: "CEH_RELAY_ACCEPTED_KEY_IDS",
  hmacKeysJson: "CEH_RELAY_HMAC_KEYS_JSON",
  subjectHmacKey: "CEH_RELAY_SUBJECT_HMAC_KEY",
  maxClockSkewSeconds: "CEH_RELAY_MAX_CLOCK_SKEW_SECONDS",
  nonceTtlSeconds: "CEH_RELAY_NONCE_TTL_SECONDS",
  lockTimeoutMs: "CEH_RELAY_LOCK_TIMEOUT_MS",
  maxNonceCount: "CEH_RELAY_MAX_NONCE_COUNT",
};

const RELAY_SUPPORTED_ENVIRONMENTS_ = ["test", "production"];
const RELAY_NONCE_HARD_MAX_ = 500;
const RELAY_PRODUCTION_CONFIG_ = {
  expectedSpreadsheetId: "1b1IVRl3GIxFWJM0x7J5RTGmHTl_yrzHqis0O7hdM-wc",
  ledgerSheetName: "Relay Event Ledger",
};

function parseRelayPositiveInteger_(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
}

function parseRelayKeyIds_(value) {
  const rawIds = safeStr_(value).split(",");
  const keyIds = rawIds.map(function (keyId) {
    return safeStr_(keyId);
  }).filter(function (keyId) {
    return !!keyId;
  });

  if (!keyIds.length || new Set(keyIds).size !== keyIds.length) {
    return null;
  }

  const allValid = keyIds.every(function (keyId) {
    return /^[A-Za-z0-9._-]{1,64}$/.test(keyId);
  });
  return allValid ? keyIds : null;
}

function parseRelayHmacKeys_(rawJson, acceptedKeyIds) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (_) {
    return null;
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return null;
  }

  const keys = {};
  for (const keyId of acceptedKeyIds) {
    const encodedKey = safeStr_(parsed[keyId]);
    const keyBytes = decodeRelayBase64Url_(encodedKey);
    if (!keyBytes || keyBytes.length !== 32) {
      return null;
    }
    keys[keyId] = keyBytes;
  }
  return keys;
}

function relayConfigInvalidStatus_(environment) {
  return environment === "production" ? "production_invalid" : "invalid";
}

function loadRelayConfigResult_() {
  try {
    const properties = PropertiesService.getScriptProperties();
    const values = properties.getProperties();
    if (values[RELAY_CONFIG_KEYS_.enabled] !== "true") {
      return { config: null, status: "disabled" };
    }

    const environment = safeStr_(values[RELAY_CONFIG_KEYS_.environment]);
    if (RELAY_SUPPORTED_ENVIRONMENTS_.indexOf(environment) === -1) {
      return { config: null, status: relayConfigInvalidStatus_(environment) };
    }

    const expectedSpreadsheetId = safeStr_(
      values[RELAY_CONFIG_KEYS_.expectedSpreadsheetId]
    );
    const ledgerSheetName = safeStr_(values[RELAY_CONFIG_KEYS_.ledgerSheetName]);
    const acceptedKeyIds = parseRelayKeyIds_(
      values[RELAY_CONFIG_KEYS_.acceptedKeyIds]
    );
    if (!expectedSpreadsheetId || !ledgerSheetName || !acceptedKeyIds) {
      return { config: null, status: relayConfigInvalidStatus_(environment) };
    }

    if (
      environment === "production" &&
      (
        expectedSpreadsheetId !== RELAY_PRODUCTION_CONFIG_.expectedSpreadsheetId ||
        ledgerSheetName !== RELAY_PRODUCTION_CONFIG_.ledgerSheetName
      )
    ) {
      return { config: null, status: relayConfigInvalidStatus_(environment) };
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet || spreadsheet.getId() !== expectedSpreadsheetId) {
      return { config: null, status: relayConfigInvalidStatus_(environment) };
    }

    const hmacKeys = parseRelayHmacKeys_(
      values[RELAY_CONFIG_KEYS_.hmacKeysJson],
      acceptedKeyIds
    );
    const subjectHmacKey = decodeRelayBase64Url_(
      safeStr_(values[RELAY_CONFIG_KEYS_.subjectHmacKey])
    );
    if (!hmacKeys || !subjectHmacKey || subjectHmacKey.length !== 32) {
      return { config: null, status: relayConfigInvalidStatus_(environment) };
    }

    const maxClockSkewSeconds = parseRelayPositiveInteger_(
      values[RELAY_CONFIG_KEYS_.maxClockSkewSeconds],
      30,
      900
    );
    const nonceTtlSeconds = parseRelayPositiveInteger_(
      values[RELAY_CONFIG_KEYS_.nonceTtlSeconds],
      60,
      3600
    );
    const lockTimeoutMs = parseRelayPositiveInteger_(
      values[RELAY_CONFIG_KEYS_.lockTimeoutMs],
      100,
      30000
    );
    const maxNonceCount = parseRelayPositiveInteger_(
      values[RELAY_CONFIG_KEYS_.maxNonceCount],
      1,
      RELAY_NONCE_HARD_MAX_
    );

    if (
      !maxClockSkewSeconds ||
      !nonceTtlSeconds ||
      !lockTimeoutMs ||
      !maxNonceCount ||
      nonceTtlSeconds < maxClockSkewSeconds * 2
    ) {
      return { config: null, status: relayConfigInvalidStatus_(environment) };
    }

    return { config: {
      environment: environment,
      audience: "ceh-relay:" + environment + ":apps-script",
      spreadsheet: spreadsheet,
      ledgerSheetName: ledgerSheetName,
      acceptedKeyIds: acceptedKeyIds,
      hmacKeys: hmacKeys,
      subjectHmacKey: subjectHmacKey,
      maxClockSkewMs: maxClockSkewSeconds * 1000,
      nonceTtlMs: nonceTtlSeconds * 1000,
      lockTimeoutMs: lockTimeoutMs,
      maxNonceCount: maxNonceCount,
    }, status: "ready" };
  } catch (_) {
    return { config: null, status: "invalid" };
  }
}

function loadRelayConfig_() {
  return loadRelayConfigResult_().config;
}
/* end[relay_environment_config] */
