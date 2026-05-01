// begin[check_clock_outs_from_time_tracker]
function checkClockOutsAndSendReminder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TIME_SHEET_NAME);

  if (!sheet) {
    Logger.log(`Sheet not found: ${TIME_SHEET_NAME}`);
    return;
  }

  ensureHeaders_(sheet, TIME_TRACKER_COLUMNS);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log("No Time Tracker rows yet.");
    return;
  }

  const headers = data[0].map(String);
  const idx = indexMap_(headers, TIME_TRACKER_COLUMNS);
  const rows = data.slice(1);
  const timeZone = Session.getScriptTimeZone();

  const openShifts = rows
    .map(function (row, index) {
      const name = safeStr_(row[idx["Name"]]);
      const property = safeStr_(row[idx["Property"]]);
      const dateValue = coerceToDate_(row[idx["Date"]]);
      const clockInValue = coerceToDate_(row[idx["Clock In"]]);
      const clockOutValue = row[idx["Clock Out"]];

      if (!name || !property || !clockInValue) return null;
      if (clockOutValue) return null;

      return {
        rowNumber: index + 2,
        name: name,
        property: property,
        date: dateValue,
        clockIn: clockInValue,
      };
    })
    .filter(function (entry) {
      return !!entry;
    });

  if (openShifts.length === 0) {
    Logger.log("All Time Tracker shifts are paired. No action needed.");
    return;
  }

  const emailBody = openShifts
    .map(function (entry) {
      const dateText = entry.date
        ? Utilities.formatDate(entry.date, timeZone, "MMM d, yyyy")
        : "[No date]";
      const timeText = Utilities.formatDate(entry.clockIn, timeZone, "h:mm a");

      return `• ${entry.name} at ${entry.property} (Date: ${dateText}, checked in at ${timeText})`;
    })
    .join("\n");

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: "⚠️ Unpaired Check-Ins Alert",
    body: `The following open shifts still do not have a clock-out:\n\n${emailBody}`,
  });

  Logger.log(`Unpaired check-in reminder sent for ${openShifts.length} open shift(s).`);
}
// end[check_clock_outs_from_time_tracker]