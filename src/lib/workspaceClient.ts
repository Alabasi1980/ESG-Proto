/**
 * TASK-PROTO-U3-A §1 — workspace client layer (module state, no React).
 *
 * Every GE (ge_admin) request to /api must present `X-Workspace-Tab` (opaque
 * 43-char handle) and `X-Workspace-Version` (the tab generation the client last
 * saw). src/server/access.ts (withWorkspace / deriveDomainAccess) validates that
 * pair, derives mode/tenant server-side and rejects anything else with
 * 409 workspace.invalid / 409 workspace.stale / 400 workspace.version_required.
 * This module is only the client mirror of what the server returned: it never
 * decides a mode or a tenant by itself.
 *
 * Scope is the BROWSER TAB (spec §3): the handle lives in sessionStorage, so
 * two tabs create two independent tabs and a reload of one tab reuses its own
 * handle. localStorage would share one handle across tabs — never used here.
 */

/** Existing token store (AuthContext). Kept here because this is the lower
 * layer: api.ts imports from this module, never the other way round. */
export const AUTH_TOKEN_KEY = 'greenedge_token';

/** sessionStorage entry holding {handle,generation,mode,client}. */
const TAB_STORAGE_KEY = 'greenedge_workspace';

export type WorkspaceMode = 'platform' | 'consultant';

export interface WorkspaceClientSummary {
  id: string;
  name: string;
  suspended?: boolean;
}

/** The client-side mirror of one workspace tab (per browser tab). */
export interface WorkspaceTab {
  handle: string;
  generation: number;
  mode: WorkspaceMode;
  client: WorkspaceClientSummary | null;
}

/** Envelope returned by POST /workspace/tab and by GET|enter|exit /workspace. */
export interface WorkspaceEnvelope {
  tabHandle?: string;
  generation: number;
  mode: WorkspaceMode;
  client: WorkspaceClientSummary | null;
  expiresAt?: string;
}

let tab: WorkspaceTab | null = null;
let loaded = false;
/** Set after one conclusive "this session cannot own a tab" answer (403
 * workspace.forbidden / 401 / 429 / an OK reply that carries no usable tab):
 * C/E identities have no tab, and probing again on every request would be noise.
 * A transient or unexplained failure must never latch (SHIELD-U3A-03). Cleared
 * by reset() (logout / re-login). */
let unavailable = false;
/** Single-flight for POST /workspace/tab: parallel first calls share one tab. */
let pending: Promise<WorkspaceTab | null> | null = null;
/** Adoption epoch (QA F1): bumped by reset(). A request captures it before the
 * await and a late reply from an older epoch is discarded, so a createTab() /
 * reconcile() / enter() answer arriving after logout can never re-establish a
 * handle for the new (signed-out or different) session. */
let epoch = 0;

/** sessionStorage may be absent (SSR, denied storage, node tests): tolerate it. */
function tabStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/** Bearer for the workspace endpoints themselves (they are not served by apiFetch). */
export function readToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(AUTH_TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

function isTab(value: unknown): value is WorkspaceTab {
  const row = value as WorkspaceTab | null;
  return !!row && typeof row === 'object'
    && typeof row.handle === 'string' && /^[A-Za-z0-9_-]{43}$/.test(row.handle)
    && Number.isSafeInteger(row.generation) && row.generation > 0
    && (row.mode === 'platform' || row.mode === 'consultant');
}

/** Current tab, hydrated from sessionStorage once per page. A corrupt, expired
 * or foreign entry is dropped instead of being trusted. */
function current(): WorkspaceTab | null {
  if (!loaded) {
    loaded = true;
    const store = tabStorage();
    const raw = store?.getItem(TAB_STORAGE_KEY);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isTab(parsed)) tab = parsed;
        else store?.removeItem(TAB_STORAGE_KEY);
      } catch {
        store?.removeItem(TAB_STORAGE_KEY);
      }
    }
  }
  return tab;
}

/** Mirror the server envelope. `startedAt` is the adoption epoch captured before
 * the request: a reply from an older epoch is discarded (logout raced us). */
