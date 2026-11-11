// B16 proof (run: DATABASE_URL=... JWT_SECRET=... tsx scripts/b16-proof.ts).
//
// Proves the CLIENT ROLE REALIGNMENT batch on a FRESH local Postgres:
//   E1 full chain with TWO dept users (evaluator + head): evaluate ->
//      dept-approve by head -> client-approve -> ge-final -> freeze,
//      proving each level stamp (department / client / ge).
//   E2 single-user dept self-approve allowed + flagged preliminary
//      (selfApproved + bilingual label in the evaluator notice), then
//      client-confirm.
//   E3 refusal table (all 403, bilingual path-pointing): client POST
//      evaluation, ge POST evaluation, client import (GRI + ESG), client
//      level-set, client assign (+unassign +na), client action-open,
//      client action-verify/close, client select/unselect initiative,
//      ge A4-approve/return, cross-dept approve, employee client-approve,
//      client self-approve at client level, ge self-approve at GE final,
//      client correct.
//   E4 live shapes unaffected: a legacy draft-shaped row (draft evaluation +
//      draft answer) survives the idempotent migration and works through the
//      same code path (read + API draft update).
//   D  dept-approve fan-out: the tenant's client_admin(s) get
//      evaluation.dept_approved ("awaiting your confirmation", AR+EN).
//
// Env required: DATABASE_URL, JWT_SECRET. Exits non-zero on first failure.

import express from 'express';
import { getPool, withTenantContext, runMigrations } from '../src/db/index.ts';
import { generateToken, hashPassword } from '../src/server/auth.ts';
import apiRouter from '../src/server/routes.ts';

