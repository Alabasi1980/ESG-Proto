// B17 U2-A domain proof, extended by U2-B0 (policy substrate) and by U2-B
// round 3 (the 13-route retrofit + first registry flips) â€” explicit
// disposable PostgreSQL 18 only.
// node --import tsx scripts/b17-domain-proof.ts --allow-disposable-b17 --database-url=<loopback named b17_*scratch* DB>
//
// Guards copied from b17-workspace-proof.ts: named disposable loopback DB,
// explicit --allow opt-in, non-superuser/non-BYPASSRLS runtime role, no ambient
// .env (no dotenv import; DATABASE_URL comes only from argv).
//
// NON-DESTRUCTIVE by contract: this script never DELETEs assignments, answers or
// any business row أ¢â‚¬â€‌ it distinguishes itself by SEEDING extra rows (second
// department, frozen disclosure, tenant B, content-inventory fixtures) and
// proving they survive untouched. Every ط¢آ§3 policy probe runs inside its own
// transaction and is ALWAYS rolled back.
//
// It applies BOTH offline versions through the real migration path (U1
// b17.sql, then the U2D content transaction carrying the U2-B0 policies) and
// then exercises the four domains' ط¢آ§3 positives/negatives through FORCE RLS.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import express from 'express';
import cookieParser from 'cookie-parser';
import { getPool, runMigrations, withTenantContext, setTenantContext, type TenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, verifyB17, verifyB17Content, STRUCTURE_SQL,
  B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { parseB17ContentSources, inventoryB17ContentOffline, applyB17ContentOffline,
  type ContentTarget, type ContentSources } from '../src/db/b17ContentMigration.ts';
import { hashPassword, verifyToken } from '../src/server/auth.ts';
import { requireDomainAccess, assertRouteContext, hashTab } from '../src/server/access.ts';
import { LEGACY_ROUTES, ACCESS_REGISTRY, classifyRoute } from '../src/server/accessRegistry.ts';
import { activeBusinessCapabilities } from '../src/lib/capabilities.ts';
import { NOTIFICATION_INBOX_LIMIT } from '../src/server/routes/_shared.ts';
import { MAX_ATTACHMENT_BYTES, validateAttachment } from '../src/lib/approvalChain.ts';
import { canTransitionAction, actionTransitionRequiresReason } from '../src/lib/actions.ts';
import apiRouter from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';

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

async function main() {
  const pool = getPool();
  const role = (await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0,
    'Scratch must start empty; never reset or replay an existing application DB.');
  assert.equal((await runMigrations()).success, true);

  // Seed BEFORE U1 activation (predecessor policies allow the GE fixture context),
  // exactly like b17-workspace-proof: catalog + tenant fixture rows are INSERT-only.
  const password = `Aa1!${randomBytes(16).toString('hex')}`;
  // Approved OD-10 provenance extracts (ControlPath, read-only) drive the exact-ID
  // content inventory the real applyB17ContentOffline path requires. Batch labels
  // are fixture-local; they never appear in live data or logs.
  const GRI_BATCH = 'b17u2b0-fixture-gri', PROFILE_BATCH = 'b17u2b0-fixture-profile';
  const sources: ContentSources = parseB17ContentSources(
    readFileSync(new URL('../../prototype/GRI_SOURCE_EXTRACT.csv', import.meta.url), 'utf8'),
    readFileSync(new URL('../../prototype/ESG_PROFILE_EXTRACT.csv', import.meta.url), 'utf8'));
  const seed = await withTenantContext({ role: 'ge_admin' }, async c => {
    const tenants: string[] = [], departments: string[][] = [];
    for (const name of ['A', 'B', 'D']) {
      const id = (await c.query('INSERT INTO clients(code,name) VALUES($1,$1) RETURNING id', [`B17U2A-${name}`])).rows[0].id;
      tenants.push(id); const ds: string[] = [];
      for (const code of ['one', 'two']) ds.push((await c.query(
        'INSERT INTO departments(client_id,code,name) VALUES($1,$2,$2) RETURNING id', [id, code])).rows[0].id);
      departments.push(ds);
    }
    const mk = async (name: string, role: string, tenant: string | null = null, department: string | null = null) =>
      (await c.query(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [`${name}@b17u2a.invalid`, await hashPassword(password), name, role, tenant, department])).rows[0].id as string;
    const ge = await mk('ge', 'ge_admin'), ca = await mk('client', 'client_admin', tenants[0]),
      ea = await mk('employee', 'employee', tenants[0], departments[0][0]), changer = await mk('changer', 'ge_admin');
    const standard = (await c.query("INSERT INTO standards(code,title,category) VALUES('B17U2A','Fixture','Universal') RETURNING id")).rows[0].id;
    const disclosure = (await c.query("INSERT INTO disclosures(standard_id,code,title) VALUES($1,'B17U2A','Fixture') RETURNING id", [standard])).rows[0].id;
    const item = (await c.query("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'B17U2A','Fixture','high','governance') RETURNING id", [disclosure])).rows[0].id;
    // U2-C2 fixtures (INSERT-only, still pre-activation): a SECOND item for the
    // equivalent-link read/write rows, and the link itself.
    const item2 = (await c.query("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'B17U2A-2','Fixture two','mid','governance') RETURNING id", [disclosure])).rows[0].id;
    await c.query(`INSERT INTO item_links(item_a,item_b,relation,created_by)
      VALUES($1,$2,'equivalent',$3)`, [item, item2, ge]);
    // U2-C2 UNSCOPED fixture: a catalog branch linked to NO service — P must
    // see it while W/C/E must not (scoping numbers differ per context).
    const std3 = (await c.query("INSERT INTO standards(code,title,category) VALUES('B17U2C-N','Unmapped fixture','Universal') RETURNING id")).rows[0].id;
    const disc3 = (await c.query("INSERT INTO disclosures(standard_id,code,title) VALUES($1,'B17U2C-N','Unmapped fixture') RETURNING id", [std3])).rows[0].id;
    await c.query("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'B17U2C-N-1','Unmapped item','low','governance')", [disc3]);
    const service = (await c.query("SELECT id FROM services WHERE code='GRI'")).rows[0].id;
    await c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$2,true,true)', [tenants[0], service]);
    // U2-C2 overlap fixture: a SECOND service linked to A sharing the SAME
    // standard — dashboard/list counts must count each item exactly once.
    const service2 = (await c.query("INSERT INTO services(code,name) VALUES('U2C-S2','Second linked service') RETURNING id")).rows[0].id;
    await c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$2,true,true)', [tenants[0], service2]);
    await c.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2)', [service2, standard]);
    // U2-C2 hidden-gap tenant D: linked to GRI but show_gap=false — its C
    // dashboard must return null score/gap fields (redaction, §6/D3).
    const caD = await mk('clientd', 'client_admin', tenants[2]);
    await c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$2,false,false)', [tenants[2], service]);
    // Seeded (never deleted): assignment+answer for BOTH departments of tenant A.
    for (const d of departments[0]) await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [tenants[0], item, d]);
    const answerId = (await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'submitted','u2a seeded') RETURNING id`, [tenants[0], item, departments[0][0], ea])).rows[0].id as string;
    // U2-C2: a REAL submitted evaluation for (A, item) — the dashboard numerator
    // (F-01 gate) and the truthful DELETE /items refusal count (1 evaluation).
    await c.query(`INSERT INTO evaluations(client_id,item_id,evaluator_id,score,not_evaluated,not_applicable)
      VALUES($1,$2,$3,50,false,false)`, [tenants[0], item, ea]);
    // U2-C2: a second evaluation on item2 — the links overlay shows it (100)
    // while the dashboard keeps it out of the numerator (no submitted answer,
    // F-01 gate), proving overlay-vs-numerator separation with real numbers.
    await c.query(`INSERT INTO evaluations(client_id,item_id,evaluator_id,score,not_evaluated,not_applicable)
      VALUES($1,$2,$3,100,false,false)`, [tenants[0], item2, ea]);
    // U2-C2 cross-tenant fixture: tenant B answers the SAME global catalog item,
    // so delete-refusal counts must be catalog-wide truthful (3 answers total).
    const eb = await mk('employeeb', 'employee', tenants[1], departments[1][0]);
    await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'draft','u2c2 cross-tenant answer')`, [tenants[1], item, departments[1][0], eb]);
    // Seeded (never deleted): U2-B fixtures for the RLS-readiness probes in
    // section G أ¢â‚¬â€‌ predecessor policies still admit GE INSERTs before activation.
    const actionId = (await c.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
      VALUES($1,$2,$3,'U2B seeded action','open') RETURNING id`, [tenants[0], item, departments[0][0]])).rows[0].id as string;
    const notifyOwn = (await c.query(`INSERT INTO notifications(user_id,client_id,type,title)
      VALUES($1,$2,'action.status','U2B seeded inbox row') RETURNING id`, [ca, tenants[0]])).rows[0].id as string;
    const notifyPlatform = (await c.query(`INSERT INTO notifications(user_id,client_id,type,title)
      VALUES($1,NULL,'action.status','U2B seeded platform row') RETURNING id`, [ca])).rows[0].id as string;
    const attachmentId = (await c.query(`INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
      VALUES($1,'seed.txt','text/plain',4,decode('73656564','hex'),$2) RETURNING id`, [answerId, ea])).rows[0].id as string;

    // ---- U2-B0 four-domain fixtures (INSERT-only, still pre-activation) ----
    const e2 = await mk('employee2', 'employee', tenants[0], departments[0][1]);
    // Third member of E's own department: lets the E2E section prove the
    // "E only on its own upload" delete clause against a non-E uploader.
    const e3 = await mk('employee3', 'employee', tenants[0], departments[0][0]);
    // Same department, DIFFERENT uploader: an attachment E may see but must
    // not delete (uploader clause) for W to remove with its scoped authority.
    const otherAttachmentId = (await c.query(`INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
      VALUES($1,'other.txt','text/plain',4,decode('6f74686572','hex'),$2) RETURNING id`, [answerId, e3])).rows[0].id as string;
    // Second action in ANOTHER own-company department (C covers ALL own-company
    // departments, never just one) plus one action in tenant B (must stay hidden).
    const actionId2 = (await c.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
      VALUES($1,$2,$3,'U2B seeded action dept two','open') RETURNING id`,
      [tenants[0], item, departments[0][1]])).rows[0].id as string;
    const actionB = (await c.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
      VALUES($1,$2,$3,'U2B seeded foreign action','open') RETURNING id`,
      [tenants[1], item, departments[1][0]])).rows[0].id as string;
    // A SECOND, frozen disclosure keeps every positive fixture above writable:
    // is_scope_frozen(A, item1) stays false while itemF's scope is GE-final.
    const frozenStandard = (await c.query(
      "INSERT INTO standards(code,title,category) VALUES('B17U2AF','Fixture frozen','Universal') RETURNING id")).rows[0].id;
    const frozenDisclosure = (await c.query(
      "INSERT INTO disclosures(standard_id,code,title) VALUES($1,'B17U2AF','Fixture frozen') RETURNING id",
      [frozenStandard])).rows[0].id;
    const frozenItem = (await c.query(
      "INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'B17U2AF','Fixture frozen','high','governance') RETURNING id",
      [frozenDisclosure])).rows[0].id;
    // Assigned in E's department so E's own write REACHES the freeze trigger
    // (RLS must admit the row; the trigger, not the policy, is what refuses it).
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',
      [tenants[0], frozenItem, departments[0][0]]);
    // U2-C2: a second equivalent link where BOTH ends are E-assigned — E's
    // links read must show exactly this one (both ends L+D), never item↔item2.
    await c.query(`INSERT INTO item_links(item_a,item_b,relation,created_by)
      VALUES($1,$2,'equivalent',$3)`, [item, frozenItem, ge]);
    const frozenAnswerId = (await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'draft','frozen fixture') RETURNING id`,
      [tenants[0], frozenItem, departments[0][0], ea])).rows[0].id as string;
    const frozenAttachmentId = (await c.query(`INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
      VALUES($1,'frozen.txt','text/plain',4,decode('66726f7a','hex'),$2) RETURNING id`,
      [frozenAnswerId, ea])).rows[0].id as string;
    await c.query(`INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash)
      VALUES($1,'disclosure',$2,'{}','b17-u2b0-fixture')`, [tenants[0], frozenDisclosure]);
    // Foreign department, SAME tenant: never E's own department (R+L+D denial).
    const foreignAnswerId = (await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'draft','foreign department fixture') RETURNING id`,
      [tenants[0], item, departments[0][1], e2])).rows[0].id as string;
    // Both fixture standards ride the pre-existing GRI membership (the content
    // migration maps the approved-CSV standard itself; nothing is re-granted).
    await c.query(`INSERT INTO service_standards(service_id,standard_id)
      SELECT $1,id FROM standards WHERE code IN ('B17U2A','B17U2AF')`, [service]);
    // One inbox row per ط¢آ§3 context, plus rows that must stay invisible to it.
    const notifyRow = async (user: string, client: string | null, title: string) =>
      (await c.query(`INSERT INTO notifications(user_id,client_id,type,title) VALUES($1,$2,'action.status',$3) RETURNING id`,
        [user, client, title])).rows[0].id as string;
    const notifyW = await notifyRow(ge, tenants[0], 'U2B0 consultant inbox row');
    const notifyP = await notifyRow(ge, null, 'U2B0 platform inbox row');
    const notifyE = await notifyRow(ea, tenants[0], 'U2B0 employee inbox row (must stay hidden)');
    const notifyForeign = await notifyRow(ge, tenants[1], 'U2B0 foreign inbox row');
    // Second own-company row for C, seeded ALREADY READ: keeps the B0 G-section
    // counts exact while giving H two visible C inbox rows.
    const notifyOwn2 = (await c.query(`INSERT INTO notifications(user_id,client_id,type,title,read_at)
      VALUES($1,$2,'action.status','U2B0 second own inbox row (already read)',now()) RETURNING id`,
      [ca, tenants[0]])).rows[0].id as string;
    // Audit rows outside U2D's former lifecycle allow-list + outside A.
    await c.query(`INSERT INTO audit_log(client_id,action,entity_type,payload)
      VALUES(NULL,'PLATFORM_EVENT','platform','{}')`);
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload)
      VALUES($1,$2,'ACTION_CREATED','actions',$3,'{}')`, [tenants[1], ge, actionId]);
    // An A business event ACTED BY THE CLIENT ADMIN: the W audit JOIN must
    // resolve its own-tenant actor name (D1 repair of the users JOIN).
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload)
      VALUES($1,$2,'ACTION_EVIDENCE_UPDATED','actions',$3,'{}')`, [tenants[0], ca, actionId]);

    // ---- OD-10 content-inventory fixture: exact approved-CSV provenance keys ----
    const [griStdCode, griDiscCode, griItemCode, griRequirement] = JSON.parse(sources.griKeys[0]) as string[];
    const [profPillar, profDepartment, profTopic, profParameter] = JSON.parse(sources.profileKeys[0]) as string[];
    const contentStandard = (await c.query("INSERT INTO standards(code,title,category) VALUES($1,$1,'Governance') RETURNING id",
      [griStdCode])).rows[0].id;
    const contentDisclosure = (await c.query("INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2) RETURNING id",
      [contentStandard, griDiscCode])).rows[0].id;
    await c.query(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class,import_batch_id)
      VALUES($1,$2,$3,'high','governance',$4)`, [contentDisclosure, griItemCode, griRequirement, GRI_BATCH]);
    const contentProfile = (await c.query(`INSERT INTO esg_profile(client_id,pillar,department,topic,parameter,import_batch_id,profile_rating)
      VALUES($1,$2,$3,$4,$5,$6,3) RETURNING id`,
      [tenants[0], profPillar, profDepartment, profTopic, profParameter, PROFILE_BATCH])).rows[0].id;
    const reportSettingId = (await c.query(`INSERT INTO report_settings(client_id,level,notification_recorded,
      disclosure_level,report_level,notified) VALUES($1,'in_accordance',false,'in-accordance','L1','done') RETURNING id`,
      [tenants[0]])).rows[0].id as string;
    const reportAuditId = (await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload)
      VALUES($1,$2,'REPORT_SETTINGS_SAVED','report_settings',$3,$4) RETURNING id`,
      [tenants[0], ge, reportSettingId, JSON.stringify({ targetTenant: tenants[0], serviceId: null,
        disclosureLevel: 'in-accordance', reportLevel: 'L1', notified: 'done' })])).rows[0].id as string;
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload)
      VALUES($1,$2,'IMPORT_GRI_DISCLOSURES','standards',$3,$4)`,
      [tenants[0], ge, contentStandard, JSON.stringify({ targetTenant: tenants[0], importBatchId: GRI_BATCH })]);
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload)
      VALUES($1,$2,'ESG_PROFILE_IMPORTED','esg_profile',$3,$4)`,
      [tenants[0], ge, contentProfile, JSON.stringify({ targetTenant: tenants[0], importBatchId: PROFILE_BATCH })]);
    const targets: ContentTarget[] = [{ clientId: tenants[0], griBatchId: GRI_BATCH,
      profileBatchId: PROFILE_BATCH, reportSettingId, reportAuditId }];

    const n = async (t: string) => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n as number;
    return { tenants, departments, ge, ca, ea, caD, e2, e3, changer, item, item2, frozenItem,
      standard, disclosure, std3, service, answerId, foreignAnswerId,
      frozenAnswerId, frozenAttachmentId, actionId, actionId2, actionB, notifyOwn, notifyOwn2,
      notifyPlatform, notifyW, notifyP, notifyE, notifyForeign, attachmentId, otherAttachmentId, targets,
      before: { clients: await n('clients'), departments: await n('departments'), users: await n('users'),
        standards: await n('standards'), disclosures: await n('disclosures'), items: await n('items'),
        services: await n('services'), client_services: await n('client_services'),
        assignments: await n('assignments'), answers: await n('answers') } };
  });
  assert.deepEqual(seed.before, { clients: 3, departments: 6, users: 8, standards: 4, disclosures: 4,
    items: 5, services: seed.before.services, client_services: 3, assignments: 3, answers: 4 });
  assert.ok(seed.before.services >= 1, 'GRI service must be pre-seeded by schema');
  const admin = await pool.connect();
  try { assert.equal(await applyB17Offline(admin), 'applied'); } finally { admin.release(); }
  await assertB17Ready();
  // U2D content version + the U2-B0 policy substrate, through the REAL offline
  // migration path (inventory -> apply -> ledger-last -> readiness). Idempotent
  // re-apply must be a verified no-op, never a second DDL pass.
  const contentAdmin = await pool.connect();
  try {
    const inventory = await inventoryB17ContentOffline(contentAdmin, seed.targets, sources);
    assert.equal(await applyB17ContentOffline(contentAdmin, inventory, sources), 'applied');
    assert.equal(await applyB17ContentOffline(contentAdmin, inventory, sources), 'verified');
  } finally { contentAdmin.release(); }
  await assertB17Ready();
  assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum, B17_CONTENT_SHAPE,
    'effective catalog must equal the content-version structure/authority fingerprint');
  pass('guards: opt-in loopback scratch, non-superuser/non-BYPASSRLS PG18, empty start, seeded INSERT-only fixtures, offline U1 + U2D/B0 content activation, readiness green');

  // Neither U1 nor the content/B0 delta grants ANY catalog mutation policy: a
  // no-op UPDATE must still touch 0 rows, so seeded catalog rows stay frozen.
  for (const [table, where] of [['standards', "code='B17U2A'"], ['disclosures', "code='B17U2A'"],
    ['items', "code='B17U2A'"], ['services', "code='GRI'"]] as const) {
    assert.equal((await pool.query(`UPDATE ${table} SET id=id WHERE ${where}`)).rowCount, 0,
      `${table} must be unreachable under the activated policy set`);
  }
  const work = (tenant: string): TenantContext =>
    ({ purpose: 'work', role: 'ge_admin', userId: seed.ge, tenantId: tenant, mode: 'consultant' });
  const count = async (table: string, ctx: TenantContext) =>
    withTenantContext(ctx, async c => (await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n as number);
  const preserved = async () => ({
    clients: (await count('clients', work(seed.tenants[0]))) + (await count('clients', work(seed.tenants[1]))),
    departments: (await count('departments', work(seed.tenants[0]))) + (await count('departments', work(seed.tenants[1]))),
    users: await count('users', { purpose: 'auth.bootstrap' }),
    client_services: (await count('client_services', work(seed.tenants[0])))
      + (await count('client_services', work(seed.tenants[1]))),
    assignments: (await count('assignments', work(seed.tenants[0]))) + (await count('assignments', work(seed.tenants[1]))),
    answers: (await count('answers', work(seed.tenants[0]))) + (await count('answers', work(seed.tenants[1]))),
  });
  assert.deepEqual(await preserved(), { clients: 2, departments: 4, users: 8, client_services: 2,
    assignments: 3, answers: 3 });

  const app = express();
  app.use(jsonInput); app.use(cookieParser()); app.use('/api', apiRouter); app.use(globalJsonErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const api = async (method: string, path: string, token?: string, body?: unknown,
    tab?: { tabHandle: string; generation: number }, extra: Record<string, string> = {}) => {
    const response = await fetch(base + path, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(tab ? { 'X-Workspace-Tab': tab.tabHandle, 'X-Workspace-Version': String(tab.generation) } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  const login = async (name: string) => {
    const r = await api('POST', '/auth/login', undefined, { email: `${name}@b17u2a.invalid`, password });
    assert.equal(r.status, 200, `${name} login`); return r.json.token as string;
  };
  try {
    const ge = await login('ge'), ca = await login('client'), employee = await login('employee'), changer = await login('changer');
    const tabResult = await api('POST', '/workspace/tab', ge, {});
    assert.equal(tabResult.status, 201);
    const t = { tabHandle: tabResult.json.tabHandle as string, generation: 1 };

    // --- A: requireDomainAccess admission + ط¢آ§3 context (real login/tab state) ---
    // Isolated probe app WITHOUT the dispatcher: exercises the wrapper itself أ¢â‚¬â€‌
    // SHIELD-U2A-01 (refuses non-U1 activation here, not only via dispatcher
    // ordering) and SHIELD-U2A-02 (mode/tenant vs the route's ط¢آ§3 row + the
    // locked tab read). In production the dispatcher runs the same gates first.
    const probe = express.Router();
    const echo = (req: any, res: any) => res.json({ access: req.access });
    probe.get('/ge/overview', requireDomainAccess, echo);   // UNACTIVATED
    probe.get('/auth/me', requireDomainAccess, echo);          // U1, SESSION row
    probe.post('/workspace/enter', requireDomainAccess, echo); // U1, P-only row
    probe.post('/clients', requireDomainAccess, echo);         // UNACTIVATED (U2-F admin)
    const probeApp = express();
    probeApp.use(jsonInput); probeApp.use(cookieParser()); probeApp.use('/api', probe);
    const probeServer = probeApp.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => probeServer.once('listening', resolve));
    const pbase = `http://127.0.0.1:${(probeServer.address() as { port: number }).port}/api`;
    const probeGet = async (path: string, token?: string, tab?: typeof t, extra: Record<string, string> = {}) => {
      const r = await fetch(pbase + path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(tab ? { 'X-Workspace-Tab': tab.tabHandle, 'X-Workspace-Version': String(tab.generation) } : {}), ...extra } });
      return { status: r.status, json: await r.json() };
    };
    const probePost = async (path: string, token: string, tab?: typeof t) => {
      const r = await fetch(pbase + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json', ...(tab ? { 'X-Workspace-Tab': tab.tabHandle,
          'X-Workspace-Version': String(tab.generation) } : {}) } });
      return { status: r.status, json: await r.json() };
    };
    try {
      // A1 أ¢â‚¬â€‌ SHIELD-U2A-01: the wrapper itself refuses a non-U1 route, for every
      // context, before any context derivation (no tab, session or DB work).
      for (const [token, tabArg] of [[undefined, undefined], [ge, t], [ca, undefined],
        [employee, undefined]] as const) {
        const r = await probeGet('/ge/overview', token, tabArg);
        assert.deepEqual([r.status, r.json.code], [403, 'access.unactivated'],
          'SHIELD-U2A-01: requireDomainAccess must refuse an UNACTIVATED route itself');
      }
      const unactivatedPost = await fetch(pbase + '/clients', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `token=${ca}` } });
      assert.deepEqual([unactivatedPost.status, (await unactivatedPost.json()).code],
        [403, 'access.unactivated'], 'SHIELD-U2A-01 on a mutating route (before auth/context)');
      pass('SHIELD-U2A-01: requireDomainAccess refuses non-U1 activation itself (GET+POST ط£â€”4 contexts)');

      // A2 أ¢â‚¬â€‌ context attachment on an ADMITTED U1 declaration (SESSION row).
      const gp = await probeGet(`/auth/me?clientId=${seed.tenants[1]}`, ge, t); // before enter: platform, gen 1
      assert.equal(gp.status, 200, JSON.stringify(gp.json));
      assert.equal(gp.json.access.role, 'ge_admin'); assert.equal(gp.json.access.mode, 'platform');
      assert.equal(gp.json.access.tenantId, null, 'platform context must ignore any supplied clientId');
      assert.equal(gp.json.access.generation, 1); assert.equal(gp.json.access.capability, 'session');
      assert.ok(gp.json.access.tabId && gp.json.access.actorId === seed.ge && gp.json.access.sessionId);
      const entered = await api('POST', '/workspace/enter', ge, { clientId: seed.tenants[0] }, t);
      assert.equal(entered.status, 200); t.generation = 2;
      const ge2 = await login('ge');
      const t2r = await api('POST', '/workspace/tab', ge2, {});
      const t2 = { tabHandle: t2r.json.tabHandle as string, generation: 1 };
      const gw = await probeGet('/auth/me', ge, t);
      assert.equal(gw.json.access.mode, 'consultant'); assert.equal(gw.json.access.tenantId, seed.tenants[0]);
      const cp = await probeGet(`/auth/me?clientId=${seed.tenants[1]}`, ca);
      assert.equal(cp.status, 200); assert.equal(cp.json.access.mode, 'client');
      assert.equal(cp.json.access.tenantId, seed.tenants[0], 'client context stays own company');
      assert.equal(cp.json.access.departmentId, null); assert.equal(cp.json.access.tabId, null);
      const ep = await probeGet(`/auth/me?clientId=${seed.tenants[1]}&departmentId=${seed.departments[1][0]}`, employee);
      assert.equal(ep.status, 200); assert.equal(ep.json.access.mode, 'employee');
      assert.equal(ep.json.access.tenantId, seed.tenants[0]); assert.equal(ep.json.access.departmentId, seed.departments[0][0]);
      assert.equal(ep.json.access.tabId, null, 'employee can never enter a GE tab context');
      const forgedTab = await probeGet('/auth/me', ca, t);
      assert.equal(forgedTab.json.access.tabId, null, 'foreign tab headers are ignored for lower roles');
      assert.equal((await probeGet('/auth/me', ge)).status, 409); // missing handle
      assert.equal((await probeGet('/auth/me', ge, { ...t, generation: 0 })).status, 400); // invalid version
      assert.equal((await probeGet('/auth/me', ge, { ...t, generation: 1 })).status, 409); // stale generation
      assert.equal((await probeGet('/auth/me', ge, t2)).status, 409); // other-session handle
      pass('wrapper attaches P/W/C/E contexts from real login+tab state; supplied ids never become the context source');

      // A3 أ¢â‚¬â€‌ SHIELD-U2A-02 mode/tenant validation against the route's ط¢آ§3 row.
      const enterPlatform = await probePost('/workspace/enter', ge2, t2); // platform tab, P-only row
      assert.equal(enterPlatform.status, 200, JSON.stringify(enterPlatform.json));
      assert.equal(enterPlatform.json.access.mode, 'platform');
      assert.equal(enterPlatform.json.access.tenantId, null, 'P row must carry no tenant');
      const enterConsultant = await probePost('/workspace/enter', ge, t); // consultant tab, P-only row
      assert.deepEqual([enterConsultant.status, enterConsultant.json.code], [403, 'workspace.mode_mismatch'],
        'consultant tab hitting a P-only row must be 403 workspace.mode_mismatch');
      const wOnly = classifyRoute('POST', '/actions');
      assert.ok(wOnly, 'the ط¢آ§3.5 W-only row must exist');
      assert.throws(() => assertRouteContext(wOnly, enterPlatform.json.access),
        (err: any) => err?.statusCode === 403 && err?.code === 'workspace.mode_mismatch',
        'platform tab hitting a W-only row must be 403 workspace.mode_mismatch');
      assert.equal((await probePost('/workspace/enter', ca)).status, 403,
        'a lower role can never satisfy a GE row');
      pass('SHIELD-U2A-02: platformأ¢â€ â€‌W-only and consultantأ¢â€ â€‌P-only both refused 403 workspace.mode_mismatch');

      // A4 أ¢â‚¬â€‌ the GE context attachment locks workspace_tabs FOR UPDATE like withWorkspace.
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        const holderSid = verifyToken(ge)!.sid;
        await setTenantContext(holder, { purpose: 'workspace', userId: seed.ge, sessionId: holderSid });
        const held = await holder.query(
          'SELECT id FROM workspace_tabs WHERE handle_hash=$1 AND session_id=$2 FOR UPDATE',
          [hashTab(t.tabHandle), holderSid]);
        assert.equal(held.rowCount, 1, 'the harness must hold the exact tab row');
        const pending = probeGet('/auth/me', ge, t);
        const raced = await Promise.race([pending.then(() => 'settled' as const),
          new Promise(resolve => setTimeout(() => resolve('blocked' as const), 800))]);
        assert.equal(raced, 'blocked',
          'deriveDomainAccess must block on workspace_tabs FOR UPDATE (same lock as withWorkspace)');
        await holder.query('ROLLBACK');
        const released = await pending;
        assert.deepEqual([released.status, released.json.access.generation], [200, t.generation],
          JSON.stringify(released.json));
      } finally {
        try { await holder.query('ROLLBACK'); } catch { /* already released */ }
        holder.release();
      }
      pass('SHIELD-U2A-02: context attachment blocks on workspace_tabs FOR UPDATE, completes after release');
    } finally { await new Promise<void>((resolve, reject) => probeServer.close(err => err ? reject(err) : resolve())); }

    // --- B: every still-UNACTIVATED declaration stays denied (dispatcher) ---
    // U2-B flipped 13 rows, U2-C 23 more, U2-D 11 and U2-E all fifteen
    // evaluations/reviews rows (87 -> 74 -> 51 -> 40 -> 34 -> 25); the flipped
    // rows are exercised END-TO-END through the real chain in sections H/I
    // (the six E-1 reads in scripts/b17-domain-e1.ts, the nine E-2 writes in
    // scripts/b17-domain-e2.ts).
    let denied = 0;
    for (const route of LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED')) {
      for (const [token, tab] of [[undefined, undefined], [ge, t], [ca, undefined], [employee, undefined]] as const) {
        const r = await api(route.method, route.path.replace(/:[^/]+/g, randomUUID()), token, undefined, tab);
        assert.equal(r.status, 403, `${route.method} ${route.path}`);
        assert.equal(r.json.code, 'access.unactivated');
        denied++;
      }
    }
    assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').length, 25);
    assert.equal(denied, 25 * 4);
    pass('all 25 remaining unactivated business routes still 403 access.unactivated across 4 contexts');

    // --- C: the 8 active system/session routes keep their current behavior ---
    assert.deepEqual((await api('GET', '/db/status')).json, { configured: true, connected: true });
    assert.equal((await api('POST', '/db/migrate')).status, 409);
    assert.equal((await api('POST', '/db/migrate')).json.code, 'migrations.offline_only');
    assert.deepEqual((await api('GET', '/setup/status')).json, { canSetup: false, needsMigration: false });
    assert.equal((await api('POST', '/setup/admin', undefined,
      { email: 'late@b17u2a.invalid', name: 'Late', password })).status, 403);
    assert.equal((await api('POST', '/setup/admin', ge, { email: 'late@b17u2a.invalid', name: 'Late', password })).status, 403);
    assert.equal((await api('POST', '/auth/login', undefined, { email: 'ge@b17u2a.invalid', password: 'wrong' })).status, 401);
    assert.equal((await api('GET', '/auth/me', 'Bearer-injected')).status, 401);
    assert.equal((await api('GET', '/auth/me', ge)).status, 200);
    assert.equal((await api('POST', '/auth/change-password', changer,
      { currentPassword: 'wrong', newPassword: password })).status, 400);
    const changed = await api('POST', '/auth/change-password', changer,
      { currentPassword: password, newPassword: `${password}x` });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    const throwaway = await login('ge');
    assert.equal((await api('POST', '/auth/logout', throwaway, {})).status, 200);
    const cookieOnly = await fetch(base + '/auth/logout', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${ca}` }, body: '{}' });
    assert.equal(cookieOnly.status, 403);
    assert.equal((await api('GET', '/auth/me', ge)).status, 200, 'other sessions stay usable');
    pass('8 active system/session routes byte-compatible: status/migrate/setup/login/logout/me/change-password');

    // --- D: matrix-coverage table test passes ---
    const coverage = spawn(process.execPath, ['--import', 'tsx', '--test', 'src/lib/domainAccess.test.ts'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    const chunks: string[] = [];
    coverage.stdout.on('data', b => { chunks.push(String(b)); });
    coverage.stderr.on('data', b => { chunks.push(String(b)); });
    const code = await new Promise<number | null>((resolve, reject) => {
      coverage.once('error', reject); coverage.once('exit', resolve);
    });
    assert.equal(code, 0, `domainAccess.test failed:\n${chunks.join('').slice(-2000)}`);
    assert.equal(ACCESS_REGISTRY.length, 99);
    assert.ok(classifyRoute('GET', '/queue')?.matrix.length);
    pass('registry-coverage table test passes (99 declarations, ط¢آ§3/ط¢آ§4 matrix exact, mounted routers covered)');

    // --- E: non-destructive proof أ¢â‚¬â€‌ every seeded business row survives ---
    assert.deepEqual(await preserved(), { clients: 2, departments: 4, users: 8, client_services: 2,
      assignments: 3, answers: 3 }, 'no business row may be added or removed by this proof');
    pass('seeded assignments/answers/clients/membership rows unchanged (no DELETE, no membership churn)');

    // --- G: ط¢آ§3 positives for the four U2-B0 domains through the REAL FORCE-RLS layer ---
    // The policy substrate landed in src/db/b17-content.sql and was applied by the
    // real offline content migration above, so every ط¢آ§3 positive now succeeds as
    // the non-bypass table owner and every previously-denied context is still
    // denied. These are direct SQL probes through FORCE RLS — not a helper bypass,
    // and not a route (activation truth lives in sections B/H/I). Every probe runs
    // in its own transaction and ALWAYS rolls back: nothing is ever committed.
    const rls = async (ctx: TenantContext, run: (client: any) => Promise<any>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await setTenantContext(client, ctx);
        const value = await run(client);
        await client.query('ROLLBACK');
        return { value, error: null as any };
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
        return { value: null, error };
      } finally { client.release(); }
    };
    const work = (over: Partial<TenantContext>): TenantContext => ({ purpose: 'work', userId: seed.ge, ...over });
    const platform = work({ role: 'ge_admin', mode: 'platform', tenantId: null });
    // P-mode carrying a tenant: the ط¢آ§3 mode/tenant mismatch that must stay denied.
    const platformAt = { ...platform, tenantId: seed.tenants[0] };
    const consultant = work({ role: 'ge_admin', mode: 'consultant', tenantId: seed.tenants[0] });
    const clientCtx = work({ role: 'client_admin', mode: 'client', userId: seed.ca, tenantId: seed.tenants[0] });
    const employeeCtx = work({ role: 'employee', mode: 'employee', userId: seed.ea,
      tenantId: seed.tenants[0], departmentId: seed.departments[0][0] });
    const count = async (ctx: TenantContext, text: string, params: any[] = []) => {
      const result = await rls(ctx, client => client.query(text, params));
      assert.equal(result.error, null, `read must not error: ${result.error?.message}`);
      return result.value.rows[0].n as number;
    };
    const served: string[] = [], refused: string[] = [];
    const writeOk = async (label: string, ctx: TenantContext, text: string, params: any[] = []) => {
      const result = await rls(ctx, client => client.query(text, params));
      assert.equal(result.error, null, `${label}: unexpected ${result.error?.message}`);
      assert.equal(result.value.rowCount, 1, `${label}: expected exactly one affected row`);
      served.push(label);
    };
    const writeDenied = async (label: string, ctx: TenantContext, text: string, params: any[] = []) => {
      const result = await rls(ctx, client => client.query(text, params));
      // Either the policy refuses outright (42501) or no row passes USING (0 rows).
      if (result.error) assert.equal(result.error.code, '42501', `${label}: unexpected ${result.error.code}`);
      else assert.equal(result.value.rowCount, 0, `${label}: a write must not be permitted`);
      refused.push(`${label}=${result.error ? '42501' : '0rows'}`);
    };

    // ط¢آ§3.6 notifications أ¢â‚¬â€‌ includes the U2D dropped-policy regression (P/W/C inbox
    // rows must be visible per ط¢آ§3, E must see none, platform rows stay P-only).
    assert.equal(await count(platform, 'SELECT count(*)::int n FROM notifications WHERE user_id=$1', [seed.ge]),
      1, 'P inbox = own platform rows only');
    assert.equal(await count(platform, 'SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND client_id IS NOT NULL',
      [seed.ge]), 0, 'P never reads tenant inbox rows');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM notifications WHERE user_id=$1', [seed.ge]),
      1, 'W inbox = own A rows only');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND client_id=$2',
      [seed.ge, seed.tenants[1]]), 0, 'W never reads B inbox rows');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND client_id IS NULL',
      [seed.ge]), 0, 'W never reads platform inbox rows');
    assert.equal(await count(clientCtx, 'SELECT count(*)::int n FROM notifications WHERE user_id=$1', [seed.ca]),
      2, 'C inbox = own company rows only (platform row excluded; 2nd row seeded already read)');
    assert.equal(await count(employeeCtx, 'SELECT count(*)::int n FROM notifications WHERE user_id=$1', [seed.ea]),
      0, 'E sees no notifications at all');
    assert.equal(NOTIFICATION_INBOX_LIMIT, 50, 'notification 50-cap constant unchanged');
    // آ§19(1) / آ§20 D2: the server-side notify INSERT + cap-trim DELETE policies
    // now exist with the sanctioned scope; the cap LIMIT itself stays in code.
    const notifyPolicies = (await pool.query(`SELECT policyname,cmd,qual,with_check FROM pg_policies
      WHERE tablename='notifications' AND cmd IN ('INSERT','DELETE') ORDER BY cmd`)).rows;
    assert.deepEqual(notifyPolicies.map(p => `${p.cmd}:${p.policyname}`),
      ['DELETE:b17_notifications_delete', 'INSERT:b17_notifications_insert']);
    const notifyInsert = notifyPolicies.find(p => p.cmd === 'INSERT');
    assert.ok(String(notifyInsert.with_check).includes('b17_work_tenant'),
      'fan-out WITH CHECK requires the caller own work tenant');
    assert.ok(String(notifyInsert.with_check).includes('client_id'),
      'fan-out recipient must be a member of that tenant');
    const notifyDelete = notifyPolicies.find(p => p.cmd === 'DELETE');
    assert.ok(String(notifyDelete.qual).includes('b17_work_tenant'),
      'cap-trim DELETE is scoped to the caller own work tenant');
    served.push('notifications inbox/unread scope P/W/C served, E denied; notify INSERT/DELETE policies present');

    // ط¢آ§3.6 audit أ¢â‚¬â€‌ P platform events only, W A-filtered (incl. business events),
    // C/E denied, and the P-with-tenant / W-without-tenant mismatches denied.
    assert.ok(await count(platform, 'SELECT count(*)::int n FROM audit_log WHERE client_id IS NULL') >= 1,
      'P reads platform events only');
    assert.equal(await count(platform, 'SELECT count(*)::int n FROM audit_log WHERE client_id=$1',
      [seed.tenants[0]]), 0, 'P never reads tenant audit rows');
    assert.ok(await count(consultant, 'SELECT count(*)::int n FROM audit_log WHERE client_id=$1',
      [seed.tenants[0]]) >= 1, 'W reads the A-filtered log');
    assert.equal(await count(consultant,
      "SELECT count(*)::int n FROM audit_log WHERE client_id=$1 AND action='IMPORT_GRI_DISCLOSURES'",
      [seed.tenants[0]]), 1, 'W reads A business (non-lifecycle) events');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM audit_log WHERE client_id IS NULL'),
      0, 'W never reads platform events');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM audit_log WHERE client_id=$1',
      [seed.tenants[1]]), 0, 'W never reads B audit rows');
    // §9(a): C/E read NO general audit feed — the ONLY thing the new
    // item-local history branch can ever admit is entity_type='evaluations'
    // for an own-tenant, ownership-resolved evaluation (proved end-to-end in
    // scripts/b17-domain-e2.ts). Everything else stays denied for C and E.
    assert.equal(await count(clientCtx, "SELECT count(*)::int n FROM audit_log WHERE client_id=$1 AND entity_type<>'evaluations'",
      [seed.tenants[0]]), 0, 'C denied the GENERAL audit log');
    assert.equal(await count(employeeCtx, "SELECT count(*)::int n FROM audit_log WHERE client_id=$1 AND entity_type<>'evaluations'",
      [seed.tenants[0]]), 0, 'E denied the GENERAL audit log');
    served.push('audit read scope P platform / W A-filtered served, C/E general log denied');

    // ط¢آ§3.6 storage reads + the ط¢آ§3.5 actions read scope.
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM answers WHERE client_id=$1',
      [seed.tenants[0]]), 3, 'W storage usage sees all own-company answers');
    assert.equal(await count(employeeCtx, 'SELECT count(*)::int n FROM answers WHERE client_id=$1',
      [seed.tenants[0]]), 2, 'E sees only own-department answers (foreign department hidden)');
    assert.equal(await count(platformAt, 'SELECT count(*)::int n FROM answers WHERE client_id=$1',
      [seed.tenants[0]]), 0, 'P storage usage @T stays denied (mode mismatch)');
    assert.ok(await count(consultant, `SELECT count(*)::int n FROM evidence_attachments f
      JOIN answers a ON a.id=f.answer_id WHERE a.client_id=$1`, [seed.tenants[0]]) >= 1,
      'W attachment metadata/bytes read under parent-answer scope');
    assert.ok(await count(clientCtx, `SELECT count(*)::int n FROM evidence_attachments f
      JOIN answers a ON a.id=f.answer_id WHERE a.client_id=$1`, [seed.tenants[0]]) >= 1,
      'C attachment metadata read under parent-answer scope');
    assert.equal(await count(employeeCtx, `SELECT count(*)::int n FROM evidence_attachments f
      JOIN answers a ON a.id=f.answer_id WHERE f.id=$1`, [seed.frozenAttachmentId]), 1,
      'E reads its own attachment bytes under parent-answer scope');
    assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_policies
      WHERE tablename='evidence_attachments' AND cmd='UPDATE'`)).rows[0].n, 0,
      'attachments stay read/insert/delete only (no UPDATE policy)');

    // ط¢آ§3 positives that must now SUCCEED (previously silent no-ops / 42501).
    await writeOk('notifications :id/read (C)', clientCtx,
      'UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2', [seed.notifyOwn, seed.ca]);
    await writeOk('notifications read-all (C, own rows only)', clientCtx,
      'UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [seed.ca]);
    await writeOk('storage upload (E own-assigned parent)', employeeCtx,
      `INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
       VALUES($1,'probe.txt','text/plain',4,decode('70726f6265','hex'),$2)`, [seed.answerId, seed.ea]);
    await writeOk('storage delete (E own uploader)', employeeCtx,
      'DELETE FROM evidence_attachments WHERE id=$1', [seed.attachmentId]);
    await writeOk('storage delete (W scoped GE authority)', consultant,
      'DELETE FROM evidence_attachments WHERE id=$1', [seed.attachmentId]);
    await writeOk('actions create (W bounds)', consultant,
      `INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
       VALUES($1,$2,$3,'probe','open')`, [seed.tenants[0], seed.item, seed.departments[0][0]]);
    await writeOk('actions transition (W)', consultant,
      "UPDATE actions SET status='in_progress',updated_at=now() WHERE id=$1", [seed.actionId]);
    await writeOk('actions evidence (C owned)', clientCtx,
      "UPDATE actions SET evidence_note='probe',updated_at=now() WHERE id=$1", [seed.actionId]);
    await writeOk('business audit append (W work context)', consultant,
      `INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id)
       VALUES($1,$2,'ACTION_CREATED','actions',$3)`, [seed.tenants[0], seed.ge, seed.actionId]);
    await writeOk('business audit append (C work context)', clientCtx,
      `INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id)
       VALUES($1,$2,'CLIENT_CONFIRMED','evaluations',$3)`, [seed.tenants[0], seed.ca, seed.actionId]);
    served.push('all ط¢آ§3 write positives for notifications/storage/actions/audit affected exactly one row each');

    // Every context that was denied before B0 must still be denied.
    await writeDenied('E notifications read', employeeCtx,
      'UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2', [seed.notifyE, seed.ea]);
    await writeDenied('E action create', employeeCtx,
      `INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
       VALUES($1,$2,$3,'probe','open')`, [seed.tenants[0], seed.item, seed.departments[0][0]]);
    await writeDenied('C action create', clientCtx,
      `INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
       VALUES($1,$2,$3,'probe','open')`, [seed.tenants[0], seed.item, seed.departments[0][0]]);
    await writeDenied('P action create (platform@T mode mismatch)', platformAt,
      `INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
       VALUES($1,$2,$3,'probe','open')`, [seed.tenants[0], seed.item, seed.departments[0][0]]);
    await writeDenied('W action create in a foreign department/tenant', consultant,
      `INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
       VALUES($1,$2,$3,'probe','open')`, [seed.tenants[0], seed.item, seed.departments[1][0]]);
    await writeDenied('E upload to a foreign-department answer', employeeCtx,
      `INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
       VALUES($1,'probe.txt','text/plain',4,decode('70726f6265','hex'),$2)`, [seed.foreignAnswerId, seed.ea]);
    await writeDenied('C attachment delete', clientCtx,
      'DELETE FROM evidence_attachments WHERE id=$1', [seed.attachmentId]);
    await writeDenied('P attachment delete', platformAt,
      'DELETE FROM evidence_attachments WHERE id=$1', [seed.attachmentId]);
    await writeDenied('W read-all over platform inbox rows', consultant,
      'UPDATE notifications SET read_at=now() WHERE user_id=$1 AND client_id IS NULL', [seed.ge]);
    await writeDenied('P business audit append (no tenant-work authority)', platformAt,
      `INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id)
       VALUES($1,$2,'ACTION_CREATED','actions',$3)`, [seed.tenants[0], seed.ge, seed.actionId]);

    // آ§19(1)/آ§20 D1: the server-side notify context + cap-trim and the
    // narrowly-scoped users SELECT branches, through FORCE RLS (all rolled back).
    await writeOk('notify insert (W, own-tenant recipient)', consultant,
      `INSERT INTO notifications(user_id,client_id,type,title)
       VALUES($1,$2,'action.status','probe')`, [seed.ca, seed.tenants[0]]);
    await writeOk('notify insert (C, own-tenant recipient)', clientCtx,
      `INSERT INTO notifications(user_id,client_id,type,title)
       VALUES($1,$2,'action.status','probe')`, [seed.ea, seed.tenants[0]]);
    // Cap-trim positive needs an actual overflow: 2 seeded + 53 probe rows = 55,
    // so the handler's exact trim SQL removes 5. The whole probe rolls back.
    const trimProbe = await rls(consultant, async c => {
      for (let i = 0; i < 53; i++) await c.query(
        `INSERT INTO notifications(user_id,client_id,type,title) VALUES($1,$2,'action.status',$3)`,
        [seed.ca, seed.tenants[0], `trim-probe-${i}`]);
      return c.query(`DELETE FROM notifications WHERE user_id = $1 AND id NOT IN (
        SELECT id FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50)`, [seed.ca]);
    });
    assert.equal(trimProbe.error, null, `cap-trim must run: ${trimProbe.error?.message}`);
    assert.equal(trimProbe.value.rowCount, 5, 'cap-trim removed exactly the overflow beyond the 50-row cap');
    served.push('notify cap-trim delete runs on own inbox rows only (55 -> 50, overflow removed)');
    await writeDenied('notify insert cross-user (platform actor in a tenant row)', consultant,
      `INSERT INTO notifications(user_id,client_id,type,title)
       VALUES($1,$2,'action.status','probe')`, [seed.ge, seed.tenants[0]]);
    await writeDenied('notify insert cross-tenant (A actor in a B row)', consultant,
      `INSERT INTO notifications(user_id,client_id,type,title)
       VALUES($1,$2,'action.status','probe')`, [seed.ca, seed.tenants[1]]);
    await writeDenied('notify insert platform row (deferred to U2-F)', consultant,
      `INSERT INTO notifications(user_id,client_id,type,title)
       VALUES($1,NULL,'action.status','probe')`, [seed.ge]);
    await writeDenied('notify trim over platform rows', consultant,
      `DELETE FROM notifications WHERE user_id=$1 AND client_id IS NULL`, [seed.ge]);
    await writeDenied('notify trim over foreign-tenant rows', consultant,
      `DELETE FROM notifications WHERE client_id=$1`, [seed.tenants[1]]);

    // D1 users SELECT (task آ§20): purpose 'work' branches + the F-03 branch.
    assert.ok(await count(consultant, 'SELECT count(*)::int n FROM users WHERE client_id=$1',
      [seed.tenants[0]]) >= 1, 'W resolves own-tenant actor rows');
    assert.ok(await count(clientCtx, 'SELECT count(*)::int n FROM users WHERE client_id=$1',
      [seed.tenants[0]]) >= 1, 'C resolves own-tenant actor rows');
    assert.ok(await count(employeeCtx, 'SELECT count(*)::int n FROM users WHERE client_id=$1',
      [seed.tenants[0]]) >= 1, 'E resolves own-tenant actor rows');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM users WHERE client_id=$1',
      [seed.tenants[1]]), 0, 'W never reads B user rows');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM users WHERE client_id IS NULL'),
      0, 'W never reads platform actor rows');
    assert.ok(await count(platform, 'SELECT count(*)::int n FROM users WHERE client_id IS NULL') >= 1,
      'P resolves platform-event actors');
    assert.equal(await count(platform, 'SELECT count(*)::int n FROM users WHERE client_id=$1',
      [seed.tenants[0]]), 0, 'P never reads tenant user rows');
    const gateOwn = await rls({ purpose: null, userId: seed.ge, role: 'ge_admin' },
      c => c.query('SELECT count(*)::int n FROM users WHERE id = $1', [seed.ge]));
    assert.equal(gateOwn.error, null, `fresh-gate branch must read: ${gateOwn.error?.message}`);
    assert.equal(gateOwn.value.rows[0].n, 1, 'F-03 branch: own row only under purpose/session NULL');
    const gateForeign = await rls({ purpose: null, userId: seed.ge, role: 'ge_admin' },
      c => c.query('SELECT count(*)::int n FROM users WHERE id <> $1', [seed.ge]));
    assert.equal(gateForeign.error, null);
    assert.equal(gateForeign.value.rows[0].n, 0, 'F-03 branch: no other row is visible');
    served.push('notify fan-out/trim context + D1 users branches (work P/W/C/E + fresh gate) hold');

    // Freeze (WF-05 backstop) unchanged: RLS admits E's own row, the TRIGGER refuses it.
    const frozenInsert = await rls(employeeCtx, c => c.query(
      `INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
       VALUES($1,'frozen-probe.txt','text/plain',4,decode('70726f6265','hex'),$2)`,
      [seed.frozenAnswerId, seed.ea]));
    assert.ok(String(frozenInsert.error?.message ?? '').includes('FROZEN_SCOPE'),
      `frozen-scope upload must raise FROZEN_SCOPE, got: ${frozenInsert.error?.message}`);
    const frozenDelete = await rls(employeeCtx, c =>
      c.query('DELETE FROM evidence_attachments WHERE id=$1', [seed.frozenAttachmentId]));
    assert.ok(String(frozenDelete.error?.message ?? '').includes('FROZEN_SCOPE'),
      `frozen-scope delete must raise FROZEN_SCOPE, got: ${frozenDelete.error?.message}`);
    served.push('freeze trigger still refuses attachment write/delete inside a frozen scope');

    // 5 MB + mime checks unchanged (DB CHECK constraint and handler validator).
    const oversize = await rls(employeeCtx, c => c.query(
      `INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
       VALUES($1,'big.bin','application/pdf',5242881,decode('00','hex'),$2)`,
      [seed.answerId, seed.ea]));
    assert.equal(oversize.error?.code, '23514', 'the 5 MB CHECK constraint still refuses oversize rows');
    const sizeCapConstraints = (await pool.query(
      `SELECT count(*)::int n FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
       WHERE c.relname='evidence_attachments' AND pg_get_constraintdef(k.oid) LIKE '%5242880%'`)).rows[0].n as number;
    assert.ok(sizeCapConstraints >= 1, 'the evidence_attachments 5 MB CHECK constraint must remain');
    assert.equal(MAX_ATTACHMENT_BYTES, 5 * 1024 * 1024);
    assert.deepEqual(validateAttachment({ mime: 'application/pdf', sizeBytes: MAX_ATTACHMENT_BYTES + 1 }),
      { ok: false, code: 'attachments.oversize' });
    assert.deepEqual(validateAttachment({ mime: 'application/x-msdownload', sizeBytes: 10 }),
      { ok: false, code: 'attachments.mime' });
    served.push('5 MB DB CHECK + handler mime/size validator unchanged');

    // WF-04 stays a handler/lib rule: the policy layer neither encodes nor blocks it.
    assert.equal(canTransitionAction('open', 'in_progress'), true);
    assert.equal(canTransitionAction('open', 'closed'), false);
    assert.equal(actionTransitionRequiresReason('reopened'), true);
    const wf04Constraint = (await pool.query(
      `SELECT count(*)::int n FROM pg_constraint WHERE conname='actions_status_check'
       AND pg_get_constraintdef(oid) LIKE '%awaiting_verification%'`)).rows[0].n as number;
    assert.equal(wf04Constraint, 1, 'the WF-04 actions_status_check constraint must remain');
    await writeOk('actions illegal transition stays handler-owned (policy encodes no WF-04)', consultant,
      "UPDATE actions SET status='closed',updated_at=now() WHERE id=$1", [seed.actionId]);
    assert.equal(canTransitionAction('open', 'closed'), false, 'lib/handler WF-04 gate unchanged');
    served.push('WF-04 transition+reason rules remain in src/lib/actions.ts, not in SQL');

    // Append-only audit_log: RLS refuses the write at the policy layer (no
    // UPDATE/DELETE policy exists) and trg_block_audit_log_mod still refuses any
    // row that does reach it. The temporary probe policy lives only inside this
    // rolled-back transaction.
    const appendOnly = async (label: string, text: string) => {
      const result = await rls(consultant, c => c.query(text, [seed.tenants[0]]));
      const outcome = result.error ? String(result.error.code) : `${result.value.rowCount}rows`;
      assert.ok(result.error ? result.error.code === '42501' : result.value.rowCount === 0,
        `${label}: append-only audit must be refused, got ${outcome}`);
      refused.push(`${label}=${outcome}`);
    };
    await appendOnly('audit_log UPDATE', "UPDATE audit_log SET action='TAMPERED' WHERE client_id=$1");
    await appendOnly('audit_log DELETE', 'DELETE FROM audit_log WHERE client_id=$1');
    const triggerBlocked = await rls(consultant, async c => {
      await c.query('CREATE POLICY b17_probe_append ON audit_log FOR UPDATE USING(true) WITH CHECK(true)');
      await c.query("UPDATE audit_log SET action='TAMPERED' WHERE client_id=$1", [seed.tenants[0]]);
    });
    assert.ok(String(triggerBlocked.error?.message ?? '').includes('append-only'),
      `trg_block_audit_log_mod must refuse a reaching UPDATE, got: ${triggerBlocked.error?.message}`);
    const appendOnlyTrigger = (await pool.query(
      `SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname='audit_log' AND t.tgname='trg_block_audit_log_mod'
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE %'
         AND pg_get_triggerdef(t.oid) LIKE '%UPDATE%'
         AND pg_get_triggerdef(t.oid) LIKE '%DELETE%'`)).rows[0].n as number;
    assert.equal(appendOnlyTrigger, 1, 'trg_block_audit_log_mod must remain a BEFORE UPDATE/DELETE trigger');
    served.push('audit_log stays append-only (policy layer + BEFORE UPDATE/DELETE trigger)');

    // Readiness still refuses fingerprint drift, policy tampering and ACL drift.
    const auditor = await pool.connect();
    try {
      await auditor.query('BEGIN');
      await auditor.query('DROP POLICY b17_notifications ON notifications');
      await assert.rejects(() => verifyB17(auditor), /schema_drift/, 'dropping a B0 policy must refuse readiness');
      await auditor.query('ROLLBACK');
      await auditor.query('BEGIN');
      await auditor.query('CREATE POLICY b17_proof_drift ON notifications FOR SELECT USING(true)');
      await assert.rejects(() => verifyB17(auditor), /schema_drift/, 'adding a rogue policy must refuse readiness');
      await auditor.query('ROLLBACK');
      await auditor.query('BEGIN');
      await auditor.query('GRANT EXECUTE ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) TO PUBLIC');
      await assert.rejects(() => verifyB17Content(auditor), /content_authority_drift/, 'ACL drift must refuse readiness');
      await auditor.query('ROLLBACK');
      await auditor.query('BEGIN');
      await auditor.query(`CREATE POLICY b17_probe ON app_schema_versions FOR UPDATE USING(true) WITH CHECK(true)`);
      await auditor.query(`UPDATE app_schema_versions SET checksum=repeat('0',64) WHERE version='B17_U2D'`);
      await auditor.query('DROP POLICY b17_probe ON app_schema_versions');
      await assert.rejects(() => verifyB17(auditor), /version_drift/, 'ledger checksum drift must refuse readiness');
      await auditor.query('ROLLBACK');
      await auditor.query('BEGIN');
      await auditor.query("SELECT set_config('app.current_purpose','migration',true)");
      await auditor.query(`INSERT INTO app_schema_versions(version,checksum,structure_checksum)
        VALUES('B17_ROGUE',repeat('a',64),repeat('b',32))`);
      await assert.rejects(() => verifyB17(auditor), /version_drift/, 'unexpected ledger version must refuse readiness');
      await auditor.query('ROLLBACK');
    } finally { auditor.release(); }
    await assertB17Ready();
    assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum, B17_CONTENT_SHAPE);
    served.push('readiness refuses structure/policy/authority/version drift and recovers after rollback');

    // Rollback proof: every seeded row is exactly as it was.
    assert.equal(await count(consultant, "SELECT count(*)::int n FROM actions WHERE id=$1 AND status='open'",
      [seed.actionId]), 1, 'seeded action must be untouched');
    assert.equal(await count(clientCtx, 'SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL',
      [seed.ca]), 1, 'seeded inbox row must still be unread');
    assert.equal(await count(employeeCtx, 'SELECT count(*)::int n FROM evidence_attachments WHERE id=$1',
      [seed.attachmentId]), 1, 'seeded attachment must still exist');
    assert.deepEqual(await preserved(), { clients: 2, departments: 4, users: 8, client_services: 2,
      assignments: 3, answers: 3 }, 'no business row may be added or removed by this proof');
    console.log(`B0_RLS served=${served.length} denied=${refused.length} :: ${refused.join(' | ')}`);
    pass(`U2-B0 policy substrate: ${served.length} ط¢آ§3 positive groups served, ${refused.length} denials held, freeze/5MB/WF-04/readiness intact, all probes rolled back`);

    // =========================================================================
    // --- H: U2-B round 3 â€” the 13 flipped routes END-TO-END through the REAL
    // chain: accessDispatcher -> requireDomainAccess -> readContext/scope ->
    // handler. FIRST TIME this chain has ever executed (every prior round
    // stopped at the dispatcher). Allowed contexts must work; every
    // disallowed context must be refused with its آ§3 status/code.
    // =========================================================================
    const FLIPPED = [
      'GET /audit-log',
      'GET /notifications', 'GET /notifications/unread-count',
      'POST /notifications/:id/read', 'POST /notifications/read-all',
      'POST /answers/:id/attachments', 'GET /answers/:id/attachments',
      'GET /answers/:id/attachments/:attachId/download',
      'DELETE /answers/:id/attachments/:attachId', 'GET /storage/usage',
      'GET /actions', 'POST /actions', 'PATCH /actions/:id',
      'GET /services', 'GET /disclosures', 'GET /items',
      'POST /services', 'PATCH /services/:id', 'POST /services/:id/duplicate',
      'POST /services/:id/standards', 'DELETE /services/:id/standards',
      'PATCH /standards/:id', 'DELETE /standards/:id',
      'PATCH /disclosures/:id', 'DELETE /disclosures/:id',
      'POST /items', 'PATCH /items/:id', 'DELETE /items/:id',
      'POST /items/:id/links', 'DELETE /items/:id/links', 'GET /items/:id/links',
      'POST /gri/preview', 'POST /gri/commit', 'GET /gri/template',
      'GET /standards', 'GET /dashboard/stats',
      'GET /initiatives', 'POST /initiatives', 'PATCH /initiatives/:id',
      'POST /initiatives/select', 'DELETE /initiatives/select/:id',
      'POST /esg-profile/import', 'GET /esg-profile',
      'GET /report-settings', 'PUT /report-settings', 'GET /reports/index', 'GET /reports/export',
      // U2-E E-1: the six evaluations/reviews READ declarations.
      'GET /queue', 'GET /evaluations', 'GET /client-review',
      'GET /reviews/ge-check', 'GET /reviews/snapshots', 'GET /reviews/snapshots/:id',
      // U2-E E-2: the nine evaluations/reviews WRITE declarations.
      'POST /evaluations', 'POST /evaluations/:id/submit', 'POST /evaluations/:id/approve',
      'POST /evaluations/:id/return', 'PUT /evaluations/:id/correct',
      'POST /evaluations/:id/client-approve', 'POST /evaluations/:id/client-return',
      'POST /reviews/ge-final', 'POST /reviews/snapshots/:id/notes',
    ];
    const u1Keys = LEGACY_ROUTES.filter(r => r.activation === 'U1').map(r => `${r.method} ${r.path}`).sort();
    assert.equal(u1Keys.length, 70, '8 system/session + 13 U2-B + 23 U2-C + 11 U2-D + 15 U2-E flips');
    assert.deepEqual(u1Keys, [
      'GET /db/status', 'POST /db/migrate', 'GET /setup/status', 'POST /setup/admin',
      'POST /auth/login', 'POST /auth/logout', 'GET /auth/me', 'POST /auth/change-password',
      ...FLIPPED,
    ].sort(), 'exactly the 8 system/session rows + 13 U2-B + 23 U2-C + 11 U2-D + 15 U2-E flips are U1; NO other row changed');
    assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').length, 25, '87 -> 74 -> 51 -> 40 -> 34 -> 25 UNACTIVATED');
    for (const key of FLIPPED) {
      const [method, path] = key.split(' ');
      const route = LEGACY_ROUTES.find(r => r.method === method && r.path === path);
      assert.ok(route && route.activation === 'U1', `flipped row must be U1: ${key}`);
    }
    assert.deepEqual([...activeBusinessCapabilities()],
      ['taxonomy', 'gri', 'evaluations', 'actions', 'initiatives', 'reports', 'storage', 'audit', 'notifications'],
      'activeBusinessCapabilities() tracks the 13 U2-B + 23 U2-C + 11 U2-D + 15 U2-E flips truthfully');
    pass('registry truth: exactly 62 flips (87 -> 25 UNACTIVATED), no other row changed, capabilities truthful (9)');

    // Fresh real sessions/tabs per آ§3 context (server-derived, never client-supplied).
    const wToken = await login('ge');
    const wTabRes = await api('POST', '/workspace/tab', wToken, {});
    assert.equal(wTabRes.status, 201);
    const wTab = { tabHandle: wTabRes.json.tabHandle as string, generation: 1 };
    const wEnter = await api('POST', '/workspace/enter', wToken, { clientId: seed.tenants[0] }, wTab);
    assert.equal(wEnter.status, 200, JSON.stringify(wEnter.json));
    wTab.generation = wEnter.json.generation;
    assert.deepEqual(wEnter.json.capabilities,
      ['taxonomy', 'gri', 'evaluations', 'actions', 'initiatives', 'reports', 'storage', 'audit', 'notifications'],
      'workspace envelope reports the landed capabilities');
    const pToken = await login('ge');
    const pTabRes = await api('POST', '/workspace/tab', pToken, {});
    assert.equal(pTabRes.status, 201);
    const pTab = { tabHandle: pTabRes.json.tabHandle as string, generation: 1 }; // platform, never entered
    const cToken = await login('client');
    const eToken = await login('employee');
    const e3Token = await login('employee3');

    // --- H1: F-03 fresh gate on an ACTIVATED mutating route (D1 branch 2) ---
    // Probed with a nonexistent id so the gate result (403 vs 404) is observable
    // WITHOUT consuming any inbox state that later assertions count.
    const gateProbe = `/notifications/${randomUUID()}/read`;
    await withTenantContext({ purpose: 'auth.password', userId: seed.ca }, c =>
      c.query('UPDATE users SET must_change_password=true WHERE id=$1', [seed.ca]));
    const stale = await api('POST', gateProbe, cToken, {});
    assert.deepEqual([stale.status, stale.json.code], [403, 'auth.password_change_required'],
      'F-03 refuses a stale-password caller on an activated mutating route');
    await withTenantContext({ purpose: 'auth.password', userId: seed.ca }, c =>
      c.query('UPDATE users SET must_change_password=false WHERE id=$1', [seed.ca]));
    const gateFresh = await api('POST', gateProbe, cToken, {});
    assert.deepEqual([gateFresh.status, gateFresh.json.code], [404, undefined],
      'fresh-password caller passes F-03 and reaches the handler (404 = no such notification)');
    pass('D1/F-03: own-row users branch serves the fresh gate end-to-end (403 stale -> handler 404 fresh)');

    // --- H2: آ§3.6 notifications أ—4 ---
    const pInbox = await api('GET', '/notifications', pToken, undefined, pTab);
    assert.equal(pInbox.status, 200);
    assert.ok(pInbox.json.items.length >= 1 && pInbox.json.items.every((i: any) => i.id === seed.notifyP),
      'P inbox = ONLY its own platform row');
    const wInbox = await api('GET', '/notifications', wToken, undefined, wTab);
    assert.equal(wInbox.status, 200);
    assert.ok(wInbox.json.items.length >= 1 && wInbox.json.items.every((i: any) => i.id === seed.notifyW),
      'W inbox = ONLY its own A row (no platform, no B)');
    const cInbox = await api('GET', '/notifications', cToken);
    assert.equal(cInbox.status, 200);
    assert.deepEqual(cInbox.json.items.map((i: any) => i.id).sort(), [seed.notifyOwn, seed.notifyOwn2].sort(),
      'C inbox = own company rows only (platform row excluded)');
    assert.deepEqual([(await api('GET', '/notifications/unread-count', pToken, undefined, pTab)).json.unreadCount,
      (await api('GET', '/notifications/unread-count', wToken, undefined, wTab)).json.unreadCount,
      (await api('GET', '/notifications/unread-count', cToken)).json.unreadCount], [1, 1, 1],
      'unread badge uses the exact same scope per context');
    const extraUnread = (await withTenantContext({ purpose: 'work', role: 'client_admin', userId: seed.ca,
      mode: 'client', tenantId: seed.tenants[0] }, c => c.query(
        `INSERT INTO notifications(user_id,client_id,type,title) VALUES($1,$2,'action.status','H extra unread') RETURNING id`,
        [seed.ca, seed.tenants[0]]))).rows[0].id as string;
    const ok = await api('POST', `/notifications/${extraUnread}/read`, cToken, {});
    assert.equal(ok.status, 200, 'C marks its own notification read');
    const foreignRead = await api('POST', `/notifications/${seed.notifyForeign}/read`, cToken, {});
    assert.equal(foreignRead.status, 404, 'foreign notification is a 404 (scope + ownership)');
    const platformRead = await api('POST', `/notifications/${seed.notifyP}/read`, cToken, {});
    assert.equal(platformRead.status, 404, 'C never reaches platform rows');
    const wPlatformRead = await api('POST', `/notifications/${seed.notifyP}/read`, wToken, undefined, wTab);
    assert.equal(wPlatformRead.status, 404, 'W never reaches platform rows');
    const readAll = await api('POST', '/notifications/read-all', cToken, {});
    assert.equal(readAll.status, 200); assert.equal(readAll.json.updated, 1, 'read-all updated only its own unread row');
    assert.equal((await api('GET', '/notifications/unread-count', cToken)).json.unreadCount, 0);
    assert.deepEqual([(await api('GET', '/notifications', eToken)).status,
      (await api('GET', '/notifications', cToken, undefined, undefined, { 'X-Workspace-Tab': 'x' })).status], [403, 200],
      'E is denied (no polling path); stray tab headers are ignored for lower roles');
    const anonInbox = await api('GET', '/notifications');
    assert.deepEqual([anonInbox.status, anonInbox.json.code], [401, 'auth.invalid']);
    pass('آ§3.6 notifications end-to-end: P own-platform / W own-A / C own-company / E denied / 404 ownership');

    // --- H3: آ§3.5 GET /actions (W/C linked+owned, C covers ALL own-company depts) ---
    const wList = await api('GET', '/actions', wToken, undefined, wTab);
    assert.equal(wList.status, 200);
    assert.ok(wList.json.items.some((a: any) => a.id === seed.actionId) && wList.json.items.some((a: any) => a.id === seed.actionId2),
      'W sees linked+owned actions in both own-company departments');
    assert.ok(wList.json.items.every((a: any) => a.client_id === seed.tenants[0]), 'W list never leaks B');
    assert.ok(!wList.json.items.some((a: any) => a.id === seed.actionB), 'W never sees the foreign action');
    assert.ok(wList.json.items.some((a: any) => a.id === seed.actionId && a.item_code), 'linked item metadata rides along');
    const cList = await api('GET', '/actions', cToken);
    assert.equal(cList.status, 200);
    assert.ok(cList.json.items.some((a: any) => a.id === seed.actionId) && cList.json.items.some((a: any) => a.id === seed.actionId2),
      'C covers ALL its company departments, not one assigned department');
    assert.ok(!cList.json.items.some((a: any) => a.id === seed.actionB), 'C never sees the foreign action');
    assert.equal((await api('GET', '/actions?clientId=' + seed.tenants[1], wToken, undefined, wTab)).status, 403,
      'explicit foreign clientId is a 403');
    assert.equal((await api('GET', '/actions?departmentId=' + seed.departments[1][0], wToken, undefined, wTab)).status, 403,
      'explicit foreign department is a 403 (scope.department_mismatch)');
    assert.equal((await api('GET', '/actions?departmentId=' + seed.departments[0][0], wToken, undefined, wTab)).status, 200,
      'own-company department filter narrows, never broadens');
    assert.equal((await api('GET', '/actions?status=bogus', wToken, undefined, wTab)).status, 400,
      'unknown status filter stays 400');
    assert.deepEqual([(await api('GET', '/actions', eToken)).status, (await api('GET', '/actions', pToken, undefined, pTab)).status],
      [403, 403], 'E and P are denied on GET /actions');
    assert.equal((await api('GET', '/actions', eToken, undefined, undefined, { 'X-Workspace-Tab': 'x' })).status, 403,
      'E cannot borrow a GE tab to reach W/C rows');
    pass('آ§3.5 GET /actions end-to-end: W/C linked+owned (C all own-company depts), E/P denied, explicit mismatches 403');

    // --- H4: آ§3.6 audit (P platform only, W mandatory A filter, C/E denied) ---
    const pAudit = await api('GET', '/audit-log', pToken, undefined, pTab);
    assert.equal(pAudit.status, 200);
    assert.ok(pAudit.json.items.length >= 1 && pAudit.json.items.every((r: any) => r.client_id === null),
      'P reads platform events only (client_id IS NULL)');
    assert.ok(pAudit.json.items.some((r: any) => r.user_name), 'P JOIN resolves platform-event actor names (D1)');
    const wAudit = await api('GET', '/audit-log', wToken, undefined, wTab);
    assert.equal(wAudit.status, 200);
    assert.ok(wAudit.json.items.length >= 1 && wAudit.json.items.every((r: any) => r.client_id === seed.tenants[0]),
      'W reads the A-filtered log only (no platform, no B)');
    assert.ok(wAudit.json.items.some((r: any) => r.user_name), 'W JOIN resolves own-tenant actor names (D1 repair)');
    assert.ok(wAudit.json.items.every((r: any) => r.client_id !== null), 'platform events never appear in W');
    assert.equal((await api('GET', '/audit-log?clientId=' + seed.tenants[1], wToken, undefined, wTab)).status, 403,
      'W naming a foreign clientId is a 403');
    assert.equal((await api('GET', '/audit-log?clientId=' + seed.tenants[0], wToken, undefined, wTab)).status, 200,
      'W naming its own A stays a read');
    assert.equal((await api('GET', '/audit-log?clientId=' + seed.tenants[0], pToken, undefined, pTab)).status, 403,
      'P has no client payload scope at all (audit.forbidden)');
    assert.deepEqual([(await api('GET', '/audit-log', cToken)).status,
      (await api('GET', '/audit-log', eToken)).status,
      (await api('GET', '/audit-log')).status], [403, 403, 401],
      'C/E denied (delegates cannot reopen it), anonymous 401');
    pass('آ§3.6 audit end-to-end: P platform-only, W mandatory A filter, C/E denied, JOIN names restored');

    // --- H5: آ§3.5 POST /actions (W only) ---
    const wCreate = await api('POST', '/actions', wToken,
      { title: 'H item action', departmentId: seed.departments[0][0], itemId: seed.item }, wTab);
    assert.equal(wCreate.status, 201, JSON.stringify(wCreate.json));
    assert.equal(wCreate.json.client_id, seed.tenants[0], 'created inside A only');
    const wCreateStandalone = await api('POST', '/actions', wToken,
      { title: 'H standalone action', departmentId: seed.departments[0][1], serviceId: seed.service }, wTab);
    assert.equal(wCreateStandalone.status, 201,
      `standalone action carries an explicit linked service: ${JSON.stringify(wCreateStandalone.json)}`);
    assert.equal(wCreateStandalone.json.service_id, seed.service);
    assert.equal((await count(consultant,
      "SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='ACTION_CREATED' AND user_id=$2",
      [wCreate.json.id, seed.ge])), 1, 'audit appended atomically with the write, actor preserved (append-only INSERT)');
    assert.equal((await api('POST', '/actions', wToken, { departmentId: seed.departments[0][0], itemId: seed.item }, wTab)).status, 400,
      'title still required');
    assert.equal((await api('POST', '/actions', wToken, { title: 'x' }, wTab)).status, 400,
      'departmentId still required');
    assert.equal((await api('POST', '/actions', wToken,
      { title: 'x', departmentId: seed.departments[1][0], itemId: seed.item }, wTab)).status, 403,
      'foreign department is a 403 (scope.department_mismatch)');
    assert.equal((await api('POST', '/actions', wToken,
      { title: 'x', departmentId: seed.departments[0][0], itemId: seed.item, clientId: seed.tenants[1] }, wTab)).status, 403,
      'a disagreeing clientId is a 403, never a scope widener');
    assert.deepEqual([(await api('POST', '/actions', pToken, { title: 'x', departmentId: seed.departments[0][0] }, pTab)).status,
      (await api('POST', '/actions', cToken, { title: 'x', departmentId: seed.departments[0][0] })).status,
      (await api('POST', '/actions', eToken, { title: 'x', departmentId: seed.departments[0][0] })).status], [403, 403, 403],
      'POST /actions is W only: P/C/E refused');
    pass('آ§3.5 POST end-to-end: W creates in A (item + explicit linked service), audit actor preserved, validation + 403s hold');

    // --- H6: آ§3.5 PATCH /actions/:id (W transitions / C start-work+evidence) ---
    // 50-cap precondition: pre-fill C's inbox beyond the cap through the SAME
    // server-side notify context the handler uses (rows are H-local fixtures).
    await withTenantContext({ purpose: 'work', role: 'client_admin', userId: seed.ca, mode: 'client',
      tenantId: seed.tenants[0] }, async c => {
      for (let i = 0; i < 55; i++) await c.query(
        `INSERT INTO notifications(user_id,client_id,type,title) VALUES($1,$2,'action.status',$3)`,
        [seed.ca, seed.tenants[0], `H-cap-seed-${i}`]);
    });
    const wf1 = await api('PATCH', `/actions/${wCreate.json.id}`, wToken, { status: 'in_progress' }, wTab);
    assert.equal(wf1.status, 200, JSON.stringify(wf1.json));
    // Inbox inspection for NON-actor users: an actor's own RLS identity can
    // never read another user's inbox (§3.6), so the harness uses the same
    // transaction-local notify-target branch the cap-trim itself relies on.
    const inboxRows = async (uid: string) => {
      const r = await rls(consultant, async c => {
        await c.query(`SELECT set_config('app.notify_trim_target',$1,true)`, [uid]);
        return c.query('SELECT count(*)::int n FROM notifications WHERE user_id=$1', [uid]);
      });
      assert.equal(r.error, null, `inbox inspection failed: ${r.error?.message}`);
      return r.value.rows[0].n as number;
    };
    const eaBefore = await inboxRows(seed.ea);
    const wf2 = await api('PATCH', `/actions/${wCreate.json.id}`, wToken, { status: 'awaiting_verification' }, wTab);
    assert.equal(wf2.status, 200, `W legal transition commits: ${JSON.stringify(wf2.json)}`);
    assert.equal(await count(clientCtx,
      'SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [seed.ca]), 50,
      '50-cap enforced through the REAL handler fan-out (notifyUsers insert + trim)');
    assert.equal(await inboxRows(seed.ea), eaBefore + 1,
      'fan-out delivered exactly one new row to the owner department member');
    assert.equal(await inboxRows(seed.e3), 1,
      'fan-out reached every active member of that department (resolver sees own-tenant users)');
    assert.deepEqual([(await api('PATCH', `/actions/${wCreate.json.id}`, wToken, { status: 'in_progress' }, wTab)).status,
      (await api('PATCH', `/actions/${wCreate.json.id}`, wToken, { status: 'reopened' }, wTab)).status], [409, 400],
      'WF-04 illegal transition 409 and missing required reason 400, through the handler');
    const reopened = await api('PATCH', `/actions/${wCreate.json.id}`, wToken,
      { status: 'reopened', reason: 'needs rework' }, wTab);
    assert.equal(reopened.status, 200, 'WF-04 reopened+reason commits for W');
    // C: start-work + evidence only, columns beyond status/evidence never written.
    const cStart = await api('PATCH', `/actions/${seed.actionId2}`, cToken, { status: 'in_progress' });
    assert.equal(cStart.status, 200, `C start-work allowed: ${JSON.stringify(cStart.json)}`);
    assert.equal(cStart.json.status, 'in_progress');
    const before = (await withTenantContext(consultant, c => c.query(
      'SELECT title, due_date, owner_department_id FROM actions WHERE id=$1', [seed.actionId2]))).rows[0];
    const cEvidence = await api('PATCH', `/actions/${seed.actionId2}`, cToken,
      { evidenceNote: 'checked', title: 'HACKED', due_date: '2001-01-01', owner_department_id: seed.departments[1][0] });
    assert.equal(cEvidence.status, 200, JSON.stringify(cEvidence.json));
    assert.equal(cEvidence.json.evidence_note, 'checked', 'C evidence note written');
    const after = (await withTenantContext(consultant, c => c.query(
      'SELECT title, due_date, owner_department_id FROM actions WHERE id=$1', [seed.actionId2]))).rows[0];
    assert.deepEqual(after, before, 'column scope: title/due_date/owner_department_id never move for C');
    assert.equal(after.owner_department_id, seed.departments[0][1], 'C cannot re-home an action');
    const cClose = await api('PATCH', `/actions/${seed.actionId2}`, cToken, { status: 'awaiting_verification' });
    assert.equal(cClose.status, 403, 'C denied everything but start-work/evidence (آ§3.5)');
    assert.ok(String(cClose.json.error).includes('GE'), 'existing B16 refusal message retained');
    assert.deepEqual([(await api('PATCH', `/actions/${seed.actionId2}`, cToken, { status: 'closed' })).status,
      (await api('PATCH', `/actions/${wCreate.json.id}`, eToken, { status: 'in_progress' })).status,
      (await api('PATCH', `/actions/${wCreate.json.id}`, pToken, { status: 'in_progress' }, pTab)).status], [409, 403, 403],
      'WF-04 illegal pair still 409 for C; E/P denied outright');
    assert.equal((await api('PATCH', `/actions/${seed.actionB}`, wToken, { evidenceNote: 'x' }, wTab)).status, 404,
      'foreign action is a generic 404');
    assert.deepEqual([(await api('PATCH', `/actions/${seed.actionId2}`, cToken, { status: 'archived' })).status,
      (await api('PATCH', `/actions/${seed.actionId2}`, cToken, {})).status], [400, 400],
      'unknown status / empty body stay 400');
    pass('آ§3.5 PATCH end-to-end: W transitions + C start-work/evidence only (columns pinned), WF-04+50-cap through handlers');

    // --- H7: آ§3.6 storage metadata + download (W/C R+L, E R+L+D, attachId bound) ---
    const wMeta = await api('GET', `/answers/${seed.answerId}/attachments`, wToken, undefined, wTab);
    assert.equal(wMeta.status, 200);
    assert.ok(wMeta.json.items.length >= 2, 'W metadata lists the parent answers attachments');
    assert.ok(wMeta.json.items.some((i: any) => i.uploaded_by_name), 'uploader name resolves (D1 users JOIN repair)');
    assert.equal((await api('GET', `/answers/${seed.answerId}/attachments`, cToken)).status, 200, 'C metadata read');
    assert.equal((await api('GET', `/answers/${seed.answerId}/attachments`, eToken)).status, 200, 'E metadata read (own dept)');
    assert.equal((await api('GET', `/answers/${seed.foreignAnswerId}/attachments`, eToken)).status, 404,
      'E foreign-department answer is a 404');
    assert.equal((await api('GET', `/answers/${seed.answerId}/attachments`, pToken, undefined, pTab)).status, 403,
      'P denied on metadata');
    const rawGet = async (path: string, token?: string, tab?: { tabHandle: string; generation: number }) =>
      fetch(base + path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(tab ? { 'X-Workspace-Tab': tab.tabHandle, 'X-Workspace-Version': String(tab.generation) } : {}) } });
    const dl = await rawGet(`/answers/${seed.answerId}/attachments/${seed.attachmentId}/download`, eToken);
    assert.equal(dl.status, 200); assert.ok(String(dl.headers.get('content-type')).includes('text/plain'),
      'E downloads its own bytes');
    assert.equal((await rawGet(`/answers/${seed.answerId}/attachments/${randomUUID()}/download`, eToken)).status, 404,
      'guessed attachId is a 404 (belongs-to-that-answer)');
    assert.equal((await rawGet(`/answers/${seed.foreignAnswerId}/attachments/${seed.attachmentId}/download`, eToken)).status, 404,
      'foreign parent is a 404');
    assert.equal((await rawGet(`/answers/${seed.answerId}/attachments/${seed.attachmentId}/download`, wToken, wTab)).status, 200,
      'W downloads under R+L');
    assert.equal((await rawGet(`/answers/${seed.answerId}/attachments/${seed.attachmentId}/download`, pToken, pTab)).status, 403,
      'P denied on download');
    pass('آ§3.6 metadata/download end-to-end: W/C R+L, E R+L+D, attachId bound to that answer, P denied');

    // --- H8: آ§3.6 upload (E own-assigned) + 5 MB/mime/freeze through handlers ---
    const small = (type: string) => new Blob([new Uint8Array([104, 105])], { type });
    const upload = async (token: string, answerId: string, blob: Blob, filename: string,
      tab?: { tabHandle: string; generation: number }) => {
      const fd = new FormData();
      fd.append('file', blob, filename);
      const r = await fetch(`${base}/answers/${answerId}/attachments`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`,
          ...(tab ? { 'X-Workspace-Tab': tab.tabHandle, 'X-Workspace-Version': String(tab.generation) } : {}) },
        body: fd });
      return { status: r.status, json: await r.json() as any };
    };
    const upA = await upload(eToken, seed.answerId, small('text/plain'), 'h-a.txt');
    assert.equal(upA.status, 201, `E uploads on its own assigned parent: ${JSON.stringify(upA.json)}`);
    assert.equal(upA.json.uploaded_by, seed.ea);
    const upB = await upload(e3Token, seed.answerId, small('text/plain'), 'h-b.txt');
    assert.equal(upB.status, 201, `second department member uploads too: ${JSON.stringify(upB.json)}`);
    assert.deepEqual([(await upload(cToken, seed.answerId, small('text/plain'), 'c.txt')).status,
      (await upload(wToken, seed.answerId, small('text/plain'), 'w.txt', wTab)).status,
      (await upload(pToken, seed.answerId, small('text/plain'), 'p.txt', pTab)).status], [403, 403, 403],
      'upload is E only: C/W/P refused');
    assert.equal((await upload(eToken, seed.foreignAnswerId, small('text/plain'), 'x.txt')).status, 404,
      'E foreign-department parent is a 404');
    const hOversize = await upload(eToken, seed.answerId,
      new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], { type: 'application/pdf' }), 'big.pdf');
    assert.deepEqual([hOversize.status, hOversize.json.code], [400, 'attachments.oversize'],
      '5 MB cap enforced by the real multipart path');
    const badMime = await upload(eToken, seed.answerId, small('application/x-msdownload'), 'evil.exe');
    assert.deepEqual([badMime.status, badMime.json.code], [400, 'attachments.mime'], 'mime allowlist enforced');
    const frozenUp = await upload(eToken, seed.frozenAnswerId, small('text/plain'), 'frozen.txt');
    assert.equal(frozenUp.status, 409, 'FROZEN_SCOPE pre-check refuses the upload through the handler');
    assert.ok(String(frozenUp.json.error).toLowerCase().includes('frozen'));
    pass('آ§3.6 upload end-to-end: E own-assigned only, 5 MB + mime + freeze all enforced through the real handler');

    // --- H9: آ§3.6 DELETE (E uploader | W scoped GE; C/P denied) ---
    assert.equal((await api('DELETE', `/answers/${seed.answerId}/attachments/${upA.json.id}`, eToken, {})).status, 200,
      'E deletes its OWN upload');
    const eForeignUp = await api('DELETE', `/answers/${seed.answerId}/attachments/${upB.json.id}`, eToken, {});
    assert.equal(eForeignUp.status, 403, 'E may not delete another members upload (uploader clause)');
    assert.equal((await api('GET', `/answers/${seed.answerId}/attachments`, cToken)).json.items.some((i: any) => i.id === upB.json.id),
      true, 'refused delete left the row in place');
    assert.equal((await api('DELETE', `/answers/${seed.answerId}/attachments/${upB.json.id}`, wToken, {}, wTab)).status, 200,
      'W scoped GE admin delete authority works');
    const cDelete = await api('DELETE', `/answers/${seed.answerId}/attachments/${seed.attachmentId}`, cToken, {});
    assert.equal(cDelete.status, 403, 'C delete DENIED per آ§3 (the old isAdmin contradiction is gone)');
    const pDelete = await api('DELETE', `/answers/${seed.answerId}/attachments/${seed.attachmentId}`, pToken, {}, pTab);
    assert.equal(pDelete.status, 403, 'P delete denied');
    const hFrozenDelete = await api('DELETE', `/answers/${seed.frozenAnswerId}/attachments/${seed.frozenAttachmentId}`, eToken, {});
    assert.equal(hFrozenDelete.status, 409, 'freeze refuses delete through the handler');
    assert.equal(await count(employeeCtx, 'SELECT count(*)::int n FROM evidence_attachments WHERE id=$1',
      [seed.frozenAttachmentId]), 1, 'frozen/seeded attachments survive every refused path');
    assert.equal(await count(employeeCtx, 'SELECT count(*)::int n FROM evidence_attachments WHERE id=$1',
      [seed.attachmentId]), 1, 'seeded attachment untouched (non-destructive contract)');
    pass('آ§3.6 DELETE end-to-end: E uploader | W scoped GE only; C/P403; freeze409; fixtures survive');

    // --- H10: آ§3.6 usage (D3: P-without-T400, foreign-T403, P@T known gap) ---
    assert.equal((await api('GET', '/storage/usage', pToken, undefined, pTab)).status, 400,
      'P must name an explicit target T');
    const pUsage = await api('GET', `/storage/usage?clientId=${seed.tenants[0]}`, pToken, undefined, pTab);
    assert.equal(pUsage.status, 200, 'P@T responds (configuration aggregate)');
    console.log(`KNOWN GAP (task آ§20 D3): P@T storage usage returned files=${pUsage.json.files} `
      + `bytes=${pUsage.json.bytes} â€” zeros, not true counts; deferred to a platform-summary round`);
    const wUsage = await api('GET', '/storage/usage', wToken, undefined, wTab);
    assert.equal(wUsage.status, 200);
    assert.ok(wUsage.json.files >= 3 && wUsage.json.bytes > 0, 'W usage = true linked-visible counts');
    const cUsage = await api('GET', '/storage/usage', cToken);
    assert.equal(cUsage.status, 200);
    assert.ok(cUsage.json.files >= 3, 'C usage = own-company counts');
    const eUsage = await api('GET', '/storage/usage', eToken);
    assert.equal(eUsage.status, 200);
    assert.ok(eUsage.json.files >= 3, 'E usage = own-assigned answers only');
    assert.deepEqual([(await api('GET', `/storage/usage?clientId=${seed.tenants[1]}`, wToken, undefined, wTab)).status,
      (await api('GET', `/storage/usage?clientId=${seed.tenants[1]}`, cToken)).status,
      (await api('GET', `/storage/usage?clientId=${seed.tenants[1]}`, eToken)).status], [403, 403, 403],
      'foreign-T on usage is a 403 for W/C/E');
    assert.equal((await api('GET', '/storage/usage?clientId=not-a-uuid', wToken, undefined, wTab)).status, 400,
      'ambiguous clientId stays 400, never a broadener');
    pass('آ§3.6 usage end-to-end: P-without-T400, foreign-T403, W/C/E true counts (P@T = KNOWN GAP zeros)');

    // --- H11: GE platform-vs-consultant mode validation, both directions ---
    assert.deepEqual([(await api('POST', '/actions', pToken,
        { title: 'x', departmentId: seed.departments[0][0] }, pTab)).status,
      (await upload(wToken, seed.answerId, small('text/plain'), 'dir.txt', wTab)).status,
      (await upload(pToken, seed.answerId, small('text/plain'), 'dir2.txt', pTab)).status],
      [403, 403, 403], 'platform refused on W-only rows; consultant AND platform refused on the E-only row');
    const dirModeP = await api('POST', '/actions', pToken, { title: 'x', departmentId: seed.departments[0][0] }, pTab);
    assert.equal(dirModeP.json.code, 'workspace.mode_mismatch');
    const dirModeW = await upload(wToken, seed.answerId, small('text/plain'), 'dir3.txt', wTab);
    assert.equal(dirModeW.json.code, 'workspace.mode_mismatch');
    // ... while both GE modes are admitted on the shared rows (audit P;W).
    assert.equal((await api('GET', '/audit-log', pToken, undefined, pTab)).status, 200, 'platform admitted on P;W rows');
    assert.equal((await api('GET', '/audit-log', wToken, undefined, wTab)).status, 200, 'consultant admitted on P;W rows');
    pass('mode validation both directions: platformâ†”W-only and consultantâ†”E-only refused workspace.mode_mismatch');

    // --- H12: append-only + non-destructive closure ---
    assert.equal(await count(consultant, "SELECT count(*)::int n FROM audit_log WHERE action='ACTION_CREATED' AND client_id=$1",
      [seed.tenants[0]]) >= 1, true, 'handler appends (never mutates) audit_log; UPDATE/DELETE refusal proven in G');
    assert.equal((await api('GET', '/audit-log?limit=1', wToken, undefined, wTab)).status, 200, 'append-only reads stay open');
    assert.deepEqual(await preserved(), { clients: 2, departments: 4, users: 8, client_services: 2,
      assignments: 3, answers: 3 }, 'no business row added or removed by the whole proof');
    for (const survivor of [seed.attachmentId, seed.otherAttachmentId, seed.frozenAttachmentId]) {
      assert.equal(await count(employeeCtx, 'SELECT count(*)::int n FROM evidence_attachments WHERE id=$1',
        [survivor]), 1, `seeded attachment survives: ${survivor}`);
    }
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM actions WHERE id=$1', [seed.actionId]), 1,
      'seeded action survives');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM actions WHERE id=$1', [seed.actionId2]), 1,
      'second-department action survives (status transitioned, row never removed)');
    assert.equal(await count(consultant, 'SELECT count(*)::int n FROM actions WHERE id=$1', [seed.actionB]), 0,
      'foreign action never entered W scope');
    pass(`U2-B round 3 E2E: 13 routes exercised through dispatcherâ†’requireDomainAccessâ†’scopeâ†’handler (first time) â€” allowed contexts served, آ§3 denials held`);

    // =========================================================================
    // --- I: U2-C2 E2E — the 23 taxonomy/GRI declarations through the REAL
    // dispatcher -> requireDomainAccess -> readContext/platformConfigContext
    // -> scope/RLS -> handler chain (task §22 evidence). Contexts: pTab = GE
    // platform (P), wToken/wTab = GE consultant A (W), cToken = client_admin A
    // (C), eToken = employee A/dept-one (E). Seeded overlap: a standard shared
    // by two linked services; an unmapped std3 branch; a cross-tenant answer.
    // =========================================================================
    const P = (method: string, path: string, body?: unknown) => api(method, path, pToken, body, pTab);
    const Wq = (method: string, path: string, body?: unknown) => api(method, path, wToken, body, wTab);
    const Cq = (method: string, path: string, body?: unknown) => api(method, path, cToken, body);
    const Eq = (method: string, path: string, body?: unknown) => api(method, path, eToken, body);

    // --- I1: unauthenticated -> 401; P catalog reads exact; filters refuse ---
    for (const [method, path] of [['POST', '/gri/preview'], ['GET', '/gri/template'],
      ['GET', '/standards'], ['GET', '/dashboard/stats'], ['GET', '/services']] as const) {
      const r = await fetch(base + path, { method,
        ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}) });
      assert.equal(r.status, 401, `unauthenticated ${method} ${path} -> 401`);
    }
    const pServices = await P('GET', '/services');
    assert.deepEqual([pServices.status, pServices.json.length], [200, seed.before.services],
      'P sees the full catalog services list');
    const pItems = await P('GET', '/items');
    assert.deepEqual([pItems.status, pItems.json.length], [200, seed.before.items], 'P sees every catalog item');
    const pDisc = await P('GET', '/disclosures');
    assert.deepEqual([pDisc.status, pDisc.json.length], [200, seed.before.disclosures]);
    const pStand = await P('GET', '/standards');
    assert.equal(pStand.status, 200);
    assert.equal(pStand.json.length, seed.before.standards, 'P standards = full catalog');
    assert.equal(pStand.json.reduce((n: number, s: any) => n + Number(s.item_count), 0), seed.before.items,
      'P standards item_count covers every catalog item exactly once');
    const badFilter = await P('GET', '/items?disclosureId=not-a-uuid');
    assert.deepEqual([badFilter.status, badFilter.json.error], [400, 'scope.id_invalid'],
      'explicit invalid filter refuses 400');
    const dupFilter = await P('GET', `/items?disclosureId=${seed.tenants[0]}&disclosureId=${seed.tenants[0]}`);
    assert.equal(dupFilter.status, 400, 'duplicate/ambiguous filter param refuses 400');
    const pLinks = await P('GET', `/items/${seed.item}/links`);
    assert.deepEqual([pLinks.status, pLinks.json.count], [200, 2], 'P sees both seeded equivalent links');
    assert.ok(pLinks.json.links.every((l: any) => l.evaluation === null && l.ownDepartmentAnswerStatus === null),
      'P links = catalog metadata ONLY, no tenant evaluation overlay');
    const pLinkOverlay = await P('GET', `/items/${seed.item}/links?clientId=${seed.tenants[0]}`);
    assert.equal(pLinkOverlay.status, 403, 'P + clientId -> 403 (no P tenant overlay)');
    pass('I1 unauthenticated preview/template/standards/dashboard/services -> 401; P catalog reads exact; invalid+duplicate filters -> 400; P links metadata-only, clientId overlay -> 403');

    // --- I2: W/C L and E L+D scoping with truthful numbers ---
    const wServices = await Wq('GET', '/services');
    assert.deepEqual([wServices.status, wServices.json.length], [200, 2],
      'W sees exactly its 2 linked services (shared-standard overlap safe)');
    const wItems = await Wq('GET', '/items');
    assert.deepEqual([wItems.status, wItems.json.length], [200, 4],
      'W linked items = 4: shared standard deduped, unmapped std3 hidden');
    const wDisc = await Wq('GET', '/disclosures');
    assert.deepEqual([wDisc.status, wDisc.json.length], [200, 3], 'W disclosures = linked only');
    assert.equal(wDisc.json.reduce((n: number, d: any) => n + Number(d.item_count), 0), 4,
      'W item_count = authorized items only (no foreign counts)');
    const wStand = await Wq('GET', '/standards');
    assert.equal(wStand.json.length, 3, 'W standards = linked only (unmapped std3 hidden)');
    const cItems = await Cq('GET', '/items');
    assert.deepEqual([cItems.status, cItems.json.length], [200, 4], 'C item scope = W');
    const wLinks = await Wq('GET', `/items/${seed.item}/links`);
    assert.equal(wLinks.json.count, 2, 'W: both link ends L');
    assert.equal(wLinks.json.links.find((l: any) => l.otherItem.id === seed.item2)?.evaluation?.score, 100,
      'W evaluation overlay on the linked other item');
    const cLinks = await Cq('GET', `/items/${seed.item}/links`);
    assert.equal(cLinks.json.links.find((l: any) => l.otherItem.id === seed.item2)?.evaluation?.score, 100,
      'C evaluation overlay (show_gap visible for A)');
    const eServices = await Eq('GET', '/services');
    assert.equal(eServices.json.length, 2, 'E: linked services having own assigned items (L+D)');
    const eItems = await Eq('GET', '/items');
    assert.deepEqual([eItems.status, eItems.json.length], [200, 2],
      'E items = own assigned only (no global parents/counts)');
    const eDisc = await Eq('GET', '/disclosures');
    assert.equal(eDisc.json.length, 2, 'E disclosures = assigned-children only');
    const eStand = await Eq('GET', '/standards');
    assert.equal(eStand.json.length, 2, 'E standards = assigned-children only (content std + std3 hidden)');
    const eLinks = await Eq('GET', `/items/${seed.item}/links`);
    assert.deepEqual([eLinks.json.count, eLinks.json.links[0]?.otherItem?.id], [1, seed.frozenItem],
      'E sees only the link whose BOTH ends are L+D');
    assert.equal(eLinks.json.links[0].ownDepartmentAnswerStatus, 'draft', 'E own-department answer status only');
    assert.equal(eLinks.json.links[0].evaluation, null, 'E never sees the foreign-department evaluation (G-SHARED)');
    pass('I2 scoped reads: W(2 services / 4 items / 3 disclosures / 3 standards), C items=4, E(2/2/2/2 + links=1 both-ends L+D), counts deduped and free of foreign rows');

    // --- I3: every §3 disallowed context, exact status/code ---
    const writeRoutes = ['POST /services', 'PATCH /services/:id', 'POST /services/:id/duplicate',
      'POST /services/:id/standards', 'DELETE /services/:id/standards', 'PATCH /standards/:id',
      'DELETE /standards/:id', 'PATCH /disclosures/:id', 'DELETE /disclosures/:id', 'POST /items',
      'PATCH /items/:id', 'DELETE /items/:id', 'POST /items/:id/links', 'DELETE /items/:id/links'];
    assert.equal(writeRoutes.length, 14, 'the 14 P-only taxonomy write declarations');
    for (const route of writeRoutes) {
      const [method, rawPath] = route.split(' ');
      const path = rawPath.replace(':id', seed.item);
      for (const call of [() => Wq(method, path, {}), () => Cq(method, path, {}), () => Eq(method, path, {})]) {
        const r = await call();
        assert.deepEqual([r.status, r.json.code], [403, 'workspace.mode_mismatch'],
          `${route} disallowed context -> 403 workspace.mode_mismatch`);
      }
    }
    const griDeny = [() => Wq('POST', '/gri/preview', {}), () => Cq('POST', '/gri/preview', {}),
      () => Eq('POST', '/gri/preview', {}), () => Wq('POST', '/gri/commit', {}),
      () => Cq('POST', '/gri/commit', {}), () => Eq('POST', '/gri/commit', {}),
      () => Wq('GET', '/gri/template'), () => Cq('GET', '/gri/template'), () => Eq('GET', '/gri/template')];
    for (const call of griDeny) {
      const r = await call();
      assert.deepEqual([r.status, r.json.code], [403, 'workspace.mode_mismatch'],
        'GRI preview/commit/template W/C/E -> 403 workspace.mode_mismatch');
    }
    const pDash = await P('GET', '/dashboard/stats');
    assert.deepEqual([pDash.status, pDash.json.code], [403, 'workspace.mode_mismatch'], 'no P dashboard');
    const eDash = await Eq('GET', '/dashboard/stats');
    assert.deepEqual([eDash.status, eDash.json.code], [403, 'workspace.mode_mismatch'], 'no E dashboard');
    pass('I3 denials: 14 writes x {W,C,E} + GRI preview/commit/template x {W,C,E} + dashboard {P,E} all 403 workspace.mode_mismatch');

    // --- I4: P writes (platform.config) with truthful delete-refusals ---
    const createdSvc = await P('POST', '/services', { code: 'U2C-I-SVC', name: 'U2C service' });
    assert.deepEqual([createdSvc.status, createdSvc.json.code], [201, 'U2C-I-SVC']);
    const iSvc = createdSvc.json.id as string;
    assert.equal((await P('PATCH', `/services/${iSvc}`, { code: 'OTHER' })).status, 400, 'service code immutable');
    assert.equal((await P('PATCH', `/services/${iSvc}`, { name: 'U2C service renamed' })).status, 200);
    const dupSvc = await P('POST', `/services/${iSvc}/duplicate`, { code: 'U2C-I-SVC2' });
    assert.deepEqual([dupSvc.status, dupSvc.json.linksCopied], [201, 0], 'duplicate reachable (0 mappings to copy)');
    const linkStd = await P('POST', `/services/${iSvc}/standards`, { standardId: seed.standard });
    assert.deepEqual([linkStd.status, linkStd.json], [201, { linked: true, existed: false }]);
    const unlinkStd = await P('DELETE', `/services/${iSvc}/standards`, { standardId: seed.standard });
    assert.deepEqual([unlinkStd.status, unlinkStd.json], [200, { unlinked: true, existed: true }]);
    assert.equal((await P('PATCH', `/standards/${seed.standard}`, { title: 'Fixture' })).status, 200,
      'standards PATCH reachable (no-op value)');
    assert.equal((await P('PATCH', `/standards/${seed.standard}`, { code: 'B17U2A2' })).status, 400,
      'standard code immutable');
    assert.equal((await P('PATCH', `/disclosures/${seed.disclosure}`, { title: 'Fixture' })).status, 200,
      'disclosures PATCH reachable (no-op value)');
    const newItem = await P('POST', '/items', { disclosureId: seed.disclosure, code: 'U2C-I-ITEM',
      requirement: 'U2C lifecycle item', priority: 'mid', esgClass: 'general',
      departmentId: seed.departments[0][0] });
    assert.equal(newItem.status, 201, `POST /items with department validation: ${JSON.stringify(newItem.json)}`);
    assert.equal((await P('PATCH', `/items/${newItem.json.id}`, { priority: 'high' })).status, 200);
    assert.equal((await P('DELETE', `/items/${newItem.json.id}`)).status, 200,
      'delete of a childless own row succeeds');
    const mkLink = await P('POST', `/items/${seed.item2}/links`, { otherItemId: seed.frozenItem });
    assert.equal(mkLink.status, 201, JSON.stringify(mkLink.json));
    assert.equal((await P('DELETE', `/items/${seed.item2}/links`, { otherItemId: seed.frozenItem })).status, 200,
      'link delete lifecycle');
    // §22/§23 D1: truthful counts BEFORE any delete (incl. the cross-tenant answer).
    const delItem = await P('DELETE', `/items/${seed.item}`);
    assert.equal(delItem.status, 409, JSON.stringify(delItem.json));
    for (const fact of ['3 answer(s)', '1 evaluation(s)', '2 assignment(s)'])
      assert.ok(String(delItem.json.error).includes(fact),
        `delete-refusal carries the truthful count ${fact}: "${delItem.json.error}"`);
    const delStd = await P('DELETE', `/standards/${seed.standard}`);
    assert.equal(delStd.status, 409);
    assert.ok(String(delStd.json.error).includes('1 disclosure'), delStd.json.error);
    const delDisc = await P('DELETE', `/disclosures/${seed.disclosure}`);
    assert.equal(delDisc.status, 409);
    assert.ok(String(delDisc.json.error).includes('2 item(s)'), delDisc.json.error);
    pass('I4 P writes: create/patch/duplicate/link/unlink + item/link lifecycles 2xx (targetless department validation); immutable codes 400; delete-refusal counts truthful (3/1/2 incl. cross-tenant answer, 1 disclosure, 2 items), no seeded row deleted');

    // --- I5: GRI preview / template / commit (T + linked serviceId) ---
    const PREVIEW_CSV = 'Standard Code,Standard Title,Category,Disclosure Code,Disclosure Title,Item Code,Requirement,Priority,ESG Class,Weight,Answer Type,Hint\n'
      + 'U2C-PREVIEW,U2C Preview Standard,Universal,U2C-PREVIEW-D,Preview Disclosure,U2C-PREVIEW-1,Preview requirement,high,governance,3.0,text,hint\n';
    const preview = await P('POST', '/gri/preview', { csvContent: PREVIEW_CSV });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.ok((preview.json.standards?.length ?? 0) >= 1, 'authenticated P preview parses before any write');
    const tplResp = await fetch(base + '/gri/template', { headers: { Authorization: `Bearer ${pToken}`,
      'X-Workspace-Tab': pTab.tabHandle, 'X-Workspace-Version': String(pTab.generation) }});
    assert.equal(tplResp.status, 200, 'authenticated P template download');
    assert.ok((tplResp.headers.get('content-disposition') ?? '').includes('GRI_Disclosure_Template.csv'),
      'template still ships as attachment');
    const oneStd = [{ code: 'U2C-I-GRI', title: 'U2C import standard', category: 'Universal', version: '2021',
      disclosures: [{ code: 'U2C-I-GRI-D', title: 'U2C import disclosure', description: '',
        items: [{ code: 'U2C-I-GRI-1', requirement: 'U2C import requirement', priority: 'high',
          esgClass: 'general', answerType: 'text', department: 'U2C Import Dept' }]}] }];
    const noT = await P('POST', '/gri/commit', { standards: oneStd, serviceId: seed.service });
    assert.equal(noT.status, 400, `commit without T -> 400: ${JSON.stringify(noT.json)}`);
    const noSvc = await P('POST', '/gri/commit', { standards: oneStd, clientId: seed.tenants[0] });
    assert.deepEqual([noSvc.status, noSvc.json.error], [400, 'scope.id_required'],
      'commit without serviceId -> 400');
    const badSvc = await P('POST', '/gri/commit',
      { standards: oneStd, clientId: seed.tenants[0], serviceId: 'not-a-uuid' });
    assert.deepEqual([badSvc.status, badSvc.json.error], [400, 'scope.id_invalid'], 'malformed serviceId -> 400');
    const foreignSvc = await P('POST', '/gri/commit',
      { standards: oneStd, clientId: seed.tenants[1], serviceId: seed.service });
    assert.deepEqual([foreignSvc.status, foreignSvc.json.error], [403, 'scope.service_unlinked'],
      'unlinked service for T -> 403, zero mutation');
    const clientCtxA: TenantContext = { purpose: 'work', role: 'client_admin', userId: seed.ca,
      mode: 'client', tenantId: seed.tenants[0] };
    const clientCtxD: TenantContext = { purpose: 'work', role: 'client_admin', userId: seed.caD,
      mode: 'client', tenantId: seed.tenants[2] };
    assert.equal((await count(clientCtxA, 'SELECT count(*)::int n FROM client_services')) + (await count(clientCtxD, 'SELECT count(*)::int n FROM client_services')),
      seed.before.client_services, 'zero client_services mutation after ALL commit attempts');
    const commit = await P('POST', '/gri/commit',
      { standards: oneStd, clientId: seed.tenants[0], serviceId: seed.service });
    assert.equal(commit.status, 200, JSON.stringify(commit.json));
    assert.deepEqual(
      { s: commit.json.standardsCount, d: commit.json.disclosuresCount, i: commit.json.itemsCount,
        depts: commit.json.departmentsUpserted, asg: commit.json.assignmentsCreated,
        svc: commit.json.serviceId, unmapped: commit.json.unmappedStandards, frozen: commit.json.skippedFrozen },
      { s: 1, d: 1, i: 1, depts: 1, asg: 1, svc: seed.service, unmapped: 1, frozen: 0 },
      'commit with T + linked serviceId provisions departments/assignments and reports mapping state');
    assert.ok(String(commit.json.setupNotice ?? '').includes('not yet mapped'),
      'truthful unmapped-standard setup notice (no guessed standards->service mapping)');
    const frozenCommit = await P('POST', '/gri/commit', {
      standards: [{ code: 'B17U2AF', title: 'Fixture frozen', category: 'Universal', version: '2021',
        disclosures: [{ code: 'B17U2AF', title: 'Fixture frozen', description: '',
          items: [{ code: 'U2C-I-FROZEN', requirement: 'frozen probe', priority: 'mid', esgClass: 'general' }]}] }],
      clientId: seed.tenants[0], serviceId: seed.service });
    assert.equal(frozenCommit.status, 200, JSON.stringify(frozenCommit.json));
    assert.deepEqual([frozenCommit.json.skippedFrozen, frozenCommit.json.itemsCount], [1, 0],
      'frozen-scope rows skipped with reason through the real handler (D2 fact path)');
    const cfgCtx: TenantContext = { purpose: 'platform.config', role: 'ge_admin', userId: seed.ge,
      mode: 'platform', tenantId: null, targetId: null };
    assert.equal(await count(cfgCtx, 'SELECT count(*)::int n FROM service_standards'), 4,
      'zero guessed standards->service mappings (commit never writes service_standards)');
    assert.equal((await count(clientCtxA, 'SELECT count(*)::int n FROM client_services')) + (await count(clientCtxD, 'SELECT count(*)::int n FROM client_services')),
      seed.before.client_services, 'client_services unchanged after the successful commits');
    pass('I5 GRI: authenticated preview parses (W/C/E 403), template auth+attachment, commit no-T / no-serviceId / bad / foreign -> 400/400/400/403, success provisions depts+assignments with ZERO client_services/service_standards mutation, frozen disclosure skipped');

    // --- I6: dashboard L+V numbers, overlap dedupe, show_gap redaction ---
    const wDash = await Wq('GET', '/dashboard/stats');
    assert.equal(wDash.status, 200, JSON.stringify(wDash.json));
    assert.deepEqual(
      { items: wDash.json.itemsCount, stds: wDash.json.standardsCount, agg: wDash.json.aggregateScore,
        ev: wDash.json.evaluatedCount, ap: wDash.json.applicableCount, cov: wDash.json.coveragePercentage,
        full: wDash.json.fullGapCount, part: wDash.json.partialGapCount, no: wDash.json.noGapCount },
      { items: 4, stds: 3, agg: 50, ev: 1, ap: 4, cov: 25, full: 0, part: 1, no: 0 },
      'W dashboard: denominator=4 (overlap dedupe), F-01-gated numerator=1 -> 50/25% + gap distribution');
    const cDash = await Cq('GET', '/dashboard/stats');
    assert.deepEqual([cDash.json.itemsCount, cDash.json.aggregateScore, cDash.json.coveragePercentage],
      [4, 50, 25], 'C dashboard scoped with show_gap visible for A');
    const cDToken = await login('clientd');
    const dDash = await api('GET', '/dashboard/stats', cDToken);
    assert.equal(dDash.status, 200, JSON.stringify(dDash.json));
    assert.deepEqual(
      { items: dDash.json.itemsCount, stds: dDash.json.standardsCount, total: dDash.json.totalCount,
        agg: dDash.json.aggregateScore, ev: dDash.json.evaluatedCount, cov: dDash.json.coveragePercentage,
        full: dDash.json.fullGapCount, part: dDash.json.partialGapCount, no: dDash.json.noGapCount },
      { items: 4, stds: 3, total: 4, agg: null, ev: null, cov: null, full: null, part: null, no: null },
      'show_gap=false (C): EVERY score/gap/coverage field null, workflow counts truthful');
    pass('I6 dashboard: W/C L+V numbers with overlap-dedupe (4 items counted once), hidden-gap C tenant returns null score/gap fields, P/E refused');

    // --- I7: zero links -> truthful empty (W over tenant B) ---
    const enterB = await api('POST', '/workspace/enter', pToken, { clientId: seed.tenants[1] }, pTab);
    assert.equal(enterB.status, 200, JSON.stringify(enterB.json));
    pTab.generation = enterB.json.generation;
    const bServices = await api('GET', '/services', pToken, undefined, pTab);
    const bItems = await api('GET', '/items', pToken, undefined, pTab);
    const bStand = await api('GET', '/standards', pToken, undefined, pTab);
    const bDash = await api('GET', '/dashboard/stats', pToken, undefined, pTab);
    assert.deepEqual([bServices.json.length, bItems.json.length, bStand.json.length], [0, 0, 0],
      'zero links -> empty lists, NEVER all content');
    assert.deepEqual([bDash.json.hasData, bDash.json.itemsCount], [false, 0],
      'zero links -> empty dashboard');
    pass('I7 W(B) zero links: services/items/standards empty (never all), dashboard hasData=false');
    pass('U2-C2 E2E: all 23 taxonomy/GRI routes exercised end-to-end — every §3 allowed context served, every disallowed context refused with its status/code');

    console.log('B17 U2 regression proof complete: 62 routes flipped (87 -> 25 UNACTIVATED), sections B/H/I green, no release acceptance.');

  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}
main().catch(err => { console.error('B17_U2B0 proof FAILED:', err instanceof Error ? err.message : 'unknown'); process.exitCode = 1; })
  .finally(async () => { await getPool().end(); });
