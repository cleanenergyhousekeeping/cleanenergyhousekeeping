/* begin[relay_request_security] */
const RELAY_SIGNED_BODY_MAX_BYTES_ = 32768;
const RELAY_NONCE_PROPERTY_PREFIX_ = "ceh_relay_nonce_v1_";
const RELAY_USER_ID_HEADER_ = "User ID";

function normalizeRelayBytes_(bytes) {
  return Array.from(bytes || [], function (value) {
    return value < 0 ? value + 256 : value;
  });
}

function decodeRelayBase64Url_(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    return normalizeRelayBytes_(Utilities.base64DecodeWebSafe(value));
  } catch (_) {
    return null;
  }
}

function encodeRelayBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(normalizeRelayBytes_(bytes)).replace(/=+$/, "");
}

function relayUtf8Bytes_(value) {
  return normalizeRelayBytes_(Utilities.newBlob(String(value)).getBytes());
}

function relayBytesEqualConstantTime_(left, right) {
  const leftBytes = normalizeRelayBytes_(left);
  const rightBytes = normalizeRelayBytes_(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const comparisonLength = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < comparisonLength; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function relaySecurityFailure_(result, retryable) {
  return {
    ok: false,
    result: result,
    retryable: !!retryable,
  };
}

function verifyRelaySignedEnvelope_(outerBody, config, nowMs) {
  if (!outerBody || Array.isArray(outerBody) || typeof outerBody !== "object") {
    return relaySecurityFailure_("authentication_failed", false);
  }

  const keyId = safeStr_(outerBody.keyId);
  if (config.acceptedKeyIds.indexOf(keyId) === -1 || !config.hmacKeys[keyId]) {
    return relaySecurityFailure_("authentication_failed", false);
  }

  const signedBytes = decodeRelayBase64Url_(safeStr_(outerBody.signedBody));
  const suppliedSignature = decodeRelayBase64Url_(safeStr_(outerBody.signature));
  if (
    !signedBytes ||
    !signedBytes.length ||
    signedBytes.length > RELAY_SIGNED_BODY_MAX_BYTES_ ||
    !suppliedSignature ||
    suppliedSignature.length !== 32
  ) {
    return relaySecurityFailure_("authentication_failed", false);
  }

  const expectedSignature = normalizeRelayBytes_(Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    signedBytes,
    config.hmacKeys[keyId]
  ));
  if (!relayBytesEqualConstantTime_(suppliedSignature, expectedSignature)) {
    return relaySecurityFailure_("authentication_failed", false);
  }

  let request;
  try {
    const signedJson = Utilities.newBlob(signedBytes).getDataAsString("UTF-8");
    request = JSON.parse(signedJson);
  } catch (_) {
    return relaySecurityFailure_("invalid_event", false);
  }

  if (!request || Array.isArray(request) || typeof request !== "object") {
    return relaySecurityFailure_("invalid_event", false);
  }
  if (
    request.version !== 1 ||
    safeStr_(request.keyId) !== keyId ||
    safeStr_(request.environment) !== config.environment ||
    safeStr_(request.audience) !== config.audience
  ) {
    return relaySecurityFailure_("authentication_failed", false);
  }

  const timestampMs = Number(request.timestampMs);
  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(nowMs - timestampMs) > config.maxClockSkewMs
  ) {
    return relaySecurityFailure_("stale_request", true);
  }

  const nonce = safeStr_(request.nonce);
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(nonce)) {
    return relaySecurityFailure_("invalid_event", false);
  }

  return {
    ok: true,
    keyId: keyId,
    nonce: nonce,
    request: request,
  };
}

function buildRelayNoncePropertyKey_(environment, keyId, nonce) {
  const separatedValue = [
    "ceh-relay-nonce",
    "v1",
    environment,
    keyId,
    nonce,
  ].join("\n");
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    separatedValue,
    Utilities.Charset.UTF_8
  );
  return RELAY_NONCE_PROPERTY_PREFIX_ + environment + "_" + keyId + "_" +
    encodeRelayBase64Url_(digest);
}

