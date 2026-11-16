/**
 * TASK-PROTO-U3-A §2 — the single authenticated transport for /api calls.
 *
 * apiFetch(path, init) behaves like fetch() plus exactly four additions:
 *  (a) Authorization: Bearer <token> from the existing token store
 *      (localStorage 'greenedge_token') when the call site did not set it;
 *  (b) the workspace headers of this browser tab for GE requests
 *      (src/lib/workspaceClient.ts), ensuring the tab on the first call;
 *  (c) ONE recovery + retry when the server answers 409 workspace.stale /
 *      workspace.invalid — never a loop, never for any other 409;
 *  (d) a single 401 hook that clears the session through AuthContext's own
 *      logout path (the only clear-auth path; no second one is introduced).
 *
 * Bypass paths never receive auth/workspace headers and are never retried:
 * /api/auth/*, /api/workspace/*, /api/db/status, /api/setup/*. Anything that is
 * not an /api/ path is passed through untouched so a session handle can never
 * be attached to a foreign origin.
 */
import {
  AUTH_TOKEN_KEY,
  currentTab as workspaceState,
  ensureTab,
  headers as workspaceHeaders,
  reconcile as reconcileWorkspace,
  reset as resetWorkspace,
} from './workspaceClient.ts';

const BYPASS_PREFIXES = ['/api/auth/', '/api/workspace/', '/api/setup/'];
const BYPASS_EXACT = ['/api/db/status'];

function isBypass(path: string): boolean {
  if (!path.startsWith('/api/')) return true;
  if (BYPASS_EXACT.includes(path.split('?')[0])) return true;
  return BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function readToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(AUTH_TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

/** AuthContext registers its existing session-clearing function here; without a
 * handler (tests, non-browser) the persisted token is simply dropped. */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function clearAuth(): void {
  const handler = unauthorizedHandler;
  if (handler) {
    handler();
    return;
  }
  try {
    globalThis.localStorage?.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}

/** Request init with the identity of this session folded in. */
async function prepare(init: RequestInit): Promise<RequestInit> {
  const headers = new Headers(init.headers);
  const token = readToken();
  if (token) {
    if (!headers.get('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    const workspace = workspaceHeaders();
    if (workspace['X-Workspace-Tab']) {
      headers.set('X-Workspace-Tab', workspace['X-Workspace-Tab']);
      headers.set('X-Workspace-Version', workspace['X-Workspace-Version']);
    } else {
      // First authenticated request of this browser tab (or a recovered one).
      const created = await ensureTab();
      if (created) {
        headers.set('X-Workspace-Tab', created.handle);
        headers.set('X-Workspace-Version', String(created.generation));
      }
    }
  }
  return { ...init, headers };
}

async function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(path, await prepare(init));
}

/** Server error code of a response, read from a clone so the caller's body stays intact. */
async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = await res.clone().json() as { code?: unknown; error?: unknown } | null;
    if (typeof body?.code === 'string') return body.code;
    if (typeof body?.error === 'string') return body.error;
    return null;
  } catch {
    return null;
  }
}

/**
 * Repair the workspace handle after a 409 {workspace.stale|workspace.invalid}.
 *
 * Order and limits (SHIELD-U3A-01 / QA F3):
 * 1. reconcile first — that keeps the same tab and its mode;
 * 2. a reconcile that reports a DIFFERENT mode than we last knew is never
 *    adopted: the call is surfaced as a 409 instead of being retried under a
 *    different context;
 * 3. a fresh tab is minted only on an explicit `workspace.invalid` and only
 *    when the last known mode is `platform` (or nothing is known yet). A
 *    consultant session is never silently reset to a platform tab — U3-B owns
 *    the explicit re-entry path;
 * 4. any transport / non-409 failure keeps the existing handle (no TAB_LIMIT
 *    burn) and surfaces the original response.
 */
async function repair(): Promise<boolean> {
  const expected = workspaceState()?.mode ?? null;
  const outcome = await reconcileWorkspace(expected ?? undefined);

  if (outcome.tab) return true;
  if (outcome.code !== 'workspace.invalid') return false;
  if (expected === 'consultant') return false;

  resetWorkspace();
  const created = await ensureTab();
  return created !== null && created.mode === 'platform';
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (isBypass(path)) return fetch(path, init);

  const first = await send(path, init);
  if (first.status === 401) {
    clearAuth();
    return first;
  }
  if (first.status !== 409) return first;

  const code = await errorCode(first);
  if (code !== 'workspace.stale' && code !== 'workspace.invalid') return first;
  if (!(await repair())) return first;

  // Exactly one retry; its result — whatever it is — is final for this call.
  const retried = await send(path, init);
  if (retried.status === 401) clearAuth();
  return retried;
}
