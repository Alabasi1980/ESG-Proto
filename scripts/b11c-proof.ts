// B11c MICRO-FIX proof (run: DATABASE_URL=<fresh db> JWT_SECRET=... tsx scripts/b11c-proof.ts).
//
// Proves the B11c dashboard aggregate fix on a FRESH local Postgres over HTTP:
// the dashboard/stats aggregate+coverage gate counts answers.status IN
// ('submitted','approved','client_approved') — the pre-B9 two-value list
// silently dropped client_approved rows the moment they advanced.
//
//   P1 seed 6 items: draft / submitted / approved / client_approved
//      (+1 N/A +1 not-evaluated) with known scores, all weight 1.0
//   P2 GET /api/dashboard/stats asserts aggregate + coverage count EXACTLY
//      submitted+approved+client_approved and exclude the rest
//      (expected: evaluated=3, aggregate=50.0, coverage=60.0%)
//   P3 advance one row submitted -> approved -> client_approved, re-GET after
//      each step: numbers must NEVER drop (monotonic non-decreasing coverage)
//   P4 refusal table: draft row stays invisible to numbers throughout
//
// Env required: DATABASE_URL (must point at a FRESH database), JWT_SECRET.
// Exits non-zero on first failure. Fails fast if the DB is not fresh.

import express from 'express';
import { getPool, withTenantContext, runMigrations } from '../src/db/index.ts';
import { generateToken, hashPassword } from '../src/server/auth.ts';
import apiRouter from '../src/server/routes.ts';

const RUN = `B11C${Date.now().toString(36).toUpperCase()}`;
const results: string[] = [];

function ok(line: string) {
  results.push(`PASS ${line}`);
  console.log(`PASS ${line}`);
}

