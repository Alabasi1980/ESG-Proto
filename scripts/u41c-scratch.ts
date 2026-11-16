// TASK-PROTO-U4-1c — own-throwaway PG18 measurement + behaviour proof.
//
// WHY: the three STRUCTURE_SQL constants must be re-measured AFTER the new
// columns/tables/policies exist, and the falsifiability claim ("removing this
// unit's objects restores the PREVIOUS md5") must be SHOWN. This script also
// proves, on policies rather than prose: general-bucket idempotence, department
// scoping of every write, the two read contexts (W/C tenant, P@T target), the
// evidence-file row scope and the audit admission for the new rows.
//
// Own container only (created/removed by the caller), generated credentials,
// ambient DSNs/.env refused. Never touches the shared showcase database.
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { getPool, runMigrations, setTenantContext } from '../src/db/index.ts';
import { STRUCTURE_SQL, b17Source, b17ContentSource } from '../src/db/b17Readiness.ts';
import { ensureGeneralBucket, generalStandardCode } from '../src/lib/generalBucket.ts';

// Pre-U4-1c constants (HEAD 5efb0c8) — the falsifiability oracles.
const OLD_PRE = 'd093f4720020a9f496a230e02dc6e573';
const OLD_B17 = '99455c0b7408fe8f5b204e44fc242649';
const OLD_CONTENT = '6f67b44de1e2620fdb711ef9175fb6f5';
const OLD_CONTENT_SHA = '2e07a7c14934aaebde24a145be6a4912530db9e160d74544d36b2d66912f3f45';
const A = '11111111-1111-4111-8111-111111111111';
const B = '12121212-1212-4212-8212-121212121212';
const D1 = '21111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const S = '31111111-1111-4111-8111-111111111111';
const STANDARD = '41111111-1111-4111-8111-111111111111';
const DISCLOSURE = '51111111-1111-4111-8111-111111111111';
const ITEM = '61111111-1111-4111-8111-111111111111';
const ACTOR = '71111111-1111-4111-8111-111111111111';
const ACTOR2 = '72222222-2222-4222-8222-222222222222';
const CACTOR = '73333333-3333-4333-8333-333333333333';
const WACTOR = '74444444-4444-4444-8444-444444444444';
const PACTOR = '75555555-5555-4555-8555-555555555555';
const SESSION = '81111111-1111-4111-8111-111111111111';
const INITIATIVE = '91111111-1111-4111-8111-111111111111';
const DROPS = [
  'ALTER TABLE items DROP COLUMN indicator_code',
  'ALTER TABLE items DROP COLUMN tags',
  'DROP TABLE evidence_files',
  'DROP TABLE initiative_department_status',
  'DROP TABLE document_submissions',
  'DROP TABLE document_requirements',
];
setTimeout(() => { console.error('WATCHDOG: scratch proof stalled'); process.exit(9); }, 300000).unref();

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
const denied = async (label: string, fn: () => Promise<unknown>) => {
  await assert.rejects(fn, (err: any) => /row-level security|permission denied|violates/i.test(String(err?.message)),
    `${label} must be refused by row security`);
  pass(`${label} refused by RLS (zero writes)`);
};

const E1 = { role: 'employee', mode: 'employee', purpose: 'work', tenantId: A, userId: ACTOR,
  sessionId: SESSION, departmentId: D1, tabId: null, targetId: null };
const E2 = { ...E1, userId: ACTOR2, departmentId: D2 };
const C = { role: 'client_admin', mode: 'client', purpose: 'work', tenantId: A, userId: CACTOR,
  sessionId: SESSION, departmentId: null, tabId: null, targetId: null };
const W = { role: 'ge_admin', mode: 'consultant', purpose: 'work', tenantId: A, userId: WACTOR,
  sessionId: SESSION, departmentId: null, tabId: SESSION, targetId: null };
const PCAT = { role: 'ge_admin', mode: 'platform', purpose: 'platform.config', tenantId: null, userId: PACTOR,
  sessionId: SESSION, departmentId: null, tabId: SESSION, targetId: null };
const PT = { ...PCAT, tenantId: A, targetId: A };

