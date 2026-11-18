// B12 — structural + gate-matrix tests (no DB needed).
//
// 1. F-03 grep-proof: EVERY POST/PUT/PATCH/DELETE route line in the split
//    sub-routers (src/server/routes/*.ts) and taxonomy.ts carries
//    requireFreshPassword, except the explicit FRESH_GATE_ALLOWLIST entries.
//    `router.use(...)` mounts and GETs are reads (never gated).
// 2. S-24 audit-reader matrix: ge_admin always; named delegate via env;
//    client roles never; case-insensitive e-mail match.
// 3. S-23 inbox contract: cap is 50; the ten fan-out event types exist
//    (B16 adds evaluation.dept_approved).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classifyRoute } from '../server/accessRegistry.ts';
import {
  FRESH_GATE_ALLOWLIST,
  NOTIFICATION_INBOX_LIMIT,
  NOTIFICATION_TYPES,
  isAuditReader,
  writeFailure,
} from '../server/routes/_shared.ts';

const ROUTES_DIR = path.resolve('src/server/routes');
const SERVER_ROOT = path.resolve('src/server');
const TAXONOMY_FILE = path.resolve('src/server/taxonomy.ts');

test('B12 F-03: every mutating route carries requireFreshPassword or is allowlisted', () => {
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(ROUTES_DIR, f));
  files.push(TAXONOMY_FILE);

  const allowlist = new Set<string>(FRESH_GATE_ALLOWLIST);
  const violations: string[] = [];
  const gated: string[] = [];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      const m = line.match(/router\.(post|put|patch|delete)\(\s*'([^']+)'/);
      if (!m) continue;
      const key = `${m[1].toUpperCase()} ${m[2]}`;
      if (line.includes('requireFreshPassword')) {
        gated.push(key);
        continue;
      }
      if (allowlist.has(key as never)) continue;
      violations.push(`${path.basename(file)}: ${key}`);
    }
  }

  assert.deepEqual(violations, [], `ungated mutating routes: ${violations.join(', ')}`);
  // Sanity: the gate actually covers a large surface (not a vacuous pass).
  assert.ok(gated.length >= 40, `expected ≥40 gated mutating routes, saw ${gated.length}: ${gated.join(', ')}`);
});

test('B12 S-24: audit-reader matrix (GE + named delegate only)', () => {
  const ge = { id: 'g', email: 'ge@x.test', name: 'GE', role: 'ge_admin' as const };
  const ca = { id: 'c', email: 'ca@x.test', name: 'CA', role: 'client_admin' as const };
  const emp = { id: 'e', email: 'e@x.test', name: 'E', role: 'employee' as const };
  assert.equal(isAuditReader(ge), true);
  assert.equal(isAuditReader(ca), false);
  assert.equal(isAuditReader(emp), false);

  const prev = process.env.GE_AUDIT_DELEGATES;
  try {
    process.env.GE_AUDIT_DELEGATES = 'Delegate@x.test, other@x.test';
    assert.equal(isAuditReader({ ...ca, email: 'delegate@x.test' }), true);
    assert.equal(isAuditReader({ ...ca, email: 'DELEGATE@X.TEST' }), true);
    assert.equal(isAuditReader({ ...ca, email: 'stranger@x.test' }), false);
    assert.equal(isAuditReader({ ...emp, email: 'other@x.test' }), true);
  } finally {
    if (prev === undefined) delete process.env.GE_AUDIT_DELEGATES;
    else process.env.GE_AUDIT_DELEGATES = prev;
  }
  // U2-B round-3 retirement (U2_LEGACY_HELPER_RETIREMENT §2): audit admission
  // is now the §3 matrix inside requireDomainAccess, so the delegate env must
  // no longer grant audit read anywhere in the handler.
  const auditSource = fs.readFileSync(path.join(ROUTES_DIR, 'audit.ts'), 'utf8');
  assert.ok(!auditSource.includes('isAuditReader'), 'audit.ts must not consult the delegate grant');
  assert.ok(!auditSource.includes('auditDelegateEmails'), 'audit.ts must not read the delegate env');
  assert.ok(auditSource.includes('requireDomainAccess'), 'audit read must mount the §3 wrapper');
});

test('B12 S-23: inbox cap is 50 and the ten fan-out types exist', () => {
  assert.equal(NOTIFICATION_INBOX_LIMIT, 50);
  assert.deepEqual([...NOTIFICATION_TYPES].sort(), [
    'action.status',
    'assignment.created',
    'evaluation.approved',
    'evaluation.client_approved',
    'evaluation.client_returned',
    'evaluation.dept_approved',
    'evaluation.returned',
    'evaluation.submitted',
    'staff.approved',
    'staff.rejected',
  ]);
});

// U2-E E-2 (task §2/§9): source-shape guarantees for the evaluations write
// path. The two PostgreSQL row-security traps below were found empirically by
// the E-2 harness and are pinned here so they cannot come back:
//  - INSERT ... RETURNING: PG applies the SELECT policies to the RETURNING
//    clause, and a brand-new evaluation has no answer yet, so
//    b17_content_fact('evaluation', ...) is false and the row is denied;
//  - INSERT ... ON CONFLICT: the UPDATE row policy is evaluated against the row
//    being written, which the first draft save cannot satisfy.
test('U2-E E-2: evaluations.ts writes avoid the RETURNING/ON CONFLICT RLS traps and mount the §3 wrapper', () => {
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'evaluations.ts'), 'utf8');
  assert.ok(!/INSERT INTO evaluations[\s\S]{0,600}?RETURNING/.test(src),
    'no INSERT ... RETURNING on the evaluations pair upsert');
  assert.ok(!/INSERT INTO evaluations[\s\S]{0,600}?ON CONFLICT/.test(src),
    'no INSERT ... ON CONFLICT on the evaluations pair upsert');
  // Every §3.3 declaration (fifteen) carries requireDomainAccess on its line.
  const declarations = src.split('\n').filter(line => /router\.(get|post|put)\('/.test(line));
  assert.equal(declarations.length, 15, 'the §3.3 evaluations group is fifteen declarations');
  for (const line of declarations)
    assert.ok(line.includes('requireDomainAccess'), `wrapper missing: ${line.trim().slice(0, 90)}`);
  // Legacy context builders are fully retired from this file (E-1 reads +
  // E-2 writes).
  for (const legacy of ['contextFromUser', 'evalClientScope', 'evalDepartmentScope'])
    assert.ok(!src.includes(legacy), `${legacy} must be gone from evaluations.ts`);
  // BF-01: exactly one shared-lock line, and it is the tenant-level key.
  const locks = [...src.matchAll(/pg_advisory_xact_lock\(hashtextextended\(\$1,(\d+)\)\)/g)];
  assert.equal(locks.length, 1, 'exactly one advisory lock line in evaluations.ts (ge-final)');
  assert.equal(locks[0][1], '1717005', 'the BF-01 shared tenant lock seed');
});

