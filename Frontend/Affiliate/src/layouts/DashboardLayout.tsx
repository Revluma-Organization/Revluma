import { Suspense, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import Sidebar from '../components/sidebar/Sidebar';
import TopNav from '../components/topnav/TopNav';
import PageTransition from '../components/common/PageTransition';
import { useAuth } from '../hooks/useAuth';
import { useSidebar } from '../providers/SidebarProvider';

function DashboardGuard({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const status = ((user?.status ?? 'pending') as string).toLowerCase();
  if (status !== 'approved') {
    if (status === 'pending' || status === 'pending_review' || status === 'under_review') {
      return <Navigate to="/pending-review" replace />;
    }
    if (status === 'rejected') {
      return <Navigate to="/rejected" replace />;
    }
    if (status === 'pending_email_verification') {
      return <Navigate to="/verify-email" replace />;
    }
    return <Navigate to="/pending-review" replace />;
  }

  return <>{children}</>;
}

export default function DashboardLayout() {
  const { open } = useSidebar();

  return (
    <DashboardGuard>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <div style={{
          flex: 1,
          marginLeft: open ? 'var(--sidebar-width)' : 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          transition: 'margin-left 0.2s ease',
        }}>
          <TopNav />
          <main style={{
            flex: 1,
            padding: 24,
            background: 'var(--color-bg)',
          }}>
            <Suspense fallback={null}>
              <PageTransition>
                <Outlet />
              </PageTransition>
            </Suspense>
          </main>
        </div>
      </div>
    </DashboardGuard>
  );
}
