import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './theme.css';
import './styles.css';
import { App } from './App.jsx';

// The operator console lives on a hidden route and is code-split so the
// audience bundle never pays for it.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

const isAdmin = window.location.pathname.startsWith('/admin');

createRoot(document.getElementById('root')).render(
  isAdmin ? (
    <Suspense fallback={null}>
      <AdminApp />
    </Suspense>
  ) : (
    <App />
  ),
);
