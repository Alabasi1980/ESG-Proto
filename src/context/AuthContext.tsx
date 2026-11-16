import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ensureTab, reset as resetWorkspace, currentTab, type WorkspaceTab } from '../lib/workspaceClient.ts';
import { setUnauthorizedHandler } from '../lib/api.ts';

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

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  // TASK-PROTO-U3-B1 §2: the browser-tab workspace mirror this session owns
  // (null for C/E and until a GE tab is established). Read-only for the shell:
  // the nav context derives from user.role + workspace.mode + workspace.client.
  workspace: WorkspaceTab | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Re-read the workspace mirror after it changes (login / enter / exit). */
  syncWorkspace: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('greenedge_token'));
  const [loading, setLoading] = useState<boolean>(true);
  const [workspace, setWorkspace] = useState<WorkspaceTab | null>(null);

  // TASK-PROTO-U3-B1 §2: mirror the workspace tab into React state so the shell
  // can derive its context. Only a GE actor can own a tab; C/E clear it. The
  // mode/tenant is never decided here — currentTab() is workspaceClient's copy
  // of the last server envelope.
  const adoptWorkspace = useCallback(async (role: AuthUser['role'] | null | undefined) => {
    if (role !== 'ge_admin') {
      setWorkspace(null);
      return;
    }
    await ensureTab();
    setWorkspace(currentTab());
  }, []);

  // TASK-PROTO-U3-A §4: the single place that clears the session (expired
  // session, manual logout, or a 401 reported by apiFetch all land here).
  const clearSession = useCallback(() => {
    localStorage.removeItem('greenedge_token');
    setToken(null);
    setUser(null);
    setWorkspace(null);
  }, []);

  // apiFetch reports a 401 through this re-used path only; it never builds a
  // second logout path of its own.
  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

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
        // TASK-PROTO-U3-A §4 / U3-B1 §2: a GE session needs its workspace tab
        // before any business call; C/E sessions never own one.
        void adoptWorkspace(data.user?.role);
      } else {
        clearSession();
      }
    } catch (err) {
      console.error('Failed to fetch auth session:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [clearSession, adoptWorkspace]);

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
    void adoptWorkspace(newUser.role);
  };

  // U3-B1 §2: call after any workspace transition (B2's enter/exit) so the
  // shell re-derives its context from the new envelope — no polling added.
  const syncWorkspace = useCallback(async () => {
    await adoptWorkspace(user?.role ?? null);
  }, [adoptWorkspace, user?.role]);

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
    <AuthContext.Provider value={{ user, token, loading, workspace, login, logout, refreshUser, syncWorkspace }}>
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