// U2-E E-3 (§10 rulings 2, 4 and 5): source-shape twins for the three handler
// repairs that the §3 matrix would otherwise be the only defence for.
test('U2-E E-3: client-* refuse non-client_admin, read catches are sanitized, notes shares the read gate', () => {
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'evaluations.ts'), 'utf8');
  // Ruling 2 (Shield-06): OD-08 at handler level, not only in the dispatcher.
  assert.equal((src.match(/user\.role !== 'client_admin'/g) ?? []).length, 2,
    'client-approve and client-return each carry the explicit client_admin guard');
  // Ruling 4 (Shield-04): the six READ catches go through readFailure; no catch
  // anywhere may echo a raw err.code (a PostgreSQL SQLSTATE) to the client.
  assert.equal((src.match(/readFailure\(res, err,/g) ?? []).length, 6,
    'all six read catches use the sanitized readFailure treatment');
  assert.ok(!/code:\s*err\.code/.test(src), 'no catch may echo err.code directly');
  // Ruling 5 (Shield-05): notes applies the IDENTICAL full-visibility gate as
  // GET /reviews/snapshots/:id — same argument, same predicate.
  assert.equal(
    (src.match(/snapshotPayloadFullyLinked\(client, access, snapshot\.payload\)/g) ?? []).length, 2,
    'GET /:id and POST /:id/notes share the identical full-visibility gate');
  // Ruling 1(b) SUPERSEDED by TASK-PROTO-U4-2-FIX P3: the import commit is
  // service-scoped catalog-only (no tenant), so the BF-01 tenant advisory
  // lock and the tenant-keyed freeze recheck are BOTH gone from this path
  // (spec API-2 CHANGE, INV-IMPORT-SAFE — no freeze scope is determinable
  // without a tenant). Tenant freeze enforcement stays where the tenant
  // exists (evaluations ge-final lock above + answers paths).
  const gri = fs.readFileSync(path.join(ROUTES_DIR, 'gri.ts'), 'utf8');
  assert.ok(!gri.includes('pg_advisory_xact_lock(hashtextextended($1,1717005))'),
    'gri.ts takes no BF-01 tenant lock on the service-scoped import path');
  assert.ok(!gri.includes('SELECT is_scope_frozen($1) AS frozen'),
    'no tenant-keyed freeze query on the catalog import path');
});

