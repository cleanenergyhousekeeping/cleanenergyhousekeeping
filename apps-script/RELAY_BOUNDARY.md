# CEH Relay Apps Script Boundary

This boundary is inactive unless its complete environment configuration is present in Apps Script Properties and the bound spreadsheet ID matches exactly. The same source is intended for TEST and production; only deployment-specific configuration and key material differ.

## Controlled Sheet Setup

Before enabling the relay in TEST, a separately reviewed migration must:

1. Add one `User ID` header to the TEST Users sheet.
2. Assign one random UUID v4 to every populated user row.
3. Verify every ID is nonblank, well-formed, and unique.
4. Create a TEST-only Relay Event Ledger sheet with the exact headers below.

This repository change does not create the header, IDs, or ledger. Relay processing fails closed when the `User ID` schema is absent or invalid. Existing login and direct submission behavior does not depend on the new column.

The opaque cleaner subject is a keyed HMAC over the subject version, configured environment, and immutable User ID. The User ID and subject key are never returned to the client or written to D1. Changing an assigned User ID changes the relay identity and requires a controlled repair.

## Script Properties

Both environments use these property names with separate values and secrets:

```text
CEH_RELAY_ENABLED
CEH_RELAY_ENVIRONMENT
CEH_RELAY_EXPECTED_SPREADSHEET_ID
CEH_RELAY_LEDGER_SHEET_NAME
CEH_RELAY_ACCEPTED_KEY_IDS
CEH_RELAY_HMAC_KEYS_JSON
CEH_RELAY_SUBJECT_HMAC_KEY
CEH_RELAY_MAX_CLOCK_SKEW_SECONDS
CEH_RELAY_NONCE_TTL_SECONDS
CEH_RELAY_LOCK_TIMEOUT_MS
CEH_RELAY_MAX_NONCE_COUNT
```

Only `test` and `production` are valid environment values. Production remains disabled until a separate production deployment and complete production properties are approved. Keys must be generated independently for each environment and stored only in Script Properties and the corresponding Worker secrets.

For the separate production Apps Script deployment, configure these non-secret values only when the approved promotion runbook calls for it:

```text
CEH_RELAY_ENABLED=false
CEH_RELAY_ENVIRONMENT=production
CEH_RELAY_EXPECTED_SPREADSHEET_ID=1b1IVRl3GIxFWJM0x7J5RTGmHTl_yrzHqis0O7hdM-wc
CEH_RELAY_LEDGER_SHEET_NAME=Relay Event Ledger
```

Production code accepts only that spreadsheet ID and ledger sheet name. It remains inactive when `CEH_RELAY_ENABLED` is absent or any value other than the exact string `true`. The production deployment must use its own Script Properties; TEST key IDs and cryptographic values must not be copied into production. Missing or malformed secrets are reported as a generic relay configuration failure only after relay handling is explicitly invoked; no property name, value, or secret is returned or logged.

### Production property installer

`installProductionRelayPropertiesAdmin(hmacKeysJson, subjectHmacKey)` is the
admin-only path for installing the complete production relay property set when the
Apps Script settings UI is at its row limit. It accepts the two secret values as
direct parameters, validates them before writing, keeps the relay disabled, and
uses `setProperties(..., false)` so Live session properties are preserved. Its
return value is the same sanitized report produced by
`verifyProductionRelayPropertiesAdmin()`; neither function logs or returns a secret
string.

Do not pass secrets with `clasp run --params`, because they would appear in the
shell command and history. A separately approved operational phase must use a local
execution-only wrapper that reads the retained recovery bundle from a protected
clipboard or anonymous descriptor, clears the clipboard, and sends the two direct
parameters in the Apps Script Execution API HTTPS request body. The wrapper must
suppress request and response logging and must never persist the request body. Do
not paste secret values into source, the Apps Script editor, a shell command,
environment variables, a spreadsheet, or chat.

## Signed Requests

The Worker sends `mode`, `keyId`, a base64url-encoded exact UTF-8 JSON body, and a base64url HMAC-SHA-256 signature over those decoded body bytes. The signed body includes version, key ID, environment, audience, operation, timestamp, nonce, and payload. Context is not secret, but it must be reconstructed exactly.

Nonce property keys hash the nonce with version, environment, and key-ID separation. Only expiration timestamps are stored. Expired relay nonce entries are removed opportunistically, retained entries are bounded by configuration and an absolute limit of 500, and cleanup never touches properties outside the relay nonce prefix.

## Relay Event Ledger

```text
Event ID
Payload Digest
State
Cleaner Subject
Device ID
Device Sequence
Event Type
Client Timestamp
Received At
Applied At
Result Code
```

The ledger stores no property, note, display name, User ID, credential, signature, request body, raw error, or stack trace. The sheet must exist with exactly these headers; request handling never creates or repairs it.

For an existing Event ID, payload digest, cleaner subject, device ID, device sequence, event type, and client timestamp must all match exactly. Any mismatch is a permanent conflict without reconciliation or ledger mutation. Property and note remain absent from the ledger and are bound through the payload digest.

The ledger enters `PROCESSING` before existing queued reconciliation runs. Spreadsheet writes are flushed before `APPLIED` is recorded. Final State, Applied At, and Result Code are written together as one complete-row update. A matching PROCESSING retry re-enters the unchanged reconciliation function, while a matching APPLIED retry returns success without another mutation. Session high-water is the highest contiguous APPLIED device sequence beginning at one, never a simple maximum across gaps.

## Production Promotion

Production promotion must use the same reviewed source commit with a separate Apps Script deployment, spreadsheet, Script Properties, cryptographic keys, Worker name and bindings, D1 database, and Cloudflare resources. No deployment URL, cleaner identity, D1 ID, or key material belongs in source. The reviewed Live spreadsheet binding above is the only intentionally source-defined production identifier.

`relay/src/crypto.ts` already derives authenticated-encryption contexts from the validated relay environment: `ceh-relay:<environment>:event:<eventId>` and `ceh-relay:<environment>:state:<cleanerSubject>`. TEST and production ciphertexts therefore cannot be decrypted across environments when keys or contexts are mixed.

Before activation, provision the production D1 database and replace the deliberately unresolved production database ID in `relay/wrangler.jsonc`; configure the production Worker secrets listed in `relay/README.md`; configure matching production Apps Script properties and key IDs; create the separate Apps Script deployment; and perform a separately approved deployment and migration. This source change does none of those operations.
