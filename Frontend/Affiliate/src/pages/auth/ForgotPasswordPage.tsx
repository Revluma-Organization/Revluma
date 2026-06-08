import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import AuthInterface from '../../components/AuthInterface';
import type { PartnerProfile } from '../../types';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { user, hydrateUser } = useAuth();

  return (
    <AuthInterface
      initialMode="forgot"
      currentUser={user}
      onAuthSuccess={(profile: PartnerProfile) => {
        hydrateUser(profile);
        navigate('/dashboard/home');
      }}
      onRouteChange={(mode) => {
        const map: Record<string, string> = {
          register: '/signup',
          verifyEmail: '/verify-email',
          pendingApproval: '/pending-review',
          rejected: '/rejected',
          login: '/login',
          forgot: '/forgot-password',
          resetConfirm: '/reset-password',
        };
        navigate(map[mode] || '/login');
      }}
      onBackToLanding={() => navigate('/')}
    />
  );
}
