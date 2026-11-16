import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, setUnauthorizedHandler, setWorkspaceLostHandler } from './api.ts';
import { AUTH_TOKEN_KEY, currentTab, ensureTab, enter, reset as resetWorkspace } from './workspaceClient.ts';

// --- fakes -----------------------------------------------------------------
interface MemoryStorage extends Storage { dump(): Record<string, string> }

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    dump: () => Object.fromEntries(map),
  };
}

function setGlobal(name: 'localStorage' | 'sessionStorage' | 'fetch', value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Call { path: string; init?: RequestInit; headers: Headers }

type Reply = { path: string; status: number; body: unknown; throws?: boolean };

/** Records every request and answers from a script keyed by (path, nth hit). */
function stubFetch(responses: Reply[]): Call[] {
  const calls: Call[] = [];
  setGlobal('fetch', async (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ path: String(path), init, headers });
    const index = responses.findIndex((entry) => entry.path === String(path));
    if (index === -1) throw new Error(`unexpected request: ${path}`);
    const [entry] = responses.splice(index, 1); // each scripted answer is used once
    if (entry.throws) throw new TypeError('network down');
    return json(entry.status, entry.body);
  });
  return calls;
}

const HANDLE_A = 'A'.repeat(43);
const HANDLE_B = 'B'.repeat(43);
const TAB_CREATED = { path: '/api/workspace/tab', status: 201,
  body: { tabHandle: HANDLE_A, generation: 1, mode: 'platform', client: null } };
const ENTERED = { path: '/api/workspace/enter', status: 200,
  body: { generation: 2, mode: 'consultant', client: { id: 'c-1', name: 'Tenant' } } };

function setup(token: string | null = 'token-a') {
  setGlobal('localStorage', memoryStorage(token === null ? {} : { [AUTH_TOKEN_KEY]: token }));
  setGlobal('sessionStorage', memoryStorage());
  resetWorkspace();
  setUnauthorizedHandler(null);
  setWorkspaceLostHandler(null);
}

// --- tests -----------------------------------------------------------------
test('a GE request carries the bearer and both workspace headers of this tab', async () => {
  setup();
  const calls = stubFetch([TAB_CREATED, { path: '/api/clients', status: 200, body: [] }]);

  const res = await apiFetch('/api/clients');

  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer token-a');
  assert.equal(calls[1].headers.get('X-Workspace-Tab'), HANDLE_A);
  assert.equal(calls[1].headers.get('X-Workspace-Version'), '1');
});

test('workspace.stale performs exactly one refresh + retry with the new generation', async () => {
  setup();
  const calls = stubFetch([
    TAB_CREATED,
    { path: '/api/services', status: 409, body: { error: 'workspace.stale', code: 'workspace.stale' } },
    { path: '/api/workspace', status: 200, body: { generation: 2, mode: 'platform', client: null } },
    { path: '/api/services', status: 200, body: { items: [] } },
  ]);

  const res = await apiFetch('/api/services');

  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((call) => call.path),
    ['/api/workspace/tab', '/api/services', '/api/workspace', '/api/services']);
  assert.equal(calls[3].headers.get('X-Workspace-Version'), '2');
  assert.equal(new Headers(calls[2].init?.headers).get('Authorization'), 'Bearer token-a');
});

test('a second 409 after the retry is returned as-is: never a third attempt', async () => {
  setup();
  const calls = stubFetch([
    TAB_CREATED,
    { path: '/api/services', status: 409, body: { code: 'workspace.stale' } },
    { path: '/api/workspace', status: 200, body: { generation: 2, mode: 'platform', client: null } },
    { path: '/api/services', status: 409, body: { code: 'workspace.stale' } },
    { path: '/api/workspace', status: 200, body: { generation: 3, mode: 'platform', client: null } },
  ]);

  const res = await apiFetch('/api/services');

  assert.equal(res.status, 409);
  assert.equal(calls.length, 4, 'exactly one retry, no loop');
});

