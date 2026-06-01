/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthInterface — connects to the Express backend for all auth operations.
 * No simulation, no localStorage database, no plaintext passwords.
 */

import React, { useState } from 'react';
import {
  Shield, User, Mail, Lock, Phone, Globe, Twitter, Linkedin, Instagram,
  Layers, CheckSquare, Info, ChevronRight, ChevronLeft, Loader2, Link2,
  Send, Sparkles, CheckCircle2, AlertCircle
} from 'lucide-react';
import { PartnerProfile } from '../types';
import * as api from '../lib/api';

// ============================================================
// Types
// ============================================================

type AuthMode =
  | 'login'
  | 'register'
  | 'forgot'
  | 'resetConfirm'
  | 'verifyEmail'
  | 'pendingApproval';

interface AuthInterfaceProps {
  onAuthSuccess: (profile: PartnerProfile) => void;
  onBackToLanding: () => void;
}

// ============================================================
// Helpers
// ============================================================

function convertBackendTierToDisplay(backendTier: unknown): PartnerProfile['tier'] {
  const tier = (backendTier as string)?.toUpperCase() ?? 'AFFILIATE';
  const tierMap: Record<string, PartnerProfile['tier']> = {
    'AFFILIATE': 'Affiliate',
    'GROWTH': 'Growth',
    'ELITE': 'Elite',
    'FOUNDING_AMBASSADOR': 'Founding Ambassador'
  };
  return tierMap[tier] ?? 'Affiliate';
}

function buildPartnerProfile(serverUser: {
  id: string;
  email: string;
  full_name: string;
  role: string;
}, profile?: Record<string, unknown>): PartnerProfile {
  const nameParts = (serverUser.full_name ?? '').split(' ');
  return {
    id: serverUser.id,
    fullName: serverUser.full_name ?? '',
    username: (profile?.username as string) ?? serverUser.email.split('@')[0],
    email: serverUser.email,
    phoneNumber: (profile?.phoneNumber as string) ?? '',
    country: (profile?.country as string) ?? '',
    twitterHandle: (profile?.twitterHandle as string) ?? undefined,
    instagramHandle: (profile?.instagramHandle as string) ?? undefined,
    linkedInProfile: (profile?.linkedInUrl as string) ?? undefined,
    website: (profile?.websiteUrl as string) ?? undefined,
    audienceNiche: (profile?.audienceNiche as string) ?? '',
    audienceSize: (profile?.audienceSize as string) ?? '',
    affiliateExperience: (profile?.affiliateExperience as string) ?? '',
    whyJoin: (profile?.whyJoin as string) ?? '',
    status: (profile?.status as PartnerProfile['status']) ?? 'pending',
    role: (serverUser.role === 'admin' ? 'admin' : 'affiliate') as PartnerProfile['role'],
    createdAt: (profile?.createdAt as string) ?? new Date().toISOString(),
    tier: convertBackendTierToDisplay(profile?.tier),
    commissionRate: (profile?.commissionRate as number) ?? 0.20,
    avatarUrl: (profile?.avatarUrl as string) ?? undefined,
    termsAccepted: (profile?.termsAccepted as boolean) ?? false,
    marketingConsent: (profile?.marketingConsent as boolean) ?? false,
    emailVerified: true
  };
}

// ============================================================
// Component
// ============================================================

