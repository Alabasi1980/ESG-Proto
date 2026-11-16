import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthProvider} from './context/AuthContext.tsx';
import {ThemeProvider} from './context/ThemeContext.tsx';
import './index.css';

// Provider order is fixed: AuthProvider OUTER (the session source), ThemeProvider
// INNER (it mirrors the authenticated user's server-owned theme, D-H01-01).
createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </AuthProvider>
);
