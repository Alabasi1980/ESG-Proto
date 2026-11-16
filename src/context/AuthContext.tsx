import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  IDLE_TRANSITION,
  beginWorkspaceTransition,
  bootWorkspace as runBootWorkspace,
  claimWorkspaceTransition,
  currentTab,
  ensureTab,
  enterVerified,
  exitVerified,
  failWorkspaceTransition,
  recoverWorkspace,
  releaseWorkspaceTransition,
  reset as resetWorkspace,
  settleWorkspaceTransition,
  type WorkspaceMode,
  type WorkspacePhase,
  type WorkspaceTab,
  type WorkspaceTransitionState,
} from '../lib/workspaceClient.ts';
import { setUnauthorizedHandler } from '../lib/api.ts';
import { workspaceExitLanding } from '../lib/navModel.ts';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'ge_admin' | 'client_admin' | 'employee';
  clientId?: string | null;
  clientName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  // D-H01-01: server-owned tenant theme broadcast by POST /auth/login and
  // GET /auth/me; absent on legacy payloads (ThemeContext settles on 'ge').
  theme?: 'ge' | 'lime' | 'dark' | null;
}

/** TASK-PROTO-U3-B2 §2: result of an explicit Enter/Exit (or its Retry). */
export interface WorkspaceTransitionResult {
  ok: boolean;
  mode: WorkspaceMode | null;
  /** True when an identical transition was already in flight (click suppressed). */
  duplicate: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  // TASK-PROTO-U3-B1 §2: the browser-tab workspace mirror this session owns
  // (null for C/E and until a GE tab is established). Read-only for the shell:
  // the nav context derives from user.role + workspace.mode + workspace.client.
  workspace: WorkspaceTab | null;
  // TASK-PROTO-U3-B2 §2/§7: the ONE workspace lifecycle phase the shell gates
  // on. `idle` is the only phase that may render protected content; every other
  // phase renders its named transition/recovery state instead of a guessed W/P.
  workspacePhase: WorkspacePhase;
  // §2 P row: a fresh login lands `ge-overview`, but a reload/new/duplicated
  // tab (a stored tab mirror exists) or an exited consultant tab lands
  // `clients`. App applies this once, before the user navigates anywhere.
  bootLanding: 'ge-overview' | 'clients' | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Re-read the workspace mirror after it changes (login / enter / exit). */
  syncWorkspace: () => Promise<void>;
  /** §2 Enter: confirm handled by the caller; POST enter → GET confirm → W. */
  enterWorkspace: (clientId: string) => Promise<WorkspaceTransitionResult>;
  /** §2 Exit: POST exit → P; the caller lands on Clients. */
  exitWorkspace: () => Promise<WorkspaceTransitionResult>;
  /** §7 Retry: reconcile the same handle first; never replay blindly. */
  retryWorkspace: () => Promise<WorkspaceTransitionResult>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('greenedge_token'));
  const [loading, setLoading] = useState<boolean>(true);
  const [workspace, setWorkspace] = useState<WorkspaceTab | null>(null);
  const [workspacePhase, setWorkspacePhase] = useState<WorkspacePhase>('idle');
  const [bootLanding, setBootLanding] = useState<'ge-overview' | 'clients' | null>(null);
  // The first boot of this session decides the landing (reload vs fresh login);
  // later refreshUser() passes (password change, theme save) never re-land.
  const bootSettledRef = useRef(false);

  // The full transition state (kind/clientId ride along for the Retry panel).
  const transitionRef = useRef<WorkspaceTransitionState>({ ...IDLE_TRANSITION });
  const applyTransition = useCallback((next: WorkspaceTransitionState) => {
    transitionRef.current = next;
    setWorkspacePhase(next.phase);
  }, []);

  // TASK-PROTO-U3-A §4: the single place that clears the session (expired
  // session, manual logout, or a 401 reported by apiFetch all land here).
  const clearSession = useCallback(() => {
    localStorage.removeItem('greenedge_token');
    setToken(null);
    setUser(null);
    setWorkspace(null);
    setBootLanding(null);
    bootSettledRef.current = false;
    applyTransition({ ...IDLE_TRANSITION });
  }, [applyTransition]);

  // apiFetch reports a 401 through this re-used path only; it never builds a
  // second logout path of its own.
  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  /**
   * §7 boot/reload: memory-only workspace. A stored consultant mirror is NEVER
   * resumed: reconcile-before-render, then exit to P → Clients. A confirmed P
   * mirror (or none) renders P normally. While the boot is unresolved the phase
   * is `checking`, so App renders the neutral shell instead of guessed content.
   */
  const bootWorkspace = useCallback(async (role: AuthUser['role'] | null | undefined) => {
    if (role !== 'ge_admin') {
      setWorkspace(null);
      setBootLanding(null);
      bootSettledRef.current = true;
      applyTransition({ ...IDLE_TRANSITION });
      return;
    }
    const mirror = currentTab();
    const firstBoot = !bootSettledRef.current;
    bootSettledRef.current = true;
    const land = () => {
      if (!firstBoot) return;
      // A stored mirror means this page was reloaded/duplicated (or a W tab was
      // exited): both land on Clients. A fresh login has no mirror yet.
      setBootLanding(mirror ? workspaceExitLanding() : 'ge-overview');
    };
    if (mirror?.mode !== 'consultant') {
      await ensureTab();
      setWorkspace(currentTab());
      land();
      applyTransition({ ...IDLE_TRANSITION });
      return;
    }
    const begun = beginWorkspaceTransition(transitionRef.current, 'boot');
    applyTransition(begun);
    let result: Awaited<ReturnType<typeof runBootWorkspace>>;
    try {
      result = await runBootWorkspace();
    } catch {
      applyTransition(failWorkspaceTransition(begun));
      return;
    }
    if (result === 'unauthorized') {
      clearSession();
      return;
    }
    setWorkspace(currentTab());
    if (result !== 'failed' && firstBoot) setBootLanding(workspaceExitLanding());
    applyTransition(result === 'failed' ? failWorkspaceTransition(begun) : settleWorkspaceTransition());
  }, [applyTransition, clearSession]);

  const refreshUser = useCallback(async () => {
    const currentToken = localStorage.getItem('greenedge_token');
    if (!currentToken) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${currentToken}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        // TASK-PROTO-U3-A §4 / U3-B1 §2 / U3-B2 §2: a GE session needs its
        // workspace lifecycle settled before any protected render.
        await bootWorkspace(data.user?.role);
      } else {
        clearSession();
      }
    } catch (err) {
      console.error('Failed to fetch auth session:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [clearSession, bootWorkspace]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem('greenedge_token', newToken);
    setToken(newToken);
    setUser(newUser);
    // A handle is bound to one session: a new session always starts a new tab.
    resetWorkspace();
    setWorkspace(null);
    setBootLanding(null);
    bootSettledRef.current = false;
    applyTransition({ ...IDLE_TRANSITION });
    void bootWorkspace(newUser.role);
  };

  // U3-B1 §2: call after any workspace transition so the shell re-derives its
  // context from the new envelope — no polling added.
  const syncWorkspace = useCallback(async () => {
    setWorkspace(currentTab());
  }, []);

  /** §2 Enter (called only after the caller's confirmation names the client). */
  const enterWorkspace = useCallback(async (clientId: string): Promise<WorkspaceTransitionResult> => {
    if (!claimWorkspaceTransition('enter')) return { ok: false, mode: null, duplicate: true };
    const begun = beginWorkspaceTransition(transitionRef.current, 'enter', clientId);
    applyTransition(begun);
    try {
      const outcome = await enterVerified(clientId);
      if (outcome.ok) {
        setWorkspace(outcome.tab);
        applyTransition(settleWorkspaceTransition());
        return { ok: true, mode: outcome.tab.mode, duplicate: false };
      }
      if (outcome.reason === 'unauthorized') {
        clearSession();
        return { ok: false, mode: null, duplicate: false };
      }
      applyTransition(failWorkspaceTransition(begun));
      return { ok: false, mode: null, duplicate: false };
    } finally {
      releaseWorkspaceTransition();
    }
  }, [applyTransition, clearSession]);

  /** §2 Exit (confirmation already accepted by the caller). */
  const exitWorkspace = useCallback(async (): Promise<WorkspaceTransitionResult> => {
    if (!claimWorkspaceTransition('exit')) return { ok: false, mode: null, duplicate: true };
    const begun = beginWorkspaceTransition(transitionRef.current, 'exit');
    applyTransition(begun);
    try {
      const outcome = await exitVerified();
      if (outcome.ok) {
        setWorkspace(outcome.tab);
        applyTransition(settleWorkspaceTransition());
        return { ok: true, mode: outcome.tab.mode, duplicate: false };
      }
      if (outcome.reason === 'unauthorized') {
        clearSession();
        return { ok: false, mode: null, duplicate: false };
      }
      applyTransition(failWorkspaceTransition(begun));
      return { ok: false, mode: null, duplicate: false };
    } finally {
      releaseWorkspaceTransition();
    }
  }, [applyTransition, clearSession]);

  /** §7 Retry: GET /api/workspace first; a boot recovery always exits to P. */
  const retryWorkspace = useCallback(async (): Promise<WorkspaceTransitionResult> => {
    const kind = transitionRef.current.kind ?? 'enter';
    if (!claimWorkspaceTransition(kind)) return { ok: false, mode: null, duplicate: true };
    const begun = beginWorkspaceTransition(transitionRef.current, kind, transitionRef.current.clientId);
    applyTransition(begun);
    try {
      const outcome = await recoverWorkspace(kind === 'boot' ? 'boot' : 'adopt');
      if (outcome.unauthorized) {
        clearSession();
        return { ok: false, mode: null, duplicate: false };
      }
      if (!outcome.ok) {
        applyTransition(failWorkspaceTransition(begun));
        return { ok: false, mode: null, duplicate: false };
      }
      setWorkspace(currentTab());
      // A recovered reload still establishes P → Clients (never W resume).
      if (kind === 'boot') setBootLanding(workspaceExitLanding());
      applyTransition(settleWorkspaceTransition());
      return { ok: true, mode: outcome.mode, duplicate: false };
    } finally {
      releaseWorkspaceTransition();
    }
  }, [applyTransition, clearSession]);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      // ignore
    } finally {
      clearSession();
      resetWorkspace();
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      workspace,
      workspacePhase,
      bootLanding,
      login,
      logout,
      refreshUser,
      syncWorkspace,
      enterWorkspace,
      exitWorkspace,
      retryWorkspace,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
