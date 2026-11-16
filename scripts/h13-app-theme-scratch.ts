// TASK-PROTO-H13 — own-scratch measurement + behaviour proof.
//
// WHY this script: the three STRUCTURE_SQL constants and the app_settings
// behaviour (row scope, single-row invariant, audit append) can only be measured
// on a real PostgreSQL 18 catalog — and the owner's shared showcase
// (127.0.0.1:55432 / b17-showcase) must never be touched.
//
// Own throwaway container only (created by the caller), one fresh named database,
// generated credentials, ambient DSN/.env values refused, container removed at
// the end. It proves, on that scratch:
//   1. the three new constants (after schema.sql, after b17.sql, after content);
//   2. app_settings: open SELECT, purpose-gated INSERT/UPDATE, single-row CHECK,
//      and the APP_THEME_UPDATED audit row;
//   3. falsifiability — reversing BOTH H13 content hunks (drop the table +
//      restore the original audit list) returns the PREVIOUS content md5
//      (cf79a6a3827ab6037a28f629e4cbdb17), and restoring the previous content
//      source hashes back to the previous checksum.
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { getPool, runMigrations, setTenantContext } from '../src/db/index.ts';
import { STRUCTURE_SQL, b17Source, b17ContentSource, assertB17ContentAuthority } from '../src/db/b17Readiness.ts';

// Content md5 pinned at HEAD (before TASK-PROTO-H13 changed the audit list).
const HEAD_CONTENT_SHAPE = 'cf79a6a3827ab6037a28f629e4cbdb17';
const ACTOR = '99999999-9999-4999-8999-999999999999';
const PROGRESS = process.env.H13_PROGRESS_LOG ?? '';
// Hard stop: a stalled scratch proof must never hang the caller.
setTimeout(() => { console.error('WATCHDOG: scratch proof stalled'); process.exit(9); }, 150000).unref();

const args = process.argv.slice(2);
// The owner's .env lives in this directory and must not be moved or deleted. It
// is safe to leave in place because NOTHING on this script's path calls
// dotenv.config(); the flag only bypasses the file-existence rail — ambient DSNs
// are still refused unconditionally.
if (!args.includes('--allow-disposable-b17') || process.env.DATABASE_URL
  || process.env.JWT_SECRET
  || Object.keys(process.env).some(k => /^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE)/.test(k))
  || (existsSync('.env') && !args.includes('--own-scratch-ignore-env-file')))
  throw new Error('Explicit isolated opt-in required; ambient config refused');
const one = (key: string) => {
  const values = args.filter(a => a.startsWith(`--${key}=`));
  if (values.length !== 1) throw new Error(`One explicit ${key} required`);
  return new URL(values[0].slice(key.length + 3));
};
const url = one('database-url'), oracleUrl = one('oracle-url');
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
  || !/^\/h13_scratch_\d+$/.test(url.pathname) || !url.port || url.search || url.hash
  || url.username !== 'h13owner') throw new Error('Only own named loopback scratch accepted');
if (oracleUrl.host !== url.host || oracleUrl.pathname !== url.pathname || oracleUrl.username !== 'postgres')
  throw new Error('Oracle must be exact same scratch');
process.env.DATABASE_URL = url.toString();
process.env.JWT_SECRET = randomBytes(48).toString('hex');

const pool = getPool();
const oracle = new pg.Client({ connectionString: oracleUrl.toString() });
const log = (message: string) => {
  console.log(message);
  if (PROGRESS) appendFileSync(PROGRESS, `${message}\n`);
};
const pass = (label: string) => log(`PASS ${label}`);
// NOTE: measured on the SAME connection that just applied the phase (exactly what
// the offline harness does). A second pooled connection while an uncommitted DDL
// transaction is open is not needed and was observed to stall.
const shapeOn = async (client: pg.PoolClient | pg.Pool) =>
  (await client.query(STRUCTURE_SQL)).rows[0].checksum as string;
const shape = async () => shapeOn(pool);
const FILE = 'src/db/b17-content.sql';
// The comment half of the audit hunk; the action string is the other half.
const H13_POLICY_COMMENT = '      -- TASK-PROTO-H13: the platform-wide app theme is a NULL-target platform\n'
  + '      -- configuration write; without this action its append-only audit row is\n'
  + '      -- refused by row security, which would roll the theme save back with it.\n';
