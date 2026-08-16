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

Production promotion must use the same reviewed source commit with a separate Apps Script deployment, spreadsheet, Script Properties, cryptographic keys, Worker bindings, D1 database, and Cloudflare resources. No deployment URL, spreadsheet ID, cleaner identity, or key material belongs in source.

Before any production Worker promotion, `relay/src/crypto.ts` must replace its current TEST-only `ceh-relay:test` authenticated-encryption prefix with a validated environment-derived context. That Worker change is intentionally outside this Apps Script PR.
