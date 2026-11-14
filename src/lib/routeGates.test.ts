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
import {
  FRESH_GATE_ALLOWLIST,
  NOTIFICATION_INBOX_LIMIT,
  NOTIFICATION_TYPES,
  isAuditReader,
} from '../server/routes/_shared.ts';

const ROUTES_DIR = path.resolve('src/server/routes');
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
  // Ruling 1(b): the GRI-commit freeze recheck must come AFTER the lock line.
  const gri = fs.readFileSync(path.join(ROUTES_DIR, 'gri.ts'), 'utf8');
  const lockAt = gri.indexOf('pg_advisory_xact_lock(hashtextextended($1,1717005))');
  const recheckAt = gri.indexOf("SELECT is_scope_frozen($1) AS frozen", lockAt);
  assert.ok(lockAt > 0, 'gri.ts takes the BF-01 lock');
  assert.ok(recheckAt > lockAt, 'the freeze recheck must run INSIDE (after) the lock, not before it');
});
