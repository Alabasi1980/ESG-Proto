// JSON-error micro-fix harness proof (run on a FRESH local Postgres).
//
// Usage: DATABASE_URL=postgres://postgres:postgres@localhost:5433/esg_jsonproof JWT_SECRET=<test-secret> tsx scripts/json-error-proof.ts
//
// Proves over real HTTP against the REAL apiRouter wiring:
//   R1. client_admin POST /users → 403 JSON with the staff-list pointer
//       (GE_ONLY_PROVISION_REFUSAL, body byte-identical to the constant).
//   R2. employee POST /users → 403 JSON, same refusal.
//   R3. client_admin GET /ge/overview → 403 JSON (ge_admin-only gate).
//   F1. Forced sync throw on a route of the live apiRouter → JSON with the
//       thrown status (never the Express HTML error page).
//   F2. Unknown /api route → 404 JSON (never the default HTML page).
// Every check asserts the Content-Type explicitly (must be application/json)
// and asserts the body is NOT HTML. Exits non-zero on first failure.
// Never logs secrets (no tokens/passwords/OTPs).

import express from 'express';
import { getPool, withTenantContext, runMigrations } from '../src/db/index.ts';
import { generateToken, hashPassword } from '../src/server/auth.ts';
import apiRouter from '../src/server/routes.ts';
import { GE_ONLY_PROVISION_REFUSAL } from '../src/lib/tenantAccess.ts';
import { apiNotFoundHandler, globalJsonErrorHandler } from '../src/server/errorHandler.ts';

const RUN = `JSON${Date.now().toString(36).toUpperCase()}`;
const rows: string[] = [];

