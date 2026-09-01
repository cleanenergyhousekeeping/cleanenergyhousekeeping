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

/* begin[production_relay_status_admin] */
function showProductionRelayStatusAdmin() {
  requireProductionRelayAdminSpreadsheet_();
  const verification = verifyProductionRelayPropertiesAdmin();
  const missingNonSecretPropertyNames = verification.missingPropertyNames.filter(
    function (name) {
      return RELAY_PRODUCTION_ADMIN_SECRET_NAMES_.indexOf(name) === -1;
    }
  );
  const missingSecretPropertyCount = verification.missingPropertyNames.length -
    missingNonSecretPropertyNames.length;
  const missingPropertyList = missingNonSecretPropertyNames.slice();
  if (missingSecretPropertyCount > 0) {
    missingPropertyList.push(
      "[secret property names withheld: " + missingSecretPropertyCount + "]"
    );
  }

  const nonSecretValues = verification.nonSecretValues;
  const message = [
    "CEH_RELAY_ENABLED: " + (nonSecretValues.CEH_RELAY_ENABLED || "(missing)"),
    "CEH_RELAY_ENVIRONMENT: " +
      (nonSecretValues.CEH_RELAY_ENVIRONMENT || "(missing)"),
    "CEH_RELAY_EXPECTED_SPREADSHEET_ID: " +
      (nonSecretValues.CEH_RELAY_EXPECTED_SPREADSHEET_ID || "(missing)"),
    "CEH_RELAY_LEDGER_SHEET_NAME: " +
      (nonSecretValues.CEH_RELAY_LEDGER_SHEET_NAME || "(missing)"),
    "",
    "Missing property count: " + verification.missingPropertyNames.length,
    "Missing property list: " +
      (missingPropertyList.length ? missingPropertyList.join(", ") : "None"),
    "Relay enabled status: " + verification.relayEnabledStatus,
    "Signing ring structurally valid: " +
      (verification.signingRingStructurallyValid ? "yes" : "no"),
    "Production key ID present: " +
      (verification.productionKeyIdPresent ? "yes" : "no"),
    "Signing key length valid: " +
      (verification.signingKeyLengthValid ? "yes" : "no"),
    "Subject key length valid: " +
      (verification.subjectKeyLengthValid ? "yes" : "no"),
  ].join("\n");

  const ui = SpreadsheetApp.getUi();
  ui.alert("Production relay status", message, ui.ButtonSet.OK);
}
/* end[production_relay_status_admin] */

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

/* begin[production_relay_activation_controls] */
function productionRelayVerificationAllowsEnable_(verification) {
  const expectedNonSecretValues = buildProductionRelayAdminProperties_();
  return !!verification &&
    verification.missingPropertyNames.length === 0 &&
    verification.relayEnabledStatus === "disabled" &&
    verification.signingRingStructurallyValid &&
    verification.productionKeyIdPresent &&
    verification.signingKeyLengthValid &&
    verification.subjectKeyLengthValid &&
    Object.keys(expectedNonSecretValues).every(function (name) {
      return verification.nonSecretValues[name] === expectedNonSecretValues[name];
    });
}

function enableProductionRelayAdmin() {
  requireProductionRelayAdminSpreadsheet_();
  const verification = verifyProductionRelayPropertiesAdmin();
  if (!productionRelayVerificationAllowsEnable_(verification)) {
    throw new Error("Production relay activation failed");
  }

  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "Enable production relay",
    "Enable production relay request handling for the Live spreadsheet? " +
      "This changes only CEH_RELAY_ENABLED. Worker delivery is controlled separately.",
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return false;

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(RELAY_CONFIG_KEYS_.enabled, "true");
  if (properties.getProperty(RELAY_CONFIG_KEYS_.enabled) !== "true") {
    throw new Error("Production relay activation failed");
  }
  return true;
}

function disableProductionRelayAdmin() {
  requireProductionRelayAdminSpreadsheet_();
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "Disable production relay",
    "Disable production relay request handling for the Live spreadsheet? " +
      "This changes only CEH_RELAY_ENABLED.",
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return false;

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(RELAY_CONFIG_KEYS_.enabled, "false");
  if (properties.getProperty(RELAY_CONFIG_KEYS_.enabled) !== "false") {
    throw new Error("Production relay deactivation failed");
  }
  return true;
}
/* end[production_relay_activation_controls] */