// Mirror b17ContentSource(): function bodies are stored verbatim in pg_proc, so the
// harness folds CRLF to LF before executing — an un-normalized read measures a
// different catalogue and a different constant (found the hard way).
const contentSql = () => readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
// The H13 storage block exactly as schema.sql defines it (table + 3 policies).
const appSettingsDdl = () => {
  const schema = readFileSync('src/db/schema.sql', 'utf8');
  const at = schema.indexOf('-- TASK-PROTO-H13');
  // The block is bounded by the next schema banner (D-H01-01), so this slice
  // carries the table + its three policies and nothing else.
  const end = schema.indexOf('-- D-H01-01 (TASK-PROTO-H12)');
  assert.ok(at > 0 && end > at, 'H13 schema block bounded');
  return schema.slice(at, end).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
};

/** The b17_audit_insert statement exactly as H13 leaves it, plus the pre-H13
 * version (H13's ONLY other content hunk reversed) — both re-derived from the
 * landed file so the reversal cannot drift from the forward edit. */
function auditPolicyStatements(): { current: string; original: string } {
  const sql = contentSql();
  const start = sql.lastIndexOf('CREATE POLICY b17_audit_insert');
  // The statement's comments contain semicolons, so scan to the first ';' that
  // sits at parenthesis depth 0 instead of the first ';' per se.
  let depth = 0, end = start;
  for (; end < sql.length; end++) {
    const ch = sql[end];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) { end++; break; }
  }
  const current = sql.slice(start, end);
  assert.match(current, /b17_work_tenant\(client_id\)\)\);$/, 'whole policy statement extracted');
  assert.match(current, /'APP_THEME_UPDATED'/, 'H13 audit hunk present');
  const original = current.replace(H13_POLICY_COMMENT, '').replace(",'APP_THEME_UPDATED'", '');
  assert.doesNotMatch(original, /APP_THEME_UPDATED/, 'reversal removes only the H13 action');
  return { current, original };
}

/** One app-role transaction with an explicit purpose (the same GUC contract
 * setTenantContext gives the real handlers). */
async function asApp<T>(purpose: string | null, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const platform = purpose === 'platform.config';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, { purpose: purpose ?? undefined, role: platform ? 'ge_admin' : undefined,
      userId: platform ? ACTOR : undefined, mode: platform ? 'platform' : undefined });
    const out = await operation(client);
    await client.query('COMMIT');
    return out;
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
const sqlstate = (err: any) => err?.code as string | undefined;
const insertAudit = (client: pg.PoolClient, theme: string) => client.query(
  `INSERT INTO audit_log (client_id,user_id,action,entity_type,entity_id,payload)
   VALUES (NULL,$1,'APP_THEME_UPDATED','app_settings',NULL,$2)`,
  [ACTOR, JSON.stringify({ theme })]);

