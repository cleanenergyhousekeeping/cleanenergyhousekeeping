import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { issueCredential, revokeCredential, resolveCleaner, validateTestTarget } from '../scripts/siri-credentials.mjs';

/* begin[siri_operator_tests] */
const key = Buffer.alloc(32, 17).toString('base64url');
const secrets = { CEH_RELAY_ENVIRONMENT: 'test', CEH_RELAY_APPS_URL: 'https://script.google.com/macros/s/synthetic/exec',
  CEH_RELAY_APPS_ACTIVE_KEY_ID: 'test-v1', CEH_RELAY_APPS_HMAC_KEYS_JSON: JSON.stringify({ 'test-v1': key }), CEH_RELAY_TOKEN_HMAC_KEY: key };
const subject = 'cehusr_v1_' + 'A'.repeat(43);
const reply = data => new Response(JSON.stringify({ ok: true, operation: 'resolve_siri_cleaner', result: 'resolved', retryable: false, data }));

describe('TEST Siri credential operator', () => {
  it('verifies the human cleaner through a fresh signed TEST envelope before storing only the hash', async () => {
    const sql = [];
    const fetchImpl = async (_url, options) => {
      const envelope = JSON.parse(options.body);
      const body = Buffer.from(envelope.signedBody, 'base64url');
      expect(createHmac('sha256', Buffer.from(key, 'base64url')).update(body).digest('base64url')).toBe(envelope.signature);
      expect(JSON.parse(body)).toMatchObject({ environment: 'test', audience: 'ceh-relay:test:apps-script',
        operation: 'resolve_siri_cleaner', payload: { cleanerName: 'Cleaner One' } });
      return reply({ cleanerName: 'Cleaner One', cleanerSubject: subject });
    };
    let stored;
    const query = async statement => {
      sql.push(statement);
      if (statement.startsWith('INSERT')) {
        const parts = /VALUES \('([^']+)', '([^']+)', '([^']+)', (\d+), (\d+)\)/u.exec(statement);
        stored = { credential_id: parts[1], token_hash: parts[2], cleaner_subject: parts[3], expires_at_ms: Number(parts[5]), revoked_at_ms: null };
        return [];
      }
      return [stored];
    };
    const result = await issueCredential('Cleaner One', secrets, query, fetchImpl, 1000);
    expect(result.token).toMatch(/^siri_[A-Za-z0-9_-]{43}$/u);
    expect(sql.join('\n')).not.toContain(result.token);
    expect(stored.token_hash).toBe(createHmac('sha256', Buffer.from(key, 'base64url')).update(`ceh-siri-token\nv1\ntest\n${result.token}`).digest('base64url'));
    expect(stored.expires_at_ms).toBe(1000 + 90 * 86400000);
  });

  it('rejects production config and invalid/ambiguous cleaner responses before any D1 write', async () => {
    expect(() => validateTestTarget({ name: 'ceh-relay-production' })).toThrow();
    await expect(resolveCleaner('Cleaner One', { ...secrets, CEH_RELAY_ENVIRONMENT: 'production' })).rejects.toThrow();
    let writes = 0;
    await expect(issueCredential('Cleaner One', secrets, async () => { writes++; }, async () => reply({ cleanerName: 'Other', cleanerSubject: subject }))).rejects.toThrow();
    expect(writes).toBe(0);
  });

  it('revocation uses a validated credential ID and verifies the stored result', async () => {
    const id = 'siri_credential_' + 'a'.repeat(32);
    const sql = [];
    await revokeCredential(id, async statement => { sql.push(statement); return statement.startsWith('SELECT') ? [{ credential_id: id, revoked_at_ms: 1000 }] : []; }, 1000);
    expect(sql[0]).toContain('COALESCE(revoked_at_ms, 1000)');
    await expect(revokeCredential("anything' OR 1=1", async () => { throw new Error('must not query'); })).rejects.toThrow('Credential ID required');
  });
});
/* end[siri_operator_tests] */