// U2-F round 1 (task §3(3)): E3-02 write-catch masking folded from U2-E Shield.
// Every WRITE catch on the 22 retrofitted rows goes through _shared writeFailure
// (the write twin of readFailure), so a raw PostgreSQL message/SQLSTATE can
// never reach the client, while an error WE raised passes its own status/message/
// code (and the suspend wall's flag) through unchanged. The three round-2
// provisioning rows keep their legacy catch bodies until their own round.
test('U2-F E3-02: admin write catches use writeFailure; raw PG collapses, own status/message/code pass', () => {
  const splitFiles = ['adminClients.ts', 'adminDirectory.ts', 'adminAssignments.ts', 'adminStaff.ts',
    'adminPlatformOps.ts', 'adminProvisioning.ts', 'admin.ts'];
  let catches = 0, masked = 0;
  for (const file of splitFiles) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const c = (src.match(/catch \(err: any\) \{/g) ?? []).length;
    const m = (src.match(/writeFailure\(res, err,/g) ?? []).length;
    catches += c; masked += m;
    assert.equal(m, c, `${file}: every write catch routes through writeFailure (${c} catch(es))`);
    assert.ok(!/res\.status\([^)]*\)\.json\(\{ ?error: err\?*\.message/.test(src),
      `${file}: no catch may echo err.message directly`);
  }
  assert.ok(catches >= 20, `expected the 22-row surface to carry >=20 write catches, saw ${catches}`);
  assert.ok(masked === catches, 'masked catch count equals catch count');
  // Runtime behaviour of the treatment itself (unit-level, no DB).
  const calls: unknown[] = [];
  const res = {
    status(code: number) { calls.push(['status', code]); return this; },
    json(body: unknown) { calls.push(['json', body]); return this; },
  } as unknown as Parameters<typeof writeFailure>[0];
  writeFailure(res, { message: 'invalid input syntax for type uuid: "oops"', code: '22P02' }, 'Failed to fetch clients');
  assert.deepEqual(calls, [['status', 500], ['json', { error: 'Failed to fetch clients' }]],
    'a raw PG message + SQLSTATE collapses to the static fallback with NO code');
  calls.length = 0;
  writeFailure(res, Object.assign(new Error('Assignment not found.'), { statusCode: 404 }), 'fallback');
  assert.deepEqual(calls, [['status', 404], ['json', { error: 'Assignment not found.' }]],
    'own status + message pass through (no code key)');
  calls.length = 0;
  writeFailure(res, Object.assign(new Error('This tenant is suspended.'), {
    statusCode: 403, code: 'tenant.suspended', suspended: true,
  }), 'fallback');
  assert.deepEqual(calls, [['status', 403], ['json', {
    error: 'This tenant is suspended.', code: 'tenant.suspended', suspended: true,
  }]], 'own status/message/code pass, including the suspend-wall flag');
  calls.length = 0;
  writeFailure(res, { message: 'relation "x" does not exist', code: '42P01', statusCode: 500 }, 'fallback');
  assert.deepEqual(calls, [['status', 500], ['json', { error: 'fallback' }]],
    'even an integer statusCode alongside a SQLSTATE collapses (belt at the PG-diagnostic test)');
});

// U2-F round 2, ruling 3 (Shield-2 mitigation): the NULL-target platform
// configuration context may read answers/review_snapshots ONLY as an explicit-
// column/count projection (the §5 fixed-aggregate exception). RLS cannot
// restrict columns, so this source pin is the column-level ring: no SELECT * in
// the P summary path, every read of those two tables carries an explicit
// projection, /ge/overview never touches them at all, and no P summary file
// reads an evaluation row.
//
// U2-F round 3 (Shield Low-1): the scanned-file list is DERIVED from the actual
// NULL-target call sites under src/server/ — any file whose CODE (comments
// stripped) contains `platformConfigContext(req, null)` or a
// `platformGlobalContext(` call joins the surface, so a future caller is
// scanned automatically and a prose mention never drags an unrelated file in.
// Non-vacuity (synthetic caller in / non-caller out) is the companion test.

// Mask literals/comments without shifting offsets. This bounded call-expression
// reader balances argument delimiters; prose/imports/declarations are not calls.
function maskCode(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g,
    text => text.replace(/[^\r\n]/g, ' '));
}
function calls(src: string) {
  const code = maskCode(src), result: { name: string; args: string[]; at: number; end: number }[] = [];
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (/\bfunction\s*$/.test(code.slice(Math.max(0,m.index!-24),m.index))) continue;
    let depth = 1, start = m.index!+m[0].length, end = start;
    const args: string[] = [];
    for (; end < code.length; end++) {
      const ch = code[end];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (!depth || (ch === ',' && depth === 1)) {
        args.push(src.slice(start,end).trim()); start = end+1;
        if (!depth) break;
      }
    }
    result.push({ name:m[1],args,at:m.index!,end:end+1 });
  }
  return result;
}
const nullish = (value = '') => /^(?:null|undefined|void\s+0)?$/.test(value.trim());
function selectNullTargetFiles(corpus: Record<string, string>): string[] {
  return Object.entries(corpus).filter(([, src]) => calls(src).some(call => {
    if (call.name === 'platformGlobalContext') return true;
    if (call.name === 'platformConfigContext') return nullish(call.args[1]);
    if (call.name !== 'domainTransaction') return false;
    const selector = call.args[2];
    if (nullish(selector) || selector === 'platformGlobalContext') return true;
    // A forwarded default/null argument is a reachable Auto path too.
    if (/^[\w$]+$/.test(selector ?? '')
      && [...maskCode(src).matchAll(/\b([\w$]+)\s*(?::[^,)=]+)?\s*=\s*(?:null|undefined)\b/g)]
        .some(match => match[1]===selector)) return true;
    assert.ok(selector === 'readContext' || /\b(?:readContext|platformConfigContext|adminTenantContext)\s*\(/.test(maskCode(selector ?? '')),
      `Unclassified context selector: ${selector}`);
    return false;
  })).map(([file]) => file).sort();
}
function serverCorpus(serverRoot: string) {
  const corpus: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts'))
        corpus[path.relative(serverRoot, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(serverRoot);
  return corpus;
}

/** Table-specific, alias/quoted/schema/JOIN aware: COUNT(*) is not a row star.
 * This is an additional conservative ring, not a blanket ban on catalog stars. */
function sensitiveStars(src: string): string[] {
  const sql = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '').replace(/"/g, '');
  return [...sql.matchAll(/\bSELECT\s+([\s\S]*?)\bFROM\s+([\s\S]*?)(?=\bSELECT\b|;|$)/gi)]
    .filter(m => /\b(?:FROM|JOIN)\s+(?:\w+\.)?(?:answers|review_snapshots)\b/i.test(`FROM ${m[2]}`)
      && /(?:^|,)\s*(?:\w+\s*\.\s*)?\*(?:\s*(?:,|$))/.test(m[1].trim()))
    .map(m => m[0]);
}
function reachableSources(corpus: Record<string,string>, files: string[], roots?:string[]): string[] {
  // Follow borrowed function bodies rather than importing entire work-only
  // modules (scope.ts contains legitimate W/E answer stars).
  const definitions = new Map<string,string>();
  for (const src of Object.values(corpus)) {
    const masked = maskCode(src);
    for (const match of masked.matchAll(/\bfunction\s+(\w+)\s*\(/g)) {
      // Declarations are excluded by calls(); find the parameter close directly.
      const open = masked.indexOf('(',match.index!); let end = open+1, depth = 1;
      for (; end < masked.length && depth; end++) {
        if (masked[end] === '(') depth++; else if (masked[end] === ')') depth--;
      }
      const brace = masked.indexOf('{',end); if (brace < 0) continue;
      depth = 1; end = brace+1;
      for (; end < masked.length && depth; end++) {
        if (masked[end] === '{') depth++; else if (masked[end] === '}') depth--;
      }
      definitions.set(match[1],src.slice(brace,end));
    }
  }
  const sources = roots ?? files.map(file => corpus[file]), seen = new Set<string>();
  for (let i = 0; i < sources.length; i++) for (const call of calls(sources[i])) {
    if (seen.has(call.name)) continue;
    seen.add(call.name);
    const body = definitions.get(call.name); if (body) sources.push(body);
  }
  return sources;
}
function targetlessOperations(src:string):string[] {
  const sites=calls(src),roots:string[]=[];
  const routes=sites.filter(c => ['get','post','put','patch','delete'].includes(c.name) && /^['"]\//.test(c.args[0] ?? ''));
  const permitsP=(at:number) => {
    const enclosing=routes.filter(r => r.at<at && r.end>at);
    if (!enclosing.length) return undefined;
    return enclosing.some(r => classifyRoute(r.name.toUpperCase(),r.args[0].slice(1,-1))?.matrix.some(m => m.context==='P'));
  };
  for (const c of sites.filter(c => ['domainTransaction','withTenantContext'].includes(c.name))) {
    const selector=c.name==='domainTransaction'?c.args[2]:c.args[0];
    const auto=c.name==='domainTransaction' && (nullish(selector) || /^[\w$]+$/.test(selector ?? '') && selector!=='readContext');
    const explicit=selector==='platformGlobalContext' || calls(selector ?? '').some(s => s.name==='platformGlobalContext'
      || s.name==='platformConfigContext' && nullish(s.args[1]));
    if (!auto && !explicit) continue;
    let possible=permitsP(c.at);
    if (possible===undefined) {
      const owner=[...maskCode(src).slice(0,c.at).matchAll(/\bfunction\s+(\w+)\s*\(/g)].at(-1)?.[1];
      const forwarded=owner?sites.filter(s => s.name===owner):[];
      if (forwarded.length && forwarded.every(s => permitsP(s.at)===false)) possible=false;
    }
    if (possible!==false) roots.push(/^[\w$]+$/.test(c.args[1])?`${c.args[1]}();`:c.args[1]);
  }
  return roots;
}
function forbiddenProjection(src:string):boolean {
  const sql=src.replace(/"/g,'');
  return [...sql.matchAll(/\bSELECT\s+([\s\S]*?)\bFROM\s+([\s\S]*?)(?=\bSELECT\b|;|$)/gi)].some(m =>
    /\b(?:FROM|JOIN)\s+(?:\w+\.)?(?:answers|review_snapshots)\b/i.test(`FROM ${m[2]}`)
    && /\b(?:value|correction_history|payload|score|justification)\b/i.test(m[1]));
}

test('U2-F R2 Shield-2 pin: P summary reads of answers/review_snapshots are explicit-column/count only', () => {
  const corpus = serverCorpus(SERVER_ROOT), pSummaryFiles = selectNullTargetFiles(corpus);
  // Low-1 regression guard: the provisioning NULL-target probes ARE scanned.
  assert.ok(pSummaryFiles.includes('routes/adminProvisioning.ts'),
    `pin surface must include adminProvisioning.ts (got: ${pSummaryFiles.join(', ') || 'EMPTY'})`);
  assert.ok(pSummaryFiles.length >= 4, `pin surface must not be vacuous (got ${pSummaryFiles.length})`);
  for (const source of reachableSources(corpus,pSummaryFiles)) assert.deepEqual(sensitiveStars(source), [],
    'no sensitive row stars in a selected caller or its borrowed helpers');
  const roots=pSummaryFiles.flatMap(file => targetlessOperations(corpus[file]));
  for (const source of reachableSources(corpus,[],roots)) assert.equal(forbiddenProjection(source),false,
    'reachable CfgØ operations never project assessment values/history/payload/score');
  const opsCode = fs.readFileSync(path.join(SERVER_ROOT, 'routes/adminPlatformOps.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/FROM\s+(answers|review_snapshots)/i.test(opsCode),
    '/ge/overview totals never read answers or review_snapshots (count-only projection)');
  // The exact sanctioned projections that DO exist (adminClients progress).
  const clients = fs.readFileSync(path.join(SERVER_ROOT, 'routes/adminClients.ts'), 'utf8');
  assert.ok(clients.includes('SELECT client_id, item_id, department_id FROM answers'),
    'progress reads answer STATUS keys only (explicit columns)');
  assert.ok(clients.includes('SELECT client_id, scope_type, scope_ref FROM review_snapshots'),
    'progress reads snapshot coverage keys only (explicit columns)');
});

// U2-F round 3 (Shield Low-1): discovery non-vacuity — the surface is derived
// from call sites, the four current callers are all present, a work-context
// handler is absent, and a SYNTHETIC future caller is picked up by the same
// selection function with no list to edit (while a prose mention is not).
test('U2-F R3 Low-1: pin discovery is call-site-derived and non-vacuous', () => {
  const discovered = selectNullTargetFiles(serverCorpus(SERVER_ROOT));
  for (const f of [
    'routes/adminClients.ts', 'routes/adminCommon.ts',
    'routes/adminPlatformOps.ts', 'routes/adminProvisioning.ts', 'taxonomy.ts',
    'routes/initiatives.ts', 'routes/reports.ts',
  ]) assert.ok(discovered.includes(f), `${f} must join the NULL-target pin surface`);
  assert.ok(!discovered.includes('routes/adminStaff.ts'),
    'a readContext-only handler must NOT be dragged into the pin surface');
  // Synthetic corpus: brand-new caller auto-included, non-caller and prose-only
  // mention excluded — proving the selection, not today's file list.
  const forms = ['platformConfigContext(req, null)', 'platformConfigContext(req)',
    'platformConfigContext(req, undefined)', 'platformGlobalContext(req)',
    'domainTransaction(req, op)', 'domainTransaction(req, op, null)', 'domainTransaction(req, op, undefined)',
    'domainTransaction(req, op, live => platformConfigContext(live))',
    'domainTransaction(req, op, platformGlobalContext)',
    'function forwarded(req,op,target=null) { return domainTransaction(req, op, target); }'];
  for (const form of forms) for (const sql of ['SELECT * FROM answers',
    'SELECT s.* FROM review_snapshots s', 'SELECT s.* FROM services x JOIN public.review_snapshots s ON true',
    'SELECT a.* FROM "public"."answers" a']) {
    const invocation=form.startsWith('platform')?`withTenantContext(${form}, op)`:form;
    const corpus = { 'caller.ts':`${invocation}; function op() { return borrowed(); }`,
      'borrowed.ts':`function borrowed() { return db.query('${sql}'); }` };
    assert.deepEqual(selectNullTargetFiles(corpus), ['caller.ts'], form);
    assert.ok(reachableSources(corpus,['caller.ts']).some(src => sensitiveStars(src).length), `${form}: ${sql}`);
    const blob={ 'caller.ts':`${invocation}; function op() { return borrowed(); }`,
      'borrowed.ts':"function borrowed() { return db.query('SELECT a.value FROM answers a'); }" };
    assert.ok(reachableSources(blob,[],targetlessOperations(blob['caller.ts'])).some(forbiddenProjection), `${form}: borrowed values refused`);
  }
  for (const sql of ['SELECT COUNT(*) FROM answers','SELECT client_id, item_id FROM answers',
    'SELECT * FROM services','SELECT s.* FROM services s']) assert.deepEqual(sensitiveStars(sql),[]);
  assert.deepEqual(selectNullTargetFiles({ prose:'// platformConfigContext(req)\nimport { platformGlobalContext } from "x";',
    work:'domainTransaction(req, op, readContext);', explicit:'domainTransaction(req, op, live => platformConfigContext(live, target));' }), []);
  assert.throws(() => selectNullTargetFiles({unknown:'domainTransaction(req, op, staleContext);'}),/Unclassified context/);
});

// U2-F round 3 (Shield Low-2): the F-03 fresh-gate failure path must not echo
// err.message (a raw PostgreSQL message is reachable there on a non-own error).
// It routes through writeFailure — same §8(6) semantics as every admin write
// catch: own status/code pass, anything else collapses to the static fallback.
test('U2-F R3 Low-2: fresh-gate failure path routes through writeFailure (no raw echo)', () => {
  const src = fs.readFileSync(path.join(ROUTES_DIR, '_shared.ts'), 'utf8');
  const start = src.indexOf('export async function requireFreshPassword');
  assert.ok(start > 0, 'requireFreshPassword exists in _shared.ts');
  const next = src.indexOf('\nexport ', start + 10);
  const body = src.slice(start, next === -1 ? undefined : next);
  assert.ok(body.includes("writeFailure(res, err, 'Password-freshness check failed')"),
    'the catch routes through writeFailure');
  assert.ok(!body.includes("res.status(err?.statusCode || 500)"),
    'the raw err.message echo line is gone');
  const messageRefs = body.match(/error:\s*err\??\.message/g) ?? [];
  assert.equal(messageRefs.length, 1,
    'only the own forced-change 403 branch may reference err.message');
  assert.ok(body.includes('PASSWORD_CHANGE_REQUIRED_CODE'),
    'the own 403 forced-change branch is preserved unchanged');
});

test('U2-F R2: provisioning revalidates and holds the live session/tab through mutation + audit', () => {
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'adminProvisioning.ts'), 'utf8');
  assert.ok(src.includes('return withWorkspace(req, route.capability,'));
  assert.ok(src.includes('assertRouteContext(route, access)'));
  assert.ok(src.includes('await setTenantContext(client, platformConfigContext(req, target))'));
  assert.equal((src.match(/await configurationTransaction\(req, target,/g) ?? []).length, 2);
  assert.ok(!src.includes('withTenantContext('), 'no detached purpose-only transaction on provisioning rows');
  assert.ok(src.includes('client_id = $2 FOR UPDATE'), 'approve serializes on the list before checking status/issuing OTP');
});

// U2-F round 2, ruling 5 / parent §15: the deactivation MUST take the target
// user's auth_sessions ... FOR UPDATE before the users UPDATE, bracketed by the
// auth.revoke GUC dance (the same pattern b17_revoke_inactive uses), so the
// trigger's FOR UPDATE re-enters rows the transaction already holds and a
// concurrent request (sessions FOR SHARE -> users FOR SHARE) can never deadlock
// against it. Source-order pin; the runtime interleaving is proved in
// scripts/b17-domain-f3.ts.
test('U2-F R2-A lock order: auth_sessions FOR UPDATE precedes the users UPDATE, GUC-bracketed', () => {
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'adminProvisioning.ts'), 'utf8');
  const saveAt = src.indexOf("current_setting('app.current_actor_id', true)");
  const revokeAt = src.indexOf("set_config('app.current_purpose', 'auth.revoke', true)");
  const lockAt = src.indexOf('SELECT sid FROM auth_sessions WHERE user_id = $1 ORDER BY sid FOR UPDATE');
  const restoreAt = src.indexOf('set_config($1, $2, true), set_config($3, $4, true)');
  const updateAt = src.indexOf('UPDATE users SET is_active = $1');
  assert.ok(saveAt > 0, 'the prior actor/purpose GUCs are saved first');
  assert.ok(revokeAt > saveAt, 'purpose switched to auth.revoke before the lock');
  assert.ok(lockAt > revokeAt, 'auth_sessions ... FOR UPDATE runs inside the revoke bracket');
  assert.ok(restoreAt > lockAt, 'GUCs restored after the lock');
  assert.ok(updateAt > restoreAt, 'the users UPDATE happens only AFTER the session lock is held (parent §15)');
  assert.ok(src.indexOf('SELECT sid FROM auth_sessions') < updateAt,
    'never the reverse order (users row lock before sessions lock = the §15 deadlock)');
});

// ---------------------------------------------------------------------------
// G2 (task §12) — E3-02 completeness pin, SHIELD-U2G-01 evaluations ring and
// the legacy-helper no-any-client audit.
// ---------------------------------------------------------------------------

// G2 E3-02 (§12(1)): EVERY response construction in src/server that echoes an
// error's `.message`/`.code` field must sit inside a sanctioned own-error
// region — one of the collapse helpers (each runs the integer-statusCode own
// test AND the 5-char SQLSTATE belt, then collapses to a static fallback), or
// a catch whose own-error guard appears BEFORE the echo (forced-change 403
// code, version-conflict payload, or Number.isInteger statusCode). The exact
// per-file inventory is pinned: a NEW echo anywhere (catch or not, helper or
// not) fails until this table is deliberately edited — that edit is the
// reviewable act. Not matched by construction: globalJsonErrorHandler's
// indirection through a local `message` variable (Express last-resort for
// escaped errors; own-error contract pinned by errorHandler.test.ts) —
// disclosed residual, unchanged this round.
test('G2 E3-02: no raw err.message/err.code response construction outside sanctioned own-error paths', () => {
  const HELPER_NAMES = ['writeFailure', 'readFailure', 'domainFailure', 'failure', 'catalogFailure',
    'actionFailure', 'auditFailure', 'griFailure', 'inboxFailure', 'storageFailure', 'evalWriteFailure'];
  const GUARDS = ['PASSWORD_CHANGE_REQUIRED_CODE', 'conflictPayload', 'Number.isInteger('];
  const PATTERNS = [/error\s*:\s*[^,};]*?\.(?:message|code)\b/g, /code\s*:\s*err\??\.(?:message|code)\b/g];
  const EXPECTED: Record<string, number> = {
    'taxonomy.ts': 3, 'routes/actions.ts': 1, 'routes/audit.ts': 1, 'routes/evaluations.ts': 8,
    'routes/gri.ts': 3, 'routes/initiativeScope.ts': 1, 'routes/notifications.ts': 1,
    'routes/reports.ts': 1, 'routes/storage.ts': 1, 'routes/_shared.ts': 3,
  };
  const regionsOf = (src: string) => {
    // Sanctioned collapse helpers cover their whole function body.
    const regions: { start: number; end: number; spans?: [number, number][] }[] = [];
    for (const name of HELPER_NAMES) {
      const re = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`, 'g');
      for (const m of src.matchAll(re)) {
        let i = m.index! + m[0].length, depth = 1;
        for (; i < src.length && depth; i++) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; }
        const brace = src.indexOf('{', i); if (brace < 0) continue;
        let end = brace + 1; depth = 1;
        for (; end < src.length && depth; end++) { if (src[end] === '{') depth++; else if (src[end] === '}') depth--; }
        regions.push({ start: m.index!, end: end - 1 });
      }
    }
    // Catch regions expose ONLY their guard spans: a guard covers echoes from
    // its own condition through that if-block's closing `}` (regex literals
    // masked so the `{5}` SQLSTATE test cannot fake a block boundary). A later
    // statement in the same catch — an unguarded tail after a conflict branch —
    // falls outside every span and is a violation.
    for (const m of src.matchAll(/\bcatch\s*\((\w+)(?::[^)]+)?\)\s*\{/g)) {
      let depth = 1, end = m.index! + m[0].length; const start = end;
      for (; end < src.length && depth; end++) { if (src[end] === '{') depth++; else if (src[end] === '}') depth--; }
      const body = src.slice(start, end - 1);
      const masked = body.replace(/\/\^[^\n]*?\//g, s => s.replace(/[^\r\n]/g, ' '));
      const spans: [number, number][] = [];
      for (const guard of GUARDS) {
        let at = body.indexOf(guard);
        while (at >= 0) {
          const close = masked.indexOf('}', at);
          spans.push([start + at, close < 0 ? end : start + close]);
          at = body.indexOf(guard, at + guard.length);
        }
      }
      if (spans.length) regions.push({ start: m.index!, end: end - 1, spans });
    }
    return regions;
  };
  const corpus = serverCorpus(SERVER_ROOT);
  const counts: Record<string, number> = {};
  const violations: string[] = [];
  let total = 0;
  for (const [file, src] of Object.entries(corpus)) {
    const regions = regionsOf(src);
    for (const pattern of PATTERNS) for (const m of src.matchAll(pattern)) {
      const at = m.index!;
      const region = regions.find(r => at >= r.start && at <= r.end
        && (!r.spans || r.spans.some(([s, e]) => at > s && at < e)));
      if (region) { counts[file] = (counts[file] ?? 0) + 1; total++; }
      else violations.push(`${file}:${src.slice(0, at).split('\n').length} ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  assert.deepEqual(violations, [],
    `raw error echo outside a sanctioned own-error path:\n${violations.join('\n')}`);
  assert.deepEqual(counts, EXPECTED, 'sanctioned echo inventory must equal the reviewed table exactly');
  assert.ok(total >= 20, `pin must not be vacuous (saw ${total})`);
  for (const name of HELPER_NAMES) {
    const src = Object.values(corpus).find(s => new RegExp(`function\\s+${name}\\s*\\(`).test(s));
    assert.ok(src, `sanctioned helper ${name} must exist`);
    assert.match(src, /\[0-9A-Z\]\{5\}|statusCode/, `${name} must discriminate own vs PG/unknown`);
  }
});

// G2 SHIELD-U2G-01 (G1 ruling 1): the static `no FROM evaluations` ring is
// re-added ON TOP of the table-scoped answers|review_snapshots ring for the
// TARGETLESS-PLATFORM operation surface (platformGlobalContext /
// platformConfigContext(req, null) / defaulted selectors). Runtime already
// refuses (no platform.config SELECT policy on evaluations + FORCE RLS
// default-deny); this is the source-level belt that was dropped in G1.
test('G2 SHIELD-U2G-01: targetless-platform operations never read FROM/JOIN evaluations', () => {
  const read = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/"/g, '');
  const fromEvaluations = (src: string) => /\b(?:FROM|JOIN)\s+(?:\w+\.)?evaluations\b/i.test(read(src));
  const corpus = serverCorpus(SERVER_ROOT);
  const targetlessFiles = selectNullTargetFiles(corpus);
  const roots = targetlessFiles.flatMap(file => targetlessOperations(corpus[file]));
  assert.ok(roots.length >= 3, `targetless-platform operation roots must exist (saw ${roots.length})`);
  const offenders = reachableSources(corpus, [], roots).filter(fromEvaluations);
  assert.deepEqual(offenders.length, 0,
    `a targetless-platform operation must never read the evaluations table (${offenders.length} source(s))`);
  // Non-vacuity: the same discovery + detector flags a synthetic targetless
  // reader, and a prose-only mention is NOT part of the surface.
  const synthetic = {
    'synthetic.ts': 'function handler(req){ return domainTransaction(req, op, platformGlobalContext); }'
      + 'function op(){ return db.query(\'SELECT * FROM evaluations\'); }',
  };
  const syntheticRoots = targetlessOperations(synthetic['synthetic.ts']);
  assert.ok(syntheticRoots.length >= 1, 'synthetic targetless call must be discovered');
  assert.ok(reachableSources(synthetic, [], syntheticRoots).some(fromEvaluations),
    'synthetic targetless reader must be flagged by the ring');
  assert.deepEqual(selectNullTargetFiles({ prose: '// FROM evaluations platformGlobalContext' }), [],
    'a prose mention alone must not join the surface');
});

// G2 (§12(5)) legacy-helper no-any-client verification: the retirement
// checklist surface measured against ACTUAL source — business route files and
// taxonomy never rebuild context from req.user, no optional-auth mount exists,
// and every retired b11b/scope helper has zero live call sites. The single
// sanctioned contextFromUser is the auth-internal fresh gate.
test('G2 legacy-helper audit: contextFromUser only in the auth-internal fresh gate; no any-client/optional-auth fallback', () => {
  const corpus = serverCorpus(SERVER_ROOT);
  const RETIRED = ['evalClientScope', 'evalDepartmentScope', 'b11bOwnTenantScope', 'b11bRequireGeAdmin',
    'b11bAssertPasswordFresh', 'b11bAssertTenantActive', 'reportTenantScope', 'initiativeSelectionScope'];
  const contextSites: string[] = [];
  const retiredSites: string[] = [];
  const optionalAuthFiles: string[] = [];
  for (const [file, src] of Object.entries(corpus)) {
    const code = maskCode(src);
    for (const m of code.matchAll(/\bcontextFromUser\s*\(/g)) {
      const before = code.slice(Math.max(0, m.index! - 12), m.index!);
      if (/\bfunction\s*$/.test(before)) continue; // the definition, not a call
      contextSites.push(`${file}:${src.slice(0, m.index!).split('\n').length}`);
    }
    for (const name of RETIRED)
      if (new RegExp(`\\b${name}\\s*\\(`).test(code)) retiredSites.push(`${file}:${name}`);
    if (/\boptionalAuthMiddleware\b/.test(code)) optionalAuthFiles.push(file);
  }
  assert.deepEqual(retiredSites, [], 'no retired legacy helper may have a live call site');
  assert.deepEqual(optionalAuthFiles, ['auth.ts'],
    'optionalAuthMiddleware may appear only as its auth.ts definition — zero mounts anywhere');
  const authCode = maskCode(corpus['auth.ts']);
  assert.equal((authCode.match(/\boptionalAuthMiddleware\b/g) ?? []).length, 1,
    'auth.ts keeps exactly the one definition');
  assert.match(authCode, /function\s+optionalAuthMiddleware\s*\(/);
  assert.equal(contextSites.length, 1,
    `exactly one contextFromUser call is sanctioned, saw: ${contextSites.join(', ') || 'NONE'}`);
  assert.ok(contextSites[0].startsWith('routes/_shared.ts:'),
    `the only contextFromUser lives in _shared.ts (got ${contextSites[0]})`);
  const shared = corpus['routes/_shared.ts'];
  const gateAt = shared.indexOf('export async function requireFreshPassword');
  const nextExport = shared.indexOf('\nexport ', gateAt + 10);
  // First contextFromUser reference AFTER the gate starts (the definition at
  // the top of the file precedes it and is not a call).
  const callAt = maskCode(shared).indexOf('contextFromUser(', gateAt);
  assert.ok(gateAt > 0 && callAt > gateAt && (nextExport < 0 || callAt < nextExport),
    'contextFromUser must sit inside requireFreshPassword (the sanctioned auth-internal fresh gate)');
  for (const file of Object.keys(corpus).filter(f => f === 'taxonomy.ts' || f.startsWith('routes/'))) {
    if (file === 'routes/_shared.ts') continue;
    assert.ok(!/\bcontextFromUser\s*\(/.test(maskCode(corpus[file])),
      `${file} must never rebuild context from req.user (any-client fallback)`);
  }
});

// U4-1b (OD-12 §1–2) — enumerated wire pins for the typed-answer contract.
// The pure rules live in src/lib/answerValidation.ts (unit-matrixed); these
// pins make the evaluations route a faithful consumer and keep the submit gate
// before any state write. A future edit that silently drops a gate fails here.
test('U4-1b: evaluations save/submit consume the typed-answer contract (submit gate before writes)', () => {
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'evaluations.ts'), 'utf8');
  const lib = fs.readFileSync(path.join(SERVER_ROOT, '..', 'lib', 'answerValidation.ts'), 'utf8');

  // Single import; the route holds no duplicate rule text.
  assert.ok(src.includes("from '../../lib/answerValidation.ts'"), 'evaluations.ts imports the validator module');
  assert.equal((src.match(/\bvalidateAnswerValue\s*\(/g) ?? []).length, 1,
    'draft save calls validateAnswerValue exactly once ');
  assert.equal((src.match(/\bvalidateSubmitAnswer\s*\(/g) ?? []).length, 1,
    'submit calls validateSubmitAnswer exactly once');
  // Draft: the item answer_type is read with the assignment and the typed value
  // is validated before the answer row is written.
  const draftAt = src.indexOf('validateAnswerValue(answerType, evidenceNote)');
  const draftWriteAt = src.indexOf("INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value");
  assert.ok(draftAt > 0 && draftWriteAt > draftAt,
    'draft validation precedes the answers upsert');
  assert.ok(/SELECT a\.id, i\.answer_type AS answer_type/.test(src),
    'draft save reads items.answer_type alongside the assignment');
  // Submit: item metadata + attachment count feed the gate, which must run
  // before enforcePairVersion/any UPDATE.
  const submitMetaAt = src.indexOf('SELECT answer_type, attachment_required FROM items WHERE id = $1');
  const submitCountAt = src.indexOf('SELECT COUNT(*)::int AS n FROM evidence_attachments WHERE answer_id = $1');
  const submitGateAt = src.indexOf('validateSubmitAnswer({');
  const submitVersionAt = src.indexOf('// B9-C (A-15): submit requires the caller\'s answer version.');
  assert.ok(submitMetaAt > 0 && submitCountAt > submitMetaAt, 'submit reads item metadata then the attachment count');
  assert.ok(submitGateAt > submitCountAt && submitVersionAt > submitGateAt,
    'the submit gate runs after the reads and BEFORE the version/write path');
  // The lib owns both wire codes and the IO cap (no handler-side literals).
  assert.ok(lib.includes("ANSWER_TYPE_INVALID = 'answer.type_invalid'"));
  assert.ok(lib.includes("ANSWER_ATTACHMENT_REQUIRED = 'answer.attachment_required'"));
  assert.ok(lib.includes('MAX_TEXT_ANSWER_LENGTH = 10_000'));
  assert.ok(!src.includes("'answer.type_invalid'") && !src.includes("'answer.attachment_required'"),
    'the route never re-declares the wire codes');
});

// U4-1b round 2 (SHIELD R1–R4) — enumerated source pins. These keep the
// evidence lock, the N/A-shortcut guard, the fail-closed submit metadata and the
// invisible/NUL text rules from being silently removed in a later refactor.
test('U4-1b R1-R4: evidence lock, N/A attachment guard, fail-closed submit metadata, invisible/NUL text', () => {
  const read = (relative: string) => fs.readFileSync(path.resolve('src', relative), 'utf8');

  // R1: only non-draft answers are locked, and the lock sits before the DELETE.
  const storage = read('server/routes/storage.ts');
  assert.equal((storage.match(/attachment\.locked/g) ?? []).length, 1,
    'the evidence lock is declared exactly once (upload stays append-only)');
  const statusAt = storage.indexOf("answer.status !== 'draft'");
  const deleteAt = storage.indexOf('DELETE FROM evidence_attachments');
  assert.ok(statusAt > 0 && deleteAt > statusAt, 'the non-draft lock precedes the attachment DELETE');

  // R2: the shortcut refuses an attachment_required item before any write.
  const assignments = read('server/routes/adminAssignments.ts');
  assert.ok(assignments.includes('attachment_required'), 'the N/A shortcut reads items.attachment_required');
  const naGuardAt = assignments.indexOf("'assignment.na_attachment_required'");
  const naInsertAt = assignments.indexOf('INSERT INTO evaluations');
  assert.ok(naGuardAt > 0 && naInsertAt > naGuardAt, 'the N/A attachment guard precedes every write');

  // R3: strict metadata resolution; no silent `text` fallback at submit.
  const evals = read('server/routes/evaluations.ts');
  assert.ok(evals.includes('resolveAnswerType(itemMeta.answer_type)'), 'submit resolves the type strictly');
  assert.ok(evals.includes('ANSWER_ITEM_UNRESOLVED'), 'missing item metadata is refused');
  assert.ok(!/itemMetaRes\.rows\[0\]\s*\?\?\s*\{\s*answer_type:\s*'text'/.test(evals),
    'no silent text default in submit metadata');

  // R4: invisible-only text and NUL are handled in the pure validator.
  const lib = read('lib/answerValidation.ts');
  assert.ok(lib.includes('resolveAnswerType'), 'the strict resolver is exported');
  assert.ok(lib.includes('\\p{Cf}') && lib.includes('\\uFEFF') && lib.includes('\\u00AD'),
    'the \u0070{Cf} + soft-hyphen/BOM invisible set is pinned in the validator');
  assert.ok(lib.includes("const NUL = '\\u0000'") && lib.includes('rawValue.includes(NUL)'),
    'NUL is refused before any DB write');
});

// U4-1b round 3 — the correction-conversion guard (R1) and the typed N/A
// shortcut value (R3) are pinned so a later refactor cannot re-open the
// attachment_required bypass or reintroduce a literal 'N/A' for typed items.
test('U4-1b round 3: N/A correction guard precedes writes; typed N/A shortcut value', () => {
  const read = (relative: string) => fs.readFileSync(path.resolve('src', relative), 'utf8');
  const evals = read('server/routes/evaluations.ts');
  const correctStart = evals.indexOf("router.put('/evaluations/:id/correct'");
  const convertAt = evals.indexOf('if (afterNotApplicable)');
  const versionAt = evals.indexOf('const gate = await enforcePairVersion(', correctStart);
  assert.ok(correctStart > 0 && convertAt > correctStart && versionAt > convertAt,
    'the N/A-conversion attachment guard runs before the correction version/write path');
  assert.ok(evals.includes('ANSWER_ATTACHMENT_REQUIRED'),
    'the correction guard reuses the shared attachment-required code');

  const assignments = read('server/routes/adminAssignments.ts');
  assert.ok(assignments.includes('i.answer_type AS answer_type'),
    'the N/A shortcut reads the item answer_type');
  assert.ok(assignments.includes("const naAnswerValue = asg.rows[0].answer_type === 'text'"),
    'the shortcut derives a typed-appropriate N/A value');
  assert.ok(assignments.includes('[tenant, itemId, departmentId, req.access!.actorId, naAnswerValue]'),
    'the shortcut stores that value (text keeps N/A; non-text stores empty)');
});
