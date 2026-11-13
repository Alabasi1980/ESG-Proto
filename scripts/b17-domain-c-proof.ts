// B17 U2-C1 substrate proof — task §23 (C1 = policy substrate, ZERO flips),
// explicit disposable PostgreSQL 18 only.
// node --import tsx scripts/b17-domain-c-proof.ts --allow-disposable-b17
//   --database-url=<loopback named b17_*scratch* DB>
//
// This is the INVERTED form of the round-1 diagnostic: the six executed
// blockers (B1-B6) must now be GREEN positives through the real offline
// activation path (schema.sql -> b17.sql -> b17-content.sql) under FORCE RLS
// as a non-bypass owner, plus the negatives §23 demands:
//   R2  P catalog reads visible in BOTH P contexts; W/C/E still scoped (L/L+D)
//   R3  catalog writes policy-reachable for P; W/C denied; client_services
//       INSERT/UPDATE/DELETE impossible in every context (no implicit grant)
//   R4  P audit config branches (NULL-client catalog + target-T import) work;
//       W and wrong-action/wrong-target inserts refused
//   R5  answers/evaluations BLOBS unreachable under platform.config AND the
//       platform summary context (direct reads, updates and scope.counts misuse)
//   R6  freeze fact true under platform.config(T) only — foreign T, tenant-NULL
//       summary and targetless config all false; W regression stays true;
//       raw review_snapshots rows still invisible everywhere
//   R7  D1 counts truthful vs PRE-activation truth (incl. cross-tenant child);
//       denied contexts RAISE (never 0); bad kind/null ref raise
//   R8  notifications DELETE user_id identity (SHIELD-U2B3-01): whole-table
//       delete touches actor-own rows only, trim branch still works
//   R9  D3 check: already-activated /actions excludes hidden corrective rows
//       for C at the RLS layer (no actions.ts pre-authorisation needed)
//   R10 platform.config never appears on a request-reading line (server-set
//       constant only — request input can never select purpose/target)
// Registry truth (post-C2 re-run): 51 UNACTIVATED = 74 - exactly the 23
// taxonomy/gri flips; capabilities truthful (6 entries), no other row moved.
//
// NON-DESTRUCTIVE by contract: seed-only fixtures; every probe runs in its own
// transaction and is ALWAYS rolled back; no business row is ever DELETEd
// outside a rolled-back transaction.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { getPool, runMigrations, withTenantContext, setTenantContext, type TenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, STRUCTURE_SQL, B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { parseB17ContentSources, inventoryB17ContentOffline, applyB17ContentOffline,
  type ContentTarget, type ContentSources } from '../src/db/b17ContentMigration.ts';
import { hashPassword } from '../src/server/auth.ts';
import { LEGACY_ROUTES } from '../src/server/accessRegistry.ts';
import { activeBusinessCapabilities } from '../src/lib/capabilities.ts';

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
process.env.B17_SCRATCH_OPT_IN = 'YES';
const pass = (label: string) => console.log(`PASS ${label}`);

interface Probe<T> { ok?: T; code?: string; message?: string }
/** Own transaction per probe, ALWAYS rolled back (non-destructive). */
async function probe<T>(pool: pg.Pool, ctx: TenantContext,
  fn: (c: pg.PoolClient) => Promise<T>): Promise<Probe<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, ctx);
    const ok = await fn(client);
    return { ok };
  } catch (err: any) {
    return { code: String(err?.code ?? ''), message: String(err?.message ?? '') };
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* aborted */ }
    client.release();
  }
}
const count = (q: string, args: unknown[] = []) => async (c: pg.PoolClient) =>
  Number((await c.query(q, args)).rows[0].n);
const one = (q: string, args: unknown[] = []) => async (c: pg.PoolClient) =>
  (await c.query(q, args)).rows[0];
const expectRls = (p: Probe<unknown>, where: string) =>
  assert.equal(p.code, '42501', `${where}: expected RLS 42501, got ${p.code || 'rows'} ${p.message}`);
const expectRaise = (p: Probe<unknown>, text: string, where: string) =>
  assert.ok(String(p.message ?? '').includes(text), `${where}: expected RAISE ${text}, got ${p.code || 'ok'} ${p.message}`);
const noError = (p: Probe<unknown>, where: string) =>
  assert.equal(p.code, undefined, `${where}: unexpected error ${p.code} ${p.message}`);

