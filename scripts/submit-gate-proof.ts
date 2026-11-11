// MICRO-FIX proof (run: DATABASE_URL=... JWT_SECRET=... tsx scripts/submit-gate-proof.ts).
//
// Proves the submit gate (OD-08 s3 + WF-02) on a FRESH local Postgres:
//   S1 author submits own draft -> 200
//   S2 designated head submits (different user, head of the dept) -> 200
//   S3 client_admin submit -> 403 bilingual
//   S4 ge_admin submit -> 403 bilingual
//   S5 non-author same-dept employee -> 403 bilingual
//   S6 head of ANOTHER dept -> 403 bilingual
//   S7 no-deadlock chain on the head-submitted draft: head-approve by the
//      same head (self, preliminary) -> 200, then client-confirm -> 200
//      (client_approved), proving a head-submitted draft is approvable.
//
// Env required: DATABASE_URL, JWT_SECRET. Exits non-zero on first failure.

import express from 'express';
import { getPool, withTenantContext, runMigrations } from '../src/db/index.ts';
import { generateToken, hashPassword } from '../src/server/auth.ts';
import apiRouter from '../src/server/routes.ts';

const RUN = `SG${Date.now().toString(36).toUpperCase()}`;
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

  const ELEVATED = { tenantId: null as string | null, role: 'ge_admin', departmentId: null, userId: null as string | null };

  // ---- seed tenant + depts + users + taxonomy --------------------------------
  const seed = await withTenantContext(ELEVATED, async (client) => {
    const tenantId: string = (await client.query(`INSERT INTO clients (code, name) VALUES ($1, $2) RETURNING id`, [`${RUN}-T`, `${RUN} tenant`])).rows[0].id;
    const legal: string = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-LEGAL`, `${RUN} Legal`])).rows[0].id;
    const hr: string = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-HR`, `${RUN} HR`])).rows[0].id;
    const mk = async (email: string, name: string, role: string, dept: string | null, pw: string) =>
      (await client.query(
        `INSERT INTO users (email, password_hash, name, role, client_id, department_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [email, await hashPassword(pw), name, role, role === 'ge_admin' ? null : tenantId, dept]
      )).rows[0].id;
    const geId = await mk(`${RUN}-ge@x.test`, `${RUN} ge`, 'ge_admin', null, 'GePass123!');
    const caId = await mk(`${RUN}-ca@x.test`, `${RUN} ca`, 'client_admin', null, 'CaPass123!');
    const authorId = await mk(`${RUN}-author@x.test`, `${RUN} author`, 'employee', legal, 'AuPass123!');
    const headId = await mk(`${RUN}-head@x.test`, `${RUN} head`, 'employee', legal, 'HePass123!');
    const memberId = await mk(`${RUN}-member@x.test`, `${RUN} member`, 'employee', legal, 'MePass123!');
    const hrHeadId = await mk(`${RUN}-hrhead@x.test`, `${RUN} hrhead`, 'employee', hr, 'HhPass123!');
    const stdId: string = (await client.query(`INSERT INTO standards (code, title, category) VALUES ($1,$2,$3) RETURNING id`, [`${RUN}-STD`, `${RUN} std`, 'Universal'])).rows[0].id;
    const dRest: string = (await client.query(`INSERT INTO disclosures (standard_id, code, title) VALUES ($1,$2,$3) RETURNING id`, [stdId, `${RUN}-DREST`, `${RUN} rest`])).rows[0].id;
    const dChain: string = (await client.query(`INSERT INTO disclosures (standard_id, code, title) VALUES ($1,$2,$3) RETURNING id`, [stdId, `${RUN}-DCHAIN`, `${RUN} chain`])).rows[0].id;
    const mkItem = async (disc: string, code: string) =>
      (await client.query(`INSERT INTO items (disclosure_id, code, requirement, priority, esg_class) VALUES ($1,$2,$3,'high','governance') RETURNING id`, [disc, code, `${code} req`])).rows[0].id;
    const i1 = await mkItem(dRest, `${RUN}-I1`); // S1 author-submit
    const i2 = await mkItem(dRest, `${RUN}-I2`); // S2 head-submit
    const i3 = await mkItem(dRest, `${RUN}-I3`); // S3 client_admin refusal
    const i4 = await mkItem(dRest, `${RUN}-I4`); // S4 ge_admin refusal
    const i5 = await mkItem(dRest, `${RUN}-I5`); // S5 member refusal
    const i6 = await mkItem(dRest, `${RUN}-I6`); // S6 cross-dept head refusal
    const i7 = await mkItem(dChain, `${RUN}-I7`); // S7 no-deadlock chain (solo disclosure)
    return { tenantId, legal, hr, geId, caId, authorId, headId, memberId, hrHeadId, dRest, dChain, i1, i2, i3, i4, i5, i6, i7 };
  });

  const T = (u: { id: string; email: string; name: string; role: any; clientId?: string | null; departmentId?: string | null }) =>
    generateToken({ id: u.id, email: u.email, name: u.name, role: u.role, clientId: u.clientId ?? null, departmentId: u.departmentId ?? null });
  const geTok = T({ id: seed.geId, email: 'g', name: 'g', role: 'ge_admin' });
  const caTok = T({ id: seed.caId, email: 'c', name: 'c', role: 'client_admin', clientId: seed.tenantId });
  const authorTok = T({ id: seed.authorId, email: 'a', name: 'a', role: 'employee', clientId: seed.tenantId, departmentId: seed.legal });
  const headTok = T({ id: seed.headId, email: 'h', name: 'h', role: 'employee', clientId: seed.tenantId, departmentId: seed.legal });
  const memberTok = T({ id: seed.memberId, email: 'm', name: 'm', role: 'employee', clientId: seed.tenantId, departmentId: seed.legal });
  const hrHeadTok = T({ id: seed.hrHeadId, email: 'o', name: 'o', role: 'employee', clientId: seed.tenantId, departmentId: seed.hr });

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
  // Fresh draft per item (author drafts; submit actor varies).
  const draft = async (itemId: string) => {
    const r = await api('POST', '/evaluations', authorTok, { itemId, departmentId: seed.legal, score: 100, evidenceNote: `${RUN} draft` });
    must(r.status === 200 || r.status === 201, `setup draft ${itemId.slice(-3)} by author -> saved`);
    return versions(itemId);
  };

  // ---- heads + assignments (GE-only paths) -----------------------------------
  let r = await api('PATCH', `/departments/${seed.legal}/head`, geTok, { headUserId: seed.headId });
  must(r.status === 200 && r.json.head_user_id === seed.headId, 'setup Legal head designated -> 200');
  r = await api('PATCH', `/departments/${seed.hr}/head`, geTok, { headUserId: seed.hrHeadId });
  must(r.status === 200 && r.json.head_user_id === seed.hrHeadId, 'setup HR head designated -> 200');
  for (const item of [seed.i1, seed.i2, seed.i3, seed.i4, seed.i5, seed.i6, seed.i7]) {
    r = await api('POST', '/assignments', geTok, { clientId: seed.tenantId, itemId: item, departmentId: seed.legal });
    must(r.status === 200 || r.status === 201, `setup assign ${item.slice(-3)} -> Legal`);
  }

  // ---- S1 author submits own draft -> 200 -------------------------------------
  let v = await draft(seed.i1);
  r = await api('POST', `/evaluations/${v.evalId}/submit`, authorTok, { version: v.evalV });
  must(r.status === 200 && r.json.answer?.status === 'submitted', 'S1 author submits own draft -> 200 submitted');

  // ---- S2 designated head submits (different user) -> 200 ----------------------
  v = await draft(seed.i2);
  r = await api('POST', `/evaluations/${v.evalId}/submit`, headTok, { version: v.evalV });
  must(r.status === 200 && r.json.answer?.status === 'submitted', 'S2 dept head submits author draft -> 200 submitted');

  // ---- S3..S6 refusals (403 bilingual) ------------------------------------------
  const expectSubmit403 = async (label: string, itemId: string, tok: string | null) => {
    const vv = await draft(itemId);
    const rr = await api('POST', `/evaluations/${vv.evalId}/submit`, tok, { version: vv.evalV });
    must(rr.status === 403, `${label} -> 403 (got ${rr.status})`);
    must(/Only the evaluator or the department head may submit this evaluation\./.test(rr.json.error ?? ''), `${label} carries the exact EN contract`);
    mustAR(rr.json.error ?? '', `${label} bilingual`);
    refusal('POST /evaluations/:id/submit', label, '403', rr.status, rr.json.error ?? '');
  };
  await expectSubmit403('S3 client_admin', seed.i3, caTok);
  await expectSubmit403('S4 ge_admin', seed.i4, geTok);
  await expectSubmit403('S5 non-author employee', seed.i5, memberTok);
  await expectSubmit403('S6 cross-dept head', seed.i6, hrHeadTok);

  // ---- S7 no-deadlock chain: head-submitted draft stays approvable ---------------
  v = await draft(seed.i7);
  r = await api('POST', `/evaluations/${v.evalId}/submit`, headTok, { version: v.evalV });
  must(r.status === 200, 'S7.1 head submits chain draft -> 200');
  v = await versions(seed.i7);
  r = await api('POST', `/evaluations/${v.evalId}/approve`, headTok, { version: v.evalV });
  must(r.status === 200 && r.json.answer?.status === 'approved', 'S7.2 same head dept-approves the head-submitted draft -> 200 approved');
  must(r.json.selfApproved === false, 'S7.3 head approval is NOT self-approval (authorship stays with the author) — no preliminary label needed');
  v = await versions(seed.i7);
  r = await api('POST', `/evaluations/${v.evalId}/client-approve`, caTok, { version: v.evalV });
  must(r.status === 200 && r.json.answer?.status === 'client_approved', 'S7.4 client confirms head-submitted chain -> 200 client_approved (no deadlock)');

  // ---- cleanup (best-effort) ------------------------------------------------------
  const pool = getPool();
  try {
    await withTenantContext(ELEVATED, async (c) => {
      const T12 = [seed.tenantId];
      await c.query(`DELETE FROM answers WHERE client_id = ANY($1)`, [T12]).catch(() => {});
      await c.query(`DELETE FROM evaluations WHERE client_id = ANY($1)`, [T12]).catch(() => {});
      await c.query(`DELETE FROM approvals WHERE client_id = ANY($1)`, [T12]).catch(() => {});
      await c.query(`DELETE FROM assignments WHERE client_id = ANY($1)`, [T12]).catch(() => {});
      await c.query(`DELETE FROM users WHERE client_id = ANY($1) AND email LIKE '${RUN}%'`, [T12]).catch(() => {});
      await c.query(`DELETE FROM items WHERE code LIKE '${RUN}%'`, []).catch(() => {});
      await c.query(`DELETE FROM disclosures WHERE code LIKE '${RUN}%'`, []).catch(() => {});
      await c.query(`DELETE FROM standards WHERE code LIKE '${RUN}%'`, []).catch(() => {});
      await c.query(`DELETE FROM departments WHERE code LIKE '${RUN}%'`, []).catch(() => {});
      await c.query(`DELETE FROM clients WHERE code LIKE '${RUN}%'`, []).catch(() => {});
    });
    ok('cleanup: best-effort removal of harness rows');
  } catch (err: any) {
    console.log(`cleanup note: ${err.message}`);
  }

  server.close();
  pool.end().catch(() => {});
  console.log(`\nSubmit-gate proof complete: ${results.length} checks passed.`);
  console.log('Refusal table (endpoint | actor | expected | got | message):');
  for (const line of refusals) console.log(`  - ${line}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
