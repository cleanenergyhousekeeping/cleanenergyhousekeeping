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

## Validation

```bash
npm run typecheck
npm test
npm run deploy:dry-run
```

Deployment is intentionally separate from validation and requires explicit approval.
