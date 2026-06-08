import { Suspense } from 'react';
import { BrowserRouter, useRoutes } from 'react-router-dom';
import { ThemeProvider } from './providers/ThemeProvider';
import { AuthProvider } from './providers/AuthProvider';
import { SidebarProvider } from './providers/SidebarProvider';
import { routes } from './routes';
import ErrorBoundary from './components/common/ErrorBoundary';

function AppRoutes() {
  return useRoutes(routes);
}

function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
      color: 'var(--color-text-secondary)',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 32,
          height: 32,
          border: '2px solid var(--color-border)',
          borderTopColor: 'var(--color-brand)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto 16px',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Loading...
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename="/affiliate">
        <ThemeProvider>
          <AuthProvider>
            <SidebarProvider>
              <Suspense fallback={<LoadingScreen />}>
                <AppRoutes />
              </Suspense>
            </SidebarProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