try {
  log('STEP connect');
  await oracle.connect();
  assert.equal(Math.floor(Number((await oracle.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.deepEqual((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],
    { rolsuper: false, rolbypassrls: false });
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);

  // ---- 1. the three constants ------------------------------------------------
  log('STEP schema');
  assert.equal((await runMigrations()).success, true);
  log('STEP shape0');
  const predecessor = await shape();
  log('STEP b17');
  const migration = await pool.connect();
  try {
    await migration.query('BEGIN');
    await migration.query('SELECT pg_advisory_xact_lock(1717001)');
    await migration.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
    await migration.query(b17Source().sql);
    log('STEP u1-shape');
    const u1 = await shapeOn(migration);
    await migration.query("SELECT set_config('app.current_purpose','migration',true)");
    await migration.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
      ['B17_U1', b17Source().checksum, u1]);
    await migration.query('COMMIT');
    log('STEP content');
    const content = await pool.connect();
    try {
      await content.query('BEGIN');
      await content.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
      log('STEP content-sql');
      await content.query(contentSql());
      log('STEP content-shape');
      const u2d = await shapeOn(content);
      await content.query("SELECT set_config('app.current_purpose','migration',true)");
      await content.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
        ['B17_U2D', b17ContentSource().checksum, u2d]);
      await content.query('COMMIT');
      log(`PREDECESSOR_SHAPE=${predecessor}`);
      log(`B17_SHAPE=${u1}`);
      log(`B17_CONTENT_SHAPE=${u2d}`);
      assert.notEqual(predecessor, u1);
      assert.notEqual(u1, u2d);
      pass('OWN empty PG18; NOSUPERUSER/NOBYPASSRLS; three structure constants measured');
      const authz = await pool.connect();
      try { await assertB17ContentAuthority(authz); } finally { authz.release(); }
      pass('sanctioned definer surface unchanged (no new definer from H13)');

      // ---- 2. app_settings behaviour ----------------------------------------
      log('STEP behaviour');
      assert.equal((await asApp(null, c => c.query('SELECT count(*)::int n FROM app_settings'))).rows[0].n, 0,
        'open SELECT works before any identity and the table starts empty (= auto)');
      await assert.rejects(() => asApp(null, c => c.query("INSERT INTO app_settings(id,theme) VALUES(1,'dark')")),
        (err: any) => sqlstate(err) === '42501', 'INSERT outside platform.config is refused by RLS');
      await assert.rejects(() => asApp('work', c => c.query("INSERT INTO app_settings(id,theme) VALUES(1,'dark')")),
        (err: any) => sqlstate(err) === '42501', 'work purpose cannot write the global theme');
      const dark = await asApp('platform.config', async c => {
        await c.query("INSERT INTO app_settings(id,theme) VALUES(1,'dark')");
        await insertAudit(c, 'dark');
        return c.query('SELECT theme FROM app_settings WHERE id=1');
      });
      assert.equal(dark.rows[0].theme, 'dark');
      await assert.rejects(() => asApp('platform.config', c => c.query("INSERT INTO app_settings(id,theme) VALUES(2,'lime')")),
        (err: any) => sqlstate(err) === '23514', 'single-row invariant: id=2 rejected by CHECK');
      const auto = await asApp('platform.config', async c => {
        await c.query('UPDATE app_settings SET theme=NULL WHERE id=1');
        await insertAudit(c, 'auto');
        return c.query('SELECT theme FROM app_settings WHERE id=1');
      });
      assert.equal(auto.rows[0].theme, null);
      const audit = (await oracle.query(`SELECT action,client_id,payload FROM audit_log
        WHERE action='APP_THEME_UPDATED' ORDER BY created_at`)).rows;
      assert.equal(audit.length, 2, 'both writes audited in the same transaction');
      assert.deepEqual(audit[0].payload, { theme: 'dark' });
      assert.deepEqual(audit[1].payload, { theme: 'auto' });
      assert.equal(audit[0].client_id, null);
      pass('app_settings: open SELECT, purpose-gated INSERT/UPDATE, id=1 CHECK, APP_THEME_UPDATED audit');

      // ---- 3. falsifiability, both directions --------------------------------
      log('STEP falsify-source');
      const current = contentSql();
      const headContent = execFileSync('git', ['show', 'HEAD:src/db/b17-content.sql'], { encoding: 'utf8' })
        .replace(/\r\n/g, '\n');
      // The H13 tail block (app_settings policies) starts at this banner.
      const tail = current.lastIndexOf('\n-- ===========================================================================\n-- TASK-PROTO-H13');
      assert.ok(tail > 0, 'H13 app_settings policy banner found');
      const reconstructed = current.slice(0, tail + 1)
        .replace(H13_POLICY_COMMENT, '').replace(",'APP_THEME_UPDATED'", '');
      assert.equal(reconstructed.trimEnd(), headContent.trimEnd(),
        'stripping exactly the two H13 hunks reconstructs the previous content source byte-for-byte');
      // The previous ledger checksum is the HEAD source's own sha256 (CRLF-folded,
      // exactly as b17ContentSource() computes it). The reconstruction equality
      // above is asserted on trimmed text, so the trailing-newline difference
      // between a spliced string and the stored file cannot fake the match.
      const previousChecksum = createHash('sha256').update(headContent).digest('hex');
      assert.equal(createHash('sha256').update(reconstructed.trimEnd()).digest('hex'),
        createHash('sha256').update(headContent.trimEnd()).digest('hex'),
        'restoring the previous content source returns the previous checksum');
      assert.notEqual(b17ContentSource().checksum, previousChecksum,
        'the current content checksum moved with the audit hunk');
      log(`PREVIOUS_CONTENT_CHECKSUM=${previousChecksum}`);
      log(`CURRENT_CONTENT_CHECKSUM=${b17ContentSource().checksum}`);
      pass('falsifiability (source): previous content source reconstructed byte-for-byte -> previous checksum');

      // Table + audit hunk reversed on the SAME forward database: the previous
      // content md5 must come back; re-applying both must return the new one.
      log('STEP falsify-md5');
      const { current: auditCurrent, original: auditOriginal } = auditPolicyStatements();
      // Re-derive the ORIGINAL policy text from the reconstructed source, so the
      // reversal is the previous source's own statement, not a hand edit.
      const fromReconstructed = reconstructed.slice(reconstructed.lastIndexOf('CREATE POLICY b17_audit_insert'));
      assert.ok(fromReconstructed.startsWith(auditOriginal),
        'the reversal statement is the previous source\'s own audit policy text');
      // Reverse/restore as the APP role: information_schema.columns only lists
      // tables the querying role can see, so a superuser-created table would be
      // invisible to the fingerprint and fake a different md5.
      const appQuery = async (sql: string) => {
        const client = await pool.connect();
        try { return await client.query(sql); } finally { client.release(); }
      };
      await appQuery('DROP TABLE app_settings');
      await appQuery('DROP POLICY b17_audit_insert ON audit_log');
      await appQuery(auditOriginal);
      const reversed = await shape();
      assert.equal(reversed, HEAD_CONTENT_SHAPE,
        'table absent + previous audit list -> the previous content md5 returns');
      pass(`falsifiability (md5): DROP TABLE app_settings + previous audit list -> ${HEAD_CONTENT_SHAPE} returned`);
      await appQuery(appSettingsDdl());
      await appQuery('DROP POLICY b17_audit_insert ON audit_log');
      await appQuery(auditCurrent);
      const reapplied = await shape();
      assert.equal(reapplied, u2d, 're-applying both H13 hunks returns the forward-install md5');
      assert.notEqual(reapplied, reversed, 'each hunk is fingerprinted');
      pass(`falsifiability (forward): both hunks re-applied -> ${u2d} returned`);

      // ---- 4. SHIELD-H13-02 ownership defense (round 2) ---------------------
      // A table created by another role is invisible to the runtime role in
      // information_schema.columns, so readiness must name it instead of letting
      // it surface as a column-blind schema_drift. The reverse (restore owner)
      // must return the same md5: ownership is NOT part of the fingerprint.
      log('STEP ownership');
      const { verifyB17 } = await import('../src/db/b17Readiness.ts');
      const verifyOn = async () => {
        const client = await pool.connect();
        try { await verifyB17(client); return 'green'; }
        catch (err: any) { return String(err?.message ?? err); }
        finally { client.release(); }
      };
      assert.equal(await verifyOn(), 'green', 'readiness green on the forward install (constants do not move)');
      // No-op proof: with the table absent the ownership check must not fire.
      await appQuery('DROP TABLE app_settings');
      assert.equal(await verifyOn(), 'b17.schema_drift',
        'table absent -> ownership check is a no-op (the failure stays a schema_drift)');
      await appQuery(appSettingsDdl());
      assert.equal(await verifyOn(), 'green', 'table restored -> readiness green again');
      // Drift proof: owned by another role -> the distinct error, raised BEFORE
      // the structure comparison. The fingerprint the runtime role would compute
      // in that state is column-blind (app_settings columns are not visible to it,
      // information_schema.columns filters by privilege) — exactly the misleading
      // b17.schema_drift the check replaces. Restoring the owner returns the
      // constant, which is the proof that ownership itself is not fingerprinted.
      await oracle.query('ALTER TABLE app_settings OWNER TO postgres');
      assert.equal(await verifyOn(), 'b17.ownership_drift',
        'a foreign-owned app_settings is named as b17.ownership_drift');
      assert.notEqual(await shape(), u2d,
        'foreign ownership makes the runtime fingerprint column-blind (the trap the check names)');
      await oracle.query('ALTER TABLE app_settings OWNER TO h13owner');
      assert.equal(await verifyOn(), 'green', 'restoring the runtime owner clears the refusal');
      assert.equal(await shape(), u2d, 'restoring the runtime owner returns the constant unchanged');
      pass('SHIELD-H13-02: ownership_drift named, no-op when absent, constant unchanged after restore');
      log('H13 scratch proof complete on OWN throwaway PG18. NOT release acceptance.');
    } finally { content.release(); }
  } finally { migration.release(); }
} finally {
  await oracle.end().catch(() => {});
  await pool.end();
  log('STEP done');
}
