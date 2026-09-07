import type { RelayConfig } from './config';
import { signBytes } from './crypto';

/* begin[siri_immutable_contract] */
export const SIRI_TYPES = ['cleaning', 'deep_clean', 'property'] as const;
export type SiriNoteType = typeof SIRI_TYPES[number];
export type SiriState = 'accepted' | 'waiting_shift' | 'pinned' | 'completed' | 'needs_review';
export interface SiriInput {
  request_id: string;
  captured_at: string;
  note_type: SiriNoteType;
  note: string;
}
export interface SiriPin {
  spreadsheetId: string;
  timeSheetId: number;
  propertySheetId: number;
  cleanerName: string;
  property: string;
  clockInMs: number;
  clockOutMs: number;
}
export const SIRI_SUBJECT_PATTERN = /^cehusr_v1_[A-Za-z0-9_-]{43}$/u;
export const SIRI_TOKEN_PATTERN = /^siri_[A-Za-z0-9_-]{43}$/u;
export const SIRI_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export const SIRI_WAIT_MESSAGE = 'Note queued. Please open the Clean Energy app now so any saved clock-in can sync.';

export function validateSiriInput(value: unknown): SiriInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'captured_at,note,note_type,request_id' ||
      typeof v.request_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u.test(v.request_id) ||
      typeof v.captured_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v.captured_at) ||
      !Number.isFinite(Date.parse(v.captured_at)) || new Date(v.captured_at).toISOString() !== v.captured_at ||
      typeof v.note_type !== 'string' || !SIRI_TYPES.includes(v.note_type as SiriNoteType) ||
      typeof v.note !== 'string' || !v.note.trim() || Array.from(v.note).length > 1000) return null;
  return v as unknown as SiriInput;
}

export function siriContext(purpose: 'payload' | 'pin', requestId: string): string {
  return `ceh-siri:test:v1:${purpose}:${requestId}`;
}

export function hashSiriToken(token: string, config: RelayConfig): Promise<string> {
  return signBytes(new TextEncoder().encode(`ceh-siri-token\nv1\ntest\n${token}`), config.relayTokenHmacKey);
}

export function digestSiriInput(input: SiriInput, subject: string, config: RelayConfig): Promise<string> {
  return signBytes(new TextEncoder().encode(JSON.stringify([
    'ceh-siri-request', 1, 'test', subject,
    input.request_id, input.captured_at, input.note_type, input.note,
  ])), config.eventDigestHmacKey);
}

export function validateSiriPin(value: unknown, input: SiriInput): SiriPin | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).sort().join(',') !== 'cleanerName,clockInMs,clockOutMs,property,propertySheetId,spreadsheetId,timeSheetId' ||
      typeof p.spreadsheetId !== 'string' || !p.spreadsheetId || p.spreadsheetId.length > 128 ||
      typeof p.cleanerName !== 'string' || !p.cleanerName || p.cleanerName.length > 500 ||
      typeof p.property !== 'string' || !p.property || p.property.length > 500 ||
      !Number.isSafeInteger(p.timeSheetId) || Number(p.timeSheetId) < 0 ||
      !Number.isSafeInteger(p.propertySheetId) || Number(p.propertySheetId) < 0 ||
      !Number.isSafeInteger(p.clockInMs) || !Number.isSafeInteger(p.clockOutMs) ||
      Number(p.clockInMs) > Date.parse(input.captured_at) || Number(p.clockOutMs) < Date.parse(input.captured_at)) return null;
  return p as unknown as SiriPin;
}

export function digestSiriPin(pin: SiriPin, config: RelayConfig): Promise<string> {
  return signBytes(new TextEncoder().encode(JSON.stringify([
    'ceh-siri-pin', 1, 'test', pin.spreadsheetId, pin.timeSheetId, pin.propertySheetId,
    pin.cleanerName, pin.property, pin.clockInMs, pin.clockOutMs,
  ])), config.eventDigestHmacKey);
}
/* end[siri_immutable_contract] */
