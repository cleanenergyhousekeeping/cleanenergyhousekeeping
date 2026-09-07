/* begin[test_relay_hmac_property_installer] */
const RELAY_TEST_HMAC_INSTALLER_ERROR_ =
  "TEST relay signing-ring installation failed";
const RELAY_TEST_HMAC_INSTALLER_FILE_ = "TestRelayHmacInstallerAdmin";

function requireTestRelayHmacInstallerContext_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const values = PropertiesService.getScriptProperties().getProperties();
  const environment = safeStr_(values[RELAY_CONFIG_KEYS_.environment]);
  const expectedSpreadsheetId = safeStr_(
    values[RELAY_CONFIG_KEYS_.expectedSpreadsheetId]
  );
  const spreadsheetId = spreadsheet ? spreadsheet.getId() : "";
  const acceptedKeyIds = parseRelayKeyIds_(
    values[RELAY_CONFIG_KEYS_.acceptedKeyIds]
  );

  if (
    environment !== "test" ||
    !spreadsheet ||
    spreadsheetId === RELAY_PRODUCTION_CONFIG_.expectedSpreadsheetId ||
    !expectedSpreadsheetId ||
    spreadsheetId !== expectedSpreadsheetId ||
    !acceptedKeyIds
  ) {
    throw new Error(RELAY_TEST_HMAC_INSTALLER_ERROR_);
  }

  return { acceptedKeyIds: acceptedKeyIds };
}

function isTestRelayHmacInstallerMenuAvailable_() {
  try {
    requireTestRelayHmacInstallerContext_();
    return true;
  } catch (_) {
    return false;
  }
}

function isValidTestRelayHmacRing_(hmacKeysJson, acceptedKeyIds) {
  let parsed;
  try {
    parsed = JSON.parse(hmacKeysJson);
  } catch (_) {
    return false;
  }

  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    !Object.keys(parsed).length ||
    !Object.keys(parsed).every(function (keyId) {
      return /^[A-Za-z0-9._-]{1,64}$/.test(keyId) &&
        typeof parsed[keyId] === "string";
    })
  ) {
    return false;
  }

  const suppliedKeyIds = Object.keys(parsed);
  const acceptedKeysPresent = acceptedKeyIds.every(function (keyId) {
    return Object.prototype.hasOwnProperty.call(parsed, keyId);
  });
  return acceptedKeysPresent && !!parseRelayHmacKeys_(
    hmacKeysJson,
    suppliedKeyIds
  );
}

function showTestRelayHmacInstallerAdminDialog() {
  requireTestRelayHmacInstallerContext_();
  const output = HtmlService
    .createHtmlOutputFromFile(RELAY_TEST_HMAC_INSTALLER_FILE_)
    .setWidth(560)
    .setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(
    output,
    "Install TEST relay signing ring"
  );
}

function installTestRelayHmacKeysAdmin(hmacKeysJson) {
  try {
    const context = requireTestRelayHmacInstallerContext_();
    if (!isValidTestRelayHmacRing_(hmacKeysJson, context.acceptedKeyIds)) {
      return { ok: false, result: "installation_failed" };
    }

    PropertiesService.getScriptProperties().setProperty(
      RELAY_CONFIG_KEYS_.hmacKeysJson,
      hmacKeysJson
    );
    return {
      ok: true,
      result: "installed",
      property: RELAY_CONFIG_KEYS_.hmacKeysJson,
    };
  } catch (_) {
    return { ok: false, result: "installation_failed" };
  }
}
/* end[test_relay_hmac_property_installer] */
