/* begin[property_notes_tools_constants] */
const PROPERTY_NOTES_CONTROL_SHEET_NAME = "Property Notes Control";
const PROPERTY_NOTES_SHEET_NAME = "Properties";
const PROPERTY_NOTES_HEADER_NAME = "House Notes";
const PROPERTY_NOTES_PROPERTY_HEADER_NAME = "Property Name";

const UNIVERSAL_NOTE_HEADER = "UNIVERSAL NOTE:";
/* end[property_notes_tools_constants] */


/* begin[property_notes_tools_public_wrappers] */
function ensurePropertyNotesControlSheet() {
  ensurePropertyNotesControlSheet_();
}

function syncUniversalPropertyNoteToHouseNotes() {
  syncUniversalPropertyNoteToHouseNotes_();
}

function removeUniversalPropertyNoteFromHouseNotes() {
  removeUniversalPropertyNoteFromHouseNotes_();
}
/* end[property_notes_tools_public_wrappers] */


/* begin[property_notes_tools_control_sheet] */
function ensurePropertyNotesControlSheet_() {
  throw new Error("Disabled: setup function not meant to be run again.");
}

function getUniversalPropertyNoteFromControlSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROPERTY_NOTES_CONTROL_SHEET_NAME);

  if (!sheet) {
    throw new Error(
      `Sheet not found: ${PROPERTY_NOTES_CONTROL_SHEET_NAME}. Run ensurePropertyNotesControlSheet first.`
    );
  }

  return safeStr_(sheet.getRange("B2").getValue()).trim();
}
/* end[property_notes_tools_control_sheet] */


/* begin[property_notes_tools_properties_sheet_helpers] */
function getPropertiesSheetAndIndexes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROPERTY_NOTES_SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet not found: ${PROPERTY_NOTES_SHEET_NAME}`);
  }

  const data = sheet.getDataRange().getValues();
  if (!data.length) {
    throw new Error(`${PROPERTY_NOTES_SHEET_NAME} is empty.`);
  }

  const headers = data[0].map(String);
  const idx = {
    propertyName: headers.indexOf(PROPERTY_NOTES_PROPERTY_HEADER_NAME),
    houseNotes: headers.indexOf(PROPERTY_NOTES_HEADER_NAME),
  };

  if (idx.propertyName === -1) {
    throw new Error(`Missing required header: ${PROPERTY_NOTES_PROPERTY_HEADER_NAME}`);
  }

  if (idx.houseNotes === -1) {
    throw new Error(`Missing required header: ${PROPERTY_NOTES_HEADER_NAME}`);
  }

  return {
    sheet,
    data,
    idx,
  };
}
/* end[property_notes_tools_properties_sheet_helpers] */


/* begin[property_notes_tools_block_helpers] */
function buildUniversalNoteBlock_(noteText) {
  const trimmed = safeStr_(noteText).trim();
  if (!trimmed) return "";

  return `${UNIVERSAL_NOTE_HEADER}\n${trimmed}`;
}

function stripUniversalNoteBlock_(text) {
  const raw = safeStr_(text);

  const oldPattern =
    `${escapeForRegex_("[UNIVERSAL NOTE START]")}[\\s\\S]*?${escapeForRegex_("[UNIVERSAL NOTE END]")}`;

  const afterOldRemoval = raw.replace(new RegExp(oldPattern, "g"), "");

  const newPattern =
    `${escapeForRegex_(UNIVERSAL_NOTE_HEADER)}[\\s\\S]*$`;

  const withoutManagedBlocks = afterOldRemoval.replace(new RegExp(newPattern, "g"), "");
  return normalizeBlankLines_(withoutManagedBlocks).trim();
}

function upsertUniversalNoteBlock_(existingText, universalNoteText) {
  const cleanedBase = stripUniversalNoteBlock_(existingText);
  const newBlock = buildUniversalNoteBlock_(universalNoteText);

  if (!newBlock) {
    return cleanedBase;
  }

  if (!cleanedBase) {
    return newBlock;
  }

  return `${cleanedBase}\n\n${newBlock}`;
}

function normalizeBlankLines_(text) {
  return safeStr_(text)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeStr_(value) {
  return value == null ? "" : String(value);
}

function escapeForRegex_(text) {
  return safeStr_(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/* end[property_notes_tools_block_helpers] */


/* begin[property_notes_tools_main_sync] */
function syncUniversalPropertyNoteToHouseNotes_() {
  const universalNote = getUniversalPropertyNoteFromControlSheet_();
  const { sheet, data, idx } = getPropertiesSheetAndIndexes_();

  if (data.length < 2) {
    Logger.log("No property rows found.");
    return;
  }

  const outputValues = [];
  let changedCount = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const propertyName = safeStr_(row[idx.propertyName]).trim();
    const existingNotes = safeStr_(row[idx.houseNotes]);
    const updatedNotes = upsertUniversalNoteBlock_(existingNotes, universalNote);

    outputValues.push([updatedNotes]);

    if (updatedNotes !== existingNotes) {
      changedCount += 1;
      Logger.log(`Updated House Notes for: ${propertyName || "(blank property name)"}`);
    }
  }

  sheet
    .getRange(2, idx.houseNotes + 1, outputValues.length, 1)
    .setValues(outputValues);

  Logger.log(`Universal note sync complete. Updated ${changedCount} row(s).`);
}
/* end[property_notes_tools_main_sync] */


/* begin[property_notes_tools_remove] */
function removeUniversalPropertyNoteFromHouseNotes_() {
  const { sheet, data, idx } = getPropertiesSheetAndIndexes_();

  if (data.length < 2) {
    Logger.log("No property rows found.");
    return;
  }

  const outputValues = [];
  let changedCount = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const propertyName = safeStr_(row[idx.propertyName]).trim();
    const existingNotes = safeStr_(row[idx.houseNotes]);
    const updatedNotes = stripUniversalNoteBlock_(existingNotes);

    outputValues.push([updatedNotes]);

    if (updatedNotes !== existingNotes) {
      changedCount += 1;
      Logger.log(`Removed universal note block from: ${propertyName || "(blank property name)"}`);
    }
  }

  sheet
    .getRange(2, idx.houseNotes + 1, outputValues.length, 1)
    .setValues(outputValues);

  Logger.log(`Universal note removal complete. Updated ${changedCount} row(s).`);
}
/* end[property_notes_tools_remove] */