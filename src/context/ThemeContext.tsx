import React, { createContext, useContext, useLayoutEffect } from 'react';

export type TenantTheme = 'ge' | 'abyss' | 'stone';

// WHY a literal session constant: the server-enforced tenant theme column
// lands in a later batch (THEME_TOKENS.md §5) — H02b wires the mechanism only.
const TENANT_THEME: TenantTheme = 'ge';

interface ThemeContextType {
  theme: TenantTheme;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // WHY a layout effect, not a passive effect: data-theme must land on the
  // root before first paint so token utilities resolve with no theme flash.
  // WHY nothing else here: the theme is server-enforced per tenant (H01 §5),
  // so no localStorage, no picker UI, no fetch — the client applies the
  // session value only.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', TENANT_THEME);
  }, []);

  return <ThemeContext.Provider value={{ theme: TENANT_THEME }}>{children}</ThemeContext.Provider>;
};

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
