# CEH Relay Test

TypeScript Cloudflare Worker foundation for the Clean Energy Housekeeping test relay.

## Requirements

- Node.js and npm
- Authenticated Wrangler access to the existing `ceh-relay-test-db` D1 database

The Worker uses the existing D1 binding `DB`. No credentials, tokens, or secrets belong in this directory.

## Local setup

```bash
npm ci
npm run cf-typegen
npm run dev
```

`GET /health` checks D1 reachability with `SELECT 1` and returns a sanitized test-environment response. Browser access is allowed only from `https://www.cleanenergyhousekeeping.com`; requests without an `Origin` header remain available for server health checks.

## Persistence foundation

Versioned schema changes live in `migrations/` and use Wrangler's D1 migration ledger. Public routes reach D1 only through the focused session and event service layers; persistence modules remain independent of HTTP parsing and response formatting.

The schema stores relay tokens only as HMAC hashes. Event payloads and state snapshots must be AES-GCM encrypted before insertion; property names, cleaner display names, and notes are never stored in plaintext. No Worker secrets belong in migration files, configuration, source, or tests.

AES-GCM additional authenticated data binds each ciphertext to its intended environment, record, and purpose. Use `ceh-relay:<environment>:event:<eventId>` for events and `ceh-relay:<environment>:state:<cleanerSubject>` for state snapshots. This context is not secret, is not stored with the ciphertext, and must be reconstructed exactly for decryption.

## Apps Script delivery bridge

The Worker exposes `POST /v1/relay-sessions/enroll` and `POST /v1/relay-sessions/renew`. Both validate the supplied Apps Script session through the signed `validate_session` boundary before changing D1. Renewal also requires the current bearer relay token and matching device. Relay tokens last seven days; successful rotation keeps the prior token valid for ten minutes.

Authenticated phones submit events with `POST /v1/relay-events`, `Content-Type: application/json`, and `Authorization: Bearer <relay token>`. The request body contains exactly `eventId`, `deviceSequence`, `eventType`, `submittedAtMs`, `property`, and `note`. Cleaner subject and device identity always come from the active relay session and cannot be supplied by the client. Unknown fields, malformed values, notes over 1,000 Unicode code points, and properties over 500 characters are rejected.

An inserted event returns HTTP 202 and an identical replay returns HTTP 200; both use the stable body `{ "ok": true, "eventId": "<client event ID>", "status": "accepted" }`. Conflicts return sanitized HTTP 409 responses. The acknowledgment is sent only after D1 classifies the insert. Acceptance computes an environment-bound digest and stores the complete canonical event as event-bound AES-GCM ciphertext; it never calls Apps Script directly.

Accepted clock events are delivered by the every-minute Cron Trigger, never inline with phone acceptance. Each run makes at most 20 sequential delivery attempts, selecting one due lane head per ready lane in each round before selecting again. This fairly advances independent lanes while allowing multiple contiguous events from a successful lane in the same invocation. Conditional two-minute leases protect each attempt. Delivery is strictly contiguous per cleaner/device. Missing sequences block the lane and are never skipped automatically.

Each encrypted event must contain the same event ID, opaque cleaner subject, device ID, device sequence, event type, and submitted timestamp held in D1. After authenticated decryption, the Worker validates those fields and recomputes the environment-separated canonical payload digest before contacting Apps Script. Corrupt or conflicting payloads fail terminally without exposing plaintext.

Temporary failures use exponential backoff with jitter. An event that remains unresolved for at least 60 minutes after multiple genuine delivery attempts enters `attention_required` and continues randomized retries every 6–24 hours. Infrastructure age and retry count never create a terminal failure.

Deployment configuration supplies the environment, active Apps HMAC key ID, and active payload-encryption key version. These Worker secrets must be configured separately for TEST and production:

```text
CEH_RELAY_APPS_URL
CEH_RELAY_APPS_HMAC_KEYS_JSON
CEH_RELAY_TOKEN_HMAC_KEY
CEH_RELAY_EVENT_DIGEST_HMAC_KEY
CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON
```

The Apps HMAC secret is a versioned key ring. Its non-secret active key ID must exist in the ring and in Apps Script's overlapping accepted-key configuration. No deployment URL, credential, key value, Apps session, signed request body, property, note, or decrypted payload belongs in Git or logs.

Tests apply the real migrations to isolated local D1 storage. To inspect the migration state of Wrangler's local development database without contacting the remote database, run:

```bash
npm run migrations:list:local
```

## Validation

```bash
npm run typecheck
npm test
npm audit
npm run deploy:dry-run
```

Deployment is intentionally separate from validation and requires explicit approval.

## Production secret preparation helper

`scripts/production-relay-secrets.mjs` prepares the five independent 32-byte
production keys without writing them to files or printing them. Review and run its
synthetic-only check before any real generation:

```bash
npm run secrets:production:test
```

The check creates only short-lived test material in memory. It exercises key
generation and validation, Apps Script clipboard handoff through a fake clipboard,
and Worker descriptor transport through a local fake consumer. It does not access the
macOS Keychain, modify the real clipboard, invoke Wrangler, or contact Cloudflare.

After the helper has been reviewed and a separate production-operation phase has
been approved, the intended operator workflow is:

```bash
node scripts/production-relay-secrets.mjs generate
pbpaste | node scripts/production-relay-secrets.mjs apps-script-next
pbpaste | node scripts/production-relay-secrets.mjs worker-bootstrap
```

`generate` prompts for the production Apps Script `/exec` URL, generates all secret
material in memory, and places one recovery bundle on the clipboard. Save that
bundle immediately as a secure note in a trusted password manager. The helper waits
for confirmation and then clears the clipboard. This secure note is the recovery
storage; do not save the bundle in a plaintext file, terminal command, environment
variable, repository, chat, or shell history.

For either follow-up command, retrieve the recovery bundle to the clipboard and use
the exact `pbpaste` pipeline above. The helper consumes it from stdin and clears the
clipboard before continuing. `apps-script-next` hands off one Apps Script property
at a time and clears the clipboard after each confirmation. `worker-bootstrap`
requires the operator to type `DEPLOY`, then performs the first dark production
deployment with the equivalent of:

```bash
wrangler deploy --env production --strict --secrets-file /dev/fd/3
```

After reading the recovery bundle from its own piped stdin, the helper supplies all
five secrets to Wrangler through inherited anonymous file descriptor 3. No secret
value is placed in Wrangler stdin, command arguments, environment variables, or a
temporary plaintext file. The existing production Wrangler configuration keeps
`workers_dev` and preview URLs disabled and its Cron schedule empty. This command
creates the production Worker and contacts Cloudflare, so it must not be run until
the single dark production deployment is separately reviewed and approved.

The helper intentionally has no mode that reveals or prints secret material. Any
unknown mode, extra command argument, malformed key, padded base64, mismatched
shared signing key, reused logical key, malformed JSON, or invalid/missing Apps
Script URL fails closed with a generic message.