test('workspace.invalid repairs the handle once (refresh fails -> new tab) and retries', async () => {
  setup();
  const calls = stubFetch([
    TAB_CREATED,
    { path: '/api/clients', status: 409, body: { code: 'workspace.invalid' } },
    { path: '/api/workspace', status: 409, body: { code: 'workspace.invalid' } },
    { path: '/api/workspace/tab', status: 201,
      body: { tabHandle: HANDLE_B, generation: 1, mode: 'platform', client: null } },
    { path: '/api/clients', status: 200, body: [] },
  ]);

  const res = await apiFetch('/api/clients');

  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((call) => call.path), ['/api/workspace/tab', '/api/clients',
    '/api/workspace', '/api/workspace/tab', '/api/clients']);
  assert.equal(calls[4].headers.get('X-Workspace-Tab'), HANDLE_B);
});

test('any other 409 (business refusal) is passed straight through, never refreshed', async () => {
  setup();
  const calls = stubFetch([
    TAB_CREATED,
    { path: '/api/reports/index?level=L1', status: 409, body: { error: 'reports.gate_incomplete' } },
  ]);

  const res = await apiFetch('/api/reports/index?level=L1');

  assert.equal(res.status, 409);
  assert.equal(calls.length, 2);
  assert.equal((await res.json()).error, 'reports.gate_incomplete');
});

// --- SHIELD-U3A-01 / QA F3: context-preserving recovery ---------------------
test('SHIELD-U3A-01: a consultant handle is never replaced by a platform tab', async () => {
  setup();
  const calls = stubFetch([
    TAB_CREATED,
    ENTERED,
    { path: '/api/clients', status: 409, body: { code: 'workspace.invalid' } },
    { path: '/api/workspace', status: 409, body: { code: 'workspace.invalid' } },
  ]);
  await ensureTab(); //   the browser tab exists (platform) ...
  await enter('c-1'); // ... and the session is now in consultant (W) context

  const res = await apiFetch('/api/clients');

  assert.equal(res.status, 409, 'the W-context failure is surfaced, not retried under P');
  assert.equal((await res.json()).code, 'workspace.invalid');
  assert.equal(calls.filter((call) => call.path === '/api/workspace/tab').length, 1,
    'no fresh platform tab is minted for a consultant session');
  assert.equal(calls.length, 4, 'one reconcile attempt, no retry');
  assert.equal(currentTab()?.mode, 'consultant', 'the mirror never silently becomes platform');
});

test('SHIELD-U3A-01: a reconcile that reports another mode is not adopted and not retried', async () => {
  setup();
  const calls = stubFetch([
    TAB_CREATED,
    { path: '/api/clients', status: 409, body: { code: 'workspace.stale' } },
    { path: '/api/workspace', status: 200,
      body: { generation: 5, mode: 'consultant', client: { id: 'c-1', name: 'Tenant' } } },
  ]);

  const res = await apiFetch('/api/clients');

  assert.equal(res.status, 409, 'a mode switch is surfaced as the original 409');
  assert.equal(calls.length, 3, 'no retry under a different mode');
  assert.deepEqual(currentTab(), { handle: HANDLE_A, generation: 1, mode: 'platform', client: null },
    'the unexpected envelope is not adopted');
});

test('QA F3: a reconcile transport failure keeps the handle and never re-mints a tab', async () => {
  setup();
  const calls = stubFetch([
    TAB_CREATED,
    { path: '/api/clients', status: 409, body: { code: 'workspace.stale' } },
    { path: '/api/workspace', status: 0, body: null, throws: true },
  ]);

  const res = await apiFetch('/api/clients');

  assert.equal(res.status, 409);
  assert.equal(calls.filter((call) => call.path === '/api/workspace/tab').length, 1, 'no TAB_LIMIT burn');
  assert.equal(currentTab()?.handle, HANDLE_A, 'the existing handle is kept');
  assert.equal(currentTab()?.generation, 1);
});

