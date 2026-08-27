/* begin[production_relay_property_installer] */
const RELAY_PRODUCTION_ADMIN_KEY_ID_ = "production-v1";
const RELAY_PRODUCTION_ADMIN_SECRET_NAMES_ = [
  "CEH_RELAY_HMAC_KEYS_JSON",
  "CEH_RELAY_SUBJECT_HMAC_KEY",
];

function buildProductionRelayAdminProperties_() {
  return {
    [RELAY_CONFIG_KEYS_.enabled]: "false",
    [RELAY_CONFIG_KEYS_.environment]: "production",
    [RELAY_CONFIG_KEYS_.expectedSpreadsheetId]:
      RELAY_PRODUCTION_CONFIG_.expectedSpreadsheetId,
    [RELAY_CONFIG_KEYS_.ledgerSheetName]: RELAY_PRODUCTION_CONFIG_.ledgerSheetName,
    [RELAY_CONFIG_KEYS_.acceptedKeyIds]: RELAY_PRODUCTION_ADMIN_KEY_ID_,
    [RELAY_CONFIG_KEYS_.maxClockSkewSeconds]: "300",
    [RELAY_CONFIG_KEYS_.nonceTtlSeconds]: "600",
    [RELAY_CONFIG_KEYS_.lockTimeoutMs]: "5000",
    [RELAY_CONFIG_KEYS_.maxNonceCount]: "100",
  };
}

function isCanonicalRelayAdminKey_(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return false;
  }
  const decoded = decodeRelayBase64Url_(value);
  return !!decoded && decoded.length === 32 && encodeRelayBase64Url_(decoded) === value;
}

function inspectProductionRelayAdminSecrets_(hmacKeysJson, subjectHmacKey) {
  let signingRing = null;
  try {
    signingRing = JSON.parse(hmacKeysJson);
  } catch (_) {
    signingRing = null;
  }

  const signingRingStructurallyValid = !!signingRing &&
    !Array.isArray(signingRing) &&
    typeof signingRing === "object" &&
    Object.keys(signingRing).length > 0 &&
    Object.keys(signingRing).every(function (keyId) {
      return /^[A-Za-z0-9._-]{1,64}$/.test(keyId) &&
        typeof signingRing[keyId] === "string";
    });
  const productionKeyIdPresent = signingRingStructurallyValid &&
    Object.prototype.hasOwnProperty.call(signingRing, RELAY_PRODUCTION_ADMIN_KEY_ID_);
  const parsedSigningKeys = productionKeyIdPresent
    ? parseRelayHmacKeys_(hmacKeysJson, [RELAY_PRODUCTION_ADMIN_KEY_ID_])
    : null;
  const signingKeyLengthValid = !!parsedSigningKeys &&
    parsedSigningKeys[RELAY_PRODUCTION_ADMIN_KEY_ID_].length === 32 &&
    isCanonicalRelayAdminKey_(signingRing[RELAY_PRODUCTION_ADMIN_KEY_ID_]);

  return {
    signingRingStructurallyValid: signingRingStructurallyValid,
    productionKeyIdPresent: productionKeyIdPresent,
    signingKeyLengthValid: signingKeyLengthValid,
    subjectKeyLengthValid: isCanonicalRelayAdminKey_(subjectHmacKey),
  };
}

function requireProductionRelayAdminSpreadsheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (
    !spreadsheet ||
    spreadsheet.getId() !== RELAY_PRODUCTION_CONFIG_.expectedSpreadsheetId
  ) {
    throw new Error("Production relay property installation failed");
  }
  return spreadsheet;
}

function showProductionRelayPropertiesAdminDialog() {
  requireProductionRelayAdminSpreadsheet_();
  const output = HtmlService
    .createHtmlOutputFromFile("RelayPropertyInstallerAdmin")
    .setWidth(560)
    .setHeight(610);
  SpreadsheetApp.getUi().showModalDialog(
    output,
    "Install production relay properties"
  );
}

function verifyProductionRelayPropertiesAdmin() {
  const values = PropertiesService.getScriptProperties().getProperties();
  const expectedNonSecretValues = buildProductionRelayAdminProperties_();
  const expectedPropertyNames = Object.keys(expectedNonSecretValues)
    .concat(RELAY_PRODUCTION_ADMIN_SECRET_NAMES_);
  const presentPropertyNames = expectedPropertyNames.filter(function (name) {
    return Object.prototype.hasOwnProperty.call(values, name) && values[name] !== "";
  });
  const secretStatus = inspectProductionRelayAdminSecrets_(
    values.CEH_RELAY_HMAC_KEYS_JSON,
    values.CEH_RELAY_SUBJECT_HMAC_KEY
  );

  return {
    expectedPropertyNames: expectedPropertyNames,
    presentPropertyNames: presentPropertyNames,
    missingPropertyNames: expectedPropertyNames.filter(function (name) {
      return presentPropertyNames.indexOf(name) === -1;
    }),
    nonSecretValues: Object.keys(expectedNonSecretValues).reduce(
      function (result, name) {
        result[name] = Object.prototype.hasOwnProperty.call(values, name)
          ? values[name]
          : "";
        return result;
      },
      {}
    ),
    relayEnabledStatus: values.CEH_RELAY_ENABLED === "false" ? "disabled" : "not_disabled",
    signingRingStructurallyValid: secretStatus.signingRingStructurallyValid,
    productionKeyIdPresent: secretStatus.productionKeyIdPresent,
    signingKeyLengthValid: secretStatus.signingKeyLengthValid,
    subjectKeyLengthValid: secretStatus.subjectKeyLengthValid,
  };
}

function installProductionRelayPropertiesAdmin(hmacKeysJson, subjectHmacKey) {
  requireProductionRelayAdminSpreadsheet_();
  const secretStatus = inspectProductionRelayAdminSecrets_(
    hmacKeysJson,
    subjectHmacKey
  );
  if (
    !secretStatus.signingRingStructurallyValid ||
    !secretStatus.productionKeyIdPresent ||
    !secretStatus.signingKeyLengthValid ||
    !secretStatus.subjectKeyLengthValid
  ) {
    throw new Error("Production relay property installation failed");
  }

  const expectedNonSecretValues = buildProductionRelayAdminProperties_();
  const properties = Object.assign({}, expectedNonSecretValues, {
    CEH_RELAY_HMAC_KEYS_JSON: hmacKeysJson,
    CEH_RELAY_SUBJECT_HMAC_KEY: subjectHmacKey,
  });
  PropertiesService.getScriptProperties().setProperties(properties, false);

  const verification = verifyProductionRelayPropertiesAdmin();
  const nonSecretValuesMatch = Object.keys(expectedNonSecretValues).every(
    function (name) {
      return verification.nonSecretValues[name] ===
        expectedNonSecretValues[name];
    }
  );
  if (
    verification.missingPropertyNames.length > 0 ||
    !nonSecretValuesMatch ||
    verification.relayEnabledStatus !== "disabled" ||
    !verification.signingRingStructurallyValid ||
    !verification.productionKeyIdPresent ||
    !verification.signingKeyLengthValid ||
    !verification.subjectKeyLengthValid
  ) {
    throw new Error("Production relay property installation failed");
  }
  return verification;
}
/* end[production_relay_property_installer] */