export default function AuthInterface({ onAuthSuccess, onBackToLanding }: AuthInterfaceProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');

  // Pending state (after signup, awaiting email verification or admin approval)
  const [pendingUserId, setPendingUserId] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');

  // ---- Registration fields ----
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [country, setCountry] = useState('US');
  const [password, setPassword] = useState('');
  const [twitterHandle, setTwitterHandle] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [linkedInProfile, setLinkedInProfile] = useState('');
  const [website, setWebsite] = useState('');
  const [audienceNiche, setAudienceNiche] = useState('Shopify Growth');
  const [audienceSize, setAudienceSize] = useState('5,000 - 10,000');
  const [affiliateExperience, setAffiliateExperience] = useState('Intermediate');
  const [whyJoin, setWhyJoin] = useState('');
  const [termsAgreement, setTermsAgreement] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  // ---- Login fields ----
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // ---- Forgot password fields ----
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // ============================================================
  // Validation
  // ============================================================

  const validateStep1 = (): string | null => {
    if (!fullName.trim()) return 'Full name is required.';
    if (!username.trim() || username.length < 3) return 'Username must be at least 3 characters.';
    if (!email.trim() || !email.includes('@')) return 'Enter a valid email address.';
    if (!phoneNumber.trim()) return 'Phone number is required.';
    if (!password || password.length < 8) return 'Password must be at least 8 characters.';
    return null;
  };

  const validateStep2 = (): string | null => {
    if (!audienceNiche.trim()) return 'Please specify your audience niche.';
    if (!audienceSize) return 'Please choose your audience size.';
    return null;
  };

  const validateStep3 = (): string | null => {
    if (!whyJoin.trim() || whyJoin.trim().length < 15)
      return 'Please provide at least 15 characters explaining why you want to join.';
    if (!termsAgreement)
      return 'You must agree to the partnership terms.';
    return null;
  };

  const handleNextStep = () => {
    setErrorText('');
    const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : null;
    if (err) { setErrorText(err); } else { setStep(p => p + 1); }
  };

  const handlePrevStep = () => {
    setErrorText('');
    setStep(p => p - 1);
  };

  function clearForm() {
    setFullName(''); setUsername(''); setEmail(''); setPhoneNumber('');
    setCountry('US'); setPassword(''); setTwitterHandle(''); setInstagramHandle('');
    setLinkedInProfile(''); setWebsite(''); setAudienceNiche('Shopify Growth');
    setAudienceSize('5,000 - 10,000'); setAffiliateExperience('Intermediate');
    setWhyJoin(''); setTermsAgreement(false); setMarketingConsent(false); setStep(1);
  }

  // ============================================================
  // Login
  // ============================================================

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');
    setSuccessText('');

    if (!loginEmail || !loginPassword) {
      setErrorText('Please fill out all fields.');
      return;
    }

    setIsLoading(true);

    try {
      const { user } = await api.login(loginEmail, loginPassword);

      // Fetch full affiliate profile from backend
      let profile: Record<string, unknown> | undefined;
      try {
        const profileRes = await api.getProfile();
        profile = profileRes.profile as Record<string, unknown>;
      } catch {
        // profile may not exist yet for newly signed-up users
      }

      if (profile?.status === 'rejected') {
        setErrorText('Your application has been declined. Please contact support if you believe this is an error.');
        setIsLoading(false);
        return;
      }

      if (profile?.status === 'pending') {
        setPendingEmail(loginEmail);
        setPendingUserId(user.id);
        setAuthMode('pendingApproval');
        setIsLoading(false);
        return;
      }

      onAuthSuccess(buildPartnerProfile(user, profile));
    } catch (err: unknown) {
      const message = (err as { body?: { error?: string } })?.body?.error
        ?? (err instanceof Error ? err.message : 'Login failed. Please try again.');
      setErrorText(message);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Register
  // ============================================================

  const handleSignUpCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');

    const err = validateStep3();
    if (err) { setErrorText(err); return; }

    setIsLoading(true);

    try {
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] ?? fullName;
      const lastName = nameParts.slice(1).join(' ') || firstName;

      await api.signup({
        email: email.toLowerCase().trim(),
        password,
        firstName,
        lastName
      });

      // After signup, partner-specific onboarding data is submitted as a profile update
      // (done in the portal after email verification — not during auth)
      setPendingEmail(email.toLowerCase().trim());
      setSuccessText(`Verification email sent to ${email}. Please enter the 6-digit code below.`);
      setAuthMode('verifyEmail');
      clearForm();
    } catch (err: unknown) {
      const message = (err as { body?: { error?: string } })?.body?.error
        ?? (err instanceof Error ? err.message : 'Registration failed. Please try again.');
      setErrorText(message);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Email verification
  // ============================================================

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');

    if (!verifyCode.trim()) {
      setErrorText('Please enter the 6-digit code from your email.');
      return;
    }

    setIsLoading(true);

    try {
      await api.me(); // ensures we have a valid session before verifying

      const RAW_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? '';
      const API_BASE = RAW_BASE ? RAW_BASE.replace(/\/$/, '') : `${window.location.origin}/api`;

      const csrfToken = sessionStorage.getItem('csrf_token') ?? '';
      const res = await fetch(`${API_BASE}/session/verify-email`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
        },
        body: JSON.stringify({ code: verifyCode.trim() })
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Verification failed');
      }

      setSuccessText('Email verified! Your application has been submitted for review. We\'ll notify you once approved.');
      setPendingEmail('');
      setAuthMode('pendingApproval');
    } catch (err: unknown) {
      setErrorText(err instanceof Error ? err.message : 'Verification failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerificationCode = async () => {
    setErrorText('');
    setSuccessText('');
    setIsLoading(true);

    try {
      const RAW_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? '';
      const API_BASE = RAW_BASE ? RAW_BASE.replace(/\/$/, '') : `${window.location.origin}/api`;

      await fetch(`${API_BASE}/auth/send-verification`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail })
      });

      setSuccessText(`A new code has been sent to ${pendingEmail}.`);
    } catch {
      setErrorText('Failed to resend code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Forgot / reset password
  // ============================================================

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');

    if (!forgotEmail || !forgotEmail.includes('@')) {
      setErrorText('Enter your registered email address.');
      return;
    }

    setIsLoading(true);

    try {
      const RAW_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? '';
      const API_BASE = RAW_BASE ? RAW_BASE.replace(/\/$/, '') : `${window.location.origin}/api`;

      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() })
      });

      const body = await res.json() as { token?: string };
      if (body.token) setResetToken(body.token);

      setSuccessText('If that email is registered, a reset code has been sent. Please check your inbox.');
      setAuthMode('resetConfirm');
    } catch {
      // Show the same message regardless to avoid email enumeration
      setSuccessText('If that email is registered, a reset code has been sent. Please check your inbox.');
      setAuthMode('resetConfirm');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');

    if (!resetCode) { setErrorText('Enter the 6-digit code from your email.'); return; }
    if (!newPassword || newPassword.length < 8) { setErrorText('New password must be at least 8 characters.'); return; }

    setIsLoading(true);

    try {
      const RAW_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? '';
      const API_BASE = RAW_BASE ? RAW_BASE.replace(/\/$/, '') : `${window.location.origin}/api`;

      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, code: resetCode, newPassword })
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Reset failed');
      }

      setSuccessText('Password reset successfully. Please log in with your new password.');
      setAuthMode('login');
      setResetToken('');
      setResetCode('');
      setNewPassword('');
    } catch (err: unknown) {
      setErrorText(err instanceof Error ? err.message : 'Reset failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Render helpers
  // ============================================================

  const renderAlert = (text: string, type: 'error' | 'success') =>
    text ? (
      <div className={`flex items-start gap-2 p-3 rounded-md text-sm ${type === 'error'
          ? 'bg-red-500/10 border border-red-500/30 text-red-400'
          : 'bg-green-500/10 border border-green-500/30 text-green-400'
        }`}>
        {type === 'error'
          ? <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
        <span>{text}</span>
      </div>
    ) : null;

  const inputClass =
    'w-full bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition';

  const btnPrimary =
    'w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-md px-4 py-2.5 text-sm transition';

  const btnGhost =
    'w-full flex items-center justify-center gap-2 border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 font-medium rounded-md px-4 py-2.5 text-sm transition';

  // ============================================================
  // Pending approval screen
  // ============================================================

  if (authMode === 'pendingApproval') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Shield className="w-7 h-7 text-amber-400" />
          </div>
          <h2 className="text-xl font-semibold text-zinc-100">Application Under Review</h2>
          <p className="text-sm text-zinc-400">
            Your affiliate application has been submitted and is pending admin review.
            You'll receive an email once your application is approved.
          </p>
          <button onClick={() => { setAuthMode('login'); setSuccessText(''); setErrorText(''); }} className={btnGhost}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Email verification screen
  // ============================================================

  if (authMode === 'verifyEmail') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-zinc-100">Verify Your Email</h1>
            <p className="text-sm text-zinc-400">
              Enter the 6-digit code sent to <span className="text-violet-400">{pendingEmail}</span>
            </p>
          </div>

          <form onSubmit={handleVerifyEmail} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            {renderAlert(errorText, 'error')}
            {renderAlert(successText, 'success')}

            <input
              className={inputClass}
              placeholder="6-digit code"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
            />

            <button type="submit" disabled={isLoading} className={btnPrimary}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
              {isLoading ? 'Verifying…' : 'Verify Email'}
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={handleResendVerificationCode}
              className={btnGhost}
            >
              <Send className="w-4 h-4" />
              Resend Code
            </button>
          </form>

          <p className="text-center text-xs text-zinc-500">
            Already have an account?{' '}
            <button onClick={() => { setAuthMode('login'); setErrorText(''); setSuccessText(''); }} className="text-violet-400 hover:underline">
              Log in
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ============================================================
  // Forgot password
  // ============================================================

  if (authMode === 'forgot') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-zinc-100">Reset Password</h1>
            <p className="text-sm text-zinc-400 mt-1">Enter the email you registered with.</p>
          </div>

          <form onSubmit={handleForgotPassword} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            {renderAlert(errorText, 'error')}
            {renderAlert(successText, 'success')}

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                className={`${inputClass} pl-10`}
                type="email"
                placeholder="Your email address"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <button type="submit" disabled={isLoading} className={btnPrimary}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isLoading ? 'Sending…' : 'Send Reset Code'}
            </button>

            <button type="button" onClick={() => { setAuthMode('login'); setErrorText(''); setSuccessText(''); }} className={btnGhost}>
              <ChevronLeft className="w-4 h-4" />
              Back to Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================================
  // Reset confirm
  // ============================================================

  if (authMode === 'resetConfirm') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-zinc-100">Enter Reset Code</h1>
            <p className="text-sm text-zinc-400 mt-1">Check your email for the 6-digit reset code.</p>
          </div>

          <form onSubmit={handleConfirmReset} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            {renderAlert(errorText, 'error')}
            {renderAlert(successText, 'success')}

            <input
              className={inputClass}
              placeholder="6-digit reset code"
              value={resetCode}
              onChange={e => setResetCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
            />

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                className={`${inputClass} pl-10`}
                type="password"
                placeholder="New password (min 8 characters)"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <button type="submit" disabled={isLoading} className={btnPrimary}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isLoading ? 'Resetting…' : 'Reset Password'}
            </button>

            <button type="button" onClick={() => { setAuthMode('login'); setErrorText(''); setSuccessText(''); }} className={btnGhost}>
              <ChevronLeft className="w-4 h-4" />
              Back to Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================================
  // Register — 3-step form
  // ============================================================

  if (authMode === 'register') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg space-y-6">
          {/* Header */}
          <div className="text-center space-y-1">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-violet-400" />
              <span className="text-xs font-semibold tracking-widest text-violet-400 uppercase">Partner Portal</span>
            </div>
            <h1 className="text-2xl font-bold text-zinc-100">Apply to the Affiliate Programme</h1>
            <p className="text-sm text-zinc-400">Step {step} of 3</p>
          </div>

          {/* Progress */}
          <div className="flex gap-1.5">
            {[1, 2, 3].map(s => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-all ${s <= step ? 'bg-violet-500' : 'bg-zinc-800'}`} />
            ))}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            {renderAlert(errorText, 'error')}

            {/* Step 1 — Personal & Credentials */}
            {step === 1 && (
              <>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} placeholder="Full name" value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} placeholder="Username (min 3 chars)" value={username} onChange={e => setUsername(e.target.value)} />
                </div>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} placeholder="Phone number" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} />
                </div>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <select className={`${inputClass} pl-10`} value={country} onChange={e => setCountry(e.target.value)}>
                    <option value="US">United States</option>
                    <option value="GB">United Kingdom</option>
                    <option value="CA">Canada</option>
                    <option value="AU">Australia</option>
                    <option value="NG">Nigeria</option>
                    <option value="GH">Ghana</option>
                    <option value="KE">Kenya</option>
                    <option value="IN">India</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} type="password" placeholder="Password (min 8 characters)" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
              </>
            )}

            {/* Step 2 — Social & Audience */}
            {step === 2 && (
              <>
                <div className="relative">
                  <Twitter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} placeholder="Twitter/X handle (optional)" value={twitterHandle} onChange={e => setTwitterHandle(e.target.value)} />
                </div>
                <div className="relative">
                  <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} placeholder="Instagram handle (optional)" value={instagramHandle} onChange={e => setInstagramHandle(e.target.value)} />
                </div>
                <div className="relative">
                  <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} placeholder="LinkedIn URL (optional)" value={linkedInProfile} onChange={e => setLinkedInProfile(e.target.value)} />
                </div>
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10`} placeholder="Website URL (optional)" value={website} onChange={e => setWebsite(e.target.value)} />
                </div>
                <div className="relative">
                  <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <select className={`${inputClass} pl-10`} value={audienceNiche} onChange={e => setAudienceNiche(e.target.value)}>
                    {['Shopify Growth', 'eCommerce', 'SaaS', 'Marketing', 'Fintech', 'Creator Economy', 'Other'].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="relative">
                  <Info className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <select className={`${inputClass} pl-10`} value={audienceSize} onChange={e => setAudienceSize(e.target.value)}>
                    {['Under 1,000', '1,000 - 5,000', '5,000 - 10,000', '10,000 - 50,000', '50,000+'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* Step 3 — Commitment */}
            {step === 3 && (
              <>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Your affiliate experience</label>
                  <select className={inputClass} value={affiliateExperience} onChange={e => setAffiliateExperience(e.target.value)}>
                    <option>Beginner</option>
                    <option>Intermediate</option>
                    <option>Advanced</option>
                    <option>Expert</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Why do you want to join? (min 15 chars)</label>
                  <textarea
                    className={`${inputClass} resize-none h-28`}
                    placeholder="Tell us about your audience and how you plan to promote Revluma…"
                    value={whyJoin}
                    onChange={e => setWhyJoin(e.target.value)}
                  />
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={termsAgreement} onChange={e => setTermsAgreement(e.target.checked)} className="mt-0.5" />
                  <span className="text-xs text-zinc-400">
                    I agree to the <span className="text-violet-400">Partnership Terms & Conditions</span> and confirm my information is accurate.
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={marketingConsent} onChange={e => setMarketingConsent(e.target.checked)} className="mt-0.5" />
                  <span className="text-xs text-zinc-400">I consent to receiving partner updates and commission notifications.</span>
                </label>
              </>
            )}

            {/* Navigation buttons */}
            <div className="flex gap-3 pt-2">
              {step > 1 && (
                <button type="button" onClick={handlePrevStep} className={btnGhost}>
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
              )}
              {step < 3 ? (
                <button type="button" onClick={handleNextStep} className={btnPrimary}>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button type="button" disabled={isLoading} onClick={handleSignUpCompletion} className={btnPrimary}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {isLoading ? 'Submitting…' : 'Submit Application'}
                </button>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-zinc-500">
            Already have an account?{' '}
            <button onClick={() => { setAuthMode('login'); setErrorText(''); setSuccessText(''); }} className="text-violet-400 hover:underline">
              Log in
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ============================================================
  // Login (default)
  // ============================================================

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-lg bg-violet-600/20 border border-violet-600/30 flex items-center justify-center">
              <Shield className="w-5 h-5 text-violet-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Affiliate Partner Portal</h1>
          <p className="text-sm text-zinc-400">Sign in to your partner account</p>
        </div>

        <form onSubmit={handleLogin} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}

          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              className={`${inputClass} pl-10`}
              type="email"
              placeholder="Email address"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              className={`${inputClass} pl-10`}
              type="password"
              placeholder="Password"
              value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div className="text-right">
            <button
              type="button"
              onClick={() => { setAuthMode('forgot'); setErrorText(''); setSuccessText(''); }}
              className="text-xs text-zinc-500 hover:text-violet-400 transition"
            >
              Forgot password?
            </button>
          </div>

          <button type="submit" disabled={isLoading} className={btnPrimary}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {isLoading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-zinc-500">
          Don't have an account?{' '}
          <button onClick={() => { setAuthMode('register'); setErrorText(''); setSuccessText(''); setStep(1); }} className="text-violet-400 hover:underline">
            Apply to join
          </button>
        </p>
        <p className="text-center text-xs text-zinc-600">
          <button onClick={onBackToLanding} className="hover:text-zinc-400 transition">← Back to site</button>
        </p>
      </div>
    </div>
  );
}
