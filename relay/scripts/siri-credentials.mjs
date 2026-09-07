#!/usr/bin/env node
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/* begin[siri_test_credential_operator] */
const RELAY_DIR = fileURLToPath(new URL('../', import.meta.url));
const TEST_DATABASE_ID = '8804b3a1-8af0-413d-a0c3-37830e0988a0';
const LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

function decodeKey(value) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value ?? '')) throw new Error('Invalid TEST key');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new Error('Invalid TEST key');
  return bytes;
}

export function validateTestTarget(config) {
  if (config.name !== 'ceh-relay-test' || config.vars?.CEH_RELAY_ENVIRONMENT !== 'test' ||
      config.d1_databases?.length !== 1 || config.d1_databases[0].database_id !== TEST_DATABASE_ID ||
      config.d1_databases[0].database_name !== 'ceh-relay-test-db') throw new Error('TEST D1 binding required');
}

export async function resolveCleaner(cleanerName, secrets, fetchImpl = fetch) {
  if (secrets.CEH_RELAY_ENVIRONMENT !== 'test' || !cleanerName || cleanerName.length > 500) throw new Error('TEST cleaner required');
  const url = new URL(secrets.CEH_RELAY_APPS_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/u.test(url.pathname) || url.search || url.hash) throw new Error('Apps exec URL required');
  const keyId = secrets.CEH_RELAY_APPS_ACTIVE_KEY_ID;
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(keyId ?? '')) throw new Error('TEST signing key required');
  const key = decodeKey(JSON.parse(secrets.CEH_RELAY_APPS_HMAC_KEYS_JSON)[keyId]);
  const signed = Buffer.from(JSON.stringify({ version: 1, keyId, environment: 'test',
    audience: 'ceh-relay:test:apps-script', operation: 'resolve_siri_cleaner', timestampMs: Date.now(),
    nonce: randomBytes(24).toString('base64url'), payload: { cleanerName } }));
  const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'relayWorkerRequest', keyId, signedBody: signed.toString('base64url'),
      signature: createHmac('sha256', key).update(signed).digest('base64url') }), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error('TEST cleaner verification failed');
  const result = await response.json();
  if (!result.ok || result.operation !== 'resolve_siri_cleaner' || result.result !== 'resolved' || result.retryable !== false ||
      result.data?.cleanerName !== cleanerName || !/^cehusr_v1_[A-Za-z0-9_-]{43}$/u.test(result.data?.cleanerSubject ?? '')) {
    throw new Error('Cleaner missing, ambiguous, inactive, or TEST verification failed');
  }
  return result.data.cleanerSubject;
}

export async function issueCredential(cleanerName, secrets, query, fetchImpl = fetch, nowMs = Date.now(), onId = () => {}) {
  // Verify the human identity over the signed TEST boundary before storing anything.
  const subject = await resolveCleaner(cleanerName, secrets, fetchImpl);
  const key = decodeKey(secrets.CEH_RELAY_TOKEN_HMAC_KEY);
  const token = 'siri_' + randomBytes(32).toString('base64url');
  const id = 'siri_credential_' + randomBytes(16).toString('hex');
  const hash = createHmac('sha256', key).update(`ceh-siri-token\nv1\ntest\n${token}`).digest('base64url');
  const expires = nowMs + LIFETIME_MS;
  onId(id);
  await query(`INSERT INTO siri_credentials (credential_id, token_hash, cleaner_subject, issued_at_ms, expires_at_ms)
    VALUES ('${id}', '${hash}', '${subject}', ${nowMs}, ${expires})`);
  const rows = await query(`SELECT credential_id, token_hash, cleaner_subject, expires_at_ms, revoked_at_ms
    FROM siri_credentials WHERE credential_id = '${id}'`);
  if (rows.length !== 1 || rows[0].token_hash !== hash || rows[0].cleaner_subject !== subject ||
      rows[0].expires_at_ms !== expires || rows[0].revoked_at_ms !== null) throw new Error('Credential verification failed; revoke the issued ID before retrying');
  return { credential_id: id, cleaner: cleanerName, expires_at: new Date(expires).toISOString(), token };
}

export async function revokeCredential(id, query, nowMs = Date.now()) {
  if (!/^siri_credential_[0-9a-f]{32}$/u.test(id ?? '')) throw new Error('Credential ID required');
  await query(`UPDATE siri_credentials SET revoked_at_ms = COALESCE(revoked_at_ms, ${nowMs}) WHERE credential_id = '${id}'`);
  const rows = await query(`SELECT credential_id, revoked_at_ms FROM siri_credentials WHERE credential_id = '${id}'`);
  if (rows.length !== 1 || rows[0].revoked_at_ms === null) throw new Error('Revocation not verified');
}

function queryTestD1(sql) {
  validateTestTarget(JSON.parse(readFileSync(resolve(RELAY_DIR, 'wrangler.jsonc'), 'utf8')));
  const result = execFileSync(resolve(RELAY_DIR, 'node_modules/.bin/wrangler'), ['d1', 'execute', 'ceh-relay-test-db',
    '--remote', '--env', '', '--config', resolve(RELAY_DIR, 'wrangler.jsonc'), '--command', sql, '--json'],
  { cwd: RELAY_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  const parsed = JSON.parse(result);
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0].success !== true) throw new Error('TEST D1 query failed');
  return parsed[0].results;
}

async function main() {
  const [command, value, extra] = process.argv.slice(2);
  if (extra || !['issue', 'revoke'].includes(command) || !value) throw new Error('Usage: siri-credentials.mjs issue "Exact Cleaner Name" | revoke CREDENTIAL_ID');
  validateTestTarget(JSON.parse(readFileSync(resolve(RELAY_DIR, 'wrangler.jsonc'), 'utf8')));
  if (command === 'revoke') {
    await revokeCredential(value, queryTestD1);
    process.stdout.write('TEST Siri credential revoked.\n');
    return;
  }
  // Never emit a usable credential into a redirected file or agent-captured pipe.
  if (!process.stdout.isTTY) throw new Error('Issue credentials only in a private interactive terminal');
  const result = await issueCredential(value, process.env, queryTestD1, fetch, Date.now(),
    id => process.stdout.write(`Credential ID: ${id} (revoke this ID if issuance is interrupted)\n`));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('Siri credential operation failed. No secret diagnostics emitted; verify TEST configuration and any printed credential ID.\n'); process.exitCode = 1; });
}
/* end[siri_test_credential_operator] */
