// B12 — structural + gate-matrix tests (no DB needed).
//
// 1. F-03 grep-proof: EVERY POST/PUT/PATCH/DELETE route line in the split
//    sub-routers (src/server/routes/*.ts) and taxonomy.ts carries
//    requireFreshPassword, except the explicit FRESH_GATE_ALLOWLIST entries.
//    `router.use(...)` mounts and GETs are reads (never gated).
// 2. S-24 audit-reader matrix: ge_admin always; named delegate via env;
//    client roles never; case-insensitive e-mail match.
// 3. S-23 inbox contract: cap is 50; the nine fan-out event types exist.

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
});

test('B12 S-23: inbox cap is 50 and the nine fan-out types exist', () => {
  assert.equal(NOTIFICATION_INBOX_LIMIT, 50);
  assert.deepEqual([...NOTIFICATION_TYPES].sort(), [
    'action.status',
    'assignment.created',
    'evaluation.approved',
    'evaluation.client_approved',
    'evaluation.client_returned',
    'evaluation.returned',
    'evaluation.submitted',
    'staff.approved',
    'staff.rejected',
  ]);
});