function must(cond: boolean, line: string) {
  if (!cond) throw new Error(`PROOF FAILED: ${line}`);
  ok(line);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the harness proof.');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for the harness proof.');

  const mig = await runMigrations();
  if (!mig.success) throw new Error(`migrations failed: ${mig.message}`);
  ok('harness migrations applied');

  const ELEVATED = { tenantId: null as string | null, role: 'ge_admin', departmentId: null, userId: null as string | null };

  // Freshness guard: dashboard/stats LEFT JOINs the GLOBAL items catalog, so
  // any residue from another run would pollute the denominator. Fail fast.
  const preItems = await withTenantContext(ELEVATED, async (c) =>
    (await c.query('SELECT COUNT(*)::int AS n FROM items')).rows[0]?.n ?? 0);
  if (preItems > 0) {
    throw new Error(
      `Harness DB is not fresh (${preItems} pre-existing item(s) pollute dashboard denominators). ` +
      `Recreate the database (DROP + CREATE), then rerun.`
    );
  }
  ok('freshness guard: items catalog empty before seed');

  // ---- seed tenant + users + taxonomy + evaluations/answers ----------------
  const seed = await withTenantContext(ELEVATED, async (client) => {
    const tenantId: string = (await client.query(
      `INSERT INTO clients (code, name) VALUES ($1, $2) RETURNING id`, [`${RUN}-T`, `${RUN} tenant`])).rows[0].id;
    const dept: string = (await client.query(
      `INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-D`, `${RUN} dept`])).rows[0].id;
    const mkUser = async (email: string, name: string, role: string) =>
      (await client.query(
        `INSERT INTO users (email, password_hash, name, role, client_id, department_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [email, await hashPassword('Proof123!'), name, role, tenantId, role === 'client_admin' ? null : dept])).rows[0].id;
    const caId = await mkUser(`${RUN}-ca@x.test`, `${RUN} ca`, 'client_admin');
    const empId = await mkUser(`${RUN}-emp@x.test`, `${RUN} emp`, 'employee');
    const stdId: string = (await client.query(
      `INSERT INTO standards (code, title, category) VALUES ($1,$2,$3) RETURNING id`, [`${RUN}-STD`, `${RUN} std`, 'Universal'])).rows[0].id;
    const discId: string = (await client.query(
      `INSERT INTO disclosures (standard_id, code, title) VALUES ($1,$2,$3) RETURNING id`, [stdId, `${RUN}-D1`, `${RUN} disc`])).rows[0].id;
    const mkItem = async (code: string) =>
      (await client.query(
        `INSERT INTO items (disclosure_id, code, requirement, priority, esg_class) VALUES ($1,$2,$3,'high','governance') RETURNING id`,
        [discId, code, `${code} req`])).rows[0].id;
    // Four scored evaluations in the four link-states + N/A + not-evaluated.
    const iDraft = await mkItem(`${RUN}-I-DRAFT`);
    const iSub = await mkItem(`${RUN}-I-SUB`);
    const iAppr = await mkItem(`${RUN}-I-APPR`);
    const iCapp = await mkItem(`${RUN}-I-CAPP`);
    const iNA = await mkItem(`${RUN}-I-NA`);
    const iNone = await mkItem(`${RUN}-I-NONE`);
    const mkEval = async (item: string, score: number | null, notEval: boolean, notAppr: boolean, naReason: string | null = null) =>
      client.query(
        `INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, na_reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tenantId, item, empId, score, notEval, notAppr, naReason]);
    const mkAns = async (item: string, status: string, value = 'evidence v1') =>
      (await client.query(
        `INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenantId, item, dept, empId, status, value])).rows[0].id;
    await mkEval(iDraft, 100, false, false); await mkAns(iDraft, 'draft');
    await mkEval(iSub, 100, false, false); const ansSub: string = await mkAns(iSub, 'submitted');
    await mkEval(iAppr, 50, false, false); await mkAns(iAppr, 'approved');
    await mkEval(iCapp, 0, false, false); await mkAns(iCapp, 'client_approved');
    await mkEval(iNA, null, false, true, 'not-applicable'); await mkAns(iNA, 'submitted');
    await mkEval(iNone, null, true, false); // no linked answer row at all
    return { tenantId, caId, iSub, ansSub };
  });
  ok('seeded 6 items: draft/submitted/approved/client_approved + N/A + not-evaluated');

  const caTok = generateToken({ id: seed.caId, email: 'ca', name: 'ca', role: 'client_admin', clientId: seed.tenantId, departmentId: null });

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const stats = async () => {
    const res = await fetch(`${base}/dashboard/stats`, { headers: { Authorization: `Bearer ${caTok}` } });
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.status !== 200) throw new Error(`PROOF FAILED: GET /dashboard/stats -> ${res.status} ${JSON.stringify(json)}`);
    return json;
  };

  try {
    // ---- P2: exact gate membership ----------------------------------------
    // Applicable = 5 (N/A excluded). Counted = submitted+approved+
    // client_approved = 3. Aggregate = (100+50+0)/3 = 50.0. Coverage 3/5.
    let s = await stats();
    must(s.totalCount === 6, `P2 totalCount=6 (got ${s.totalCount})`);
    must(s.applicableCount === 5, `P2 applicableCount=5, N/A excluded (got ${s.applicableCount})`);
    must(s.notApplicableCount === 1, `P2 notApplicableCount=1 (got ${s.notApplicableCount})`);
    must(s.evaluatedCount === 3, `P2 evaluatedCount=3 = submitted+approved+client_approved (got ${s.evaluatedCount})`);
    must(s.aggregateScore === 50, `P2 aggregateScore=50.0 (got ${s.aggregateScore})`);
    must(s.coveragePercentage === 60, `P2 coveragePercentage=60 (got ${s.coveragePercentage})`);
    must(s.fullGapCount === 1 && s.partialGapCount === 1 && s.noGapCount === 1,
      `P2 gap distribution 1/1/1 (got ${s.fullGapCount}/${s.partialGapCount}/${s.noGapCount})`);
    must(s.notEvaluatedCount === 2, `P2 notEvaluatedCount=2 = draft + never-evaluated (got ${s.notEvaluatedCount})`);

    // ---- P3: advance submitted -> approved -> client_approved ---------------
    // Numbers must NEVER drop as the row moves through final states.
    const seenEval: number[] = [s.evaluatedCount];
    const seenCov: number[] = [s.coveragePercentage];
    const seenAgg: number[] = [s.aggregateScore];
    for (const [step, to] of [['P3a', 'approved'], ['P3b', 'client_approved']] as const) {
      await withTenantContext(ELEVATED, async (c) => {
        await c.query(`UPDATE answers SET status = $1, updated_at = NOW() WHERE id = $2`, [to, seed.ansSub]);
      });
      s = await stats();
      seenEval.push(s.evaluatedCount);
      seenCov.push(s.coveragePercentage);
      seenAgg.push(s.aggregateScore);
      must(s.evaluatedCount === 3, `${step} submitted->${to}: evaluatedCount stays 3 (got ${s.evaluatedCount})`);
      must(s.aggregateScore === 50, `${step} submitted->${to}: aggregateScore stays 50 (got ${s.aggregateScore})`);
      must(s.coveragePercentage === 60, `${step} submitted->${to}: coverage stays 60 (got ${s.coveragePercentage})`);
    }
    for (let i = 1; i < seenEval.length; i++) {
      must(seenEval[i] >= seenEval[i - 1] && seenCov[i] >= seenCov[i - 1],
        `P3 monotonic: step ${i} never drops (eval ${seenEval.join('->')}, cov ${seenCov.join('->')})`);
    }
    void seenAgg;

    // ---- P4: draft row stays invisible throughout --------------------------
    must(s.notEvaluatedCount === 2, `P4 draft row still gated out (notEvaluatedCount=2, got ${s.notEvaluatedCount})`);

    console.log(`\nB11C PROOF COMPLETE (${RUN}): evaluated=${seenEval.join('->')} coverage=${seenCov.join('->')} aggregate=50.0`);
  } finally {
    server.close();
    await getPool().end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
