# TEST Siri notes: frozen v1 backend contract

Implementation only; no migration or deployment is performed by this PR. Live,
PWA shells, PWA session/lane/event schemas, and the real Shortcut are unchanged.

## Intake and acknowledgement

`POST /v1/siri-notes` on the TEST Worker, with `Authorization: Bearer siri_…`
and `Content-Type: application/json`. No public issuance or property-read route.
The JSON object contains exactly four fields:

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "captured_at": "2026-09-03T17:42:00.000Z",
  "note_type": "cleaning",
  "note": "Clean upper kitchen cabinet interiors"
}
```

- `request_id`: 16–128 ASCII letters/digits/`.`/`_`/`:`/`-`, first character alphanumeric.
- `captured_at`: valid UTC ISO timestamp **with exactly three fractional digits**.
  Persist this original string before POST; never replace it during retry.
- `note_type`: `cleaning`, `deep_clean`, or `property`.
- `note`: nonblank, at most 1,000 Unicode code points. Original whitespace and
  multiline content are retained. Total UTF-8 request body limit: 8,192 bytes.
- No property, cleaner, PIN, session, or device fields are accepted.

A successful new request returns HTTP 202; an identical replay returns HTTP 200:

```json
{
  "ok": true,
  "environment": "test",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "durable": true,
  "state": "accepted",
  "client_action": "clear_pending",
  "message": "Cleaning note saved"
}
```

Check HTTP success, `ok`, `environment`, matching `request_id`, `durable: true`,
and `client_action: clear_pending` before deleting the persisted local request.
D1 acceptance is the agreed meaning of “saved”; it does **not** mean spreadsheet
application has completed. Normal messages are `Cleaning note saved`,
`Deep clean note saved`, and `Property note received`.

A replay whose stored state is `waiting_shift` instead says exactly:
`Note queued. Please open the Clean Energy app now so any saved clock-in can sync.`
It still has `durable: true` and permits local cleanup. Initial intake never
calls Apps Script, so it cannot diagnose a missing shift in the initial response.
There is no push notification or Shortcut polling requirement in this PR.
Request IDs must not be spoken or displayed to cleaners.

Errors: 400 invalid request; 401 invalid/expired/revoked credential; 409 request
conflict; 503 temporarily unavailable. Errors never expose another request.
A 503 uses `durable: null`: storage outcome may be unknown. Timeout, missing or
malformed response, 503, or lost response means retain and retry **the identical
persisted request**. Do not change IDs or timestamps to bypass a conflict.
Other errors have `durable: false` for this submitted payload; retain local data
for correction/operator help rather than discarding it.

## Storage, identity, and reconciliation

`siri_credentials` stores a random 256-bit token's purpose-separated HMAC hash,
existing opaque cleaner subject, issuance/expiry, and independent revocation.
`siri_requests` stores immutable AES-GCM-encrypted original input, a keyed digest
bound to the server-side cleaner subject, business state, lease/retry metadata,
and an immutable encrypted pin. No raw Siri tokens are stored in D1. Existing
TEST key rings are reused with distinct Siri contexts; PWA tokens/sessions are
not reused. Preserve those key versions for the lifetime of retained records.

Business states: `accepted`, `waiting_shift`, `pinned`, `completed`, `needs_review`.
A two-minute conditional D1 lease fences stale attempts. The existing minute
cron attempts up to ten due Siri requests after the relay batch, independently
of whether relay delivery succeeded. Waiting retries every minute for the first
five attempts, then every five minutes. Infrastructure retries are one minute
or a longer bounded upstream Retry-After. Review states stop automatic writes.
No automatic Siri payload/receipt deletion is introduced in the pilot.
Credential expiry/revocation blocks new intake and replay access, not already
accepted work; disable/hold that work separately if required. A replacement
credential for the same verified subject may retry the original ID/payload.

Signed `reconcile_siri_note` uses the existing Apps signature, environment,
audience, nonce, and script-lock checks. It is rejected outside TEST and on the
known Live spreadsheet. The separate `Siri Note Ledger` is created lazily in
TEST under that lock. Its JSON record retains original input, digest, subject,
pin, mutation journal, email status, and outcome; the Review column contains
property review text. Restrict spreadsheet access as for other operational notes.
No new cleaner-facing read endpoint exposes this ledger.

Only one completed interval with `clock_in <= captured_at <= clock_out` may be
pinned. An open shift alone stays waiting. Multiple matching completed intervals,
a conflicting open interval, malformed cleaner shift data, duplicate cleaner
names, or duplicate/missing matching properties fail safely. Identity is derived
from exactly one active Users record with an existing User ID. No newest-row
fallback or future clock-in selection exists. Resolution does not insert or
repair Time Tracker rows/headers. All three routes require this resolution.

Pins retain spreadsheet/sheet IDs, server cleaner name, property name, clock-in
and clock-out times. Row numbers are re-found, never trusted across retries.
Changed/deleted pins require review rather than silent reassignment. There is
no new global shift/property ID or cross-phone ordering mechanism.

Cleaning notes append a bullet to `Clock Out Note`; deep-clean notes append
`[yyyy-MM-dd h:mm a] Cleaner Name — note` in the script timezone using original
capture time. Existing content is preserved. No hours, transit, flags, payroll,
invoice, clock-in/out, or House Notes logic is invoked or modified.

Before a cell write, the ledger stores before/after digests and the intended
text. Retry observing the after-image finalizes without another append; the
before-image can be applied; any other value requires review. An unresolved
mutation blocks another Siri mutation to the same destination. This handles
crashes and lost responses, but a script lock does not exclude a human editing
a spreadsheet concurrently. Avoid editing destination cells during pilot writes;
intervening changes detected on recovery are held, not overwritten.

Property review is durable before MailApp is attempted. `pending` means no send
attempt; exhausted quota stays pending and retries. `uncertain` is written
**before** sending; an interrupted/throwing send is never retried automatically.
`sent` means MailApp returned normally, not guaranteed inbox delivery. A crash
before sending can also leave `uncertain`; Kyle must inspect and choose whether
to resend. This deliberately does not promise exactly-once email.

## Operator setup (only after separate TEST deployment authorization)

Apply the existing TEST relay migrations first. Apply the standalone Siri SQL
once to **ceh-relay-test-db**, using the reviewed
`migrations-test/0001_siri_notes.sql`. It is deliberately outside the shared
`migrations/` directory and outside production's migration configuration.
The SQL is a forward-only bootstrap, not an idempotent reset script. Do not run
it against production. Tests apply both directories to isolated local databases.

Deploy the matching Apps Script Siri files and Worker to TEST only. Existing
TEST Apps configuration must identify its correct spreadsheet and Users sheet.
No additional public admin credential or secret framework is required.

Use a private interactive terminal and the existing TEST secrets supplied through
your secret manager/environment, not pasted as shell arguments or committed files:
`CEH_RELAY_ENVIRONMENT=test`, `CEH_RELAY_APPS_URL`,
`CEH_RELAY_APPS_ACTIVE_KEY_ID`, `CEH_RELAY_APPS_HMAC_KEYS_JSON`, and
`CEH_RELAY_TOKEN_HMAC_KEY`. Wrangler must already have authorized Cloudflare access.

From `relay/`:

```sh
node scripts/siri-credentials.mjs issue "Exact Cleaner Name"
node scripts/siri-credentials.mjs revoke siri_credential_REPLACE_WITH_ISSUED_ID
```

Issuance verifies the human name through signed TEST `resolve_siri_cleaner` and
uses its server-derived opaque subject. Duplicate/inactive names fail closed.
The operator never copies/guesses subjects. The D1 target is checked against the
known TEST database ID/name. The credential ID is printed before insertion so
an interrupted/unknown issuance can be revoked. The token is shown only after
D1 readback confirms its hash/binding/90-day expiry, and only on a terminal.
Copy it directly to the pilot Shortcut's private configuration. Do not post it
in PRs, chats, logs, screenshots, or a repository. Revocation is idempotent and
verified by readback; it never revokes PWA sessions.

Review `needs_review` records in TEST and preserve their evidence. This PR does
not provide automatic retargeting, generic operator repair, or a review dashboard.

## Validation

From `relay/`: `npm run typecheck`, `npm test`, `npm run deploy:dry-run`.
From the repository root:
`node --test test/apps-script/relay-boundary.test.mjs test/apps-script/siri-boundary.test.mjs`.
Physical TEST validation after deployment and the real iPhone Shortcut remain
separate work. No live credentials are needed for these automated tests.
