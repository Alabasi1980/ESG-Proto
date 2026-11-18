// TASK-PROTO-U4-2-FIX P3S — seed-flow pins for the catalog-only import
// migration (no DB): the showcase seed commits the catalog with NO clientId
// on the import path, links the service explicitly, provisions departments
// by seed SQL (no POST /departments route exists) and assignments through
// the explicit POST /api/assignments route. Source-shape guards only; live
// proof stays with the disposable-preview verification in the handback.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const seed = () => readFileSync('scripts/b17-showcase.ts', 'utf8');

test('P3S seed: catalog commit is client-free on the canonical import path', () => {
  const src = seed();
  assert.ok(src.includes("POST', '/api/import/commit'"), 'canonical catalog-only commit path used');
  assert.ok(!src.includes("'/api/gri/commit'"), 'old client-scoped alias no longer used by the seed');
  const at = src.indexOf("'/api/import/commit'");
  const body = src.slice(at, src.indexOf('}, true, [200]);', at));
  assert.ok(body.includes('importBatchId'), 'deterministic batch id carried explicitly');
  assert.ok(!body.includes('clientId'), 'no clientId key in the import commit body');
  assert.ok(!body.includes('departmentsUpserted') && !body.includes('assignmentsCreated'),
    'removed auto-provisioning fields are not read from the commit reply');
});

test('P3S seed: no import call carries a client scope anywhere', () => {
  const src = seed();
  for (const m of src.matchAll(/\/api\/(import|gri)\/[a-z/]+/g)) {
    const start = Math.max(0, (m.index ?? 0) - 400);
    const window = src.slice(start, (m.index ?? 0) + m[0].length + 400)
      .replace(/\/\/[^\r\n]*/g, ''); // comments may name the forbidden key to forbid it
    assert.ok(!window.includes('clientId'), `import path ${m[0]} must stay client-free`);
  }
});

test('P3S seed: explicit provisioning split — departments SQL, assignments route', () => {
  const src = seed();
  // Departments: no POST /departments route exists (admin.ts mounts GET +
  // PATCH head only), so seed SQL is the sanctioned path.
  assert.ok(src.includes('INSERT INTO departments (client_id, code, name)'),
    'departments upserted by explicit seed SQL');
  assert.ok(src.includes('ON CONFLICT (client_id, code) DO UPDATE SET name = EXCLUDED.name'),
    'same deterministic (client_id, code) upsert the removed import step performed');
  assert.ok(src.includes("purpose: 'platform.config'"), 'seed SQL runs under the explicit platform.config target');
  assert.ok(src.includes('userId: ge.id'), 'seed SQL carries the logged-in platform admin as the RLS actor');
  assert.ok(!src.includes('INSERT INTO assignments'), 'assignments never take the SQL path');
  // Assignments: the explicit route the app itself uses, after mapping (the
  // route refuses items of unlinked/unmapped services).
  const mappingAt = src.indexOf('service<->standards mapping');
  const assignAt = src.indexOf("POST', '/api/assignments'");
  assert.ok(mappingAt > 0 && assignAt > mappingAt, 'assignments are route-provisioned after the service mapping pass');
  const assignBody = src.slice(assignAt, src.indexOf('}, true, [200, 201]);', assignAt));
  assert.ok(assignBody.includes('clientId') && assignBody.includes('itemId') && assignBody.includes('departmentId'),
    'assignment route carries the explicit tenant/item/department triple');
  // The demo tenant link stays the existing explicit operation.
  assert.ok(src.includes("POST', `/api/clients/${TENANT_ID}/services`"), 'service linked to the demo tenant explicitly');
});

test('P3S seed: department codes stay deterministic across the split', () => {
  const src = seed();
  assert.ok(src.includes('normalizeSeedDeptCode'), 'seed-local deterministic code helper present');
  // Same normalization the removed import auto-provisioning used.
  const normalize = (name: string): string => {
    const code = name.trim().toLowerCase().replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}\-_]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return code || 'dept';
  };
  assert.equal(normalize('Legal'), 'legal');
  assert.equal(normalize('Sales/BD'), 'salesbd');
  assert.equal(normalize('FM'), 'fm');
  assert.ok(src.includes("replace(/[^\\p{L}\\p{N}\\-_]/gu, '')"), 'seed regex chain matches the removed import helper');
});
