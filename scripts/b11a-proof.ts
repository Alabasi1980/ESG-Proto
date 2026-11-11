// B11a harness proof (run: tsx scripts/b11a-proof.ts).
//
// Proves every B11a gate against a real Postgres (harness DB) over HTTP:
//   A. services CRUD + duplicate + link/unlink          E. freeze->edit->snapshot-identical
//   B. taxonomy PATCH/DELETE gates (S-05)               E. import upsert still 0-dupe
//   C. items CRUD + weight re-derive (S-06)              . 04 matrix 403s + audit_log writes
//   D. equivalent links + own-department-only state, no cross-dept leak (S-08)
//
// Env required: DATABASE_URL, JWT_SECRET. Exits non-zero on the first failure.
// Leaves one B11a tenant + its immutable freeze snapshot behind BY DESIGN
// (snapshots are append-only; residue is reported, not hidden).

import express from 'express';
import { getPool, withTenantContext, runMigrations } from '../src/db/index.ts';
import { generateToken } from '../src/server/auth.ts';
import apiRouter from '../src/server/routes.ts';

const RUN = `B11A${Date.now().toString(36).toUpperCase()}`;
const results: string[] = [];
const refusals: string[] = [];

function ok(line: string) {
  results.push(`PASS ${line}`);
  console.log(`PASS ${line}`);
}

