/* begin[relay_validation_facilities] */
export const PROPOSED_NOTE_MAX_CHARACTERS = 1_000;

export interface NoteCompatibilityValidation {
  characterCount: number;
  limit: number;
  valid: boolean;
}

export function validateProposedNoteLimit(
  note: string,
): NoteCompatibilityValidation {
  const characterCount = Array.from(note).length;
  return {
    characterCount,
    limit: PROPOSED_NOTE_MAX_CHARACTERS,
    valid: characterCount <= PROPOSED_NOTE_MAX_CHARACTERS,
  };
}
/* end[relay_validation_facilities] */
