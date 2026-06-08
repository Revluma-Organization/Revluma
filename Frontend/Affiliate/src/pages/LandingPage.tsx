import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import OldLandingPage from '../components/LandingPage';

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  return (
    <OldLandingPage
      onNavigateToAuth={(view) => navigate(view === 'register' ? '/signup' : '/login')}
      currentProfile={user}
      onNavigateToDashboard={() => navigate(isAuthenticated ? '/dashboard/home' : '/login')}
    />
  );
}
