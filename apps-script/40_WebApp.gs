/**
 * Serves the cleaner web app.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.mode === "getOfflineShellPrep") {
  const result = getOfflineShellPrepByToken(e.parameter.token || "");
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

if (e && e.parameter && e.parameter.mode === "getOfflineShellPrepByCode") {
  const result = getOfflineShellPrepByCode(e.parameter.code || "");
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

  const template = HtmlService.createTemplateFromFile("WebApp");
  template.prepareShellMode =
    !!(e && e.parameter && e.parameter.view === "prepareShell");

  return template
    .evaluate()
    .setTitle("Clean Energy Time Tracker")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}
/* begin[webapp_post_routes] */
function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || "{}";
    const body = JSON.parse(raw);

    if (body && body.mode === "submitShellQueueEntry") {
      const result = submitWebAppTimeEntry(body.payload || {});
      if (!result || !result.ok) {
        logClockInDebug_({
          event: "shell_queue_submit_failure",
          cleanerName: safeStr_((body.payload || {}).cleanerName) || safeStr_(result && result.cleanerName),
          eventType: safeStr_((body.payload || {}).eventType),
          property: safeStr_((body.payload || {}).property),
          syncSource: "shell_offline",
          mode: "submitShellQueueEntry",
          status: "non_ok",
          message: safeStr_(result && result.message),
        });
      }
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body && body.mode === "refreshShellAuth") {
      const payload = body.payload || {};
      const result = refreshShellAuth(
        payload.sessionToken || "",
        payload.clientId || ""
      );
      if (!result || !result.ok) {
        logClockInDebug_({
          event: "auth_refresh_failure",
          cleanerName: safeStr_(result && result.cleanerName),
          mode: "refreshShellAuth",
          status: "non_ok",
          message: safeStr_(result && result.message),
        });
      }
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body && body.mode === "loginWithPin") {
      const payload = body.payload || {};
      const result = loginWithPin(
        payload.accessCode || "",
        payload.clientId || ""
      );
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body && body.mode === "getShellWorkHistory") {
      const payload = body.payload || {};
      const result = getShellWeeklyPropertySummary(
        payload.sessionToken || ""
      );
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    logClockInDebug_({
      event: "unsupported_post_mode",
      cleanerName: "",
      mode: safeStr_(body && body.mode),
      status: "rejected",
      message: "Unsupported POST mode.",
    });

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        message: "Unsupported POST mode.",
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        message: error && error.message ? error.message : "POST failed.",
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
/* end[webapp_post_routes] */
/**
 * Allows HTML partial includes.
 */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}