async function main() {
  const pool = getPool();
  const role = (await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0,
    'Scratch must start empty; never reset or replay an existing application DB.');
  assert.equal((await runMigrations()).success, true);

  const password = `Aa1!${randomBytes(16).toString('hex')}`;
  const GRI_BATCH = 'b17u2c1-fixture-gri', PROFILE_BATCH = 'b17u2c1-fixture-profile';
  const sources: ContentSources = parseB17ContentSources(
    readFileSync(new URL('../../prototype/GRI_SOURCE_EXTRACT.csv', import.meta.url), 'utf8'),
    readFileSync(new URL('../../prototype/ESG_PROFILE_EXTRACT.csv', import.meta.url), 'utf8'));

  // ---- Seed BEFORE activation (predecessor policies admit the GE fixture) ----
  const seed = await withTenantContext({ role: 'ge_admin' }, async c => {
    const tenantA = (await c.query("INSERT INTO clients(code,name) VALUES('B17U2C1-A','Tenant A') RETURNING id")).rows[0].id as string;
    const tenantB = (await c.query("INSERT INTO clients(code,name) VALUES('B17U2C1-B','Tenant B') RETURNING id")).rows[0].id as string;
    const deptA1 = (await c.query("INSERT INTO departments(client_id,code,name) VALUES($1,'one','One') RETURNING id", [tenantA])).rows[0].id as string;
    const deptA2 = (await c.query("INSERT INTO departments(client_id,code,name) VALUES($1,'two','Two') RETURNING id", [tenantA])).rows[0].id as string;
    const deptB1 = (await c.query("INSERT INTO departments(client_id,code,name) VALUES($1,'one','One') RETURNING id", [tenantB])).rows[0].id as string;
    const mk = async (name: string, r: string, tenant: string | null = null, department: string | null = null) =>
      (await c.query(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [`${name}@b17u2c1.invalid`, await hashPassword(password), name, r, tenant, department])).rows[0].id as string;
    const ge = await mk('ge', 'ge_admin'), ca = await mk('client', 'client_admin', tenantA),
      ea = await mk('employee', 'employee', tenantA, deptA1);
    // R9 hidden-corrective tenant: same GRI service linked with
    // show_corrective=false, one action, its own client_admin. The flip cannot
    // be done post-activation (client_services has NO update policy anywhere —
    // itself part of R3), so both visibility states are seeded.
    const tenantH = (await c.query("INSERT INTO clients(code,name) VALUES('B17U2C1-H','Tenant H') RETURNING id")).rows[0].id as string;
    const deptH1 = (await c.query("INSERT INTO departments(client_id,code,name) VALUES($1,'one','One') RETURNING id", [tenantH])).rows[0].id as string;
    const caH = await mk('clienth', 'client_admin', tenantH);

    const std1 = (await c.query("INSERT INTO standards(code,title,category) VALUES('B17U2C1','Fixture','Universal') RETURNING id")).rows[0].id as string;
    const disc1 = (await c.query("INSERT INTO disclosures(standard_id,code,title) VALUES($1,'B17U2C1','Fixture') RETURNING id", [std1])).rows[0].id as string;
    const item1 = (await c.query("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'B17U2C1-1','Fixture one','high','governance') RETURNING id", [disc1])).rows[0].id as string;
    const item2 = (await c.query("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'B17U2C1-2','Fixture two','mid','governance') RETURNING id", [disc1])).rows[0].id as string;
    const stdF = (await c.query("INSERT INTO standards(code,title,category) VALUES('B17U2C1F','Fixture frozen','Universal') RETURNING id")).rows[0].id as string;
    const discF = (await c.query("INSERT INTO disclosures(standard_id,code,title) VALUES($1,'B17U2C1F','Fixture frozen') RETURNING id", [stdF])).rows[0].id as string;
    const itemF = (await c.query("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'B17U2C1F-1','Fixture frozen','high','governance') RETURNING id", [discF])).rows[0].id as string;
    await c.query(`INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash)
      VALUES($1,'disclosure',$2,'{}','b17u2c1-fixture')`, [tenantA, discF]);
    // Equivalent-link fixture (P catalog metadata read/write).
    await c.query(`INSERT INTO item_links(item_a,item_b,relation,created_by)
      VALUES($1,$2,'equivalent',$3)`, [item1, item2, ge]);

    const service = (await c.query("SELECT id FROM services WHERE code='GRI'")).rows[0].id as string;
    await c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$2,true,true)', [tenantA, service]);
    await c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$2,true,false)', [tenantH, service]);
    await c.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2)', [service, std1]);
    // Assignments + answers in BOTH A departments and one B answer on the same
    // catalog item (D1 counts must be catalog-wide, not target-scoped).
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [tenantA, item1, deptA1]);
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [tenantA, item1, deptA2]);
    const answerA = (await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'draft','u2c1 A') RETURNING id`, [tenantA, item1, deptA1, ea])).rows[0].id as string;
    await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'draft','u2c1 B')`, [tenantB, item1, deptB1, ca]);
    await c.query(`INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
      VALUES($1,'seed.txt','text/plain',4,decode('73656564','hex'),$2)`, [answerA, ea]);
    // D3 fixture: two corrective actions in A (W sees both; C gated per flag).
    await c.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
      VALUES($1,$2,$3,'U2C1 action one','open')`, [tenantA, item1, deptA1]);
    await c.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
      VALUES($1,$2,$3,'U2C1 action two','open')`, [tenantA, item1, deptA2]);
    // R9 hidden-state twin: same item/service in tenant H (flag false), which
    // is exactly what the C corrective gate must hide while W keeps seeing it.
    await c.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
      VALUES($1,$2,$3,'U2C1 hidden corrective action','open')`, [tenantH, item1, deptH1]);
    // R8 inbox fixtures: one row per context, all must survive whole-table DELETE
    // except the actor's own rows.
    const notifyRow = async (user: string, client: string | null, title: string) =>
      (await c.query(`INSERT INTO notifications(user_id,client_id,type,title) VALUES($1,$2,'action.status',$3) RETURNING id`,
        [user, client, title])).rows[0].id as string;
    const nGeA = await notifyRow(ge, tenantA, 'ge own A');
    const nEaA = await notifyRow(ea, tenantA, 'ea own A');
    const nCaA = await notifyRow(ca, tenantA, 'ca own A');
    const nGeNull = await notifyRow(ge, null, 'ge platform row');
    const nGeB = await notifyRow(ge, tenantB, 'ge foreign row');

    // OD-10 content-inventory fixture (exact approved-CSV provenance keys).
    const [griStdCode, griDiscCode, griItemCode, griRequirement] = JSON.parse(sources.griKeys[0]) as string[];
    const [profPillar, profDepartment, profTopic, profParameter] = JSON.parse(sources.profileKeys[0]) as string[];
    const contentStandard = (await c.query("INSERT INTO standards(code,title,category) VALUES($1,$1,'Governance') RETURNING id", [griStdCode])).rows[0].id as string;
    const contentDisclosure = (await c.query("INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2) RETURNING id", [contentStandard, griDiscCode])).rows[0].id as string;
    await c.query(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class,import_batch_id)
      VALUES($1,$2,$3,'high','governance',$4)`, [contentDisclosure, griItemCode, griRequirement, GRI_BATCH]);
    await c.query(`INSERT INTO esg_profile(client_id,pillar,department,topic,parameter,import_batch_id,profile_rating)
      VALUES($1,$2,$3,$4,$5,$6,3)`, [tenantA, profPillar, profDepartment, profTopic, profParameter, PROFILE_BATCH]);
    const reportSettingId = (await c.query(`INSERT INTO report_settings(client_id,level,notification_recorded,
      disclosure_level,report_level,notified) VALUES($1,'in_accordance',false,'in-accordance','L1','done') RETURNING id`,
      [tenantA])).rows[0].id as string;
    const griAuditId = (await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
      VALUES($1,$2,'IMPORT_GRI_DISCLOSURES','standards',$3) RETURNING id`,
      [tenantA, ge, JSON.stringify({ targetTenant: tenantA, importBatchId: GRI_BATCH })])).rows[0].id as string;
    const profileAuditId = (await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
      VALUES($1,$2,'ESG_PROFILE_IMPORTED','esg_profile',$3) RETURNING id`,
      [tenantA, ge, JSON.stringify({ targetTenant: tenantA, importBatchId: PROFILE_BATCH })])).rows[0].id as string;
    const reportAuditId = (await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload)
      VALUES($1,$2,'REPORT_SETTINGS_SAVED','report_settings',$3,$4) RETURNING id`,
      [tenantA, ge, reportSettingId, JSON.stringify({ targetTenant: tenantA, serviceId: null,
        disclosureLevel: 'in-accordance', reportLevel: 'L1', notified: 'done' })])).rows[0].id as string;

    const n = async (t: string) => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n as number;
    // PRE-activation truth for the D1 counts (global, GE-visible at seed time).
    const truth = {
      standardDisclosures: (await c.query('SELECT count(*)::int n FROM disclosures WHERE standard_id=$1', [std1])).rows[0].n as number,
      disclosureItems: (await c.query('SELECT count(*)::int n FROM items WHERE disclosure_id=$1', [disc1])).rows[0].n as number,
      itemAnswers: (await c.query('SELECT count(*)::int n FROM answers WHERE item_id=$1', [item1])).rows[0].n as number,
      itemEvaluations: (await c.query('SELECT count(*)::int n FROM evaluations WHERE item_id=$1', [item1])).rows[0].n as number,
      itemAssignments: (await c.query('SELECT count(*)::int n FROM assignments WHERE item_id=$1', [item1])).rows[0].n as number,
      itemEvidence: (await c.query(`SELECT count(*)::int n FROM evidence_attachments f
        JOIN answers a ON a.id=f.answer_id WHERE a.item_id=$1`, [item1])).rows[0].n as number,
      standards: await n('standards'), disclosures: await n('disclosures'), items: await n('items'),
      services: await n('services'), links: await n('item_links'), serviceStandards: await n('service_standards'),
      departments: await n('departments'),
    };
    return { tenantA, tenantB, tenantH, deptA1, ge, ca, ea, caH, std1, disc1, item1, item2, stdF, itemF, service,
      nGeA, nEaA, nCaA, nGeNull, nGeB, truth,
      targets: [{ clientId: tenantA, griBatchId: GRI_BATCH, profileBatchId: PROFILE_BATCH,
        reportSettingId, reportAuditId } satisfies ContentTarget],
      business: { clients: await n('clients'), departments: await n('departments'), users: await n('users'),
        assignments: await n('assignments'), answers: await n('answers'), client_services: await n('client_services') } };
  });
  assert.equal(seed.truth.itemAnswers, 2, 'A and B answers must both exist pre-activation (cross-tenant truth)');

  // ---- Offline activation: U1 then U2D content (C1 substrate inside) ----
  const admin = await pool.connect();
  try { assert.equal(await applyB17Offline(admin), 'applied'); } finally { admin.release(); }
  await assertB17Ready();
  const contentAdmin = await pool.connect();
  try {
    const inventory = await inventoryB17ContentOffline(contentAdmin, seed.targets, sources);
    assert.equal(await applyB17ContentOffline(contentAdmin, inventory, sources), 'applied');
    assert.equal(await applyB17ContentOffline(contentAdmin, inventory, sources), 'verified');
  } finally { contentAdmin.release(); }
  await assertB17Ready();
  assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum, B17_CONTENT_SHAPE,
    'effective catalog must equal the C1 content-version structure fingerprint');
  pass('guards+activation: loopback scratch, non-superuser/non-BYPASSRLS PG18, empty start, seed-only fixtures, offline U1 + U2D/C1 content green');

  // ---- R1 registry truth (re-run after C2): exactly the 23 taxonomy/gri rows
  // are now flipped; no other row moved and capabilities stay truthful. ----
  const unactivated = LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED');
  assert.equal(unactivated.length, 51, 'C2 flipped exactly 23 rows (74 -> 51)');
  const u2c = LEGACY_ROUTES.filter(r => r.capability === 'taxonomy' || r.capability === 'gri');
  assert.equal(u2c.length, 23);
  assert.ok(u2c.every(r => r.activation === 'U1'), 'all 23 taxonomy/gri rows activated by C2');
  assert.deepEqual([...activeBusinessCapabilities()],
    ['taxonomy', 'gri', 'actions', 'storage', 'audit', 'notifications'],
    'activeBusinessCapabilities() stays truthful (6 entries)');
  pass('R1 registry truth (post-C2): 51 UNACTIVATED = 74 - 23 taxonomy/gri flips, no other row changed, capabilities truthful');

  // ---- Contexts (server-derived GUCs only; C2 will set these server-side) ----
  const scopeCtx: TenantContext = { purpose: 'work', role: 'ge_admin', userId: seed.ge, mode: 'platform', tenantId: null };
  const cfgT: TenantContext = { purpose: 'platform.config', role: 'ge_admin', userId: seed.ge, mode: 'platform',
    tenantId: seed.tenantA, targetId: seed.tenantA };
  const cfgB: TenantContext = { purpose: 'platform.config', role: 'ge_admin', userId: seed.ge, mode: 'platform',
    tenantId: seed.tenantB, targetId: seed.tenantB };
  const cfgNull: TenantContext = { purpose: 'platform.config', role: 'ge_admin', userId: seed.ge, mode: 'platform',
    tenantId: null, targetId: null };
  const wA: TenantContext = { purpose: 'work', role: 'ge_admin', userId: seed.ge, mode: 'consultant', tenantId: seed.tenantA };
  const wB: TenantContext = { purpose: 'work', role: 'ge_admin', userId: seed.ge, mode: 'consultant', tenantId: seed.tenantB };
  const cA: TenantContext = { purpose: 'work', role: 'client_admin', userId: seed.ca, mode: 'client', tenantId: seed.tenantA };
  const eA: TenantContext = { purpose: 'work', role: 'employee', userId: seed.ea, mode: 'employee',
    tenantId: seed.tenantA, departmentId: seed.deptA1 };
  const t = seed.truth;

  // ---- R2: P catalog reads visible in both P contexts; W/C/E stay scoped ----
  const global = { services: t.services, standards: t.standards, disclosures: t.disclosures,
    items: t.items, links: t.links, serviceStandards: t.serviceStandards + 1 }; // + GRI<->content mapping from OD-10 apply
  for (const [label, ctx] of [['platform summary/work (b17_platform_scope)', scopeCtx],
    ['platform.config(T)', cfgT]] as const) {
    const seen: Record<string, number> = {};
    for (const table of ['services', 'standards', 'disclosures', 'items', 'service_standards', 'item_links'])
      seen[table] = await probe(pool, ctx, count(`SELECT count(*)::int n FROM ${table}`)).then(p => p.ok ?? -1);
    assert.deepEqual(seen, { services: global.services, standards: global.standards,
      disclosures: global.disclosures, items: global.items,
      service_standards: global.serviceStandards, item_links: global.links },
      `${label}: P must see the FULL global catalog`);
  }
  const scoped = async (ctx: TenantContext, q: string) => probe(pool, ctx, count(q)).then(p => p.ok ?? -1);
  assert.equal(await scoped(wA, 'SELECT count(*)::int n FROM standards'), t.standards - 1,
    'W/A sees linked standards only (stdF hidden)');
  assert.equal(await scoped(wB, 'SELECT count(*)::int n FROM standards'), 0, 'zero links -> truthful empty parents');
  assert.equal(await scoped(cA, 'SELECT count(*)::int n FROM standards'), t.standards - 1, 'C linked standards only');
  assert.equal(await scoped(eA, 'SELECT count(*)::int n FROM standards'), 1,
    'E sees only standards having own assigned items (L+D), never global parents');
  assert.equal(await scoped(eA, 'SELECT count(*)::int n FROM services'), 1, 'E linked+assigned service only');
  assert.equal(await scoped(wA, 'SELECT count(*)::int n FROM services'), 1, 'W linked services only');
  pass(`R2 P catalog reads full in both P contexts (services=${global.services}, standards=${global.standards}, disclosures=${global.disclosures}, items=${global.items}, links=${global.links}); W standards=${t.standards - 1}/0, C=${t.standards - 1}, E(L+D)=1`);

  // ---- R3: catalog writes reachable for P; W/C denied; client_services frozen ----
  noError(await probe(pool, scopeCtx, c => c.query(
    "INSERT INTO services(code,name) VALUES('R3-SCOPE','Scope write')")), 'R3 scope INSERT services');
  noError(await probe(pool, cfgT, c => c.query(
    "INSERT INTO services(code,name) VALUES('R3-CFG','Config write')")), 'R3 config INSERT services');
  noError(await probe(pool, cfgNull, c => c.query(
    "INSERT INTO standards(code,title,category) VALUES('R3-NOTGT','Targetless taxonomy','Universal')")),
    'R3 targetless taxonomy INSERT standards (C2 posture)');
  noError(await probe(pool, cfgT, c => c.query(
    "UPDATE standards SET title=title WHERE code='B17U2C1'")), 'R3 config UPDATE standards');
  const dupLink = await probe(pool, scopeCtx, c => c.query(
    "INSERT INTO item_links(item_a,item_b,relation,created_by) VALUES($1,$2,'equivalent',$3)",
    [seed.item1, seed.itemF, seed.ge]));
  noError(dupLink, 'R3 scope INSERT item_links');
  noError(await probe(pool, scopeCtx, c => c.query(
    "DELETE FROM item_links WHERE item_a=$1 AND item_b=$2", [seed.item1, seed.item2])), 'R3 scope DELETE item_links');
  expectRls(await probe(pool, wA, c => c.query(
    "INSERT INTO services(code,name) VALUES('R3-W','Never')")), 'R3 W INSERT services denied');
  expectRls(await probe(pool, cA, c => c.query(
    "INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'R3-C','x','mid','general')",
    [seed.disc1])), 'R3 C INSERT items denied');
  // client_services: no policy exists in ANY context -> no implicit grant.
  for (const [label, ctx] of [['scope', scopeCtx], ['config(T)', cfgT], ['config-null', cfgNull]] as const) {
    expectRls(await probe(pool, ctx, c => c.query(
      'INSERT INTO client_services(client_id,service_id) VALUES($1,$2)', [seed.tenantA, seed.service])),
      `R3 client_services INSERT denied (${label})`);
    const upd = await probe(pool, ctx, c => c.query(
      'UPDATE client_services SET show_gap=false WHERE client_id=$1', [seed.tenantA]));
    assert.equal(upd.ok?.rowCount ?? -1, 0, `R3 client_services UPDATE touches 0 rows (${label})`);
    const del = await probe(pool, ctx, c => c.query('DELETE FROM client_services WHERE client_id=$1', [seed.tenantA]));
    assert.equal(del.ok?.rowCount ?? -1, 0, `R3 client_services DELETE touches 0 rows (${label})`);
  }
  // Row-free membership check for C2's commit serviceId validation.
  assert.equal((await probe(pool, cfgT, one(
    "SELECT b17_content_fact('service',$1,$2) AS ok", [seed.tenantA, seed.service]))).ok?.ok, true,
    'R3 fact(service) proves linked membership row-free under config(T)');
  assert.equal((await probe(pool, cfgB, one(
    "SELECT b17_content_fact('service',$1,$2) AS ok", [seed.tenantB, seed.service]))).ok?.ok, false,
    'R3 foreign tenant is not linked');
  pass('R3 catalog writes reachable only for P contexts (both), W/C refused 42501, client_services mutation impossible everywhere, membership row-free');

  // ---- R4: P audit config branches ----
  noError(await probe(pool, scopeCtx, c => c.query(
    `INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
     VALUES(NULL,$1,'CREATE_SERVICE','services','{"r3":true}')`, [seed.ge])), 'R4 NULL-client catalog audit (scope)');
  noError(await probe(pool, cfgT, c => c.query(
    `INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
     VALUES(NULL,$1,'CREATE_ITEM','items','{"r3":true}')`, [seed.ge])), 'R4 NULL-client catalog audit (config)');
  noError(await probe(pool, cfgT, c => c.query(
    `INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
     VALUES($1,$2,'IMPORT_GRI_DISCLOSURES','standards','{"r3":true}')`, [seed.tenantA, seed.ge])),
    'R4 target-T commit audit');
  expectRls(await probe(pool, wA, c => c.query(
    `INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
     VALUES(NULL,$1,'CREATE_SERVICE','services','{}')`, [seed.ge])), 'R4 W cannot write catalog audit');
  expectRls(await probe(pool, cfgT, c => c.query(
    `INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
     VALUES($1,$2,'IMPORT_GRI_DISCLOSURES','standards','{}')`, [seed.tenantB, seed.ge])),
    'R4 commit audit with FOREIGN target-T refused');
  expectRls(await probe(pool, cfgT, c => c.query(
    `INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
     VALUES($1,$2,'USER_LOGIN','users','{}')`, [seed.tenantA, seed.ge])),
    'R4 action outside the closed config lists refused');
  pass('R4 P audit config branches: NULL-client (closed action list) + target-T import work; W, foreign-T and wrong-action refused');

  // ---- R5: answers/evaluations blobs unreachable under BOTH P contexts ----
  for (const [label, ctx] of [['platform.config(T)', cfgT], ['platform summary/work', scopeCtx]] as const) {
    assert.equal(await probe(pool, ctx, count('SELECT count(*)::int n FROM answers')).then(p => p.ok), 0,
      `${label}: answers rows unreachable`);
    assert.equal(await probe(pool, ctx, count('SELECT count(*)::int n FROM evaluations')).then(p => p.ok), 0,
      `${label}: evaluations rows unreachable`);
    const upd = await probe(pool, ctx, c => c.query("UPDATE answers SET value='blob' WHERE item_id=$1", [seed.item1]));
    assert.equal(upd.ok?.rowCount ?? -1, 0, `${label}: answers UPDATE touches 0 rows`);
    const sel = await probe(pool, ctx, async c => (await c.query(
      'SELECT value FROM answers WHERE item_id=$1', [seed.item1])).rows.length);
    assert.equal(sel.ok, 0, `${label}: answer VALUES never selectable`);
  }
  // platform.config is now SERVER-SIDE production code (C2 purpose binding),
  // so the R5 invariant is sharper: the literal may only ever appear as a
  // server-selected constant — never on a line that also reads request input
  // (req./request query/body/headers), which is what makes it unreachable
  // from request input.
  const offenders: string[] = [];
  for (const dir of ['server', 'lib']) {
    const root = decodeURIComponent(
      path.dirname(new URL(`../src/${dir}/x`, import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
    for (const f of readdirSync(root, { recursive: true })) {
      const rel = String(f);
      if (!/\.tsx?$/.test(rel) || /\.test\.ts$/.test(rel)) continue;
      const file = path.join(root, rel);
      try {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (line.includes("'platform.config'")
            && /(req|request)\s*\.|\.query\b|\.body\b|\.headers\b|\.get\(/.test(line))
            offenders.push(`${file}:${i + 1}`);
        });
      } catch { /* unreadable entries are not application source */ }
    }
  }
  assert.deepEqual(offenders, [], 'platform.config must never be derived from request input (line-level invariant)');
  pass('R5 blob denial: answers/evaluations rows+values unreachable under platform.config AND platform summary; platform.config never derived from request input');

  // ---- R6: freeze fact under platform.config(T) only ----
  const frozen = async (ctx: TenantContext, client: string, item: string) =>
    probe(pool, ctx, count('SELECT count(*)::int n FROM services WHERE is_scope_frozen($1,$2)', [client, item]))
      .then(p => p.ok);
  assert.equal(await frozen(cfgT, seed.tenantA, seed.itemF), 1, 'R6 config(T) resolves the frozen scope');
  assert.equal(await frozen(cfgT, seed.tenantA, seed.item1), 0, 'R6 config(T) unfrozen item stays false');
  assert.equal(await frozen(cfgB, seed.tenantB, seed.itemF), 0, 'R6 foreign T: same item never frozen');
  assert.equal(await frozen(cfgNull, seed.tenantA, seed.itemF), 0, 'R6 targetless/tenant-NULL config: false');
  assert.equal(await frozen(scopeCtx, seed.tenantA, seed.itemF), 0, 'R6 platform summary (tenant-NULL): false');
  assert.equal(await frozen(wA, seed.tenantA, seed.itemF), 1, 'R6 W regression: work context still resolves freeze');
  assert.equal(await probe(pool, cfgT, count(
    'SELECT count(*)::int n FROM review_snapshots WHERE client_id=$1', [seed.tenantA])).then(p => p.ok), 0,
    'R6 raw snapshot rows stay invisible even under config(T)');
  pass('R6 freeze true under platform.config(T) only; foreign T, tenant-NULL summary, targetless config all false; W stays true; raw snapshots invisible');

  // ---- R7: D1 counts truthful vs pre-activation truth; denied contexts RAISE ----
  const kinds = [['standard.disclosures', seed.std1, t.standardDisclosures],
    ['disclosure.items', seed.disc1, t.disclosureItems],
    ['item.answers', seed.item1, t.itemAnswers],
    ['item.evaluations', seed.item1, t.itemEvaluations],
    ['item.assignments', seed.item1, t.itemAssignments],
    ['item.evidence', seed.item1, t.itemEvidence]] as const;
  for (const [label, ctx] of [['config(T)', cfgT], ['targetless config (taxonomy delete posture)', cfgNull]] as const) {
    for (const [kind, ref, expect] of kinds) {
      const got = await probe(pool, ctx, one('SELECT b17_catalog_child_count($1,$2) AS n', [kind, ref]));
      noError(got, `R7 count ${kind} (${label})`);
      assert.equal(got.ok?.n, expect, `R7 count ${kind} must equal pre-activation truth (${label})`);
    }
  }
  assert.equal(t.itemAnswers, 2, 'truth includes the cross-tenant (B) answer: counts are catalog-wide');
  for (const [label, ctx] of [['platform summary/work', scopeCtx], ['W', wA], ['C', cA], ['E', eA],
    ['no purpose', { role: 'ge_admin' } as TenantContext]] as const) {
    const denied = await probe(pool, ctx, one('SELECT b17_catalog_child_count($1,$2) AS n',
      ['item.answers', seed.item1]));
    expectRaise(denied, 'b17.count_context', `R7 denied context raises (${label})`);
  }
  expectRaise(await probe(pool, cfgT, one('SELECT b17_catalog_child_count($1,$2) AS n', ['evil.kind', seed.item1])),
    'b17.count_args', 'R7 unknown kind refused');
  expectRaise(await probe(pool, cfgT, one('SELECT b17_catalog_child_count($1,$2) AS n', ['item.answers', null])),
    'b17.count_args', 'R7 null ref refused');
  const partialCtx = { ...cfgT, userId: undefined };
  expectRaise(await probe(pool, partialCtx, one('SELECT b17_catalog_child_count($1,$2) AS n',
    ['item.answers', seed.item1])), 'b17.count_context', 'R7 actor-less config refused');
  pass(`R7 D1 counts truthful (answers=${t.itemAnswers} incl. foreign tenant, assignments=${t.itemAssignments}, evidence=${t.itemEvidence}) under config; wrong purpose/actor/kind REFUSE with exception, never 0`);

  // ---- R8: notifications DELETE user_id identity (SHIELD-U2B3-01) ----
  // Actor = C (a tenant member): the membership clause means only member-owned
  // rows are ever reachable; identity then narrows to actor-own (+ trim mark).
  const phase1 = await probe(pool, cA, async c => {
    const del = await c.query('DELETE FROM notifications');
    assert.equal(del.rowCount, 1, `whole-table delete must touch only actor-own member rows, got ${del.rowCount}`);
    // E has no inbox read (§3.6); survival of E's row is proven the same way
    // the identity clause would be enforced for an E actor: whole-table DELETE
    // as E reaches exactly its own surviving row, nothing else.
    await setTenantContext(c, eA); // server-set rebind on the SAME transaction
    const eaOwnDelete = await c.query('DELETE FROM notifications');
    await setTenantContext(c, wA);
    const geRows = Number((await c.query('SELECT count(*)::int n FROM notifications')).rows[0].n);
    return { eaOwnDelete: eaOwnDelete.rowCount ?? -1, geRows };
  });
  noError(phase1, 'R8 phase1');
  assert.deepEqual(phase1.ok, { eaOwnDelete: 1, geRows: 1 },
    'R8: after the actor-own (C) whole-table delete, the E row still exists (E can reach exactly its own row) and the W row survives');
  const phase2 = await probe(pool, cA, async c => {
    // Insert for another own-tenant user: trigger marks trim target; delete must
    // now reach actor-own + trim-marked member rows only (trim path preserved).
    await c.query(`INSERT INTO notifications(user_id,client_id,type,title) VALUES($1,$2,'action.status','trim probe')`,
      [seed.ea, seed.tenantA]);
    const del = await c.query('DELETE FROM notifications');
    await setTenantContext(c, wA);
    const geRows = Number((await c.query('SELECT count(*)::int n FROM notifications')).rows[0].n);
    return { deleted: del.rowCount ?? -1, geRows };
  });
  noError(phase2, 'R8 phase2');
  // actor-own (1) + trim-marked ea rows (seeded 1 + new 1) = 3; ge row survives.
  assert.deepEqual(phase2.ok, { deleted: 3, geRows: 1 },
    'R8 trim branch reaches actor-own + marked member rows only (cap-trim preserved)');
  pass('R8 notifications DELETE identity: whole-table delete = actor-own member rows only; trim branch still reaches marked recipient (cap-trim preserved)');

  // ---- R9: D3 corrective check on the ALREADY-ACTIVATED /actions ----
  const cH: TenantContext = { purpose: 'work', role: 'client_admin', userId: seed.caH, mode: 'client',
    tenantId: seed.tenantH };
  const wH: TenantContext = { purpose: 'work', role: 'ge_admin', userId: seed.ge, mode: 'consultant',
    tenantId: seed.tenantH };
  const actionsOf = (ctx: TenantContext, tenant: string) =>
    probe(pool, ctx, count('SELECT count(*)::int n FROM actions WHERE client_id=$1', [tenant]))
      .then(p => { noError(p, 'R9'); return p.ok; });
  const aVisible = await actionsOf(cA, seed.tenantA);   // show_corrective=true  -> C sees them
  const hHidden = await actionsOf(cH, seed.tenantH);    // show_corrective=false -> C sees none
  const hW = await actionsOf(wH, seed.tenantH);         // W ignores the flag
  const aW = await actionsOf(wA, seed.tenantA);
  assert.deepEqual({ aVisible, hHidden, hW, aW }, { aVisible: 2, hHidden: 0, hW: 1, aW: 2 },
    'R9 C loses hidden corrective rows at the RLS layer while W keeps them (both states seeded)');
  pass('R9 D3 verdict: /actions already excludes show_corrective=false rows FOR C via the b17_actions fact gate (C: 2 visible vs 0 hidden; W: 2 and 1) — NO actions.ts pre-authorisation needed');

  // ---- Non-destructive proof ----
  const work = (tenant: string): TenantContext =>
    ({ purpose: 'work', role: 'ge_admin', userId: seed.ge, tenantId: tenant, mode: 'consultant' });
  const countIn = async (table: string, ctx: TenantContext) =>
    withTenantContext(ctx, async c => (await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n as number);
  const after = async () => ({
    clients: (await countIn('clients', work(seed.tenantA))) + (await countIn('clients', work(seed.tenantB)))
      + (await countIn('clients', work(seed.tenantH))),
    departments: (await countIn('departments', work(seed.tenantA))) + (await countIn('departments', work(seed.tenantB)))
      + (await countIn('departments', work(seed.tenantH))),
    users: await countIn('users', { purpose: 'auth.bootstrap' }),
    assignments: (await countIn('assignments', work(seed.tenantA))) + (await countIn('assignments', work(seed.tenantB))),
    // Answers: the seeded B answer sits under a zero-link tenant, so no work
    // context can see it post-activation (by design). Count answers globally
    // through the sanctioned internal count purpose so preservation still
    // covers every row, matching the pre-activation global snapshot exactly.
    answers: await countIn('answers', { purpose: 'scope.counts', role: 'ge_admin', userId: seed.ge }),
    client_services: (await countIn('client_services', work(seed.tenantA))) + (await countIn('client_services', work(seed.tenantB)))
      + (await countIn('client_services', work(seed.tenantH))),
  });
  assert.deepEqual(await after(), seed.business, 'no seeded business row may be added or removed by this proof');
  pass('non-destructive: clients/departments/users/assignments/answers/client_services counts unchanged');

  await pool.end();
  console.log('U2-C1 SUBSTRATE PROOF COMPLETE (re-run post-C2): R1-R9 green, exactly 23 taxonomy/gri flips, catalog/P context negatives held.');
}

main().catch(err => { console.error(err); process.exit(1); });
