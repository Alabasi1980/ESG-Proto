import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_TOKEN_KEY, ensureTab, headers, refresh, enter, exit, reset, readToken,
  type WorkspaceTab,
} from './workspaceClient.ts';

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

interface Call { path: string; init?: RequestInit }

function stubFetch(handler: (path: string, init?: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  setGlobal('fetch', async (path: string, init?: RequestInit) => {
    calls.push({ path: String(path), init });
    return handler(String(path), init);
  });
  return calls;
}

const HANDLE_A = 'A'.repeat(43);
const HANDLE_B = 'B'.repeat(43);

function setup(options: { token?: string | null; session?: MemoryStorage } = {}) {
  const local = memoryStorage(options.token === null ? {} : { [AUTH_TOKEN_KEY]: options.token ?? 'token-a' });
  const session = options.session ?? memoryStorage();
  setGlobal('localStorage', local);
  setGlobal('sessionStorage', session);
  reset(); // forget any state left by the previous test
  return { local, session };
}

function envelope(overrides: Partial<WorkspaceTab> & { tabHandle?: string } = {}) {
  const { tabHandle, ...rest } = overrides;
  return { tabHandle: tabHandle ?? HANDLE_A, generation: 1, mode: 'platform', client: null, ...rest };
}

// --- tests -----------------------------------------------------------------
test('ensureTab creates exactly one tab per browser tab (single-flight) and derives both headers', async () => {
  const { local, session } = setup();
  const calls = stubFetch(() => json(201, envelope()));

  const [first, second] = await Promise.all([ensureTab(), ensureTab()]);
  const third = await ensureTab();

  assert.equal(calls.length, 1, 'parallel first calls must share one POST /api/workspace/tab');
  assert.equal(calls[0].path, '/api/workspace/tab');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(first?.handle, HANDLE_A);
  assert.equal(second?.handle, HANDLE_A);
  assert.equal(third?.handle, HANDLE_A);
  assert.deepEqual(headers(), { 'X-Workspace-Tab': HANDLE_A, 'X-Workspace-Version': '1' });
  // sessionStorage only: localStorage keeps the token and nothing workspace-related
  assert.ok(session.dump()['greenedge_workspace'], 'handle must be stored in sessionStorage');
  assert.deepEqual(Object.keys(local.dump()), [AUTH_TOKEN_KEY]);
});

test('two browser tabs never share a handle (sessionStorage isolation, never localStorage)', async () => {
  const { local } = setup();
  const firstTab = memoryStorage();
  setGlobal('sessionStorage', firstTab);
  let issued = 0;
  stubFetch(() => json(201, envelope({ tabHandle: ++issued === 1 ? HANDLE_A : HANDLE_B })));

  await ensureTab();
  const firstHandle = headers()['X-Workspace-Tab'];

  // A second browser tab has its own sessionStorage and its own module state.
  const secondTab = memoryStorage();
  setGlobal('sessionStorage', secondTab);
  reset();
  await ensureTab();

  assert.notEqual(headers()['X-Workspace-Tab'], firstHandle);
  assert.equal(headers()['X-Workspace-Tab'], HANDLE_B);
  // the first tab keeps its own handle; nothing was shared through localStorage
  assert.match(firstTab.dump()['greenedge_workspace'], new RegExp(firstHandle));
  assert.equal('greenedge_workspace' in local.dump(), false);
});

test('a corrupt or foreign stored entry is discarded instead of trusted', async () => {
  const session = memoryStorage({ greenedge_workspace: '{"handle":"too-short","generation":0}' });
  const { session: store } = setup({ session });
  const calls = stubFetch(() => json(201, envelope()));

  const tab = await ensureTab();

  assert.equal(calls.length, 1);
  assert.equal(tab?.handle, HANDLE_A);
  assert.match(store.dump()['greenedge_workspace'], /"generation":1/);
});

test('reset() drops the handle: headers() becomes empty until the next ensureTab', async () => {
  const session = memoryStorage();
  setup({ session });
  stubFetch(() => json(201, envelope()));
  await ensureTab();
  assert.equal(headers()['X-Workspace-Tab'], HANDLE_A);

  reset();

  assert.deepEqual(headers(), {});
  assert.equal('greenedge_workspace' in session.dump(), false);
});

test('refresh/enter/exit adopt the envelope (generation, mode, client)', async () => {
  const { session } = setup();
  let step = 0;
  const calls = stubFetch(() => {
    step += 1;
    if (step === 1) return json(201, envelope());
    if (step === 2) return json(200, { generation: 2, mode: 'platform', client: null });
    if (step === 3) return json(200, { generation: 3, mode: 'consultant', client: { id: 'c-1', name: 'Tenant' } });
    return json(200, { generation: 4, mode: 'platform', client: null });
  });

  await ensureTab();
  await refresh();
  assert.equal(headers()['X-Workspace-Version'], '2');

  const entered = await enter('c-1');
  assert.equal(entered.mode, 'consultant');
  assert.equal(entered.client?.id, 'c-1');
  assert.equal(headers()['X-Workspace-Version'], '3');
  assert.equal(calls[2].path, '/api/workspace/enter');
  assert.equal(new Headers(calls[2].init?.headers).get('X-Workspace-Version'), '2');
  assert.equal(calls[2].init?.body, JSON.stringify({ clientId: 'c-1' }));

  await exit();
  assert.equal(headers()['X-Workspace-Version'], '4');
  assert.equal(calls[3].path, '/api/workspace/exit');
  assert.equal(JSON.parse(session.dump()['greenedge_workspace']).mode, 'platform');
});

test('a non-GE identity (403 workspace.forbidden) is probed once and never again', async () => {
  setup();
  const calls = stubFetch(() => json(403, { error: 'workspace.forbidden', code: 'workspace.forbidden' }));

  assert.equal(await ensureTab(), null);
  assert.deepEqual(headers(), {});
  assert.equal(await ensureTab(), null);

  assert.equal(calls.length, 1, 'one conclusive answer per session, not one probe per request');
});

test('a forced password change (temporary 403) is not treated as "no workspace"', async () => {
  setup();
  let step = 0;
  const calls = stubFetch(() => {
    step += 1;
    return step === 1
      ? json(403, { error: 'auth.password_change_required', code: 'auth.password_change_required' })
      : json(201, envelope());
  });

  assert.equal(await ensureTab(), null, 'no tab while the password gate is closed');
  // AuthContext re-runs ensureTab after the password change: the path is open again.
  const tab = await ensureTab();

  assert.equal(tab?.handle, HANDLE_A);
  assert.equal(calls.length, 2);
});

// --- QA F1 (epoch) / SHIELD-U3A-03 (conclusive-only memoization) ------------
test('QA F1: reset() invalidates an in-flight createTab so a late reply cannot re-establish a handle', async () => {
  const { session } = setup();
  let release!: (res: Response) => void;
  const gate = new Promise<Response>((resolve) => { release = resolve; });
  setGlobal('fetch', async () => gate);

  const inflight = ensureTab(); // POST /api/workspace/tab is now in flight
  reset(); //             ... logout happens before the reply
  release(json(201, envelope()));

  assert.equal(await inflight, null, 'the stale adoption is discarded');
  assert.deepEqual(headers(), {});
  assert.equal('greenedge_workspace' in session.dump(), false);
});

test('SHIELD-U3A-03: a transient 500 does not latch "no workspace"', async () => {
  setup();
  let step = 0;
  const calls = stubFetch(() => {
    step += 1;
    return step === 1 ? json(500, { code: 'access.unavailable' }) : json(201, envelope());
  });

  assert.equal(await ensureTab(), null);
  assert.equal((await ensureTab())?.handle, HANDLE_A, 'a transport/server fault is not conclusive');
  assert.equal(calls.length, 2);
});

test('SHIELD-U3A-03: an unexplained 403 does not latch "no workspace"', async () => {
  setup();
  let step = 0;
  const calls = stubFetch(() => {
    step += 1;
    return step === 1 ? json(403, {}) : json(201, envelope());
  });

  assert.equal(await ensureTab(), null);
  assert.equal((await ensureTab())?.handle, HANDLE_A, 'only workspace.forbidden is conclusive');
  assert.equal(calls.length, 2);
});

test('SHIELD-U3A-03: an OK reply with no usable tab is conclusive and is not re-probed', async () => {
  setup();
  const calls = stubFetch(() => json(201, { tabHandle: 'too-short', generation: 0, mode: 'platform', client: null }));

  assert.equal(await ensureTab(), null);
  assert.equal(await ensureTab(), null);

  assert.equal(calls.length, 1, 'a tabless success is conclusive for this session');
});

test('enter() surfaces the server refusal instead of inventing a state', async () => {
  setup();
  stubFetch((path) => path === '/api/workspace/tab'
    ? json(201, envelope())
    : json(409, { error: 'workspace.exit_required', code: 'workspace.exit_required' }));

  await ensureTab();
  await assert.rejects(() => enter('c-1'), (error: any) => error.status === 409 && error.code === 'workspace.exit_required');
});

test('without a session token no workspace request is attempted', async () => {
  setup({ token: null });
  const calls = stubFetch(() => json(201, envelope()));

  assert.equal(readToken(), null);
  assert.equal(await ensureTab(), null);
  assert.equal(calls.length, 0);
});
