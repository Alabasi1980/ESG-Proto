// TASK-PROTO-U4-1c round 2 — own-throwaway PG18 measurement + fix proofs.
//
// Oracle = git HEAD (0d45445, round 1): its three constants and content sha must
// reproduce on a fresh scratch; every round-2 delta must be reversible back to
// them. Fix-specific proofs: H-01 (FK RESTRICT, destructive delete refused with
// every row intact), M-01 (slug-collision-proof bucket codes), F-03 (P@T reads
// really serve the explicit target), F-05 (cross-client isolation), F-04 (the
// status lock is handler-owned; RLS is row scope only).
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { getPool, runMigrations, setTenantContext } from '../src/db/index.ts';
import { STRUCTURE_SQL, b17Source, b17ContentSource } from '../src/db/b17Readiness.ts';
import { ensureGeneralBucket, generalStandardCode } from '../src/lib/generalBucket.ts';

const OLD_PRE = 'c320ef6ff50675206ac4c8edf762db3b';
const OLD_B17 = '3adef0179b7703b6d8e20750fbe67e8a';
const OLD_CONTENT = '9e06e001dabaa6df41c84b572dfcd494';
const OLD_CONTENT_SHA = 'd96d6bc243dc5b14beb002cceccbbeade2b8e51dcb09c128411d1f010ac41f93';
const A = '11111111-1111-4111-8111-111111111111';
const B = '12121212-1212-4212-8212-121212121212';
const D1 = '21111111-1111-4111-8111-111111111111';
const S = '31111111-1111-4111-8111-111111111111';
const S2 = '32222222-2222-4222-8222-222222222222';
const STANDARD = '41111111-1111-4111-8111-111111111111';
const DISCLOSURE = '51111111-1111-4111-8111-111111111111';
const ITEM = '61111111-1111-4111-8111-111111111111';
const ACTOR = '71111111-1111-4111-8111-111111111111';
const CACTOR = '73333333-3333-4333-8333-333333333333';
const WACTOR = '74444444-4444-4444-8444-444444444444';
const PACTOR = '75555555-5555-4555-8555-555555555555';
const SESSION = '81111111-1111-4111-8111-111111111111';
const INITIATIVE = '91111111-1111-4111-8111-111111111111';
const CI = 'a1111111-1111-4111-8111-111111111111';
const REQ_A = 'b1111111-1111-4111-8111-111111111111';
const REQ_A2 = 'b2222222-2222-4222-8222-222222222222';
const REQ_B = 'b3333333-3333-4333-8333-333333333333';
setTimeout(() => { console.error('WATCHDOG'); process.exit(9); }, 300000).unref();

const args = process.argv.slice(2);
if (!args.includes('--allow-disposable-b17') || process.env.DATABASE_URL || process.env.JWT_SECRET
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
  || !/^\/u41c_scratch_\d+$/.test(url.pathname) || !url.port || url.search || url.hash
  || url.username !== 'u41cowner') throw new Error('Only own named loopback scratch accepted');
if (oracleUrl.host !== url.host || oracleUrl.pathname !== url.pathname || oracleUrl.username !== 'postgres')
  throw new Error('Oracle must be exact same scratch');
process.env.DATABASE_URL = url.toString();
process.env.JWT_SECRET = randomBytes(48).toString('hex');