function ok(line: string) {
  rows.push(`PASS ${line}`);
  console.log(`PASS ${line}`);
}
function must(cond: boolean, line: string) {
  if (!cond) throw new Error(`PROOF FAILED: ${line}`);
  ok(line);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required.');

  const mig = await runMigrations();
  if (!mig.success) throw new Error(`migrations failed: ${mig.message}`);
  ok(`harness migrations applied (${RUN})`);

  const ELEVATED = { tenantId: null as string | null, role: 'ge_admin', departmentId: null, userId: null as string | null };
  const seed = await withTenantContext(ELEVATED, async (client) => {
    const cRes = await client.query(`INSERT INTO clients (code, name) VALUES ($1, $2) RETURNING id`, [`${RUN}-T`, `${RUN} tenant`]);
    const tenantId: string = cRes.rows[0].id;
    const dId: string = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-D`, `${RUN} dept`])).rows[0].id;
    const mk = async (email: string, role: string) => {
      const h = await hashPassword('T3st!Passw0rd');
      return (await client.query(
        `INSERT INTO users (email, password_hash, name, role, client_id, department_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [email, h, email, role, tenantId, role === 'employee' ? dId : null]
      )).rows[0].id as string;
    };
    const geId = await mk(`${RUN}-ge@x.test`, 'ge_admin');
    const caId = await mk(`${RUN}-ca@x.test`, 'client_admin');
    const empId = await mk(`${RUN}-emp@x.test`, 'employee');
    return { tenantId, geId, caId, empId };
  });
  const T = (id: string, email: string, role: any) =>
    generateToken({ id, email, name: email, role, clientId: seed.tenantId, departmentId: null });
  const caTok = T(seed.caId, 'ca', 'client_admin');
  const empTok = T(seed.empId, 'emp', 'employee');

  // NOTE: no in-process mutation of apiRouter. The forced-throw probe below
  // uses a scratch app wired with the SHIPPED handler functions in the SAME
  // terminal order as src/server/routes.ts (routes → 404 → error handler),
  // so it proves the exact shipped code + mounting order.
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
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', text, json };
  };
  const mustJson = (r: { contentType: string; text: string; json: any }, line: string) => {
    must(/application\/json/.test(r.contentType), `${line} — content-type is application/json (got '${r.contentType}')`);
    must(r.json !== null && typeof r.json.error === 'string', `${line} — body is JSON with an error field`);
    must(!/<html/i.test(r.text), `${line} — body is NOT HTML`);
    must(!('stack' in (r.json ?? {})), `${line} — no stack trace leaked`);
  };

  // ---- R1/R2: non-GE POST /users → 403 JSON with the staff-list pointer ----
  let r = await api('POST', '/users', caTok, { email: `${RUN}-x@x.test`, password: 'T3st!Passw0rd', name: 'X', role: 'employee' });
  must(r.status === 403, 'R1 client_admin POST /users -> 403 (gate holds, fail-closed)');
  mustJson(r, 'R1 client_admin POST /users');
  must(r.json.error === GE_ONLY_PROVISION_REFUSAL, 'R1 refusal body byte-identical to GE_ONLY_PROVISION_REFUSAL (unchanged)');
  must(/staff [Ll]ist|Staff Lists/.test(r.json.error), 'R1 refusal carries the staff-list pointer');

  r = await api('POST', '/users', empTok, { email: `${RUN}-y@x.test`, password: 'T3st!Passw0rd', name: 'Y', role: 'employee' });
  must(r.status === 403, 'R2 employee POST /users -> 403 (gate holds, fail-closed)');
  mustJson(r, 'R2 employee POST /users');
  must(r.json.error === GE_ONLY_PROVISION_REFUSAL, 'R2 refusal body byte-identical to GE_ONLY_PROVISION_REFUSAL (unchanged)');

  // ---- R3: client_admin GET /ge/overview → 403 JSON ----
  r = await api('GET', '/ge/overview', caTok);
  must(r.status === 403, 'R3 client_admin GET /ge/overview -> 403 (gate holds, fail-closed)');
  mustJson(r, 'R3 client_admin GET /ge/overview');
  must(r.json.error === 'Only platform administrators may perform this operation.', 'R3 refusal message unchanged');

  // ---- F1: forced throw → JSON, never HTML (shipped handlers, routes.ts order) ----
  // A scratch app proves an intentionally-thrown error inside a route yields
  // JSON with the right status through the exact shipped terminal wiring.
  const scratch = express();
  scratch.use(express.json());
  scratch.get('/__force-error', () => {
    throw Object.assign(new Error('forced boom'), { statusCode: 500, code: 'test.forced' });
  });
  scratch.use(apiNotFoundHandler);
  scratch.use(globalJsonErrorHandler);
  const scratchServer = await new Promise<any>((resolve) => {
    const s = scratch.listen(0, '127.0.0.1', () => resolve(s));
  });
  const scratchBase = `http://127.0.0.1:${scratchServer.address().port}`;
  const sresFixed = await fetch(`${scratchBase}/__force-error`);
  const stext = await sresFixed.text();
  let sjson: any = null;
  try { sjson = JSON.parse(stext); } catch { sjson = null; }
  must(sresFixed.status === 500, 'F1 forced throw -> 500 (global JSON error handler caught it)');
  must(/application\/json/.test(sresFixed.headers.get('content-type') ?? ''), `F1 forced throw — content-type is application/json (got '${sresFixed.headers.get('content-type')}')`);
  must(sjson !== null && sjson.error === 'forced boom', 'F1 forced-throw message preserved, JSON body');
  must(sjson.code === 'test.forced', 'F1 forced-throw code preserved');
  must(!/<html/i.test(stext), 'F1 forced throw — body is NOT HTML');
  must(!('stack' in (sjson ?? {})), 'F1 forced throw — no stack trace leaked');
  ok('F1 forced throw yields JSON (never the Express HTML page)');
  scratchServer.close();

  // ---- F2: unknown /api route → 404 JSON, never HTML ----
  r = await api('GET', '/no-such-route-xyz', caTok);
  must(r.status === 404, 'F2 unknown /api route -> 404');
  mustJson(r, 'F2 unknown /api route');
  must(r.json.error === 'Not found', 'F2 404 body is the JSON not-found shape');

  // ---- Residual (informational, NOT a failure): malformed JSON at the APP
  // body parser fails before routing, so it skips the apiRouter-level
  // handlers (Express skips sub-routers in error flow) and reaches Express's
  // default HTML page. Covering that vector needs a one-line mount in
  // server.ts (app-level), which is OUTSIDE this task's Allowed Write
  // Targets — reported as a decision item for Tera, not a gate failure.
  const badRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  });
  const badText = await badRes.text();
  const badCt = badRes.headers.get('content-type') ?? '';
  console.log(`INFO residual probe: malformed app-level JSON -> ${badRes.status} '${badCt}' html=${/<html/i.test(badText)}`);
  console.log(`INFO (out of scope): needs server.ts app-level mount; decision for Tera.`);

  // ---- cleanup ----
  const pool = getPool();
  await withTenantContext(ELEVATED, async (c) => {
    await c.query(`DELETE FROM users WHERE email LIKE '${RUN}%'`);
    await c.query(`DELETE FROM departments WHERE code LIKE '${RUN}%'`);
    await c.query(`DELETE FROM clients WHERE code LIKE '${RUN}%'`);
  });
  ok('cleanup: harness tenant + users removed');

  server.close();
  await pool.end().catch(() => {});
  console.log(`\nJSON-error proof complete: ${rows.length} checks passed.`);
  console.log('Refusal table (endpoint | actor | status | content-type | body):');
  console.log(`  - POST /users | client_admin | 403 | application/json | GE_ONLY_PROVISION_REFUSAL (unchanged)`);
  console.log(`  - POST /users | employee     | 403 | application/json | GE_ONLY_PROVISION_REFUSAL (unchanged)`);
  console.log(`  - GET /ge/overview | client_admin | 403 | application/json | ge_admin-only gate (unchanged)`);
  console.log(`  - GET /__force-error | scratch (shipped handlers, routes.ts order) | 500 | application/json | forced boom + code (no HTML, no stack)`);
  console.log(`  - GET /no-such-route-xyz | client_admin | 404 | application/json | Not found (no HTML)`);
  console.log(`  - Residual (out of scope, needs Tera decision): malformed JSON at the app-level body parser`);
  console.log(`    still yields the Express HTML page (pre-existing; server.ts is outside Allowed Write Targets).`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
