import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { AuthContext, type RegisterData } from '../hooks/useAuth';
import { storage } from '../utils/storage';
import * as api from '../lib/api';
import type { PartnerProfile } from '../types';

function buildProfile(serverUser: {
  id: string; email: string; full_name: string; role: string;
}, profile?: Record<string, unknown>): PartnerProfile {
  return {
    id: serverUser.id,
    fullName: serverUser.full_name ?? '',
    username: (profile?.username as string) ?? serverUser.email.split('@')[0],
    email: serverUser.email,
    avatarUrl: (profile?.avatarUrl as string) ?? null,
    tier: (profile?.membershipTier as string) ?? (profile?.tier as string) ?? 'Affiliate',
    role: serverUser.role === 'admin' ? 'admin' : 'affiliate',
    commissionRate: (profile?.commissionRate as number) ?? 0.20,
    referralCode: (profile?.referralCode as string) ?? '',
    country: (profile?.country as string) ?? '',
    phoneNumber: (profile?.phoneNumber as string) ?? '',
    twitterHandle: (profile?.twitterHandle as string) ?? undefined,
    instagramHandle: (profile?.instagramHandle as string) ?? undefined,
    linkedinProfile: (profile?.linkedinProfile as string) ?? (profile?.linkedInProfile as string) ?? undefined,
    website: (profile?.website as string) ?? '',
    audienceNiche: (profile?.audienceNiche as string) ?? '',
    audienceSize: (profile?.audienceSize as string) ?? '',
    affiliateExperience: (profile?.affiliateExperience as string) ?? '',
    whyJoin: (profile?.whyJoin as string) ?? '',
    status: (profile?.status as string) ?? 'pending',
    createdAt: (profile?.createdAt as string) ?? new Date().toISOString(),
    termsAccepted: (profile?.termsAccepted as boolean) ?? false,
    marketingConsent: (profile?.marketingConsent as boolean) ?? false,
    emailVerified: (profile?.emailVerified as boolean) ?? false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PartnerProfile | null>(() => storage.get<PartnerProfile | null>('user', null));
  const [isLoading, setIsLoading] = useState(!user);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (!user) setIsLoading(false);
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      const profileRes = await api.getProfile().catch(() => ({ profile: {} }));
      const profile = buildProfile(res.user, profileRes.profile as Record<string, unknown>);
      storage.set('user', profile);
      setUser(profile);
    } catch (err: any) {
      const msg = err?.body?.error ?? err?.message ?? 'Login failed';
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
    } catch (err: any) {
      const msg = err?.body?.error ?? err?.message ?? 'Registration failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    storage.remove('user');
    setUser(null);
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.affiliateVerifyEmail({ pendingRegistrationId: '', code: token });
    } catch (err: any) {
      const msg = err?.body?.error ?? err?.message ?? 'Verification failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const forgotPassword = useCallback(async (_email: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.forgotPassword(_email);
    } catch (err: any) {
      const msg = err?.body?.error ?? err?.message ?? 'Request failed';
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
    } catch (err: any) {
      const msg = err?.body?.error ?? err?.message ?? 'Reset failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const hydrateUser = useCallback((profile: PartnerProfile) => {
    storage.set('user', profile);
    setUser(profile);
  }, []);

  const updateProfile = useCallback(async (data: Partial<PartnerProfile>) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.updateProfile(data as Record<string, unknown>);
      const updated = { ...user, ...data, ...res.profile } as PartnerProfile;
      storage.set('user', updated);
      setUser(updated);
    } catch (err: any) {
      const msg = err?.body?.error ?? err?.message ?? 'Update failed';
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