function reserveRelayNonce_(config, keyId, nonce, nowMs) {
  const properties = PropertiesService.getScriptProperties();
  const nonceKey = buildRelayNoncePropertyKey_(config.environment, keyId, nonce);
  const expiresAtMs = nowMs + config.nonceTtlMs;

  try {
    const allProperties = properties.getProperties();
    Object.keys(allProperties).forEach(function (propertyKey) {
      if (propertyKey.indexOf(RELAY_NONCE_PROPERTY_PREFIX_) !== 0) {
        return;
      }
      const storedExpiry = Number(allProperties[propertyKey]);
      if (!Number.isFinite(storedExpiry) || storedExpiry <= nowMs) {
        properties.deleteProperty(propertyKey);
      }
    });

    const retained = properties.getProperties();
    if (retained[nonceKey] && Number(retained[nonceKey]) > nowMs) {
      return relaySecurityFailure_("replay_detected", true);
    }

    const retainedNonceCount = Object.keys(retained).filter(function (propertyKey) {
      return propertyKey.indexOf(RELAY_NONCE_PROPERTY_PREFIX_) === 0;
    }).length;
    const safeMaximum = Math.min(config.maxNonceCount, RELAY_NONCE_HARD_MAX_);
    if (retainedNonceCount >= safeMaximum) {
      return relaySecurityFailure_("internal_error", true);
    }

    properties.setProperty(nonceKey, String(expiresAtMs));
    if (properties.getProperty(nonceKey) !== String(expiresAtMs)) {
      properties.deleteProperty(nonceKey);
      return relaySecurityFailure_("internal_error", true);
    }
    return { ok: true };
  } catch (_) {
    return relaySecurityFailure_("internal_error", true);
  }
}

function normalizeRelayUserId_(value) {
  const normalized = safeStr_(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    normalized
  ) ? normalized : "";
}

function buildRelayCleanerSubject_(config, userId) {
  const context = [
    "ceh-relay-cleaner-subject",
    "v1",
    config.environment,
    userId,
  ].join("\n");
  const signature = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    relayUtf8Bytes_(context),
    config.subjectHmacKey
  );
  return "cehusr_v1_" + encodeRelayBase64Url_(signature);
}

function getRelayUserRecords_(config) {
  const usersSheet = config.spreadsheet.getSheetByName(USERS_SHEET_NAME);
  if (!usersSheet) {
    return null;
  }

  const values = usersSheet.getDataRange().getValues();
  if (!values.length) {
    return null;
  }

  const headers = values[0].map(function (header) {
    return safeStr_(header);
  });
  const requiredHeaders = ["PIN", "Name", "Is Active", RELAY_USER_ID_HEADER_];
  const indexes = {};
  for (const header of requiredHeaders) {
    const matches = headers.reduce(function (found, candidate, index) {
      if (candidate === header) found.push(index);
      return found;
    }, []);
    if (matches.length !== 1) {
      return null;
    }
    indexes[header] = matches[0];
  }

  const seenUserIds = new Set();
  const records = [];
  for (const row of values.slice(1)) {
    const hasData = row.some(function (value) {
      return safeStr_(value) !== "";
    });
    if (!hasData) continue;

    const userId = normalizeRelayUserId_(row[indexes[RELAY_USER_ID_HEADER_]]);
    const pin = normalizeAccessCode_(row[indexes.PIN]);
    const name = safeStr_(row[indexes.Name]);
    if (!userId || seenUserIds.has(userId) || !pin || !name) {
      return null;
    }
    seenUserIds.add(userId);
    records.push({
      pin: pin,
      name: name,
      active: normalizeActiveFlag_(row[indexes["Is Active"]]),
      subject: buildRelayCleanerSubject_(config, userId),
    });
  }
  return records.length ? records : null;
}
/* end[relay_request_security] */
