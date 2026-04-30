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
      Logger.log("[shell_queue_submit_attempt] " + JSON.stringify({
        mode: body.mode,
        eventType: safeStr_(body && body.payload && body.payload.eventType),
        property: safeStr_(body && body.payload && body.payload.property),
        submittedAtMs: Number((body && body.payload && body.payload.submittedAtMs) || 0),
      }));
      logClockInDebugEvent_({
        area: "webapp_post",
        mode: body.mode,
        eventType: safeStr_(body && body.payload && body.payload.eventType),
        cleanerName: safeStr_(body && body.payload && body.payload.cleanerName),
        property: safeStr_(body && body.payload && body.payload.property),
        syncSource: safeStr_(body && body.payload && body.payload.syncSource),
        clientId: safeStr_(body && body.payload && body.payload.clientId),
        queuedId: safeStr_(body && body.payload && body.payload.queuedId),
        reason: "submit_attempt",
      });
      const result = submitWebAppTimeEntry(body.payload || {});
      if (!result || !result.ok) {
        Logger.log("[shell_queue_submit_failure] " + JSON.stringify({
          mode: body.mode,
          eventType: safeStr_(body && body.payload && body.payload.eventType),
          property: safeStr_(body && body.payload && body.payload.property),
          message: safeStr_(result && result.message),
        }));
        logClockInDebugEvent_({
          area: "webapp_post",
          mode: body.mode,
          eventType: safeStr_(body && body.payload && body.payload.eventType),
          cleanerName: safeStr_(body && body.payload && body.payload.cleanerName),
          property: safeStr_(body && body.payload && body.payload.property),
          syncSource: safeStr_(body && body.payload && body.payload.syncSource),
          clientId: safeStr_(body && body.payload && body.payload.clientId),
          queuedId: safeStr_(body && body.payload && body.payload.queuedId),
          reason: "submit_non_ok",
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
        Logger.log("[auth_refresh_failure] " + JSON.stringify({
          mode: body.mode,
          message: safeStr_(result && result.message),
        }));
      }
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body && body.mode === "createOfflineShellPrepToken") {
      const payload = body.payload || {};
      const result = createOfflineShellPrepToken(
        payload,
        body.sessionToken || payload.sessionToken || ""
      );
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

    Logger.log("[unsupported_post_mode] " + JSON.stringify({
      mode: safeStr_(body && body.mode),
      keys: body ? Object.keys(body) : [],
    }));
    logClockInDebugEvent_({
      area: "webapp_post",
      mode: safeStr_(body && body.mode),
      eventType: safeStr_(body && body.payload && body.payload.eventType),
      cleanerName: safeStr_(body && body.payload && body.payload.cleanerName),
      property: safeStr_(body && body.payload && body.payload.property),
      syncSource: safeStr_(body && body.payload && body.payload.syncSource),
      clientId: safeStr_(body && body.payload && body.payload.clientId),
      queuedId: safeStr_(body && body.payload && body.payload.queuedId),
      reason: "unsupported_post_mode",
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
