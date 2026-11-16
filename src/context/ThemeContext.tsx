import React, { createContext, useContext, useLayoutEffect } from 'react';
import { useAuth } from './AuthContext.tsx';

export type TenantTheme = 'ge' | 'lime' | 'dark';

interface ThemeContextType {
  theme: TenantTheme;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  // WHY this value: the theme is the tenant's SERVER-side property (D-H01-01),
  // broadcast in the session payload. The client only mirrors it: default 'ge'
  // before login, and any legacy/NULL/unknown value also settles on 'ge' — the
  // provider never invents a theme, persists one, or fetches one itself.
  const stored = user?.theme;
  const theme: TenantTheme = stored === 'lime' || stored === 'dark' ? stored : 'ge';

  // WHY a layout effect with a theme dependency: data-theme must land on the
  // root before first paint so token utilities resolve with no theme flash, and
  // it must re-apply whenever the session theme changes (login, refresh, or
  // logout → back to 'ge'). No localStorage, no picker UI, no fetch here.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme }}>{children}</ThemeContext.Provider>;
};

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
