import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ensureTab, reset as resetWorkspace } from '../lib/workspaceClient.ts';
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
  login: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('greenedge_token'));
  const [loading, setLoading] = useState<boolean>(true);

  // TASK-PROTO-U3-A §4: the single place that clears the session (expired
  // session, manual logout, or a 401 reported by apiFetch all land here).
  const clearSession = useCallback(() => {
    localStorage.removeItem('greenedge_token');
    setToken(null);
    setUser(null);
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
        // TASK-PROTO-U3-A §4: a GE session needs its workspace tab before any
        // business call; C/E sessions never own one.
        if (data.user?.role === 'ge_admin') void ensureTab();
      } else {
        clearSession();
      }
    } catch (err) {
      console.error('Failed to fetch auth session:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem('greenedge_token', newToken);
    setToken(newToken);
    setUser(newUser);
    // A handle is bound to one session: a new session always starts a new tab.
    resetWorkspace();
    if (newUser.role === 'ge_admin') void ensureTab();
  };

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
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser }}>
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