const pool = getPool();
const oracle = new pg.Client({ connectionString: oracleUrl.toString() });
const log = (m: string) => console.log(m);
const pass = (m: string) => console.log(`PASS ${m}`);
const shape = async (c: pg.PoolClient | pg.Client) => (await c.query(STRUCTURE_SQL)).rows[0].checksum as string;
const asCtx = async <T>(ctx: Record<string, string | null>, op: (c: pg.PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await setTenantContext(client, ctx); return await op(client); }
  finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
};
const commitCtx = async <T>(ctx: Record<string, string | null>, op: (c: pg.PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await setTenantContext(client, ctx);
    const result = await op(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
};
const refused = async (label: string, fn: () => Promise<unknown>) => {
  await assert.rejects(fn, (e: any) => /row-level security|permission denied|violates foreign key|violates/i
    .test(String(e?.message)), `${label} must be refused`);
  pass(`${label} refused`);
};
const E = { role: 'employee', mode: 'employee', purpose: 'work', tenantId: A, userId: ACTOR,
  sessionId: SESSION, departmentId: D1, tabId: null, targetId: null };
const C = { role: 'client_admin', mode: 'client', purpose: 'work', tenantId: A, userId: CACTOR,
  sessionId: SESSION, departmentId: null, tabId: null, targetId: null };
const W = { role: 'ge_admin', mode: 'consultant', purpose: 'work', tenantId: A, userId: WACTOR,
  sessionId: SESSION, departmentId: null, tabId: SESSION, targetId: null };
const PT = (tenant: string) => ({ role: 'ge_admin', mode: 'platform', purpose: 'platform.config',
  tenantId: tenant, userId: PACTOR, sessionId: SESSION, departmentId: null, tabId: SESSION, targetId: tenant });
const PCAT = { role: 'ge_admin', mode: 'platform', purpose: 'platform.config', tenantId: null, userId: PACTOR,
  sessionId: SESSION, departmentId: null, tabId: SESSION, targetId: null };

let owner: pg.PoolClient | undefined;
try {
  await oracle.connect();
  await oracle.query("SET lock_timeout='20s'");
  assert.equal(Math.floor(Number((await oracle.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.deepEqual((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],
    { rolsuper: false, rolbypassrls: false });
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);

  const headSchema = execFileSync('git', ['show', '0d45445:src/db/schema.sql'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const headContent = execFileSync('git', ['show', '0d45445:src/db/b17-content.sql'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n');
  const newContent = b17ContentSource().sql;
  const newSchema = readFileSync('src/db/schema.sql', 'utf8');
  const section = newSchema.slice(newSchema.indexOf('-- U4-1c-A.'));
  const statementAt = (sql: string, marker: string) => {
    const start = sql.indexOf(marker);
    if (start < 0) throw new Error(`missing ${marker}`);
    const rest = sql.slice(start);
    const next = rest.slice(marker.length).search(/\r?\n\s*(?:CREATE|DROP) POLICY /);
    const region = next < 0 ? rest : rest.slice(0, marker.length + next);
    return region.slice(0, region.lastIndexOf(';') + 1);
  };
  assert.ok(section.length > 2000);

  // Round-2 schema delta and its exact inverse (the falsifiability oracle).
  const ROUND2 = [
    "ALTER TABLE document_submissions DROP CONSTRAINT document_submissions_requirement_id_fkey",
    'ALTER TABLE document_submissions ADD CONSTRAINT document_submissions_requirement_id_fkey'
      + ' FOREIGN KEY (requirement_id) REFERENCES document_requirements(id) ON DELETE RESTRICT',
    'ALTER TABLE document_requirements ADD COLUMN client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE',
    'ALTER TABLE document_requirements ADD CONSTRAINT document_requirements_client_service_department_title_key'
      + ' UNIQUE (client_id, service_id, department_id, title)',
    'CREATE UNIQUE INDEX ux_document_requirements_general_title'
      + ' ON document_requirements(client_id, service_id, title) WHERE department_id IS NULL',
  ];
  const UNDO_ROUND2 = [
    'DROP INDEX ux_document_requirements_general_title',
    'ALTER TABLE document_requirements DROP CONSTRAINT document_requirements_client_service_department_title_key',
    'ALTER TABLE document_requirements DROP COLUMN client_id',
    'ALTER TABLE document_submissions DROP CONSTRAINT document_submissions_requirement_id_fkey',
    'ALTER TABLE document_submissions ADD CONSTRAINT document_submissions_requirement_id_fkey'
      + ' FOREIGN KEY (requirement_id) REFERENCES document_requirements(id) ON DELETE CASCADE',
  ];

  const base = async (suffix: string, schema: string, content: string) => {
    const dbName = url.pathname.slice(1) + suffix;
    await oracle.query(`CREATE DATABASE "${dbName}" OWNER u41cowner`);
    const headUrl = new URL(url.toString()); headUrl.pathname = `/${dbName}`;
    const headPool = new pg.Pool({ connectionString: headUrl.toString() });
    try {
      const c = await headPool.connect();
      await c.query('BEGIN'); await c.query(schema); await c.query('COMMIT');
      const pre = await shape(c);
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
      await c.query(b17Source().sql);
      const u1 = await shape(c);
      await c.query("SELECT set_config('app.current_purpose','migration',true)");
      await c.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
        ['B17_U1', b17Source().checksum, u1]);
      await c.query('COMMIT');
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
      await c.query(content);
      const post = await shape(c);
      await c.query('COMMIT');
      c.release();
      return { pre, u1, post, dbName };
    } finally { await headPool.end().catch(() => {}); }
  };

  log('STEP head baseline (round-1 constants reproduce)');
  const head = await base('_head', headSchema, headContent);
  log(`HEAD_PRE=${head.pre} HEAD_B17=${head.u1} HEAD_CONTENT=${head.post}`);
  assert.equal(head.pre, OLD_PRE);
  assert.equal(head.u1, OLD_B17);
  assert.equal(head.post, OLD_CONTENT);
  assert.equal(createHash('sha256').update(headContent).digest('hex'), OLD_CONTENT_SHA);
  pass('round-1 constants + content sha reproduce exactly on this PG18 scratch');

  log('STEP schema + round-2 falsifiability');
  assert.equal((await runMigrations()).success, true);
  const db = await pool.connect(); owner = db;
  const preNew = await shape(db);
  log(`PREDECESSOR_SHAPE=${preNew}`);
  assert.notEqual(preNew, OLD_PRE);
  for (const s of UNDO_ROUND2) await db.query(s);
  assert.equal(await shape(db), OLD_PRE, 'undoing the round-2 schema delta restores the round-1 predecessor md5');
  for (const s of ROUND2) await db.query(s);
  assert.equal(await shape(db), preNew, 're-applying the round-2 delta restores the new predecessor md5');
  pass('schema delta is exactly this round (undo -> round-1 md5, redo -> new md5)');

  log('STEP b17 + falsifiability');
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(1717001)');
  await db.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
  await db.query(b17Source().sql);
  const b17New = await shape(db);
  await db.query("SELECT set_config('app.current_purpose','migration',true)");
  await db.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
    ['B17_U1', b17Source().checksum, b17New]);
  await db.query('COMMIT');
  log(`B17_SHAPE=${b17New}`);
  assert.notEqual(b17New, OLD_B17);
  for (const s of UNDO_ROUND2) await db.query(s);
  assert.equal(await shape(db), OLD_B17, 'undoing the delta restores the round-1 post-U1 md5');
  for (const s of ROUND2) await db.query(s);
  assert.equal(await shape(db), b17New);
  pass('post-U1 constant falsifiable too');

  log('STEP content + falsifiability');
  await db.query('BEGIN');
  await db.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
  await db.query(newContent);
  const contentNew = await shape(db);
  await db.query("SELECT set_config('app.current_purpose','migration',true)");
  await db.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
    ['B17_U2D', b17ContentSource().checksum, contentNew]);
  await db.query('COMMIT');
  log(`CONTENT_SHA256=${b17ContentSource().checksum}`);
  log(`B17_CONTENT_SHAPE=${contentNew}`);
  assert.notEqual(contentNew, b17New);
  const c1 = await base('_c1', newSchema, headContent);
  assert.equal(c1.pre, preNew);
  assert.equal(c1.u1, b17New);
  assert.notEqual(c1.post, OLD_CONTENT, 'the round-2 schema moves the content shape on its own');
  // Round 2 changed exactly seven policies (the client-scoped requirement set and
  // the client-matching submissions set). Reverting those seven to their round-1
  // text must reproduce C1 (the new schema with the round-1 policy file); putting
  // them back must reproduce the final content shape.
  const CHANGED: [string, string][] = [
    ['b17_document_requirements_read', 'document_requirements'],
    ['b17_document_requirements_insert', 'document_requirements'],
    ['b17_document_requirements_update', 'document_requirements'],
    ['b17_document_requirements_delete', 'document_requirements'],
    ['b17_document_submissions_read', 'document_submissions'],
    ['b17_document_submissions_insert', 'document_submissions'],
    ['b17_document_submissions_update', 'document_submissions'],
    // ROUND 3 (G-01): the audit policy gained the target-bound requirement branch.
    ['b17_audit_insert', 'audit_log'],
  ];
  const policyStatement = (sql: string, name: string) => statementAt(sql, `CREATE POLICY ${name} `);
  const swap = async (to: string) => {
    await db.query('BEGIN');
    for (const [name, table] of CHANGED) {
      await db.query(`DROP POLICY IF EXISTS ${name} ON ${table}`);
      await db.query(policyStatement(to, name));
    }
    await db.query('COMMIT');
  };
  await swap(headContent);
  assert.equal(await shape(db), c1.post, 'restoring the predecessor policies restores the schema-only content md5');
  await swap(newContent);
  assert.equal(await shape(db), contentNew, 're-applying the changed policies restores the final content md5');
  pass('content constant falsifiable: policy delta removed -> schema-only md5, re-added -> new md5');

  log('STEP seed (two clients sharing one service)');
  const user = (id: string, clientId: string | null, departmentId: string | null,
    email: string, name: string, role: string) => oracle.query(
    `INSERT INTO users(id,client_id,department_id,email,password_hash,name,role,is_active)
      VALUES($1,$2,$3,$4,'x',$5,$6,true)`, [id, clientId, departmentId, email, name, role]);
  await oracle.query('BEGIN');
  await oracle.query('INSERT INTO clients(id,code,name) VALUES($1,$2,$3)', [A, 'U41C', 'A tenant']);
  await oracle.query('INSERT INTO clients(id,code,name) VALUES($1,$2,$3)', [B, 'U41CB', 'B tenant']);
  await oracle.query('INSERT INTO departments(id,client_id,code,name) VALUES($1,$2,$3,$4)', [D1, A, 'D1', 'Dept One']);
  await user(ACTOR, A, D1, 'e1@u41c.test', 'E One', 'employee');
  await user(CACTOR, A, null, 'c@u41c.test', 'Client Admin', 'client_admin');
  await user(WACTOR, null, null, 'w@u41c.test', 'Consultant', 'ge_admin');
  await user(PACTOR, null, null, 'p@u41c.test', 'Platform', 'ge_admin');
  await oracle.query('INSERT INTO services(id,code,name) VALUES($1,$2,$3)', [S, 'U41CS', 'Service']);
  await oracle.query('INSERT INTO services(id,code,name) VALUES($1,$2,$3)', [S2, 'U41CS/2', 'Service 2']);
  await oracle.query('INSERT INTO standards(id,code,title,category) VALUES($1,$2,$3,$4)',
    [STANDARD, 'U41C-STD', 'Standard', 'GRI']);
  await oracle.query('INSERT INTO disclosures(id,standard_id,code,title) VALUES($1,$2,$3,$4)',
    [DISCLOSURE, STANDARD, 'D-1', 'Disclosure']);
  await oracle.query(`INSERT INTO items(id,disclosure_id,code,requirement,priority,esg_class,indicator_code,tags)
    VALUES($1,$2,$3,$4,'high','general','c (i)','{"water"}')`, [ITEM, DISCLOSURE, 'I-1', 'Requirement']);
  await oracle.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2)', [S, STANDARD]);
  await oracle.query('INSERT INTO client_services(client_id,service_id) VALUES($1,$2)', [A, S]);
  await oracle.query('INSERT INTO client_services(client_id,service_id) VALUES($1,$2)', [B, S]);
  await oracle.query(`INSERT INTO initiatives_library(id,title,sector,esg_class)
    VALUES($1,'Recycling','', 'environmental')`, [INITIATIVE]);
  await oracle.query('INSERT INTO service_initiatives(service_id,initiative_id) VALUES($1,$2)', [S, INITIATIVE]);
  await oracle.query('INSERT INTO client_initiatives(id,client_id,initiative_id) VALUES($1,$2,$3)', [CI, A, INITIATIVE]);
  await oracle.query('COMMIT');

  log('STEP M-01 bucket collision');
  const bA = await commitCtx(PCAT, c => ensureGeneralBucket(c, S));
  const bB = await commitCtx(PCAT, c => ensureGeneralBucket(c, S2));
  log(`bucketA=${bA.standardCode} bucketB=${bB.standardCode}`);
  assert.equal(bA.standardCode, generalStandardCode('U41CS', S));
  assert.notEqual(bA.standardCode, bB.standardCode, 'slug-equivalent codes still get distinct buckets');
  assert.equal((await commitCtx(PCAT, c => ensureGeneralBucket(c, S))).created.mapping, false);
  pass('two services with slug-equivalent codes own distinct buckets; repeat is a no-op');

  log('STEP F-05 requirements are client-scoped (P@T writes)');
  await commitCtx(PT(A), c => c.query(`INSERT INTO document_requirements
    (id,client_id,service_id,department_id,title,tags) VALUES($1,$2,$3,$4,'Policy',ARRAY['hr'])`,
  [REQ_A, A, S, D1]));
  await commitCtx(PT(A), c => c.query(`INSERT INTO document_requirements
    (id,client_id,service_id,title) VALUES($1,$2,$3,'All departments')`, [REQ_A2, A, S]));
  await commitCtx(PT(B), c => c.query(`INSERT INTO document_requirements
    (id,client_id,service_id,title) VALUES($1,$2,$3,'B only')`, [REQ_B, B, S]));
  await refused('targetless P requirement write', () => commitCtx(PCAT, c => c.query(
    `INSERT INTO document_requirements (client_id,service_id,title) VALUES($1,$2,'x')`, [A, S])));
  await refused('P@A writing a requirement for B', () => commitCtx(PT(A), c => c.query(
    `INSERT INTO document_requirements (client_id,service_id,title) VALUES($1,$2,'x')`, [B, S])));
  assert.equal((await asCtx(E, c => c.query('SELECT id FROM document_requirements'))).rows.length, 2);
  assert.equal((await asCtx(C, c => c.query('SELECT id FROM document_requirements'))).rows.length, 2,
    'C sees only its own client');
  assert.equal((await asCtx(W, c => c.query('SELECT id FROM document_requirements'))).rows.length, 2);
  assert.equal((await asCtx(PT(A), c => c.query('SELECT id FROM document_requirements'))).rows.length, 2,
    'F-03: P@T really reads the explicit target');
  assert.equal((await asCtx(PT(B), c => c.query('SELECT id FROM document_requirements'))).rows.length, 1);
  pass('requirements: P@T per client; C/W isolated to their own client; targetless P refused');

  log('STEP F-03 initiatives P@T read');
  assert.equal((await asCtx(PT(A), c => c.query('SELECT id FROM client_initiatives'))).rows.length, 1);
  assert.equal((await asCtx(C, c => c.query('SELECT id FROM client_initiatives'))).rows.length, 1);
  pass('P@T and C read the client initiative selection');

  log('STEP F-04 status submission (handler lock is source-pinned)');
  const st = await commitCtx(E, c => c.query(`INSERT INTO initiative_department_status
    (client_initiative_id,department_id,performed,note,submitted_by,submitted_at)
    VALUES($1,$2,true,'done',$3,now()) RETURNING id`, [CI, D1, ACTOR]));
  assert.equal((await commitCtx(E, c => c.query(
    "UPDATE initiative_department_status SET note='done v2' WHERE id=$1", [st.rows[0].id]))).rowCount, 1);
  const route = readFileSync('src/server/routes/departmentInitiatives.ts', 'utf8');
  assert.ok(route.includes("code: 'initiatives.locked'")
    && route.indexOf('initiatives.locked') < route.indexOf('INSERT INTO initiative_department_status'));
  pass('stamped status stays editable for notes; the performed reset is a handler zero-write refusal');

  log('STEP H-01 destructive delete refused by the FK (all rows intact)');
  const sub = await commitCtx(E, c => c.query(`INSERT INTO document_submissions
    (client_id,department_id,requirement_id,provided,note,submitted_by,submitted_at)
    VALUES($1,$2,$3,true,'sent',$4,now()) RETURNING id`, [A, D1, REQ_A2, ACTOR]));
  const file = await commitCtx(E, c => c.query(`INSERT INTO evidence_files
    (client_id,department_id,entity_type,entity_id,filename,mime,size_bytes,content,uploaded_by)
    VALUES($1,$2,'document_submission',$3,'p.pdf','application/pdf',3,'abc'::bytea,$4) RETURNING id`,
  [A, D1, sub.rows[0].id, ACTOR]));
  const before = {
    requirements: (await oracle.query('SELECT count(*)::int n FROM document_requirements')).rows[0].n,
    submissions: (await oracle.query('SELECT count(*)::int n FROM document_submissions')).rows[0].n,
    files: (await oracle.query('SELECT count(*)::int n FROM evidence_files')).rows[0].n,
  };
  await refused('P@A deleting a requirement with a submission', () => commitCtx(PT(A), c => c.query(
    'DELETE FROM document_requirements WHERE id = $1', [REQ_A2])));
  const after = {
    requirements: (await oracle.query('SELECT count(*)::int n FROM document_requirements')).rows[0].n,
    submissions: (await oracle.query('SELECT count(*)::int n FROM document_submissions')).rows[0].n,
    files: (await oracle.query('SELECT count(*)::int n FROM evidence_files')).rows[0].n,
  };
  assert.deepEqual(after, before, 'H-01: NOTHING was cascade-deleted');
  assert.equal((await oracle.query('SELECT count(*)::int n FROM document_submissions WHERE id=$1',
    [sub.rows[0].id])).rows[0].n, 1);
  assert.equal((await oracle.query('SELECT count(*)::int n FROM evidence_files WHERE id=$1',
    [file.rows[0].id])).rows[0].n, 1);
  // No submissions ⇒ the delete succeeds (the 200 path).
  await commitCtx(PT(A), c => c.query(`INSERT INTO document_requirements
    (id,client_id,service_id,title) VALUES('b4444444-4444-4444-8444-444444444444',$1,$2,'No submissions')`, [A, S]));
  assert.equal((await commitCtx(PT(A), c => c.query(
    "DELETE FROM document_requirements WHERE id='b4444444-4444-4444-8444-444444444444'"))).rowCount, 1);
  pass('H-01: refuse-with-everything-intact, and the empty case still deletes');

  log('STEP cross-client submission isolation');
  await refused('E@A submitting B\'s requirement', () => commitCtx(E, c => c.query(
    `INSERT INTO document_submissions (client_id,department_id,requirement_id,provided)
      VALUES($1,$2,$3,true)`, [A, D1, REQ_B])));
  assert.equal((await asCtx(C, c => c.query('SELECT id FROM document_submissions'))).rows.length, 1);
  assert.equal((await asCtx(PT(B), c => c.query('SELECT id FROM document_submissions'))).rows.length, 0);
  pass('submissions never cross the client boundary (write refused, reads isolated)');

  log('SUMMARY');
  log(`PREDECESSOR_SHAPE=${preNew}`);
  log(`B17_SHAPE=${b17New}`);
  log(`B17_CONTENT_SHAPE=${contentNew}`);
  log(`B17_CONTENT_SHA256=${b17ContentSource().checksum}`);
  log(`ROUND1=${OLD_PRE}/${OLD_B17}/${OLD_CONTENT}`);
} finally {
  await oracle.end().catch(() => {});
  owner?.release();
  await pool.end().catch(() => {});
}
