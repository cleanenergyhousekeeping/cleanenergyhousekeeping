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

Versioned schema changes live in `migrations/` and use Wrangler's D1 migration ledger. The persistence modules under `src/persistence/` are not connected to public routes in this foundation phase.

The schema stores relay tokens only as HMAC hashes. Event payloads and state snapshots must be AES-GCM encrypted before insertion; property names, cleaner display names, and notes are never stored in plaintext. No Worker secrets belong in migration files, configuration, source, or tests.

AES-GCM additional authenticated data binds each ciphertext to its intended environment, record, and purpose. Use `ceh-relay:<environment>:event:<eventId>` for events and `ceh-relay:<environment>:state:<cleanerSubject>` for state snapshots. This context is not secret, is not stored with the ciphertext, and must be reconstructed exactly for decryption.

## Apps Script delivery bridge

The Worker exposes `POST /v1/relay-sessions/enroll` and `POST /v1/relay-sessions/renew`. Both validate the supplied Apps Script session through the signed `validate_session` boundary before changing D1. Renewal also requires the current bearer relay token and matching device. Relay tokens last seven days; successful rotation keeps the prior token valid for ten minutes.

Accepted clock events are delivered by the five-minute Cron Trigger, never inline with phone acceptance. Each run fairly selects at most 25 due lane heads, processes no more than five independent lanes concurrently, and uses conditional two-minute leases. Delivery is strictly contiguous per cleaner/device. Missing sequences block the lane and are never skipped automatically.

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
