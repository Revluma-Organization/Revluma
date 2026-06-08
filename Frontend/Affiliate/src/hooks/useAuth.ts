import { createContext, useContext } from 'react';
import type { PartnerProfile, MembershipTier } from '../types';

export interface AuthContextValue {
  user: PartnerProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  verifyEmail: (token: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  updateProfile: (data: Partial<PartnerProfile>) => Promise<void>;
  clearError: () => void;
  hydrateUser: (profile: PartnerProfile) => void;
}

export interface RegisterData {
  username: string;
  fullName: string;
  email: string;
  password: string;
  referralCode?: string;
  country?: string;
  audienceNiche?: string;
  audienceSize?: string;
  affiliateExperience?: string;
  whyJoin?: string;
  twitterHandle?: string;
  instagramHandle?: string;
  linkedInProfile?: string;
  website?: string;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
