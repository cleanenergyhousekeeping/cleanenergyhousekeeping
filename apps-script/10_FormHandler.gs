function handleFormSubmission(e) {
  const namedValues = e?.namedValues;
  if (!namedValues) {
    Logger.log("No namedValues provided. Probably ran from editor.");
    return;
  }

  const timestamp = new Date(namedValues[FORM_COL_TIMESTAMP]?.[0] || new Date());
  const name = (namedValues[FORM_COL_NAME]?.[0] || "Unknown").trim();
  const property = (namedValues[FORM_COL_PROPERTY]?.[0] || "Unknown").trim();
  const rawAction = (namedValues[FORM_COL_ACTION]?.[0] || "").toLowerCase();

  const clockInNote = (namedValues[FORM_COL_IN_NOTE]?.[0] || "").trim();
  const clockOutNote = (namedValues[FORM_COL_OUT_NOTE]?.[0] || "").trim();

  const dateStr = timestamp.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const timeStr = timestamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  let eventType = "unknown";
  if (rawAction.includes("clock in")) {
    eventType = "clock_in";
  } else if (rawAction.includes("clock out")) {
    eventType = "clock_out";
  }

  const subject =
    eventType === "clock_in"  ? `✅ Check-In from ${name}` :
    eventType === "clock_out" ? `🚪 Check-Out from ${name}` :
                                `⚠️ Unknown Submission from ${name}`;

  const emailBody =
    eventType === "clock_in"
      ? `⏱️ Check-In Alert\n\nName: ${name}\nProperty: ${property}\nDate: ${dateStr}\nTime: ${timeStr}\n\nClock-In Note: ${clockInNote || "[No clock-in note]"}`
      : eventType === "clock_out"
      ? `⏱️ Check-Out Alert\n\nName: ${name}\nProperty: ${property}\nDate: ${dateStr}\nTime: ${timeStr}\n\nClock-Out Note: ${clockOutNote || "[No clock-out note]"}`
      : `Submission from ${name} could not be classified.\n\nRaw data:\n${JSON.stringify(namedValues, null, 2)}`;

  if (eventType === "unknown") {
    MailApp.sendEmail({ to: NOTIFY_EMAIL, subject, body: emailBody });
    Logger.log("Email sent with subject: " + subject);
    return;
  }

  try {
   // ===== BEGIN submission guard block =====
// Block invalid clock-ins and invalid clock-outs before writing to Time Tracker.

if (eventType === "clock_in") {
  assertNoOpenShiftConflict_({ name, property });
}

if (eventType === "clock_out") {
  const openShift = findOpenShiftForCleaner_(name);

  if (!openShift) {
    throw new Error(
      `${name} has no open shift to clock out of. Clock-out was blocked.`
    );
  }

  if (safeStr_(openShift.property) !== property) {
    throw new Error(
      `${name} is currently clocked in at ${openShift.property}, not ${property}. ` +
      `They must clock out of the open property first.`
    );
  }
}

// ===== END submission guard block =====

    upsertTimeTrackerRow_({
      timestamp,
      name,
      property,
      eventType,
      clockInNote,
      clockOutNote,
    });

    MailApp.sendEmail({ to: NOTIFY_EMAIL, subject, body: emailBody });
    Logger.log("Email sent with subject: " + subject);
  } catch (error) {
    const errorSubject = `⛔ Blocked Time Entry for ${name}`;
    const errorBody =
      `A form submission was blocked by the open-shift guard.\n\n` +
      `Name: ${name}\n` +
      `Property: ${property}\n` +
      `Action: ${eventType}\n` +
      `Date: ${dateStr}\n` +
      `Time: ${timeStr}\n\n` +
      `Reason: ${error.message}\n\n` +
      `Clock-In Note: ${clockInNote || "[No clock-in note]"}\n` +
      `Clock-Out Note: ${clockOutNote || "[No clock-out note]"}`;

    MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: errorSubject, body: errorBody });
    Logger.log(errorBody);
    throw error;
  }
}