const RUN = `B16${Date.now().toString(36).toUpperCase()}`;
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

  const mig1 = await runMigrations();
  if (!mig1.success) throw new Error(`migrations failed: ${mig1.message}`);
  ok('harness migrations applied');
  const mig2 = await runMigrations();
  if (!mig2.success) throw new Error(`migration re-apply failed: ${mig2.message}`);
  ok('E0 migration re-apply idempotent (live shapes safe)');

  const ELEVATED = { tenantId: null as string | null, role: 'ge_admin', departmentId: null, userId: null as string | null };

  // ---- seed tenant + users + taxonomy --------------------------------------
  const seed = await withTenantContext(ELEVATED, async (client) => {
    const tenantId: string = (await client.query(`INSERT INTO clients (code, name) VALUES ($1, $2) RETURNING id`, [`${RUN}-T`, `${RUN} tenant`])).rows[0].id;
    const legal: string = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-LEGAL`, `${RUN} Legal`])).rows[0].id;
    const hr: string = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-HR`, `${RUN} HR`])).rows[0].id;
    const solo: string = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-SOLO`, `${RUN} Solo`])).rows[0].id;
    const mk = async (email: string, name: string, role: string, dept: string | null, pw: string) =>
      (await client.query(
        `INSERT INTO users (email, password_hash, name, role, client_id, department_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [email, await hashPassword(pw), name, role, role === 'ge_admin' ? null : tenantId, dept]
      )).rows[0].id;
    const geId = await mk(`${RUN}-ge@x.test`, `${RUN} ge`, 'ge_admin', null, 'GePass123!');
    const caId = await mk(`${RUN}-ca@x.test`, `${RUN} ca`, 'client_admin', null, 'CaPass123!');
    const evalId = await mk(`${RUN}-eval@x.test`, `${RUN} evaluator`, 'employee', legal, 'EvPass123!');
    const headId = await mk(`${RUN}-head@x.test`, `${RUN} head`, 'employee', legal, 'HePass123!');
    const otherId = await mk(`${RUN}-other@x.test`, `${RUN} other`, 'employee', hr, 'OtPass123!');
    const soloId = await mk(`${RUN}-solo@x.test`, `${RUN} solo`, 'employee', solo, 'SoPass123!');
    const stdId: string = (await client.query(`INSERT INTO standards (code, title, category) VALUES ($1,$2,$3) RETURNING id`, [`${RUN}-STD`, `${RUN} std`, 'Universal'])).rows[0].id;
    const mkDisc = async (code: string) =>
      (await client.query(`INSERT INTO disclosures (standard_id, code, title) VALUES ($1,$2,$3) RETURNING id`, [stdId, code, `${code} title`])).rows[0].id;
    const mkItem = async (disc: string, code: string) =>
      (await client.query(`INSERT INTO items (disclosure_id, code, requirement, priority, esg_class) VALUES ($1,$2,$3,'high','governance') RETURNING id`, [disc, code, `${code} req`])).rows[0].id;
    const d1 = await mkDisc(`${RUN}-D1`);
    const d2 = await mkDisc(`${RUN}-D2`);
    const d3 = await mkDisc(`${RUN}-D3`);
    const d4 = await mkDisc(`${RUN}-D4`); // ca-authored fixture alone (never freezable, by design)
    const i1 = await mkItem(d1, `${RUN}-I1`); // E1 full chain (Legal, evaluator+head)
    const i2 = await mkItem(d2, `${RUN}-I2`); // E2 solo self-approve (Solo)
    const i3 = await mkItem(d2, `${RUN}-I3`); // E4 legacy draft shape (Legal)
    const i4 = await mkItem(d3, `${RUN}-I4`); // ge-authored (GE-final self-approve refusal)
    const i5 = await mkItem(d3, `${RUN}-I5`); // fresh API chain (refusal target + D3 gate filler)
    const i6 = await mkItem(d4, `${RUN}-I6`); // ca-authored (client self-approve refusal)
    return { tenantId, legal, hr, solo, geId, caId, evalId, headId, otherId, soloId, d1, d2, d3, d4, i1, i2, i3, i4, i5, i6 };
  });

  const T = (u: { id: string; email: string; name: string; role: any; clientId?: string | null; departmentId?: string | null }) =>
    generateToken({ id: u.id, email: u.email, name: u.name, role: u.role, clientId: u.clientId ?? null, departmentId: u.departmentId ?? null });
  const geTok = T({ id: seed.geId, email: 'g', name: 'g', role: 'ge_admin' });
  const caTok = T({ id: seed.caId, email: 'c', name: 'c', role: 'client_admin', clientId: seed.tenantId });
  const evalTok = T({ id: seed.evalId, email: 'e', name: 'e', role: 'employee', clientId: seed.tenantId, departmentId: seed.legal });
  const headTok = T({ id: seed.headId, email: 'h', name: 'h', role: 'employee', clientId: seed.tenantId, departmentId: seed.legal });
  const otherTok = T({ id: seed.otherId, email: 'o', name: 'o', role: 'employee', clientId: seed.tenantId, departmentId: seed.hr });
  const soloTok = T({ id: seed.soloId, email: 's', name: 's', role: 'employee', clientId: seed.tenantId, departmentId: seed.solo });

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
  const mustAR = (msg: string, line: string) => {
    must(/[\u0600-\u06FF]/.test(msg || ''), `${line} (bilingual AR half present)`);
  };
  const versions = async (itemId: string) => {
    const r = await api('GET', `/evaluations?itemId=${itemId}&clientId=${seed.tenantId}`, geTok);
    must(r.status === 200, `versions readable for ${itemId.slice(0, 8)}`);
    const ev = r.json.evaluation;
    const ans = (r.json.answers ?? [])[0];
    return { evalId: ev.id as string, evalV: ev.version as number, ansV: ans.version as number, status: ans.status as string };
  };

  // ---- GE assigns head + items (GE-only paths still open) -------------------
  let r = await api('PATCH', `/departments/${seed.legal}/head`, geTok, { headUserId: seed.headId });
  must(r.status === 200 && r.json.head_user_id === seed.headId, 'A1 GE designates Legal head -> 200');
  r = await api('PATCH', `/departments/${seed.hr}/head`, caTok, { headUserId: seed.otherId });
  must(r.status === 403, 'A2 client_admin designate head -> 403 (GE only)');
  refusal('PATCH /departments/:id/head', 'client_admin', '403', r.status, r.json.error);
  for (const [item, dept] of [[seed.i1, seed.legal], [seed.i2, seed.solo], [seed.i3, seed.legal], [seed.i4, seed.legal], [seed.i5, seed.legal], [seed.i6, seed.legal]] as const) {
    r = await api('POST', '/assignments', geTok, { clientId: seed.tenantId, itemId: item, departmentId: dept });
    must(r.status === 200 || r.status === 201, `A3 GE assigns item ${item.slice(0, 8)} -> assigned`);
  }

  // ---- E1: full chain with TWO dept users ------------------------------------
  r = await api('POST', '/evaluations', evalTok, { itemId: seed.i1, departmentId: seed.legal, score: 100, evidenceNote: `${RUN} ev` });
  must(r.status === 200 || r.status === 201, 'E1.1 evaluator drafts i1 -> saved');
  let v = await versions(seed.i1);
  r = await api('POST', `/evaluations/${v.evalId}/submit`, evalTok, { version: v.evalV });
  must(r.status === 200, 'E1.2 evaluator submits i1 -> 200');
  v = await versions(seed.i1);
  r = await api('POST', `/evaluations/${v.evalId}/approve`, headTok, { version: v.evalV, comment: `${RUN} head ok` });
  must(r.status === 200 && r.json.answer?.status === 'approved', 'E1.3 head dept-approves i1 -> approved');
  must(r.json.selfApproved === false, 'E1.4 head approval of another member is NOT self-approved');
  v = await versions(seed.i1);
  r = await api('POST', `/evaluations/${v.evalId}/client-approve`, caTok, { version: v.evalV });
  must(r.status === 200 && r.json.answer?.status === 'client_approved', 'E1.5 client-approve i1 -> client_approved');
  v = await versions(seed.i1);
  r = await api('POST', '/reviews/ge-final', geTok, { scope: 'disclosure', clientId: seed.tenantId, scopeRef: seed.d1, confirm: true });
  must(r.status === 201, 'E1.6 GE final disclosure-D1 freeze -> 201');
  const stamps: string[] = await withTenantContext(ELEVATED, async (c) => {
    const ar = await c.query(
      `SELECT a.level FROM approvals a JOIN answers an ON an.id = a.answer_id
       WHERE an.client_id = $1 AND an.item_id = $2 ORDER BY a.created_at ASC`,
      [seed.tenantId, seed.i1]
    );
    return ar.rows.map((x: any) => String(x.level));
  });
  must(
    stamps.length === 3 && stamps[0] === 'department' && stamps[1] === 'client' && stamps[2] === 'ge',
    `E1.7 level stamps prove the chain (department/client/ge: ${stamps.join('/')})`
  );
  r = await api('POST', '/evaluations', evalTok, { itemId: seed.i1, departmentId: seed.legal, score: 50 });
  must(r.status === 409, 'E1.8 draft on frozen D1 -> 409 (freeze holds)');

  // ---- D: dept-approve fan-out to client_admin(s) ------------------------------
  r = await api('GET', '/notifications', caTok);
  const deptNote = (r.json.items ?? []).find((n: any) => n.type === 'evaluation.dept_approved');
  must(r.status === 200 && Boolean(deptNote), 'D1 client_admin inbox holds evaluation.dept_approved fan-out');
  must(/awaiting your confirmation/i.test(deptNote.body ?? ''), 'D2 fan-out body names awaiting-confirmation');
  mustAR(deptNote.body_ar ?? '', 'D3 fan-out carries the Arabic half');
  r = await api('GET', '/notifications', evalTok);
  must((r.json.items ?? []).some((n: any) => n.type === 'evaluation.approved'), 'D4 evaluator inbox keeps evaluation.approved fan-out');

  // ---- E2: single-user dept self-approve (OD-08 s2 exception) --------------------
  r = await api('POST', '/evaluations', soloTok, { itemId: seed.i2, departmentId: seed.solo, score: 50, evidenceNote: `${RUN} solo` });
  must(r.status === 200 || r.status === 201, 'E2.1 solo member drafts i2 -> saved');
  v = await versions(seed.i2);
  r = await api('POST', `/evaluations/${v.evalId}/submit`, soloTok, { version: v.evalV });
  must(r.status === 200, 'E2.2 solo member submits own i2 -> 200');
  v = await versions(seed.i2);
  r = await api('POST', `/evaluations/${v.evalId}/approve`, soloTok, { version: v.evalV });
  must(r.status === 200 && r.json.selfApproved === true, 'E2.3 solo member self-approves own i2 -> 200 selfApproved=true');
  r = await api('GET', '/notifications', soloTok);
  const prelim = (r.json.items ?? []).find((n: any) => n.type === 'evaluation.approved');
  must(Boolean(prelim) && /preliminary, pending client confirmation/i.test(prelim.body ?? ''), 'E2.4 evaluator notice labeled preliminary (EN)');
  mustAR(prelim?.body_ar ?? '', 'E2.5 evaluator notice labeled preliminary (AR)');
  // NOTE E2.6 (client-confirm) runs after E4: disclosure D2 also holds i3,
  // and the unchanged all-departments-complete gate needs i3 approved too.

  // ---- E4: legacy draft-shaped row survives migration + same code path ----------
  await withTenantContext(ELEVATED, async (c) => {
    const e = await c.query(
      `INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, justification)
       VALUES ($1,$2,$3,50,false,false,'legacy note') RETURNING id`,
      [seed.tenantId, seed.i3, seed.evalId]
    );
    await c.query(
      `INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value)
       VALUES ($1,$2,$3,$4,'draft','legacy note')`,
      [seed.tenantId, seed.i3, seed.legal, seed.evalId]
    );
    void e;
  });
  const mig3 = await runMigrations();
  must(mig3.success, 'E4.1 migration re-applied OVER legacy draft rows (no schema break)');
  r = await api('GET', `/evaluations?itemId=${seed.i3}&clientId=${seed.tenantId}`, evalTok);
  must(r.status === 200 && r.json.evaluation?.score === 50, 'E4.2 legacy draft row reads back through the same code path');
  v = await versions(seed.i3);
  r = await api('POST', '/evaluations', evalTok, { itemId: seed.i3, departmentId: seed.legal, score: 100, evidenceNote: 'updated', version: v.evalV });
  must(r.status === 200 || r.status === 201, 'E4.3 legacy draft updates through POST /evaluations (draft-shaped)');

  // i3 through dept approval too, so the D2 disclosure gate is satisfiable,
  // then E2.6 client-confirms the preliminary i2 approval.
  v = await versions(seed.i3);
  r = await api('POST', `/evaluations/${v.evalId}/submit`, evalTok, { version: v.evalV });
  must(r.status === 200, 'E4.4 legacy-shaped i3 submits -> submitted');
  v = await versions(seed.i3);
  r = await api('POST', `/evaluations/${v.evalId}/approve`, headTok, { version: v.evalV });
  must(r.status === 200, 'E4.5 head dept-approves i3 -> approved');
  v = await versions(seed.i2);
  r = await api('POST', `/evaluations/${v.evalId}/client-approve`, caTok, { version: v.evalV });
  must(r.status === 200 && r.json.answer?.status === 'client_approved', 'E2.6 client confirms the preliminary approval -> client_approved');

  // i5 full API chain (evaluator -> head -> client) fills the D3 gate.
  r = await api('POST', '/evaluations', evalTok, { itemId: seed.i5, departmentId: seed.legal, score: 100, evidenceNote: `${RUN} i5` });
  must(r.status === 200 || r.status === 201, 'setup i5 drafts -> saved');
  v = await versions(seed.i5);
  r = await api('POST', `/evaluations/${v.evalId}/submit`, evalTok, { version: v.evalV });
  must(r.status === 200, 'setup i5 submits -> submitted');
  v = await versions(seed.i5);
  r = await api('POST', `/evaluations/${v.evalId}/approve`, headTok, { version: v.evalV });
  must(r.status === 200, 'setup i5 head-approves -> approved');
  await withTenantContext(ELEVATED, async (c) => {
    await c.query(
      `INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, justification)
       VALUES ($1,$2,$3,100,false,false,'ca authored')`,
      [seed.tenantId, seed.i6, seed.caId]
    );
    await c.query(
      `INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value)
       VALUES ($1,$2,$3,$4,'submitted','ca authored')`,
      [seed.tenantId, seed.i6, seed.legal, seed.caId]
    );
    await c.query(
      `INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, justification)
       VALUES ($1,$2,$3,50,false,false,'ge authored')`,
      [seed.tenantId, seed.i4, seed.geId]
    );
    await c.query(
      `INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value)
       VALUES ($1,$2,$3,$4,'submitted','ge authored')`,
      [seed.tenantId, seed.i4, seed.legal, seed.geId]
    );
  });
  // head dept-approves both (head != author: allowed, not self)
  for (const item of [seed.i6, seed.i4]) {
    const vv = await versions(item);
    r = await api('POST', `/evaluations/${vv.evalId}/approve`, headTok, { version: vv.evalV });
    must(r.status === 200, `setup dept-approve ${item.slice(0, 8)} by head -> 200`);
  }

  // ---- E3: refusal table ----------------------------------------------------------
  const expect403 = async (label: string, method: string, path: string, tok: string | null, body?: any, arCheck = false) => {
    const rr = await api(method, path, tok, body);
    must(rr.status === 403, `${label} -> 403 (got ${rr.status})`);
    if (arCheck) mustAR(rr.json.error ?? '', `${label} bilingual`);
    refusal(path, label.split(' ')[0], '403', rr.status, rr.json.error ?? '');
  };

  await expect403('client POST /evaluations', 'POST', '/evaluations', caTok, { itemId: seed.i3, departmentId: seed.legal, score: 50 }, true);
  await expect403('ge POST /evaluations', 'POST', '/evaluations', geTok, { itemId: seed.i3, departmentId: seed.legal, score: 50 }, true);
  await expect403('client POST /gri/commit', 'POST', '/gri/commit', caTok, { standards: [], clientId: seed.tenantId }, true);
  await expect403('client POST /esg-profile/import', 'POST', '/esg-profile/import', caTok, { rows: [], clientId: seed.tenantId }, true);
  await expect403('client PUT /report-settings', 'PUT', '/report-settings', caTok, { clientId: seed.tenantId, disclosureLevel: 'with-reference', reportLevel: 'L1', statementName: 'x', statementPeriod: '2026' }, true);
  await expect403('client POST /assignments', 'POST', '/assignments', caTok, { clientId: seed.tenantId, itemId: seed.i3, departmentId: seed.legal }, true);
  await expect403('client DELETE /assignments', 'DELETE', '/assignments', caTok, { clientId: seed.tenantId, itemId: seed.i3, departmentId: seed.legal });
  await expect403('client POST /assignments/na', 'POST', '/assignments/na', caTok, { clientId: seed.tenantId, itemId: seed.i3, departmentId: seed.legal, naReason: 'not-applicable' });
  await expect403('client POST /actions', 'POST', '/actions', caTok, { title: `${RUN} a`, departmentId: seed.legal }, true);
  await expect403('client POST /initiatives/select', 'POST', '/initiatives/select', caTok, { initiativeId: 'nope' }, true);
  await expect403('client DELETE /initiatives/select', 'DELETE', '/initiatives/select/nope?clientId=' + seed.tenantId, caTok);

  // action verify/close path: GE opens + progresses, client/employee close refused
  r = await api('POST', '/actions', geTok, { title: `${RUN} pump`, departmentId: seed.legal, clientId: seed.tenantId });
  must(r.status === 201, 'setup GE opens action -> 201');
  const actionId: string = r.json.id;
  r = await api('PATCH', `/actions/${actionId}`, geTok, { status: 'in_progress' });
  must(r.status === 200, 'setup GE starts action -> in_progress');
  await expect403('client PATCH action verify', 'PATCH', `/actions/${actionId}`, caTok, { status: 'awaiting_verification' }, true);
  r = await api('PATCH', `/actions/${actionId}`, geTok, { status: 'awaiting_verification', evidenceNote: `${RUN} done` });
  must(r.status === 200, 'setup GE moves action -> awaiting_verification');
  await expect403('client PATCH action close', 'PATCH', `/actions/${actionId}`, caTok, { status: 'closed' }, true);
  await expect403('employee PATCH action close', 'PATCH', `/actions/${actionId}`, evalTok, { status: 'closed' });
  await expect403('client PUT /evaluations/:id/correct', 'PUT', `/evaluations/${(await versions(seed.i3)).evalId}/correct`, caTok, { newScore: 50, reason: 'x', version: 99 }, true);

  // dept-route refusals: the A4 actor gate runs FIRST (before the submitted
  // check), so a decided row still proves the refusal reason. i5 is
  // client_approved by this point (client-approved below).
  const vv5 = await versions(seed.i5);
  r = await api('POST', `/evaluations/${vv5.evalId}/client-approve`, caTok, { version: vv5.evalV });
  must(r.status === 200 && r.json.answer?.status === 'client_approved', 'setup i5 client-approved by ca -> 200');
  const vv5b = await versions(seed.i5);
  await expect403('ge POST A4-approve', 'POST', `/evaluations/${vv5b.evalId}/approve`, geTok, { version: vv5b.evalV }, true);
  await expect403('ge POST A4-return', 'POST', `/evaluations/${vv5b.evalId}/return`, geTok, { version: vv5b.evalV, comment: 'x' });
  await expect403('cross-dept approve', 'POST', `/evaluations/${vv5b.evalId}/approve`, otherTok, { version: vv5b.evalV }, true);
  await expect403('cross-dept return', 'POST', `/evaluations/${vv5b.evalId}/return`, otherTok, { version: vv5b.evalV, comment: 'x' });
  await expect403('employee client-approve', 'POST', `/evaluations/${vv5b.evalId}/client-approve`, evalTok, { version: vv5b.evalV });

  // client self-approve at client level (ca authored i6, head dept-approved)
  const vv6 = await versions(seed.i6);
  must(vv6.status === 'approved', 'setup i6 is dept-approved (client-approval eligible)');
  r = await api('POST', `/evaluations/${vv6.evalId}/client-approve`, caTok, { version: vv6.evalV });
  must(r.status === 403 && /[Ss]elf-approval/.test(r.json.error ?? ''), 'E3 client self-approve at client level -> 403 self-approval (ban strict)');
  refusal('POST /evaluations/:id/client-approve', 'client_admin(self)', '403', r.status, r.json.error ?? '');

  // ge self-approve at GE final (ge authored i4, full chain to client-approved)
  const vv4 = await versions(seed.i4);
  r = await api('POST', `/evaluations/${vv4.evalId}/client-approve`, caTok, { version: vv4.evalV });
  must(r.status === 200, 'setup i4 client-approved by ca (non-author) -> 200');
  r = await api('POST', '/reviews/ge-final', geTok, { scope: 'disclosure', clientId: seed.tenantId, scopeRef: seed.d3, confirm: true });
  must(r.status === 403 && /[Ss]elf-approval/.test(r.json.error ?? ''), 'E3 ge self-approve at GE final -> 403 self-approval (ban strict)');
  refusal('POST /reviews/ge-final', 'ge_admin(self)', '403', r.status, r.json.error ?? '');

  // ---- cleanup (best-effort; frozen D1 rows + snapshots stay as residue) ---------
  const pool = getPool();
  try {
    await withTenantContext(ELEVATED, async (c) => {
      const T12 = [seed.tenantId];
      await c.query(`DELETE FROM answers WHERE client_id = ANY($1) AND item_id NOT IN (SELECT id FROM items WHERE code LIKE '${RUN}-I1')`, [T12]).catch(() => {});
      await c.query(`DELETE FROM evaluations WHERE client_id = ANY($1) AND item_id NOT IN (SELECT id FROM items WHERE code LIKE '${RUN}-I1')`, [T12]).catch(() => {});
      await c.query(`DELETE FROM actions WHERE client_id = ANY($1)`, [T12]).catch(() => {});
      await c.query(`DELETE FROM approvals WHERE client_id = ANY($1)`, [T12]).catch(() => {});
      await c.query(`DELETE FROM assignments WHERE client_id = ANY($1) AND item_id NOT IN (SELECT id FROM items WHERE code LIKE '${RUN}-I1')`, [T12]).catch(() => {});
      await c.query(`DELETE FROM users WHERE client_id = ANY($1) AND email LIKE '${RUN}%'`, [T12]).catch(() => {});
      await c.query(`DELETE FROM items WHERE code LIKE '${RUN}%' AND code NOT LIKE '${RUN}-I1'`, []).catch(() => {});
      await c.query(`DELETE FROM disclosures WHERE code LIKE '${RUN}%' AND code NOT LIKE '${RUN}-D1'`, []).catch(() => {});
      await c.query(`DELETE FROM standards WHERE code LIKE '${RUN}%'`, []).catch(() => {});
      await c.query(`DELETE FROM departments WHERE code LIKE '${RUN}%'`, []).catch(() => {});
      await c.query(`DELETE FROM clients WHERE code LIKE '${RUN}%' AND id NOT IN (SELECT client_id FROM review_snapshots)`, []).catch(() => {});
    });
    ok('cleanup: best-effort removal of harness rows');
  } catch (err: any) {
    console.log(`cleanup note (residue by design): ${err.message}`);
  }

  server.close();
  pool.end().catch(() => {});
  console.log(`\nB16 proof complete: ${results.length} checks passed.`);
  console.log('Refusal table (endpoint | actor | expected | got | message):');
  for (const line of refusals) console.log(`  - ${line}`);
  console.log('Residue by design: frozen D1 disclosure rows + snapshot (immutable), GRI seed + audit rows.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
