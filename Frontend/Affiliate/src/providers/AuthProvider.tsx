import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { AuthContext, type RegisterData } from '../hooks/useAuth';
import * as api from '../lib/api';
import type { PartnerProfile } from '../types';

function buildProfile(serverUser: {
  id: string; email: string; full_name: string; role: string;
}, profile?: Record<string, unknown>): PartnerProfile {
  const p = profile ?? {};
  return {
    id: serverUser.id,
    fullName: serverUser.full_name ?? '',
    username: (p.username as string) ?? serverUser.email.split('@')[0],
    email: serverUser.email,
    avatarUrl: (p.avatarUrl as string | null) ?? null,
    tier: (p.membershipTier as string) ?? (p.tier as string) ?? 'Affiliate',
    role: serverUser.role === 'admin' ? 'admin' : 'affiliate',
    commissionRate: (p.commissionRate as number) ?? 0.20,
    referralCode: (p.referralCode as string) ?? '',
    country: (p.country as string) ?? '',
    phoneNumber: (p.phoneNumber as string) ?? '',
    twitterHandle: (p.twitterHandle as string) ?? undefined,
    instagramHandle: (p.instagramHandle as string) ?? undefined,
    linkedinProfile: (p.linkedinProfile as string) ?? undefined,
    website: (p.website as string) ?? '',
    audienceNiche: (p.audienceNiche as string) ?? '',
    audienceSize: (p.audienceSize as string) ?? '',
    affiliateExperience: (p.affiliateExperience as string) ?? '',
    whyJoin: (p.whyJoin as string) ?? '',
    status: (p.status as string) ?? 'pending',
    createdAt: (p.createdAt as string) ?? new Date().toISOString(),
    termsAccepted: (p.termsAccepted as boolean) ?? false,
    marketingConsent: (p.marketingConsent as boolean) ?? false,
    emailVerified: (p.emailVerified as boolean) ?? false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PartnerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // On mount, try to restore session from the server (no PII in localStorage)
  useEffect(() => {
    api.me()
      .then(res => {
        if (res.authenticated && res.user) {
          return api.getProfile().then(profileRes => {
            const profile = buildProfile(res.user!, profileRes.profile as Record<string, unknown>);
            setUser(profile);
          }).catch(() => {
            // Profile not found, but user is authenticated (partial state)
            setUser({
              id: res.user!.id,
              fullName: res.user!.full_name,
              email: res.user!.email,
              username: res.user!.email.split('@')[0],
              role: res.user!.role === 'admin' ? 'admin' : 'affiliate',
              commissionRate: 0.20,
              tier: 'Affiliate',
            });
          });
        }
      })
      .catch(() => {
        // No valid session, stay logged out
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      const profileRes = await api.getProfile().catch(() => ({ profile: {} }));
      const profile = buildProfile(res.user, profileRes.profile as Record<string, unknown>);
      setUser(profile);
    } catch (err: unknown) {
      const e = err as { body?: { error?: string }; message?: string };
      const msg = e?.body?.error ?? e?.message ?? 'Login failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.affiliateRegister({
        email: data.email,
        password: data.password,
        firstName: data.fullName.split(' ')[0] || data.fullName,
        lastName: data.fullName.split(' ').slice(1).join(' ') || '',
        username: data.username,
        phoneNumber: '',
        country: data.country ?? '',
        twitterHandle: data.twitterHandle,
        instagramHandle: data.instagramHandle,
        linkedinProfile: data.linkedInProfile,
        website: data.website,
        audienceNiche: data.audienceNiche ?? '',
        audienceSize: data.audienceSize ?? '',
        affiliateExperience: data.affiliateExperience ?? '',
        whyJoin: data.whyJoin ?? '',
      });
    } catch (err: unknown) {
      const e = err as { body?: { error?: string }; message?: string };
      const msg = e?.body?.error ?? e?.message ?? 'Registration failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    setUser(null);
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const pendingId = user?.id ?? '';
      if (!pendingId) {
        setError('Session required for verification');
        return;
      }
      await api.affiliateVerifyEmail({ pendingRegistrationId: pendingId, code: token });
    } catch (err: unknown) {
      const e = err as { body?: { error?: string }; message?: string };
      const msg = e?.body?.error ?? e?.message ?? 'Verification failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const forgotPassword = useCallback(async (_email: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.forgotPassword(_email);
    } catch (err: unknown) {
      const e = err as { body?: { error?: string }; message?: string };
      const msg = e?.body?.error ?? e?.message ?? 'Request failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const resetPassword = useCallback(async (_token: string, _password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.resetPassword(_token, _password);
    } catch (err: unknown) {
      const e = err as { body?: { error?: string }; message?: string };
      const msg = e?.body?.error ?? e?.message ?? 'Reset failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const hydrateUser = useCallback((profile: PartnerProfile) => {
    setUser(profile);
  }, []);

  const updateProfile = useCallback(async (data: Partial<PartnerProfile>) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.updateProfile(data as Record<string, unknown>);
      const updated = { ...user, ...data, ...res.profile } as PartnerProfile;
      setUser(updated);
    } catch (err: unknown) {
      const e = err as { body?: { error?: string }; message?: string };
      const msg = e?.body?.error ?? e?.message ?? 'Update failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  return (
    <AuthContext
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        error,
        login,
        register,
        logout,
        verifyEmail,
        forgotPassword,
        resetPassword,
        updateProfile,
        clearError,
        hydrateUser,
      }}
    >
      {children}
    </AuthContext>
  );
}