function adopt(envelope: WorkspaceEnvelope, startedAt: number): WorkspaceTab | null {
  if (startedAt !== epoch) return null;
  const handle = envelope.tabHandle ?? tab?.handle;
  const next = {
    handle,
    generation: Number(envelope.generation),
    mode: envelope.mode,
    client: envelope.client ?? null,
  };
  if (!isTab(next)) return null;
  tab = next;
  loaded = true;
  unavailable = false;
  try {
    tabStorage()?.setItem(TAB_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full/denied quota must not break the in-memory handle.
  }
  return next;
}

/** POST /workspace/tab — one fresh tab for this browser tab. */
async function createTab(): Promise<WorkspaceTab | null> {
  const token = readToken();
  if (!token) return null; // no session yet: nothing to bind a tab to
  const startedAt = epoch;
  try {
    const res = await fetch('/api/workspace/tab', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (startedAt !== epoch) return null; // reset() while in flight: discard
    if (res.ok) {
      const created = adopt(await res.json() as WorkspaceEnvelope, startedAt);
      // OK but unusable (e.g. a malformed envelope) is conclusive: no tab exists
      // for this session and repeating the POST would only add noise.
      if (!created) unavailable = true;
      return created;
    }
    if (res.status === 403) {
      const code = await refusalCode(res);
      // Only "not a GE identity" is conclusive. A GE identity that must still
      // change its password is refused now but owns a tab once it does.
      if (code === 'workspace.forbidden') unavailable = true;
      return null;
    }
    // 401: session gone. 429: this session is at TAB_LIMIT. Both are conclusive
    // for this session, so stop probing; reset() re-opens the path.
    if (res.status === 401 || res.status === 429) unavailable = true;
    return null;
  } catch {
    return null; // transport failure is not conclusive: leave the door open
  }
}

async function refusalCode(res: Response): Promise<string | null> {
  try {
    const body = await res.json() as { code?: unknown; error?: unknown } | null;
    if (typeof body?.code === 'string') return body.code;
    if (typeof body?.error === 'string') return body.error;
    return null;
  } catch {
    return null;
  }
}

/** Create the tab once per browser tab; returns the current tab when it exists. */
export async function ensureTab(): Promise<WorkspaceTab | null> {
  const existing = current();
  if (existing) return existing;
  if (unavailable) return null;
  if (!pending) {
    pending = createTab().finally(() => { pending = null; });
  }
  return pending;
}

/** The tab this browser tab currently mirrors (null when none is known). Read
 * only: it is the caller's "expected mode" for any recovery decision. */
export function currentTab(): WorkspaceTab | null {
  return current();
}

/** `X-Workspace-Tab` + `X-Workspace-Version`, or {} when this session has none. */
export function headers(): Record<string, string> {
  const currentTab_ = current();
  if (!currentTab_) return {};
  return {
    'X-Workspace-Tab': currentTab_.handle,
    'X-Workspace-Version': String(currentTab_.generation),
  };
}

/** Why a reconcile failed, in the terms the caller must act on:
 * `status` null = transport failure; `code` = the server error code, if any
 * (`workspace.mode_changed` is raised locally when the server reports a mode the
 * caller did not expect — nothing is adopted in that case). */
export interface ReconcileResult {
  tab: WorkspaceTab | null;
  status: number | null;
  code: string | null;
}

/**
 * GET /workspace (reconcile: no version required). Returns the refreshed mirror
 * plus the failure classification, because a caller must never treat a transport
 * blip like a dead handle (QA F3).
 *
 * When `expected` is given, an envelope whose mode differs is NOT adopted: the
 * mirror keeps the mode the caller last acted in and the caller decides what to
 * do (SHIELD-U3A-01 — no silent context switch).
 */
export async function reconcile(expected?: WorkspaceMode): Promise<ReconcileResult> {
  const token = readToken();
  if (!token) return { tab: null, status: null, code: null };
  const startedAt = epoch;
  try {
    const res = await fetch('/api/workspace', { headers: { Authorization: `Bearer ${token}`, ...headers() } });
    if (startedAt !== epoch) return { tab: null, status: res.status, code: null };
    if (!res.ok) return { tab: null, status: res.status, code: await refusalCode(res) };
    const envelope = await res.json() as WorkspaceEnvelope;
    if (expected !== undefined && envelope.mode !== expected) {
      return { tab: null, status: res.status, code: 'workspace.mode_changed' };
    }
    return { tab: adopt(envelope, startedAt), status: res.status, code: null };
  } catch {
    return { tab: null, status: null, code: null };
  }
}

/** GET /workspace (reconcile) — refresh generation/mode/client; null on failure. */
export async function refresh(): Promise<WorkspaceTab | null> {
  return (await reconcile()).tab;
}

async function transition(path: string, body?: unknown): Promise<WorkspaceTab> {
  const token = readToken();
  const startedAt = epoch;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as WorkspaceEnvelope & { code?: string; error?: string };
  const next = res.ok ? adopt(data, startedAt) : null;
  if (!next) throw Object.assign(new Error(data.code ?? data.error ?? 'workspace.transition_failed'),
    { status: res.status, code: data.code ?? data.error ?? null });
  return next;
}

/** POST /workspace/enter — server decides mode/tenant and returns the new envelope. */
export function enter(clientId: string): Promise<WorkspaceTab> {
  return transition('/api/workspace/enter', { clientId });
}

/** POST /workspace/exit — back to platform mode; the envelope carries the new generation. */
export function exit(): Promise<WorkspaceTab> {
  return transition('/api/workspace/exit');
}

/** Logout / new session: drop this browser tab's handle (server revokes it),
 * invalidate every in-flight adoption (epoch), and forget the "cannot own a tab"
 * verdict so the next session can get its own. */
export function reset(): void {
  epoch += 1;
  tab = null;
  loaded = true;
  unavailable = false;
  pending = null;
  try {
    tabStorage()?.removeItem(TAB_STORAGE_KEY);
  } catch {
    // nothing to clean up
  }
}
