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

AES-GCM additional authenticated data binds each ciphertext to its intended TEST record and purpose. Use `ceh-relay:test:event:<eventId>` for events and `ceh-relay:test:state:<cleanerSubject>` for state snapshots. This context is not secret, is not stored with the ciphertext, and must be reconstructed exactly for decryption.

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