function refusal(endpoint: string, actor: string, expected: string, gotStatus: number, msg: string) {
  refusals.push(`${endpoint} | ${actor} | expected ${expected} | got ${gotStatus} | ${msg}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the harness proof.');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for the harness proof.');

  const mig = await runMigrations();
  if (!mig.success) throw new Error(`migrations failed: ${mig.message}`);
  ok(`harness migrations applied (${RUN})`);

  const ELEVATED = { tenantId: null as string | null, role: 'ge_admin', departmentId: null, userId: null as string | null };
  const pool = getPool();

  // ---- seed tenant + users -------------------------------------------------
  const seed = await withTenantContext(ELEVATED, async (client) => {
    const cRes = await client.query(`INSERT INTO clients (code, name) VALUES ($1, $2) RETURNING id`, [`${RUN}-T`, `${RUN} tenant`]);
    const tenantId: string = cRes.rows[0].id;
    const dA = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-A`, `${RUN} dept A`])).rows[0].id;
    const dB = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-B`, `${RUN} dept B`])).rows[0].id;
    const mk = async (email: string, name: string, role: string, dept: string | null, cid: string | null) =>
      (await client.query(
        `INSERT INTO users (email, password_hash, name, role, client_id, department_id) VALUES ($1,'x',$2,$3,$4,$5) RETURNING id`,
        [email, name, role, cid, dept]
      )).rows[0].id;
    const geId: string = await mk(`${RUN}-ge@x.test`, `${RUN} ge`, 'ge_admin', null, null);
    const caId: string = await mk(`${RUN}-ca@x.test`, `${RUN} ca`, 'client_admin', null, tenantId);
    const empAId: string = await mk(`${RUN}-a@x.test`, `${RUN} empA`, 'employee', dA, tenantId);
    const empBId: string = await mk(`${RUN}-b@x.test`, `${RUN} empB`, 'employee', dB, tenantId);
    return { tenantId, dA, dB, geId, caId, empAId, empBId };
  });
  const T = (u: { id: string; email: string; name: string; role: any; clientId?: string | null; departmentId?: string | null }) =>
    generateToken({ id: u.id, email: u.email, name: u.name, role: u.role, clientId: u.clientId ?? null, departmentId: u.departmentId ?? null });
  const geTok = T({ id: seed.geId, email: 'g', name: 'g', role: 'ge_admin' });
  const caTok = T({ id: seed.caId, email: 'c', name: 'c', role: 'client_admin', clientId: seed.tenantId });
  const empATok = T({ id: seed.empAId, email: 'a', name: 'a', role: 'employee', clientId: seed.tenantId, departmentId: seed.dA });
  const empBTok = T({ id: seed.empBId, email: 'b', name: 'b', role: 'employee', clientId: seed.tenantId, departmentId: seed.dB });

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const api = async (method: string, path: string, tok: string | null, body?: any) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json: json as any };
  };
  const must = (cond: boolean, line: string) => {
    if (!cond) throw new Error(`PROOF FAILED: ${line}`);
    ok(line);
  };

  // ---- A. services (S-04) ---------------------------------------------------
  const stdRow = (await withTenantContext(ELEVATED, async (c) => (await c.query('SELECT id, code, title, category FROM standards ORDER BY code LIMIT 1')).rows[0])) as { id: string; code: string; title: string; category: string };
  must(!!stdRow, `A0 harness has ≥1 standard (${stdRow?.code}) for link tests`);

  let r = await api('POST', '/services', caTok, { code: `${RUN}-S`, name: 'x' });
  must(r.status === 403, 'A1 client_admin POST /services -> 403 (04 matrix)');
  refusal('POST /services', 'client_admin', '403', r.status, r.json.error);

  r = await api('POST', '/services', geTok, { code: `${RUN}-S`, name: `${RUN} svc` });
  must(r.status === 201 && r.json.code === `${RUN}-S`, 'A2 GE POST /services -> 201');
  const svcId: string = r.json.id;

  r = await api('POST', '/services', geTok, { code: `${RUN}-S`, name: 'dup' });
  must(r.status === 409, 'A3 duplicate service code -> 409');
  refusal('POST /services', 'ge_admin dup code', '409', r.status, r.json.error);

  r = await api('POST', `/services/${svcId}/standards`, geTok, { standardId: stdRow.id });
  must(r.status === 201 && r.json.linked === true, 'A4 GE link standard -> 201');

  r = await api('POST', `/services/${svcId}/duplicate`, geTok, { code: `${RUN}-S2` });
  must(r.status === 201 && r.json.linksCopied === 1, `A5 duplicate copies standard links (linksCopied=${r.json.linksCopied})`);
  const svc2Id: string = r.json.service.id;

  r = await api('GET', '/services', empATok);
  must(r.status === 200 && (r.json as any[]).some((s) => s.id === svc2Id && s.standards.length === 1), 'A6 employee GET /services reads 200 incl. copied link');

  r = await api('PATCH', `/services/${svcId}`, geTok, { code: 'OTHER' });
  must(r.status === 400, 'A7 service code rename attempt -> 400 (immutable)');
  refusal('PATCH /services/:id', 'ge_admin code change', '400', r.status, r.json.error);

  r = await api('PATCH', `/services/${svcId}`, geTok, { name: `${RUN} svc renamed` });
  must(r.status === 200 && r.json.name === `${RUN} svc renamed`, 'A8 GE PATCH service name -> 200');

  r = await api('DELETE', `/services/${svcId}/standards`, geTok, { standardId: stdRow.id });
  must(r.status === 200 && r.json.unlinked === true, 'A9 GE unlink standard -> 200');

  // ---- B. taxonomy (S-05) ---------------------------------------------------
  r = await api('PATCH', `/standards/${stdRow.id}`, empATok, { title: 'x' });
  must(r.status === 403, 'B1 employee PATCH /standards -> 403 (04 matrix)');
  refusal('PATCH /standards/:id', 'employee', '403', r.status, r.json.error);

  r = await api('PATCH', `/standards/${stdRow.id}`, geTok, { code: 'GRI-XXX' });
  must(r.status === 400, 'B2 standard code rename -> 400 (codes are natural import keys)');
  refusal('PATCH /standards/:id', 'ge_admin code change', '400', r.status, r.json.error);

  r = await api('PATCH', `/standards/${stdRow.id}`, geTok, { title: `${RUN} std title`, category: 'Universal' });
  must(r.status === 200 && r.json.title === `${RUN} std title`, 'B3 GE PATCH standard title+category -> 200');

  r = await api('DELETE', `/standards/${stdRow.id}`, geTok);
  must(r.status === 409 && /disclosure/i.test(r.json.error), 'B4 DELETE standard with disclosures -> 409 human');
  refusal('DELETE /standards/:id', 'ge_admin with children', '409', r.status, r.json.error);

  // restore the harness row B3 renamed (proof must leave live data untouched)
  r = await api('PATCH', `/standards/${stdRow.id}`, geTok, { title: stdRow.title, category: stdRow.category });
  must(r.status === 200 && r.json.title === stdRow.title, 'B4b harness standard title/category restored');

  const discRow = (await withTenantContext(ELEVATED, async (c) => (await c.query('SELECT id, code FROM disclosures ORDER BY code LIMIT 1')).rows[0])) as { id: string; code: string };
  r = await api('PATCH', `/disclosures/${discRow.id}`, geTok, { code: 'X-9' });
  must(r.status === 400, 'B5 disclosure code rename -> 400');
  refusal('PATCH /disclosures/:id', 'ge_admin code change', '400', r.status, r.json.error);

  r = await api('PATCH', `/disclosures/${discRow.id}`, geTok, { standardId: stdRow.id });
  must(r.status === 400, 'B6 disclosure standard move -> 400');
  refusal('PATCH /disclosures/:id', 'ge_admin standard move', '400', r.status, r.json.error);

  r = await api('DELETE', `/disclosures/${discRow.id}`, geTok);
  must(r.status === 409 && /item/i.test(r.json.error), 'B7 DELETE disclosure with items -> 409 human');
  refusal('DELETE /disclosures/:id', 'ge_admin with children', '409', r.status, r.json.error);

  // delete-success path on a childless pair created directly (import owns creation)
  const tmp = await withTenantContext(ELEVATED, async (c) => {
    const s = (await c.query(`INSERT INTO standards (code, title, category) VALUES ($1,$2,$3) RETURNING id`, [`${RUN}-ST`, `${RUN} tmp std`, 'Universal'])).rows[0].id;
    const d = (await c.query(`INSERT INTO disclosures (standard_id, code, title) VALUES ($1,$2,$3) RETURNING id`, [s, `${RUN}-D`, `${RUN} tmp disc`])).rows[0].id;
    return { s, d };
  });
  r = await api('DELETE', `/disclosures/${tmp.d}`, geTok);
  must(r.status === 200 && r.json.deleted === true, 'B8 DELETE childless disclosure -> 200');
  r = await api('DELETE', `/standards/${tmp.s}`, geTok);
  must(r.status === 200 && r.json.deleted === true, 'B9 DELETE childless standard -> 200');

  // ---- C. items (S-06) -------------------------------------------------------
  r = await api('POST', '/items', empATok, { disclosureId: discRow.id, code: `${RUN}-I`, requirement: 'x' });
  must(r.status === 403, 'C1 employee POST /items -> 403 (04 matrix)');
  refusal('POST /items', 'employee', '403', r.status, r.json.error);

  r = await api('POST', '/items', geTok, { disclosureId: discRow.id, code: `${RUN}-I1`, requirement: `${RUN} req 1`, priority: 'high' });
  must(r.status === 201 && Number(r.json.weight) === 3 && typeof r.json.sort_order === 'number', `C2 POST item: weight=3 (high), sort_order=${r.json.sort_order}`);
  const item1: string = r.json.id;
  const firstSort: number = r.json.sort_order;

  r = await api('POST', '/items', geTok, { disclosureId: discRow.id, code: `${RUN}-I1`, requirement: 'dup' });
  must(r.status === 409, 'C3 duplicate (disclosure,code) -> 409');
  refusal('POST /items', 'ge_admin dup code', '409', r.status, r.json.error);

  r = await api('POST', '/items', geTok, { disclosureId: discRow.id, code: `${RUN}-I2`, requirement: `${RUN} req 2` });
  must(r.status === 201 && r.json.sort_order === firstSort + 1 && Number(r.json.weight) === 2, `C4 sort_order=max+1 (${r.json.sort_order}), default weight=2 (mid)`);
  const item2: string = r.json.id;

  r = await api('PATCH', `/items/${item1}`, geTok, { priority: 'low' });
  must(r.status === 200 && Number(r.json.weight) === 1, `C5 priority high->low re-derives weight via trigger (weight=${r.json.weight})`);

  r = await api('PATCH', `/items/${item1}`, geTok, { code: 'ZZZ' });
  must(r.status === 400, 'C6 item code rename -> 400 (natural key immutable)');
  refusal('PATCH /items/:id', 'ge_admin code change', '400', r.status, r.json.error);

  r = await api('PATCH', `/items/${item1}`, geTok, { weight: 3 });
  must(r.status === 400, 'C7 direct weight set -> 400 (trigger-owned)');
  refusal('PATCH /items/:id', 'ge_admin weight set', '400', r.status, r.json.error);

  // delete-refused while referenced (naming the blockers), then allowed
  const blk = await api('POST', '/items', geTok, { disclosureId: discRow.id, code: `${RUN}-BLK`, requirement: `${RUN} blocked` });
  const blkId: string = blk.json.id;
  await withTenantContext(ELEVATED, async (c) => {
    await c.query(`INSERT INTO assignments (client_id, item_id, department_id) VALUES ($1,$2,$3)`, [seed.tenantId, blkId, seed.dA]);
    await c.query(`INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value) VALUES ($1,$2,$3,$4,'draft',$5)`, [seed.tenantId, blkId, seed.dA, seed.empAId, `${RUN} draft`]);
    await c.query(`INSERT INTO evaluations (client_id, item_id, evaluator_id, score) VALUES ($1,$2,$3,50)`, [seed.tenantId, blkId, seed.geId]);
  });
  r = await api('DELETE', `/items/${blkId}`, geTok);
  must(r.status === 409 && /answer/.test(r.json.error) && /evaluation/.test(r.json.error) && /assignment/.test(r.json.error), 'C8 DELETE referenced item -> 409 naming all blockers');
  refusal('DELETE /items/:id', 'ge_admin with children', '409', r.status, r.json.error);
  await withTenantContext(ELEVATED, async (c) => {
    await c.query(`DELETE FROM evaluations WHERE item_id = $1`, [blkId]);
    await c.query(`DELETE FROM answers WHERE item_id = $1`, [blkId]);
    await c.query(`DELETE FROM assignments WHERE item_id = $1`, [blkId]);
  });
  r = await api('DELETE', `/items/${blkId}`, geTok);
  must(r.status === 200 && r.json.deleted === true, 'C9 DELETE unreferenced item -> 200');

  // ---- D. links (S-08) ---------------------------------------------------------
  r = await api('POST', `/items/${item1}/links`, caTok, { otherItemId: item2 });
  must(r.status === 403, 'D1 client_admin POST link -> 403 (GE-only writes)');
  refusal('POST /items/:id/links', 'client_admin', '403', r.status, r.json.error);

  r = await api('POST', `/items/${item1}/links`, geTok, { otherItemId: item1 });
  must(r.status === 400, 'D2 self-link -> 400');
  refusal('POST /items/:id/links', 'ge_admin self-link', '400', r.status, r.json.error);

  r = await api('POST', `/items/${item1}/links`, geTok, { otherItemId: item2 });
  must(r.status === 201, 'D3 GE link two items -> 201');

  r = await api('POST', `/items/${item2}/links`, geTok, { otherItemId: item1 });
  must(r.status === 409, 'D4 reverse duplicate link -> 409 (single unordered pair)');
  refusal('POST /items/:id/links', 'ge_admin reverse dup', '409', r.status, r.json.error);

  // cross-department leak check: dept-B secret on item2, read by dept-A employee
  const SECRET = `${RUN}-SECRET-B-DEPT-ONLY`;
  await withTenantContext(ELEVATED, async (c) => {
    await c.query(`INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value) VALUES ($1,$2,$3,$4,'submitted',$5)`, [seed.tenantId, item2, seed.dB, seed.empBId, SECRET]);
    await c.query(`INSERT INTO evaluations (client_id, item_id, evaluator_id, score) VALUES ($1,$2,$3,50) ON CONFLICT (client_id, item_id) DO UPDATE SET score = 50`, [seed.tenantId, item2, seed.geId]);
  });
  r = await api('GET', `/items/${item1}/links`, empATok);
  const dumped = JSON.stringify(r.json);
  must(r.status === 200 && r.json.count === 1, 'D5 employee link read -> 200 with 1 link');
  must(!dumped.includes(SECRET), 'D6 NO cross-department evidence leak (dept-B text absent)');
  must(/not evaluated by your department|50/.test(dumped), 'D7 reader sees evaluation STATE (score) or not-evaluated label, never text');
  must(r.json.links[0].otherItem.code === `${RUN}-I2`, 'D8 linked metadata (code/requirement/disclosure) present as reference');

  r = await api('DELETE', `/items/${item1}/links`, geTok, { otherItemId: item2 });
  must(r.status === 200 && r.json.unlinked === true, 'D9 GE unlink -> 200');
  r = await api('DELETE', `/items/${item1}/links`, geTok, { otherItemId: item2 });
  must(r.status === 404, 'D10 unlink missing -> 404');
  refusal('DELETE /items/:id/links', 'ge_admin missing link', '404', r.status, r.json.error);

  // cleanup dept-B rows BEFORE the freeze snapshot (frozen scope is immutable)
  await withTenantContext(ELEVATED, async (c) => {
    await c.query(`DELETE FROM evaluations WHERE item_id = $1`, [item2]);
    await c.query(`DELETE FROM answers WHERE item_id = $1`, [item2]);
  });

  // ---- E0. import idempotency BEFORE freeze (frozen tenants skip by design) ----
  const griPayload = {
    clientId: seed.tenantId,
    standards: [
      {
        code: `${RUN}-GRI`,
        title: `${RUN} gri std`,
        category: 'Universal',
        disclosures: [
          {
            code: `${RUN}-GD`,
            title: `${RUN} gri disc`,
            items: [{ code: `${RUN}-GI`, requirement: `${RUN} gri req`, priority: 'high', esgClass: 'environmental' }],
          },
        ],
      },
    ],
  };
  const c1 = await api('POST', '/gri/commit', geTok, griPayload);
  must(c1.status === 200 && c1.json.inserted >= 1, `E0a first import inserts (inserted=${c1.json.inserted})`);
  const c2 = await api('POST', '/gri/commit', geTok, griPayload);
  const dupeCount = await withTenantContext(ELEVATED, async (c) =>
    Number((await c.query(`SELECT COUNT(*)::int AS n FROM items WHERE code = $1`, [`${RUN}-GI`])).rows[0].n)
  );
  must(c2.status === 200 && dupeCount === 1, `E0b re-import upsert: 0 dupes (rows with code=${dupeCount}, updated=${c2.json.updated})`);

  // ---- E1. freeze -> edit -> snapshot-identical (WF-05) --------------------------
  const beforeEdit = await api('GET', '/items', geTok);
  const item1Row = (beforeEdit.json as any[]).find((x) => x.id === item1);
  const payload = { items: [{ id: item1, code: item1Row.code, requirement: item1Row.requirement }] };
  const payloadJson = JSON.stringify(payload);
  await withTenantContext(ELEVATED, async (c) => {
    await c.query(
      `INSERT INTO review_snapshots (client_id, scope_type, scope_ref, payload, content_hash, created_by) VALUES ($1,'tenant',$2,$3,'b11a-proof',$4)`,
      [seed.tenantId, seed.tenantId, payloadJson, seed.geId]
    );
  });
  const snapBefore = await withTenantContext(ELEVATED, async (c) => (await c.query(`SELECT payload::text AS p FROM review_snapshots WHERE client_id = $1`, [seed.tenantId])).rows[0].p);
  r = await api('PATCH', `/items/${item1}`, geTok, { requirement: `${RUN} req 1 EDITED` });
  must(r.status === 200, 'E1 template edit stays allowed after freeze (snapshots are copies)');
  const snapAfter = await withTenantContext(ELEVATED, async (c) => (await c.query(`SELECT payload::text AS p FROM review_snapshots WHERE client_id = $1`, [seed.tenantId])).rows[0].p);
  must(snapAfter === snapBefore, `E2 frozen snapshot payload byte-identical after edit (${snapBefore.length} bytes unchanged)`);

  // ---- E3. audit trail ----------------------------------------------------------------
  const auditCount = await withTenantContext(ELEVATED, async (c) =>
    Number((await c.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action IN ('CREATE_SERVICE','UPDATE_SERVICE','DUPLICATE_SERVICE','LINK_SERVICE_STANDARD','UNLINK_SERVICE_STANDARD','UPDATE_STANDARD','DELETE_STANDARD','UPDATE_DISCLOSURE','DELETE_DISCLOSURE','CREATE_ITEM','UPDATE_ITEM','DELETE_ITEM','LINK_ITEMS','UNLINK_ITEMS') AND user_id = $1`, [seed.geId])).rows[0].n)
  );
  must(auditCount >= 12, `E5 audit_log has ${auditCount} B11a entries (>=12)`);

  // ---- cleanup (best-effort; tenant + immutable snapshot stay by design) ---------------
  await withTenantContext(ELEVATED, async (c) => {
    await c.query(`DELETE FROM item_links WHERE item_a = $1 OR item_b = $1`, [item1]);
    await c.query(`DELETE FROM items WHERE code LIKE '${RUN}%'`);
    await c.query(`DELETE FROM service_standards WHERE service_id IN (SELECT id FROM services WHERE code LIKE '${RUN}%')`);
    await c.query(`DELETE FROM services WHERE code LIKE '${RUN}%'`);
    await c.query(`DELETE FROM disclosures WHERE code LIKE '${RUN}%'`);
    await c.query(`DELETE FROM standards WHERE code LIKE '${RUN}%'`);
  });
  ok('cleanup: B11a services/items/standards removed; tenant + freeze snapshot retained by design');

  server.close();
  (await import('../src/db/index.ts')).getPool().end().catch(() => {});
  console.log(`\nB11a proof complete: ${results.length} checks passed.`);
  console.log('Refusal table (endpoint | actor | expected | got | message):');
  for (const line of refusals) console.log(`  - ${line}`);
  console.log(`Residue by design: tenant ${RUN}-T + 1 tenant freeze snapshot (immutable).`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