let owner: pg.PoolClient | undefined;
try {
  await oracle.connect();
  await oracle.query("SET lock_timeout='20s'");
  assert.equal(Math.floor(Number((await oracle.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.deepEqual((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],
    { rolsuper: false, rolbypassrls: false }, 'runtime owner is NOSUPERUSER/NOBYPASSRLS');
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);

  const headSchema = execFileSync('git', ['show', '5efb0c8:src/db/schema.sql'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const headContent = execFileSync('git', ['show', '5efb0c8:src/db/b17-content.sql'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n');
  const newContent = b17ContentSource().sql;
  const newSchema = readFileSync('src/db/schema.sql', 'utf8');
  const section = newSchema.slice(newSchema.indexOf('-- U4-1c-A.'));
  const contentBlock = newContent.slice(newContent.indexOf('-- TASK-PROTO-U4-1c (OD-12 sections 3-8)'),
    newContent.indexOf('-- B17 U2-E E-2'));
  const statementAt = (sql: string, marker: string) => {
    const start = sql.indexOf(marker);
    if (start < 0) throw new Error(`statement marker missing: ${marker}`);
    const rest = sql.slice(start);
    const next = rest.slice(marker.length).search(/\r?\n\s*(?:CREATE|DROP) POLICY /);
    const region = next < 0 ? rest : rest.slice(0, marker.length + next);
    const end = region.lastIndexOf(';');
    return region.slice(0, end + 1);
  };
  const auditPolicy = statementAt(newContent, 'CREATE POLICY b17_audit_insert');
  assert.ok(section.length > 2000 && contentBlock.length > 4000 && auditPolicy.includes('DOCUMENT_REQUIREMENT_CREATED'));

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

  log('STEP head baseline (pre-U4-1c constants must reproduce)');
  const head = await base('_head', headSchema, headContent);
  log(`HEAD_PRE=${head.pre} HEAD_B17=${head.u1} HEAD_CONTENT=${head.post}`);
  assert.equal(head.pre, OLD_PRE);
  assert.equal(head.u1, OLD_B17);
  assert.equal(head.post, OLD_CONTENT);
  assert.equal(b17ContentSource().checksum === OLD_CONTENT_SHA, false, 'content file intentionally changed');
  assert.equal(execFileSync('git', ['show', '5efb0c8:src/db/b17-content.sql'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n') === newContent, false);
  pass('HEAD constants reproduce exactly on this PG18 scratch');

  log('STEP schema (working tree) + predecessor falsifiability');
  assert.equal((await runMigrations()).success, true);
  const db = await pool.connect(); owner = db;
  const preNew = await shape(db);
  log(`PREDECESSOR_SHAPE=${preNew}`);
  for (const statement of DROPS) await db.query(statement);
  assert.equal(await shape(db), OLD_PRE, 'dropping the new columns/tables restores the old predecessor md5');
  await db.query(section);
  assert.equal(await shape(db), preNew, 're-applying the U4-1c section restores the new predecessor md5');
  pass('schema delta is exactly this unit (drop -> old md5, re-add -> new md5)');

  log('STEP b17 + U1-stage falsifiability');
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
  assert.notEqual(b17New, preNew);
  for (const statement of DROPS) await db.query(statement);
  assert.equal(await shape(db), OLD_B17, 'dropping the new objects restores the old post-U1 md5');
  await db.query(section);
  assert.equal(await shape(db), b17New);
  pass('post-U1 constant falsifiable too');

  log('STEP content');
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

  log('STEP content falsifiability (policy block only)');
  const c1 = await base('_c1', newSchema, headContent);
  log(`NEW_SCHEMA_HEAD_CONTENT=${c1.post}`);
  assert.equal(c1.pre, preNew, 'same schema predecessor in the content oracle');
  assert.equal(c1.u1, b17New, 'same U1 shape in the content oracle');
  // The pre-change content md5 is only reachable on the PRE-CHANGE structure, so
  // the content-file oracle is C1 = the NEW structure with the HEAD policy file;
  // HEAD content on the HEAD structure is the OLD_CONTENT constant (step 1).
  assert.notEqual(c1.post, OLD_CONTENT, 'the new tables legitimately move every structural md5');
  const headPolicies = statementAt(headContent, 'CREATE POLICY b17_audit_insert');
  assert.equal(headPolicies.includes('DOCUMENT_REQUIREMENT_CREATED'), false);
  await db.query('BEGIN');
  for (const [name, table] of [
    ['b17_document_requirements_read', 'document_requirements'],
    ['b17_document_requirements_insert', 'document_requirements'],
    ['b17_document_requirements_update', 'document_requirements'],
    ['b17_document_requirements_delete', 'document_requirements'],
    ['b17_document_submissions_read', 'document_submissions'],
    ['b17_document_submissions_insert', 'document_submissions'],
    ['b17_document_submissions_update', 'document_submissions'],
    ['b17_initiative_department_read', 'initiative_department_status'],
    ['b17_initiative_department_insert', 'initiative_department_status'],
    ['b17_initiative_department_update', 'initiative_department_status'],
    ['b17_evidence_files_read', 'evidence_files'],
    ['b17_evidence_files_insert', 'evidence_files'],
    ['b17_evidence_files_delete', 'evidence_files'],
    ['b17_version_update', 'app_schema_versions'],
  ]) await db.query(`DROP POLICY IF EXISTS ${name} ON ${table}`);
  await db.query('DROP POLICY b17_scope ON client_initiatives');
  await db.query('DROP POLICY b17_library ON initiatives_library');
  for (const target of ['CREATE POLICY b17_scope ON client_initiatives',
    'CREATE POLICY b17_library ON initiatives_library']) await db.query(statementAt(headContent, target));
  await db.query('DROP POLICY b17_audit_insert ON audit_log');
  await db.query(headPolicies);
  await db.query('COMMIT');
  assert.equal(await shape(db), c1.post, 'removing this unit\'s policy block restores the pre-change content md5');
  await db.query('BEGIN');
  await db.query(contentBlock);
  await db.query('DROP POLICY b17_audit_insert ON audit_log');
  await db.query(auditPolicy);
  await db.query('COMMIT');
  assert.equal(await shape(db), contentNew, 're-applying the block restores the new content md5');
  pass('content constant falsifiable: block removed -> HEAD md5, block re-added -> new md5');

  log('STEP seed');
  const user = async (id: string, clientId: string | null, departmentId: string | null,
    email: string, name: string, role: string) =>
    oracle.query(`INSERT INTO users(id,client_id,department_id,email,password_hash,name,role,is_active)
      VALUES($1,$2,$3,$4,'x',$5,$6,true)`, [id, clientId, departmentId, email, name, role]);
  await db.query('BEGIN');
  await oracle.query('INSERT INTO clients(id,code,name) VALUES($1,$2,$3)', [A, 'U41C', 'U41C tenant']);
  await oracle.query('INSERT INTO clients(id,code,name) VALUES($1,$2,$3)', [B, 'U41CB', 'Other tenant']);
  await oracle.query('INSERT INTO departments(id,client_id,code,name) VALUES($1,$2,$3,$4)', [D1, A, 'D1', 'Dept One']);
  await oracle.query('INSERT INTO departments(id,client_id,code,name) VALUES($1,$2,$3,$4)', [D2, A, 'D2', 'Dept Two']);
  await user(ACTOR, A, D1, 'e1@u41c.test', 'E One', 'employee');
  await user(ACTOR2, A, D2, 'e2@u41c.test', 'E Two', 'employee');
  await user(CACTOR, A, null, 'c@u41c.test', 'Client Admin', 'client_admin');
  await user(WACTOR, null, null, 'w@u41c.test', 'Consultant', 'ge_admin');
  await user(PACTOR, null, null, 'p@u41c.test', 'Platform', 'ge_admin');
  await oracle.query('INSERT INTO services(id,code,name) VALUES($1,$2,$3)', [S, 'U41CS', 'Service']);
  await oracle.query('INSERT INTO standards(id,code,title,category) VALUES($1,$2,$3,$4)',
    [STANDARD, 'U41C-STD', 'Standard', 'GRI']);
  await oracle.query('INSERT INTO disclosures(id,standard_id,code,title) VALUES($1,$2,$3,$4)',
    [DISCLOSURE, STANDARD, 'D-1', 'Disclosure']);
  await oracle.query(`INSERT INTO items(id,disclosure_id,code,requirement,priority,esg_class,indicator_code,tags)
    VALUES($1,$2,$3,$4,'high','general','c (i)','{"water"}')`, [ITEM, DISCLOSURE, 'I-1', 'Requirement']);
  await oracle.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2)', [S, STANDARD]);
  await oracle.query('INSERT INTO client_services(client_id,service_id) VALUES($1,$2)', [A, S]);
  await oracle.query(`INSERT INTO initiatives_library(id,title,sector,esg_class)
    VALUES($1,'Recycling','', 'environmental')`, [INITIATIVE]);
  await oracle.query('INSERT INTO service_initiatives(service_id,initiative_id) VALUES($1,$2)', [S, INITIATIVE]);
  await oracle.query(`INSERT INTO client_initiatives(id,client_id,initiative_id) VALUES($1,$2,$3)`,
    ['a1111111-1111-4111-8111-111111111111', A, INITIATIVE]);
  await db.query('COMMIT');

  log('STEP general bucket (create/duplicate/backfill idempotence)');
  const b1 = await commitCtx(PCAT, c => ensureGeneralBucket(c, S));
  const b2 = await commitCtx(PCAT, c => ensureGeneralBucket(c, S));
  assert.deepEqual(b2.created, { standard: false, disclosure: false, mapping: false });
  assert.equal(b1.standardId, b2.standardId);
  assert.equal((await oracle.query('SELECT count(*)::int n FROM standards WHERE code=$1',
    [generalStandardCode('U41CS')])).rows[0].n, 1);
  assert.equal((await oracle.query('SELECT count(*)::int n FROM service_standards WHERE service_id=$1 AND standard_id=$2',
    [S, b1.standardId])).rows[0].n, 1);
  pass('bucket converges on one standard + disclosure + mapping (repeat call is a no-op)');

  log('STEP document requirements (P catalog write, E/W/C/P@T read)');
  await commitCtx(PCAT, c => c.query(`INSERT INTO document_requirements
    (id,service_id,department_id,title,tags) VALUES('b1111111-1111-4111-8111-111111111111',$1,$2,'Policy',ARRAY['hr'])`,
  [S, D1]));
  await commitCtx(PCAT, c => c.query(`INSERT INTO document_requirements
    (id,service_id,title) VALUES('b2222222-2222-4222-8222-222222222222',$1,'All departments')`, [S]));
  const reqId = 'b2222222-2222-4222-8222-222222222222';
  assert.equal((await asCtx(E1, c => c.query('SELECT id FROM document_requirements'))).rows.length, 2);
  assert.equal((await asCtx(E2, c => c.query('SELECT id FROM document_requirements'))).rows.length, 1,
    'E2 sees only the department-agnostic requirement');
  assert.equal((await asCtx(W, c => c.query('SELECT id FROM document_requirements'))).rows.length, 2);
  assert.equal((await asCtx(C, c => c.query('SELECT id FROM document_requirements'))).rows.length, 2);
  assert.equal((await asCtx(PT, c => c.query('SELECT id FROM document_requirements'))).rows.length, 2);
  await denied('E2 catalog write', () => commitCtx(E2, c => c.query(
    `INSERT INTO document_requirements (service_id,title) VALUES($1,'x')`, [S])));
  pass('requirements: P writes only; E sees own-department + general rows; W/C/P@T read');

  log('STEP submissions (E own department, W/C read, cross-department refusal)');
  const sub = await commitCtx(E1, c => c.query(`INSERT INTO document_submissions
    (client_id,department_id,requirement_id,provided,note,submitted_by,submitted_at)
    VALUES($1,$2,$3,true,'sent',$4,now()) RETURNING id, submitted_at`, [A, D1, reqId, ACTOR]));
  assert.ok(sub.rows[0].submitted_at);
  const upd = await commitCtx(E1, c => c.query(`UPDATE document_submissions SET note='sent v2' WHERE id=$1`, [sub.rows[0].id]));
  assert.equal(upd.rowCount, 1, 'the department row stays editable after submit');
  assert.equal((await asCtx(E2, c => c.query('SELECT id FROM document_submissions'))).rows.length, 0,
    'E2 never reads another department submission');
  await denied('E2 write into D1', () => commitCtx(E2, c => c.query(`INSERT INTO document_submissions
    (client_id,department_id,requirement_id,provided) VALUES($1,$2,$3,true)`, [A, D1, reqId])));
  await denied('C submission write', () => commitCtx(C, c => c.query(`INSERT INTO document_submissions
    (client_id,department_id,requirement_id,provided) VALUES($1,$2,$3,true)`, [A, D2, reqId])));
  assert.equal((await asCtx(C, c => c.query('SELECT id FROM document_submissions'))).rows.length, 1);
  assert.equal((await asCtx(W, c => c.query('SELECT id FROM document_submissions'))).rows.length, 1);
  assert.equal((await asCtx(PT, c => c.query('SELECT id FROM document_submissions'))).rows.length, 1);
  pass('submission: E own department writes; W/C/P@T read; cross-department and C writes refused');

  log('STEP evidence files (row scope + lock source)');
  const file = await commitCtx(E1, c => c.query(`INSERT INTO evidence_files
    (client_id,department_id,entity_type,entity_id,filename,mime,size_bytes,content,uploaded_by)
    VALUES($1,$2,'document_submission',$3,'p.pdf','application/pdf',3,'abc'::bytea,$4) RETURNING id`,
  [A, D1, sub.rows[0].id, ACTOR]));
  await denied('E2 evidence insert into D1', () => commitCtx(E2, c => c.query(`INSERT INTO evidence_files
    (client_id,department_id,entity_type,entity_id,filename,mime,size_bytes,content,uploaded_by)
    VALUES($1,$2,'document_submission',$3,'x.pdf','application/pdf',3,'abc'::bytea,$4)`, [A, D1, sub.rows[0].id, ACTOR2])));
  await denied('W evidence insert', () => commitCtx(W, c => c.query(`INSERT INTO evidence_files
    (client_id,department_id,entity_type,entity_id,filename,mime,size_bytes,content,uploaded_by)
    VALUES($1,$2,'document_submission',$3,'x.pdf','application/pdf',3,'abc'::bytea,$4)`, [A, D1, sub.rows[0].id, WACTOR])));
  assert.equal((await asCtx(E1, c => c.query('SELECT id FROM evidence_files'))).rows.length, 1);
  assert.equal((await asCtx(E2, c => c.query('SELECT id FROM evidence_files'))).rows.length, 0);
  assert.equal((await asCtx(C, c => c.query('SELECT id FROM evidence_files'))).rows.length, 1);
  assert.equal((await asCtx(PT, c => c.query('SELECT id FROM evidence_files'))).rows.length, 1);
  // Lock rule: a second, UNSUBMITTED submission's file is deletable by its own
  // uploader (the RLS DELETE row), while the handler refuses the submitted one.
  const draft = await commitCtx(E1, c => c.query(`INSERT INTO document_submissions
    (client_id,department_id,requirement_id,provided,submitted_by)
    VALUES($1,$2,'b1111111-1111-4111-8111-111111111111',false,$3) RETURNING id`, [A, D1, ACTOR]));
  const draftFile = await commitCtx(E1, c => c.query(`INSERT INTO evidence_files
    (client_id,department_id,entity_type,entity_id,filename,mime,size_bytes,content,uploaded_by)
    VALUES($1,$2,'document_submission',$3,'d.pdf','application/pdf',3,'abc'::bytea,$4) RETURNING id`,
  [A, D1, draft.rows[0].id, ACTOR]));
  assert.equal((await commitCtx(E1, c => c.query('DELETE FROM evidence_files WHERE id=$1',
    [draftFile.rows[0].id]))).rowCount, 1, 'pre-submit delete is admitted for the uploader');
  assert.equal((await commitCtx(E2, c => c.query('DELETE FROM evidence_files WHERE id=$1',
    [file.rows[0].id]))).rowCount, 0, 'E2 cannot delete E1 evidence (row filtered, zero writes)');
  pass('E2 delete of a foreign evidence row affects zero rows');
  const handlerSource = readFileSync('src/server/routes/documents.ts', 'utf8');
  assert.ok(handlerSource.includes('if (parent.submitted_at)'), 'the handler locks deletes on submitted_at');
  assert.ok(handlerSource.indexOf('if (parent.submitted_at)') < handlerSource.indexOf('DELETE FROM evidence_files'),
    'the lock precedes the delete statement');
  assert.ok(handlerSource.includes('MAX_ATTACHMENT_BYTES') && handlerSource.includes('validateAttachment('),
    'the 5 MB cap + MIME allowlist are the attachment path\'s own constants');
  pass('evidence_files: E own department/uploader only; W/C/P@T read; delete lock precedes the DELETE');

  log('STEP department initiative status');
  const ciId = 'a1111111-1111-4111-8111-111111111111';
  const st = await commitCtx(E1, c => c.query(`INSERT INTO initiative_department_status
    (client_initiative_id,department_id,performed,note,submitted_by,submitted_at)
    VALUES($1,$2,true,'done',$3,now()) RETURNING id`, [ciId, D1, ACTOR]));
  assert.equal((await commitCtx(E1, c => c.query(`UPDATE initiative_department_status SET note='done v2' WHERE id=$1`,
    [st.rows[0].id]))).rowCount, 1);
  await denied('E2 wrote D1 initiative status', () => commitCtx(E2, c => c.query(`INSERT INTO initiative_department_status
    (client_initiative_id,department_id,performed) VALUES($1,$2,true)`, [ciId, D1])));
  await denied('C initiative status write', () => commitCtx(C, c => c.query(`INSERT INTO initiative_department_status
    (client_initiative_id,department_id,performed) VALUES($1,$2,true)`, [ciId, D2])));
  assert.equal((await asCtx(E1, c => c.query('SELECT id FROM initiative_department_status'))).rows.length, 1);
  assert.equal((await asCtx(E2, c => c.query('SELECT id FROM initiative_department_status'))).rows.length, 0);
  assert.equal((await asCtx(C, c => c.query('SELECT id FROM initiative_department_status'))).rows.length, 1);
  assert.equal((await asCtx(W, c => c.query('SELECT id FROM initiative_department_status'))).rows.length, 1);
  assert.equal((await asCtx(PT, c => c.query('SELECT id FROM initiative_department_status'))).rows.length, 1);
  assert.equal((await asCtx(E1, c => c.query('SELECT id FROM client_initiatives'))).rows.length, 1,
    'E reads the selected + linked initiative (OD-12 section 4)');
  pass('initiative status: E own department; W/C/P@T read; cross-department and C writes refused');

  log('STEP audit admission');
  await commitCtx(E1, c => c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id)
    VALUES($1,$2,'DOCUMENT_SUBMITTED','document_submissions',$3)`, [A, ACTOR, sub.rows[0].id]));
  await commitCtx(PCAT, c => c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id)
    VALUES(NULL,$1,'DOCUMENT_REQUIREMENT_CREATED','document_requirements',$2)`,
  [PACTOR, 'b2222222-2222-4222-8222-222222222222']));
  await denied('unlisted P audit action', () => commitCtx(PCAT, c => c.query(`INSERT INTO audit_log
    (client_id,user_id,action,entity_type,entity_id) VALUES(NULL,$1,'BOGUS_ACTION','document_requirements',$2)`,
  [PACTOR, reqId])));
  assert.equal((await oracle.query("SELECT count(*)::int n FROM audit_log WHERE action IN ('DOCUMENT_SUBMITTED','DOCUMENT_REQUIREMENT_CREATED')")).rows[0].n, 2);
  pass('no audit row is ever written outside the policy (E work + P catalog actions admitted)');

  log('SUMMARY');
  log(`PREDECESSOR_SHAPE=${preNew}`);
  log(`B17_SHAPE=${b17New}`);
  log(`B17_CONTENT_SHAPE=${contentNew}`);
  log(`B17_CONTENT_SHA256=${b17ContentSource().checksum}`);
  log(`OLD_PRE=${OLD_PRE} OLD_B17=${OLD_B17} OLD_CONTENT=${OLD_CONTENT}`);
} finally {
  await oracle.end().catch(() => {});
  owner?.release();
  await pool.end().catch(() => {});
}