test('QA F3: a non-409 reconcile error (e.g. 500) also keeps the handle', async () => {
  setup();
  const calls = stubFetch([
    TAB_CREATED,
    { path: '/api/clients', status: 409, body: { code: 'workspace.invalid' } },
    { path: '/api/workspace', status: 500, body: { code: 'access.unavailable' } },
  ]);

  const res = await apiFetch('/api/clients');

  assert.equal(res.status, 409);
  assert.equal(calls.filter((call) => call.path === '/api/workspace/tab').length, 1);
  assert.equal(currentTab()?.handle, HANDLE_A);
});

test('401 goes through the single auth path once and is not retried', async () => {
  setup();
  let cleared = 0;
  setUnauthorizedHandler(() => { cleared += 1; });
  const calls = stubFetch([
    TAB_CREATED,
    { path: '/api/settings', status: 401, body: { code: 'auth.invalid' } },
  ]);

  const res = await apiFetch('/api/settings');

  assert.equal(res.status, 401);
  assert.equal(cleared, 1);
  assert.equal(calls.length, 2, 'no workspace recovery and no retry on 401');
});

test('bypass paths keep their exact behaviour: no bearer, no workspace headers, no retry', async () => {
  setup();
  const paths = ['/api/auth/me', '/api/auth/logout', '/api/workspace/enter', '/api/db/status', '/api/setup/status'];
  for (const path of paths) {
    const calls = stubFetch([{ path, status: 401, body: {} }]);
    const res = await apiFetch(path, { method: 'POST' });
    assert.equal(res.status, 401, path);
    assert.equal(calls.length, 1, `${path} must be a single pass-through request`);
    assert.equal(calls[0].headers.get('Authorization'), null, `${path} must not receive a bearer`);
    assert.equal(calls[0].headers.get('X-Workspace-Tab'), null, `${path} must not receive a workspace handle`);
  }
});

test('a non-API/absolute URL never receives session headers', async () => {
  setup();
  const calls = stubFetch([{ path: 'https://foreign.test/collect', status: 200, body: {} }]);

  await apiFetch('https://foreign.test/collect');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('Authorization'), null);
  assert.equal(calls[0].headers.get('X-Workspace-Tab'), null);
});

test('U3-B2 M4: an invalid consultant handle notifies the shell once and never mints a platform tab', async () => {
  setup();
  let lost = 0;
  setWorkspaceLostHandler(() => { lost += 1; });
  const calls = stubFetch([
    TAB_CREATED,
    ENTERED,
    { path: '/api/clients', status: 409, body: { code: 'workspace.invalid' } },
    { path: '/api/workspace', status: 409, body: { code: 'workspace.invalid' } },
  ]);
  await ensureTab();
  await enter('c-1');

  const res = await apiFetch('/api/clients');

  assert.equal(res.status, 409, 'the original refusal still reaches the caller');
  assert.equal(lost, 1, 'the shell is asked to perform the explicit exit-to-P recovery');
  assert.equal(calls.filter((call) => call.path === '/api/workspace/tab').length, 1,
    'no silent platform reuse');
  assert.equal(currentTab()?.mode, 'consultant', 'nothing is adopted behind the shell recovery');
});

test('U3-B2 M4: the lost-handle hook is not fired for a repairable platform handle or a stale reconcile', async () => {
  setup();
  let lost = 0;
  setWorkspaceLostHandler(() => { lost += 1; });
  stubFetch([
    TAB_CREATED,
    { path: '/api/clients', status: 409, body: { code: 'workspace.invalid' } },
    { path: '/api/workspace', status: 409, body: { code: 'workspace.invalid' } },
    { path: '/api/workspace/tab', status: 201,
      body: { tabHandle: HANDLE_B, generation: 1, mode: 'platform', client: null } },
    { path: '/api/clients', status: 200, body: [] },
  ]);

  const res = await apiFetch('/api/clients');

  assert.equal(res.status, 200);
  assert.equal(lost, 0, 'platform repair stays local (never a shell transition)');
});

test('without a token apiFetch sends the caller headers untouched and never creates a tab', async () => {
  setup(null);
  const calls = stubFetch([{ path: '/api/clients', status: 401, body: {} }]);

  await apiFetch('/api/clients', { headers: { 'X-Test': '1' } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('Authorization'), null);
  assert.equal(calls[0].headers.get('X-Test'), '1');
});
