// B17 U2-B round-2 diagnostic: is the F-03 fresh gate (assertPasswordFresh,
// src/server/routes/_shared.ts) able to read its own users row under the U1
// FORCE-RLS purpose set AFTER a business route is activated?
// node --import tsx scripts/b17-freshgate-proof.ts --allow-disposable-b17 --database-url=<loopback named b17_*scratch* DB>
// Guards identical to b17-domain-proof.ts: opt-in, loopback named scratch, no ambient .env.
// NON-DESTRUCTIVE: seeds one fixture user, applies the offline deltas, rolls every
// probe back in its own transaction; never deletes a business row.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { getPool, withTenantContext } from '../src/db/index.ts';
import { applyB17Offline } from '../src/db/b17Readiness.ts';
import { hashPassword } from '../src/server/auth.ts';

function guardedUrl(args: string[]): string {
  if (!args.includes('--allow-disposable-b17')) throw new Error('Explicit disposable B17 opt-in required.');
  const urls = args.filter(arg => arg.startsWith('--database-url='));
  if (urls.length !== 1) throw new Error('One explicit scratch database URL required; ambient URL is ignored.');
  const url = new URL(urls[0].slice('--database-url='.length));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/b17_[a-z0-9_]*scratch[a-z0-9_]*$/.test(url.pathname) || url.search || url.hash
    || !url.username || url.username === 'postgres') throw new Error('Only named disposable loopback B17 owner database accepted.');
  return url.toString();
}
process.env.DATABASE_URL = guardedUrl(process.argv.slice(2));
process.env.JWT_SECRET = randomBytes(48).toString('hex');

async function main() {
  const pool = getPool();
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
  assert.equal((await (await import('../src/db/index.ts')).runMigrations()).success, true);
  const password = `Aa1!${randomBytes(16).toString('hex')}`;
  const userId = await withTenantContext({ role: 'ge_admin' }, async c => (await c.query(
    `INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'FreshGate','ge_admin') RETURNING id`,
    [`freshgate@b17u2b.invalid`, await hashPassword(password)])).rows[0].id as string);
  const client = await pool.connect();
  try { assert.equal(await applyB17Offline(client), 'applied'); } finally { client.release(); }

  const rows = async (purpose: string | null, label: string) => {
    const result = await withTenantContext({ purpose, userId, role: 'ge_admin' },
      async c => c.query('SELECT must_change_password FROM users WHERE id = $1', [userId]));
    console.log(`PROBE purpose=${String(purpose)} (${label}) -> rows=${result.rows.length}`);
    return result.rows.length;
  };
  const asNull = await rows(null, 'requireFreshPassword/contextFromUser today');
  const asWork = await rows('work', 'readContext after the purpose fix');
  const asSession = await rows('auth.session', 'withSession identity load');

  // Expected shape of the F-03 gate: assertPasswordFresh throws 401 auth.invalid
  // when the row is not visible (!r.rows[0]).
  const freshGateVisible = asNull > 0;
  console.log(`RESULT fresh_gate_visible_under_contextFromUser=${freshGateVisible}`);
  console.log(`RESULT fresh_gate_visible_under_work=${asWork > 0} session=${asSession > 0}`);
  assert.ok(asSession > 0, 'withSession must see the actor row');
  console.log('B17 fresh-gate probe complete (diagnostic, no release acceptance).');
}
main().catch(err => { console.error('fresh-gate probe FAILED:', err instanceof Error ? err.message : 'unknown'); process.exitCode = 1; })
  .finally(async () => { await getPool().end(); });
