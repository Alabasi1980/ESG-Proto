import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveImportTenant, validateNewUser } from './tenantAccess';

const GE = { id: 'ge1', role: 'ge_admin' as const, clientId: null };
const CA = { id: 'ca1', role: 'client_admin' as const, clientId: 'tenant-A' };
const EMP = { id: 'e1', role: 'employee' as const, clientId: 'tenant-A' };

// --- B: explicit-tenant import resolution ---

test('B: ge_admin with explicit clientId resolves to that tenant (explicit)', () => {
  const r = resolveImportTenant(GE, 'tenant-B');
  assert.deepEqual(r, { ok: true, effectiveClientId: 'tenant-B', explicit: true });
});

test('B: tenant-less ge_admin without clientId fails 400 (choose a tenant)', () => {
  const r = resolveImportTenant(GE, undefined);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.match(r.error, /choose a tenant/i);
  }
});

test('B: client_admin defaults to own tenant; naming own tenant is fine', () => {
  assert.deepEqual(resolveImportTenant(CA, undefined), { ok: true, effectiveClientId: 'tenant-A', explicit: false });
  assert.deepEqual(resolveImportTenant(CA, 'tenant-A'), { ok: true, effectiveClientId: 'tenant-A', explicit: false });
});

test('B3: client_admin naming another tenant → 403', () => {
  const r = resolveImportTenant(CA, 'tenant-B');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

test('B3: employee naming another tenant → 403', () => {
  const r = resolveImportTenant(EMP, 'tenant-B');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

// --- C: user creation validation ---

test('C: ge_admin can create employee in explicit tenant', () => {
  const r = validateNewUser(GE, {
    email: 'EMP@x.com ', password: 'Str0ng!Pass', name: 'Emp', role: 'employee',
    departmentId: 'dept-1', clientId: 'tenant-A',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.user.email, 'emp@x.com');
    assert.equal(r.user.effectiveClientId, 'tenant-A');
    assert.equal(r.user.explicit, true);
  }
});

test('C: ge_admin can create tenant-less ge_admin', () => {
  const r = validateNewUser(GE, { email: 'a@x.com', password: 'Str0ng!Pass', name: 'A', role: 'ge_admin' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.user.effectiveClientId, null);
});

test('C: client_admin creates employee in own tenant (implicit)', () => {
  const r = validateNewUser(CA, {
    email: 'e@x.com', password: 'Str0ng!Pass', name: 'E', role: 'employee', departmentId: 'd1',
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.user.effectiveClientId, 'tenant-A');
});

test('C3: client_admin creating ge_admin → 403', () => {
  const r = validateNewUser(CA, { email: 'g@x.com', password: 'Str0ng!Pass', name: 'G', role: 'ge_admin' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

test('C3: client_admin creating user in another tenant → 403', () => {
  const r = validateNewUser(CA, {
    email: 'e@x.com', password: 'Str0ng!Pass', name: 'E', role: 'employee',
    departmentId: 'd1', clientId: 'tenant-B',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

test('C3: employee without department → 400', () => {
  const r = validateNewUser(CA, { email: 'e@x.com', password: 'Str0ng!Pass', name: 'E', role: 'employee' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test('C: non-employee with departmentId → 400', () => {
  const r = validateNewUser(CA, {
    email: 'c@x.com', password: 'Str0ng!Pass', name: 'C', role: 'client_admin', departmentId: 'd1',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test('B12: weak self-chosen passwords → 400 (S-02: 10 chars + complexity)', () => {
  // 9 chars with full complexity still refused (length boundary).
  const r9 = validateNewUser(GE, {
    email: 'e@x.com', password: 'Aa1!bcdef', name: 'E', role: 'employee', departmentId: 'd', clientId: 't',
  });
  assert.equal(r9.ok, false);
  if (!r9.ok) assert.equal(r9.status, 400);
  // 10+ chars but missing a symbol → 400.
  const rNoSym = validateNewUser(GE, {
    email: 'e@x.com', password: 'Aa1bcdefgh', name: 'E', role: 'employee', departmentId: 'd', clientId: 't',
  });
  assert.equal(rNoSym.ok, false);
  if (!rNoSym.ok) assert.equal(rNoSym.status, 400);
  // Compliant password passes shape validation.
  const rOk = validateNewUser(GE, {
    email: 'e@x.com', password: 'Aa1!bcdefg', name: 'E', role: 'employee', departmentId: 'd', clientId: 't',
  });
  assert.equal(rOk.ok, true);
});

test('C: employee creator cannot create users → 403; short password → 400', () => {
  const r1 = validateNewUser(EMP, { email: 'e@x.com', password: 'Str0ng!Pass', name: 'E', role: 'employee', departmentId: 'd' });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.status, 403);
  const r2 = validateNewUser(GE, { email: 'e@x.com', password: '123', name: 'E', role: 'employee', departmentId: 'd', clientId: 't' });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.status, 400);
});
