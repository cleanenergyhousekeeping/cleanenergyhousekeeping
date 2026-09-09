import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

/* begin[siri_apps_boundary_tests] */
const KEY = Buffer.alloc(32, 17);
const SUBJECT_KEY = Buffer.alloc(32, 41);
const USER_ID = '8b3f6e44-580d-4dc4-b15d-f1c8821daf38';
const CAPTURE = '2026-09-03T17:42:00.000Z';
const START = new Date('2026-09-03T16:00:00.000Z');
const END = new Date('2026-09-03T18:00:00.000Z');
const TRACKER = ['Name', 'Property', 'Clock In', 'Clock Out', 'Clock Out Note'];
const bytes = value => Array.isArray(value) ? Buffer.from(value.map(x => (x + 256) % 256)) : Buffer.from(value);
function harness(options = {}) {
  let sheetId = 0;
  const state = { crash: '', sends: 0, quota: 10, mailThrows: false, locked: false };
  class Sheet {
    constructor(rows) { this.rows = structuredClone(rows); this.id = ++sheetId; }
    getSheetId() { return this.id; }
    getDataRange() { return this.getRange(1, 1, this.rows.length || 1, this.rows[0]?.length || 1); }
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValue: () => this.rows[r - 1]?.[c - 1] ?? '',
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => this.rows[r + i - 1]?.[c + j - 1] ?? '')),
        setValue: value => {
          this.rows[r - 1][c - 1] = value;
          if (state.crash === 'after_cell') { state.crash = ''; throw new Error('simulated interrupted write'); }
        },
        setValues: values => {
          if (state.crash === 'before_completed' && values[0][3] === 'completed') { state.crash = ''; throw new Error('simulated ledger failure'); }
          for (let i = 0; i < nr; i++) {
            this.rows[r + i - 1] ??= [];
            for (let j = 0; j < nc; j++) this.rows[r + i - 1][c + j - 1] = values[i][j];
          }
        },
      };
    }
  }
  const users = new Sheet(options.users ?? [
    ['PIN', 'Name', 'Is Active', 'User ID'], ['1234', 'Cleaner One', true, USER_ID],
  ]);
  const tracker = new Sheet([TRACKER, ...(options.shifts ?? [['Cleaner One', 'Property A', START, END, 'Existing content']])]);
  const properties = new Sheet(options.properties ?? [['Property Name', 'Deep Clean Items', 'House Notes'], ['Property A', 'Keep this', 'Never modify']]);
  const sheets = new Map([['Users', users], ['Time Tracker', tracker], ['Properties', properties]]);
  const spreadsheet = { getId: () => options.spreadsheetId ?? 'test-sheet', getSheetByName: name => sheets.get(name),
    insertSheet: name => { const sheet = new Sheet([]); sheets.set(name, sheet); return sheet; } };
  const props = {
    CEH_RELAY_ENABLED: 'true', CEH_RELAY_ENVIRONMENT: options.environment ?? 'test',
    CEH_RELAY_EXPECTED_SPREADSHEET_ID: spreadsheet.getId(), CEH_RELAY_LEDGER_SHEET_NAME: 'Relay Event Ledger',
    CEH_RELAY_ACCEPTED_KEY_IDS: 'test-v1', CEH_RELAY_HMAC_KEYS_JSON: JSON.stringify({ 'test-v1': KEY.toString('base64url') }),
    CEH_RELAY_SUBJECT_HMAC_KEY: SUBJECT_KEY.toString('base64url'), CEH_RELAY_MAX_CLOCK_SKEW_SECONDS: '300',
    CEH_RELAY_NONCE_TTL_SECONDS: '600', CEH_RELAY_LOCK_TIMEOUT_MS: '5000', CEH_RELAY_MAX_NONCE_COUNT: '100',
  };
  const context = vm.createContext({ Array, Date, JSON, Number, Set, String,
    TIME_SHEET_NAME: 'Time Tracker', USERS_SHEET_NAME: 'Users', NOTIFY_EMAIL: 'admin@example.test',
    safeStr_: v => v == null ? '' : String(v).trim(), normalizeAccessCode_: v => String(v).trim(),
    normalizeActiveFlag_: v => v === true, coerceToDate_: v => v instanceof Date && Number.isFinite(v.getTime()) ? v : null,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush() {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    MailApp: { getRemainingDailyQuota: () => state.quota, sendEmail() { state.sends++; if (state.mailThrows) throw new Error('unknown send outcome'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }), getProperty: key => props[key] ?? null,
      setProperty: (key, value) => { props[key] = value; }, deleteProperty: key => { delete props[key]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (state.locked) return false; state.locked = true; return true; }, releaseLock: () => { state.locked = false; } }) },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' }, DigestAlgorithm: { SHA_256: 'sha256' }, MacAlgorithm: { HMAC_SHA_256: 'sha256' },
      base64EncodeWebSafe: v => bytes(v).toString('base64url'), base64DecodeWebSafe: v => [...Buffer.from(v, 'base64url')],
      computeHmacSignature: (_, v, key) => [...crypto.createHmac('sha256', bytes(key)).update(bytes(v)).digest()],
      computeDigest: (_, v) => [...crypto.createHash('sha256').update(bytes(v)).digest()],
      newBlob: v => ({ getBytes: () => [...bytes(v)], getDataAsString: () => bytes(v).toString('utf8') }),
      formatDate: date => { const h = date.getUTCHours(); return `${date.toISOString().slice(0, 10)} ${h % 12 || 12}:${String(date.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; },
    },
  });
  for (const file of ['51_RelayConfig.gs', '52_RelaySecurity.gs', '53_RelayLedger.gs', '54_RelayService.gs', '56_SiriLedger.gs', '57_SiriService.gs']) {
    vm.runInContext(fs.readFileSync(new URL(`../../apps-script/${file}`, import.meta.url), 'utf8'), context);
  }
  const subject = vm.runInContext(`buildRelayCleanerSubject_(loadRelayConfig_(), '${USER_ID}')`, context);
  function send(payload, operation = 'reconcile_siri_note', overrides = {}) {
    const body = Buffer.from(JSON.stringify({ version: 1, keyId: 'test-v1', environment: 'test',
      audience: 'ceh-relay:test:apps-script', operation, timestampMs: Date.now(),
      nonce: crypto.randomBytes(24).toString('base64url'), payload, ...overrides }));
    context.envelope = { keyId: 'test-v1', signedBody: body.toString('base64url'),
      signature: crypto.createHmac('sha256', KEY).update(body).digest('base64url') };
    return JSON.parse(JSON.stringify(vm.runInContext('handleRelayWorkerRequest_(envelope)', context)));
  }
  const input = { request_id: 'siri_request_00000001', captured_at: CAPTURE, note_type: 'cleaning', note: 'First line\nSecond line',
    cleanerSubject: subject, payloadDigest: 'A'.repeat(43) };
  const record = (id = input.request_id) => JSON.parse(sheets.get('Siri Note Ledger').rows.find(r => r[0] === id)[4]);
  return { send, input, state, sheets, tracker, properties, users, record, context };
}

test('Siri human issuance resolves one active cleaner server-side and rejects identity extras', () => {
  const h = harness();
  const result = h.send({ cleanerName: 'Cleaner One' }, 'resolve_siri_cleaner');
  assert.equal(result.data.cleanerSubject, h.input.cleanerSubject);
  assert.equal(h.send({ cleanerName: 'missing' }, 'resolve_siri_cleaner').ok, false);
  assert.equal(h.send({ ...h.input, property: 'Property B' }).result, 'invalid_event');
  assert.equal(h.send(h.input, 'reconcile_siri_note', { environment: 'production' }).ok, false);
  h.context.productionConfig = { environment: 'production' };
  assert.equal(vm.runInContext('validateSiriOperation_(productionConfig, "reconcile_siri_note", {})', h.context), null);
  assert.equal(h.sheets.has('Siri Note Ledger'), false);
});

test('Siri waits with no shift and with an open shift, then applies the completed capture interval', () => {
  const h = harness({ shifts: [] });
  assert.equal(h.send(h.input).result, 'waiting_shift');
  h.tracker.rows.push(['Cleaner One', 'Property A', START, '', '']);
  assert.equal(h.send(h.input).result, 'waiting_shift');
  assert.equal(h.record().pin, null);
  h.tracker.rows[1][3] = END;
  assert.equal(h.send(h.input).result, 'completed');
  assert.equal(h.record().pin.clockInMs, START.getTime());
  assert.equal(h.tracker.rows[1][4], '• First line\nSecond line');
});

test('Siri never chooses a future clock-in; overlapping completed intervals and duplicate identities require review', () => {
  const future = harness({ shifts: [['Cleaner One', 'Property A', END, new Date(END.getTime() + 1000), '']] });
  assert.equal(future.send(future.input).result, 'waiting_shift');
  const overlap = harness({ shifts: [['Cleaner One', 'Property A', START, END, ''], ['Cleaner One', 'Property A', START, END, '']] });
  assert.equal(overlap.send(overlap.input).result, 'needs_review');
  const duplicate = harness();
  duplicate.users.rows.push(['5678', 'Cleaner One', true, 'fe2f59f7-df89-40b2-9939-dcfd015ea58c']);
  assert.equal(duplicate.send(duplicate.input).result, 'needs_review');
  assert.equal(duplicate.send({ cleanerName: 'Cleaner One' }, 'resolve_siri_cleaner').ok, false);
  const property = harness();
  property.properties.rows.push(['Property A', '', '']);
  assert.equal(property.send(property.input).result, 'needs_review');
});

test('Siri cleaning mutation survives lost response, multiline text, and crashes before ledger completion', () => {
  for (const crash of ['after_cell', 'before_completed']) {
    const h = harness();
    h.state.crash = crash;
    assert.equal(h.send(h.input).ok, false);
    const written = h.tracker.rows[1][4];
    assert.equal(h.record().state, 'pinned');
    assert.equal(h.send(h.input).result, 'completed');
    assert.equal(h.send(h.input).result, 'completed');
    assert.equal(h.tracker.rows[1][4], written);
    assert.equal(written, 'Existing content\n• First line\nSecond line');
    assert.equal(h.send({ ...h.input, note: 'changed' }).result, 'event_conflict');
  }
});

test('Siri re-finds moved rows but holds edited pins and intervening cell edits', () => {
  const moved = harness(); moved.state.crash = 'after_cell'; moved.send(moved.input);
  moved.tracker.rows.splice(1, 0, ['Other', 'Property A', START, END, '']);
  assert.equal(moved.send(moved.input).result, 'completed');
  const edited = harness(); edited.state.crash = 'after_cell'; edited.send(edited.input);
  edited.tracker.rows[1][4] += '\nManual edit';
  assert.equal(edited.send(edited.input).result, 'needs_review');
  const pin = harness(); pin.state.crash = 'after_cell'; pin.send(pin.input);
  pin.tracker.rows[1][3] = new Date(END.getTime() + 1000);
  assert.equal(pin.send(pin.input).result, 'needs_review');
});

test('Siri deep-clean append preserves bytes, original capture time, and server cleaner identity', () => {
  const h = harness(); h.state.crash = 'after_cell';
  const input = { ...h.input, note_type: 'deep_clean', note: 'Clean cabinets' };
  assert.equal(h.send(input).ok, false);
  assert.equal(h.send(input).result, 'completed');
  assert.equal(h.properties.rows[1][1], 'Keep this\n[2026-09-03 5:42 PM] Cleaner One — Clean cabinets');
  assert.equal(h.properties.rows[1][2], 'Never modify');
});

test('Siri property review persists through quota failure and uncertain email without duplicate send', () => {
  const h = harness(); h.state.quota = 0;
  const input = { ...h.input, note_type: 'property', note: '=do not interpret as formula' };
  assert.equal(h.send(input).result, 'pinned');
  assert.equal(h.record().email, 'pending');
  assert.match(h.record().review, /=do not interpret as formula/);
  h.state.quota = 10; h.state.mailThrows = true;
  assert.equal(h.send(input).result, 'completed');
  assert.equal(h.record().email, 'uncertain');
  assert.equal(h.send(input).result, 'completed');
  assert.equal(h.state.sends, 1);
  assert.equal(h.properties.rows[1][2], 'Never modify');
});

test('Siri lock contention and disabled cleaner do not mutate destination', () => {
  const h = harness(); h.state.locked = true;
  assert.equal(h.send(h.input).result, 'lock_busy');
  assert.equal(h.sheets.has('Siri Note Ledger'), false);
  h.state.locked = false; h.users.rows[1][2] = false;
  assert.equal(h.send(h.input).result, 'needs_review');
  assert.equal(h.tracker.rows[1][4], 'Existing content');
});
test('a second request waits behind interrupted mutation without blocking its recovery', () => {
  const h = harness(); h.state.crash = 'after_cell';
  assert.equal(h.send(h.input).ok, false);
  const second = { ...h.input, request_id: 'siri_request_00000002', note: 'Another note' };
  assert.equal(h.send(second).result, 'pinned');
  assert.equal(h.record(second.request_id).mutation, undefined);
  assert.equal(h.send(h.input).result, 'completed');
  assert.equal(h.send(second).result, 'completed');
  assert.equal(h.tracker.rows[1][4], 'Existing content\n• First line\nSecond line\n• Another note');
});

test('validly signed production Siri operations are disabled before any ledger mutation', () => {
  const h = harness({ environment: 'production', spreadsheetId: '1b1IVRl3GIxFWJM0x7J5RTGmHTl_yrzHqis0O7hdM-wc' });
  assert.equal(h.send(h.input, 'reconcile_siri_note', { environment: 'production', audience: 'ceh-relay:production:apps-script' }).result, 'invalid_event');
  assert.equal(h.sheets.has('Siri Note Ledger'), false);
});
test('preflight counts exactly one valid synced open shift and returns no sensitive data', () => {
  const open = ['Cleaner One', 'Property A', START, '', 'Private note'];
  for (const [shifts, expected] of [
    [[], 'no_active_shift'], [[open], 'active_shift'], [[open, open], 'no_active_shift'],
    [[['Cleaner One', 'Property A', START, END, '']], 'no_active_shift'],
    [[open, ['Other cleaner', 'Property B', START, '', '']], 'active_shift'],
    [[['Cleaner One', '', START, '', '']], 'no_active_shift'],
    [[['Cleaner One', 'Property A', new Date('2099-01-01'), '', '']], 'no_active_shift'],
    [[open, ['Cleaner One', 'Property A', 'invalid', '', '']], 'no_active_shift'],
    [[open, ['Cleaner One', 'Property A', START, 'invalid', '']], 'active_shift'],
  ]) {
    const h = harness({ shifts });
    const before = JSON.stringify(h.tracker.rows);
    assert.deepEqual(h.send({ cleanerSubject: h.input.cleanerSubject }, 'siri_shift_status'),
      { ok: true, operation: 'siri_shift_status', result: expected, retryable: false });
    assert.equal(JSON.stringify(h.tracker.rows), before);
    assert.equal(h.sheets.has('Siri Note Ledger'), false);
  }
});

test('preflight ignores malformed closed history but fails closed for malformed open rows', () => {
  const open = ['Cleaner One', 'Property A', START, '', ''];
  const closedRows = [
    ['Cleaner One', '', 'invalid', END, ''],
    ['Cleaner One', '', END, START, ''],
    ['Cleaner One', '', 'invalid', 'invalid', ''],
    ['Cleaner One', '', 'invalid', ' ', ''],
  ];
  for (const closed of closedRows) {
    const h = harness({ shifts: [open, closed] });
    assert.equal(h.send({ cleanerSubject: h.input.cleanerSubject }, 'siri_shift_status').result, 'active_shift');
  }
  for (const blankOut of ['', null, false, 0]) {
    for (const [property, start] of [
      ['Property A', 'invalid'], ['Property A', ''], ['Property A', new Date('2099-01-01')], ['', START],
    ]) {
      const h = harness({ shifts: [open, ['Cleaner One', property, start, blankOut, '']] });
      assert.equal(h.send({ cleanerSubject: h.input.cleanerSubject }, 'siri_shift_status').result, 'no_active_shift');
    }
  }
});

test('preflight rejects production, extra identity fields, unavailable tables and lock failure', () => {
  const h = harness();
  const payload = { cleanerSubject: h.input.cleanerSubject };
  assert.equal(h.send({ ...payload, cleanerName: 'Cleaner One' }, 'siri_shift_status').result, 'invalid_event');
  h.state.locked = true;
  assert.equal(h.send(payload, 'siri_shift_status').result, 'lock_busy');
  h.state.locked = false;
  h.sheets.delete('Time Tracker');
  assert.equal(h.send(payload, 'siri_shift_status').result, 'internal_error');
  const production = harness({ environment: 'production', spreadsheetId: '1b1IVRl3GIxFWJM0x7J5RTGmHTl_yrzHqis0O7hdM-wc' });
  assert.equal(production.send({ cleanerSubject: production.input.cleanerSubject }, 'siri_shift_status',
    { environment: 'production', audience: 'ceh-relay:production:apps-script' }).ok, false);
});

test('preflight fails closed for inactive or ambiguous cleaner identities', () => {
  for (const users of [
    [['PIN', 'Name', 'Is Active', 'User ID'], ['1234', 'Cleaner One', false, USER_ID]],
    [['PIN', 'Name', 'Is Active', 'User ID'], ['1234', 'Cleaner One', true, USER_ID],
      ['5678', 'Cleaner One', true, '7b3f6e44-580d-4dc4-b15d-f1c8821daf38']],
  ]) {
    const h = harness({ users });
    assert.equal(h.send({ cleanerSubject: h.input.cleanerSubject }, 'siri_shift_status').result, 'no_active_shift');
  }
});
/* end[siri_apps_boundary_tests] */
