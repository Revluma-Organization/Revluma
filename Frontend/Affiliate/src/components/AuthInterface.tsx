/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthInterface — production-grade auth component.
 *
 * PHASE 9 CHANGES:
 * - Receives `initialMode` from App (derived from URL) — never manages its own route
 * - Calls `onRouteChange` on EVERY screen transition so App can push the correct URL
 * - Hardened signup: confirm password, password strength meter, rate-limit feedback,
 *   OTP auto-advance, channel count badge, debounced username check
 * - Revluma logo on Login and Signup screens
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, User, Mail, Lock, Phone, Globe, Twitter, Linkedin, Instagram,
  Layers, CheckSquare, Info, ChevronRight, ChevronLeft, Loader2, Link2,
  Send, CheckCircle2, AlertCircle, Eye, EyeOff, Youtube, Hash, Facebook,
  FileText, Users, RefreshCw, ArrowLeft
} from 'lucide-react';
import { PartnerProfile } from '../types';
import * as api from '../lib/api';
import revlumaLogo from '../assets/images/Revluma-logo.png';
import type { AuthMode } from '../App';

// ============================================================
// Types
// ============================================================

interface AuthInterfaceProps {
  onAuthSuccess: (profile: PartnerProfile) => void;
  onBackToLanding: () => void;
  /** Called whenever the user navigates to a different auth screen */
  onRouteChange: (mode: AuthMode) => void;
  initialMode?: AuthMode;
  currentUser?: PartnerProfile | null;
}

// ============================================================
// Helpers
// ============================================================

function convertBackendTierToDisplay(backendTier: unknown): PartnerProfile['tier'] {
  const tier = (backendTier as string)?.toUpperCase() ?? 'AFFILIATE';
  const tierMap: Record<string, PartnerProfile['tier']> = {
    'AFFILIATE': 'Affiliate', 'GROWTH': 'Growth',
    'ELITE': 'Elite', 'FOUNDING_AMBASSADOR': 'Founding Ambassador'
  };
  return tierMap[tier] ?? 'Affiliate';
}

function buildPartnerProfile(serverUser: {
  id: string; email: string; full_name: string; role: string;
}, profile?: Record<string, unknown>): PartnerProfile {
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
// Password strength
// ============================================================

type StrengthLevel = 0 | 1 | 2 | 3 | 4;

function getPasswordStrength(pwd: string): StrengthLevel {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return Math.min(4, score) as StrengthLevel;
}

const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const strengthColors = ['', 'bg-red-500', 'bg-amber-500', 'bg-yellow-400', 'bg-emerald-500'];
const strengthTextColors = ['', 'text-red-400', 'text-amber-400', 'text-yellow-400', 'text-emerald-400'];

// ============================================================
// OTP Input component
// ============================================================

function OTPInput({ value, onChange, length = 6 }: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
}) {
  const refs = Array.from({ length }, () => useRef<HTMLInputElement>(null));

  const digits = value.padEnd(length, '').split('').slice(0, length);

  const handleChange = (idx: number, char: string) => {
    const digit = char.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = digit;
    const newVal = next.join('').replace(/ /g, '');
    onChange(newVal);
    if (digit && idx < length - 1) {
      refs[idx + 1].current?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
      const next = [...digits];
      next[idx - 1] = '';
      onChange(next.join('').replace(/ /g, ''));
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, length - 1);
    refs[focusIdx].current?.focus();
    e.preventDefault();
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {digits.map((d, idx) => (
        <input
          key={idx}
          ref={refs[idx]}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d === ' ' ? '' : d}
          onChange={e => handleChange(idx, e.target.value)}
          onKeyDown={e => handleKeyDown(idx, e)}
          className="w-11 h-12 text-center text-lg font-mono font-bold bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-lg focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition caret-transparent"
          autoComplete="one-time-code"
        />
      ))}
    </div>
  );
}

// ============================================================
// Component
// ============================================================

export default function AuthInterface({
  onAuthSuccess,
  onBackToLanding,
  onRouteChange,
  initialMode = 'login',
}: AuthInterfaceProps) {

  const [authMode, setAuthModeInternal] = useState<AuthMode>(initialMode);
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');
  const [rateLimited, setRateLimited] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  // Keep mode in sync when App pushes a new URL (e.g. browser back)
  useEffect(() => {
    if (initialMode !== authMode) {
      setAuthModeInternal(initialMode);
      setErrorText('');
      setSuccessText('');
    }
  }, [initialMode]);

  // Rate-limit countdown
  useEffect(() => {
    if (rateLimitCountdown <= 0) { setRateLimited(false); return; }
    const t = setTimeout(() => setRateLimitCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [rateLimitCountdown]);

  // ---- Pending state ----
  const [pendingUserId, setPendingUserId] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [pendingRegistrationId, setPendingRegistrationId] = useState('');
  const [accessToken, setAccessToken] = useState('');

  // ---- Registration fields ----
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [country, setCountry] = useState('NG');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
  const [youtubeChannel, setYoutubeChannel] = useState('');
  const [tiktokHandle, setTiktokHandle] = useState('');
  const [facebookProfile, setFacebookProfile] = useState('');
  const [newsletterUrl, setNewsletterUrl] = useState('');
  const [communityUrl, setCommunityUrl] = useState('');

  // ---- Login fields ----
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // ---- Forgot password fields ----
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // ============================================================
  // Mode changer — always notifies App for URL sync
  // ============================================================

  const goToMode = useCallback((mode: AuthMode) => {
    setAuthModeInternal(mode);
    setErrorText('');
    setSuccessText('');
    onRouteChange(mode);
  }, [onRouteChange]);

  // ============================================================
  // Debounced username availability check
  // ============================================================

  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (username.length < 3) { setUsernameAvailable(null); return; }
    if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current);
    usernameDebounceRef.current = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const RAW_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? '';
        const API_BASE = RAW_BASE ? RAW_BASE.replace(/\/$/, '') : `${window.location.origin}/api`;
        const res = await fetch(`${API_BASE}/affiliate-auth/check-username?username=${encodeURIComponent(username)}`, {
          headers: { 'X-Affiliate-Portal': 'true' }
        });
        if (res.ok) {
          const data = await res.json() as { available: boolean };
          setUsernameAvailable(data.available);
        } else {
          setUsernameAvailable(null);
        }
      } catch {
        setUsernameAvailable(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);
  }, [username]);

  // ============================================================
  // Channel count
  // ============================================================

  const channelCount = [
    twitterHandle, instagramHandle, linkedInProfile,
    youtubeChannel, tiktokHandle, facebookProfile, website,
    newsletterUrl, communityUrl
  ].filter(c => c.trim().length > 0).length;

  // ============================================================
  // Validation
  // ============================================================

  const pwdStrength = getPasswordStrength(password);

  const validateStep1 = (): string | null => {
    if (!fullName.trim() || fullName.trim().split(' ').length < 2)
      return 'Please enter your first and last name.';
    if (!username.trim() || username.length < 3)
      return 'Username must be at least 3 characters.';
    if (usernameAvailable === false)
      return 'That username is already taken. Please choose another.';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return 'Enter a valid email address.';
    if (!phoneNumber.trim())
      return 'Phone number is required.';
    if (!password || password.length < 8)
      return 'Password must be at least 8 characters.';
    if (pwdStrength < 2)
      return 'Password is too weak. Add uppercase, numbers, or symbols.';
    if (password !== confirmPassword)
      return 'Passwords do not match.';
    return null;
  };

  const validateStep2 = (): string | null => {
    if (channelCount < 2)
      return `At least 2 distribution channels are required (you've provided ${channelCount}).`;
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

  const handlePrevStep = () => { setErrorText(''); setStep(p => p - 1); };

  function clearForm() {
    setFullName(''); setUsername(''); setEmail(''); setPhoneNumber('');
    setCountry('NG'); setPassword(''); setConfirmPassword('');
    setTwitterHandle(''); setInstagramHandle('');
    setLinkedInProfile(''); setWebsite(''); setAudienceNiche('Shopify Growth');
    setAudienceSize('5,000 - 10,000'); setAffiliateExperience('Intermediate');
    setWhyJoin(''); setTermsAgreement(false); setMarketingConsent(false);
    setYoutubeChannel(''); setTiktokHandle(''); setFacebookProfile('');
    setNewsletterUrl(''); setCommunityUrl('');
    setStep(1);
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

    if (rateLimited) {
      setErrorText(`Too many attempts. Please wait ${rateLimitCountdown}s before trying again.`);
      return;
    }

    setIsLoading(true);

    try {
      const { user } = await api.login(loginEmail, loginPassword);

      let profile: Record<string, unknown> | undefined;
      try {
        const profileRes = await api.getProfile();
        profile = profileRes.profile as Record<string, unknown>;
      } catch { /* no profile yet */ }

      const status = (profile?.status as string ?? '').toLowerCase();

      if (status === 'rejected') {
        onAuthSuccess(buildPartnerProfile(user, profile));
        return;
      }

      if (status === 'pending_email_verification') {
        setPendingEmail(loginEmail);
        setPendingUserId(user.id);
        goToMode('verifyEmail');
        setIsLoading(false);
        return;
      }

      if (status === 'pending_access_token') {
        goToMode('accessToken');
        setIsLoading(false);
        return;
      }

      if (status === 'pending' || status === 'pending_review') {
        setPendingEmail(loginEmail);
        setPendingUserId(user.id);
        goToMode('pendingApproval');
        setIsLoading(false);
        return;
      }

      onAuthSuccess(buildPartnerProfile(user, profile));
    } catch (err: unknown) {
      const errObj = err as { status?: number; body?: { error?: string; retryAfter?: number } };
      if (errObj?.status === 429) {
        const wait = errObj.body?.retryAfter ?? 60;
        setRateLimited(true);
        setRateLimitCountdown(wait);
        setErrorText(`Too many login attempts. Please wait ${wait} seconds.`);
      } else {
        const message = errObj?.body?.error
          ?? (err instanceof Error ? err.message : 'Login failed. Please try again.');
        setErrorText(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Register
  // ============================================================

  const handleSignUpCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateStep3();
    if (err) { setErrorText(err); return; }

    if (channelCount < 2) {
      setErrorText('Please provide at least 2 distribution channels.');
      return;
    }

    setIsLoading(true);
    try {
      const nameParts = fullName.trim().split(/\s+/);
      const result = await api.affiliateRegister({
        email: email.toLowerCase().trim(),
        password,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' ') || nameParts[0],
        username: username.toLowerCase().trim(),
        phoneNumber, country,
        twitterHandle: twitterHandle || undefined,
        instagramHandle: instagramHandle || undefined,
        linkedinProfile: linkedInProfile || undefined,
        youtubeChannel: youtubeChannel || undefined,
        tiktokHandle: tiktokHandle || undefined,
        facebookProfile: facebookProfile || undefined,
        website: website || undefined,
        newsletterUrl: newsletterUrl || undefined,
        communityUrl: communityUrl || undefined,
        audienceNiche, audienceSize, affiliateExperience, whyJoin,
      });
      setPendingRegistrationId(result.pendingRegistrationId);
      setPendingEmail(email.toLowerCase().trim());
      setSuccessText(`Verification code sent to ${email}.`);
      clearForm();
      goToMode('verifyEmail');
    } catch (err: unknown) {
      const errObj = err as { status?: number; body?: { error?: string } };
      if (errObj?.status === 429) {
        setErrorText('Too many registration attempts. Please try again later.');
      } else if (errObj?.status === 409) {
        setErrorText('An account with this email or username already exists.');
      } else {
        setErrorText((err instanceof Error ? err.message : 'Registration failed. Please try again.'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Email verification
  // ============================================================

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = verifyCode.trim();
    if (code.length < 6) { setErrorText('Enter the complete 6-digit code.'); return; }
    setIsLoading(true);
    try {
      await api.affiliateVerifyEmail({ pendingRegistrationId, code });
      setSuccessText('Email verified! Please enter your RAPP Access Token.');
      goToMode('accessToken');
    } catch (err: unknown) {
      const errObj = err as { status?: number; body?: { error?: string } };
      if (errObj?.status === 410) {
        setErrorText('This code has expired. Please request a new one.');
      } else if (errObj?.status === 400) {
        setErrorText('Invalid code. Please check and try again.');
      } else {
        setErrorText(err instanceof Error ? err.message : 'Verification failed.');
      }
    } finally { setIsLoading(false); }
  };

  // Auto-submit when all 6 digits are entered
  useEffect(() => {
    if (verifyCode.length === 6 && authMode === 'verifyEmail') {
      handleVerifyEmail({ preventDefault: () => {} } as React.FormEvent);
    }
  }, [verifyCode]);

  const handleResendVerificationCode = async () => {
    setErrorText('');
    setSuccessText('');
    setIsLoading(true);
    try {
      const RAW_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? '';
      const API_BASE = RAW_BASE ? RAW_BASE.replace(/\/$/, '') : `${window.location.origin}/api`;
      await fetch(`${API_BASE}/affiliate-auth/resend-verification`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Affiliate-Portal': 'true' },
        body: JSON.stringify({ pendingRegistrationId, email: pendingEmail })
      });
      setSuccessText(`A new code has been sent to ${pendingEmail}.`);
      setVerifyCode('');
    } catch {
      setErrorText('Failed to resend code. Please try again.');
    } finally { setIsLoading(false); }
  };

  const handleAccessToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken.trim()) { setErrorText('Access token is required.'); return; }
    setIsLoading(true);
    try {
      await api.affiliateValidateToken({ pendingRegistrationId, token: accessToken.trim() });
      await api.affiliateCompleteRegistration({ pendingRegistrationId });
      setSuccessText('Application submitted for review.');
      goToMode('pendingApproval');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid token.';
      if (
        msg.includes('INVALID_ACCESS_TOKEN') || msg.includes('TOKEN_INACTIVE') ||
        msg.includes('TOKEN_EXPIRED') || msg.includes('TOKEN_MAX_USES_EXCEEDED')
      ) {
        setErrorText('This access token is invalid, expired, or has already been used.');
      } else {
        setErrorText(msg);
      }
    } finally { setIsLoading(false); }
  };

  // ============================================================
  // Forgot / reset password
  // ============================================================

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');
    if (!forgotEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) {
      setErrorText('Enter a valid email address.');
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
      setSuccessText('If that email is registered, a reset code has been sent.');
      // Note: forgot/resetConfirm remain on /affiliate/login URL (no dedicated route needed)
      setAuthModeInternal('resetConfirm');
    } catch {
      setSuccessText('If that email is registered, a reset code has been sent.');
      setAuthModeInternal('resetConfirm');
    } finally { setIsLoading(false); }
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
      setSuccessText('Password reset successfully. Please sign in.');
      goToMode('login');
      setResetToken(''); setResetCode(''); setNewPassword('');
    } catch (err: unknown) {
      setErrorText(err instanceof Error ? err.message : 'Reset failed. Please try again.');
    } finally { setIsLoading(false); }
  };

  // ============================================================
  // Render helpers
  // ============================================================

  const renderAlert = (text: string, type: 'error' | 'success') =>
    text ? (
      <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${type === 'error'
        ? 'bg-red-500/10 border border-red-500/30 text-red-400'
        : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
      }`}>
        {type === 'error'
          ? <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
        <span>{text}</span>
      </div>
    ) : null;

  const inputClass =
    'w-full bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition';

  const btnPrimary =
    'w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 active:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-all';

  const btnGhost =
    'w-full flex items-center justify-center gap-2 border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 font-medium rounded-lg px-4 py-2.5 text-sm transition-all';

  // Shared logo header
  const LogoHeader = ({ subtitle }: { subtitle: string }) => (
    <div className="text-center space-y-2 mb-2">
      <div className="flex items-center justify-center mb-3">
        <img src={revlumaLogo} alt="Revluma" className="h-9 w-auto" />
      </div>
      <p className="text-sm text-zinc-400">{subtitle}</p>
    </div>
  );

  // Shared card wrapper
  const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 ${className}`}>
      {children}
    </div>
  );

  const PageWrap = ({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) => (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12">
      <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'} space-y-5`}>
        {children}
      </div>
    </div>
  );

  // ============================================================
  // SCREENS
  // ============================================================

  // --- Rejected ---
  if (authMode === 'rejected') {
    return (
      <PageWrap>
        <LogoHeader subtitle="Affiliate Partner Portal" />
        <Card>
          <div className="flex flex-col items-center text-center space-y-3 py-2">
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100">Application Declined</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Unfortunately your affiliate application was not approved at this time.
              If you believe this is an error, please reach out to our support team.
            </p>
            <a href="mailto:support@revluma.app" className="text-sm text-violet-400 hover:underline">
              Contact Support →
            </a>
          </div>
          <button onClick={() => goToMode('login')} className={btnGhost}>
            <ArrowLeft className="w-4 h-4" />
            Back to Login
          </button>
        </Card>
      </PageWrap>
    );
  }

  // --- Pending approval ---
  if (authMode === 'pendingApproval') {
    return (
      <PageWrap>
        <LogoHeader subtitle="Affiliate Partner Portal" />
        <Card>
          <div className="flex flex-col items-center text-center space-y-3 py-2">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100">Application Under Review</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Your affiliate application has been submitted and is pending admin review.
              You'll receive an email notification once a decision has been made.
            </p>
            {pendingEmail && (
              <p className="text-xs text-zinc-500 bg-zinc-800 px-3 py-1.5 rounded-md">
                📧 {pendingEmail}
              </p>
            )}
          </div>
          <button onClick={() => goToMode('login')} className={btnGhost}>
            <ArrowLeft className="w-4 h-4" />
            Back to Login
          </button>
        </Card>
      </PageWrap>
    );
  }

  // --- Email verification ---
  if (authMode === 'verifyEmail') {
    return (
      <PageWrap>
        <LogoHeader subtitle="Verify Your Email" />
        <div className="text-center -mt-2">
          <p className="text-sm text-zinc-400">
            We sent a 6-digit code to{' '}
            <span className="text-violet-400 font-medium">{pendingEmail}</span>
          </p>
        </div>
        <Card>
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}

          <OTPInput value={verifyCode} onChange={setVerifyCode} />

          <button
            type="button"
            disabled={isLoading || verifyCode.length < 6}
            onClick={handleVerifyEmail}
            className={btnPrimary}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
            {isLoading ? 'Verifying…' : 'Verify Email'}
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={handleResendVerificationCode}
            className={btnGhost}
          >
            <RefreshCw className="w-4 h-4" />
            Resend Code
          </button>
        </Card>
        <p className="text-center text-xs text-zinc-500">
          Already verified?{' '}
          <button onClick={() => goToMode('login')} className="text-violet-400 hover:underline">
            Log in
          </button>
        </p>
      </PageWrap>
    );
  }

  // --- Access token ---
  if (authMode === 'accessToken') {
    return (
      <PageWrap>
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-violet-500/10 border border-violet-500/30 flex items-center justify-center mb-3">
            <Shield className="w-7 h-7 text-violet-400" />
          </div>
          <h1 className="text-xl font-bold text-zinc-100">RAPP Access Token</h1>
          <p className="text-sm text-zinc-400 max-w-sm mx-auto">
            Enter your Revluma Affiliate Partnership Program access token to proceed.
          </p>
        </div>
        <Card>
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}
          <div className="space-y-1">
            <label className="text-xs text-zinc-500 uppercase tracking-widest">Access Token</label>
            <input
              className={inputClass}
              placeholder="xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx"
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-zinc-600">Format: dklfnwe9-njS37DSD-SNKL23Y-SNWG3SWE4</p>
          </div>
          <button
            type="button"
            disabled={isLoading || !accessToken.trim()}
            onClick={handleAccessToken}
            className={btnPrimary}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {isLoading ? 'Validating…' : 'Submit Application'}
          </button>
        </Card>
        <p className="text-center text-xs text-zinc-500">
          Don't have a token?{' '}
          <a href="mailto:support@revluma.app" className="text-violet-400 hover:underline">Contact us</a>
        </p>
      </PageWrap>
    );
  }

  // --- Forgot password ---
  if (authMode === 'forgot') {
    return (
      <PageWrap>
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-zinc-100">Reset Password</h1>
          <p className="text-sm text-zinc-400">Enter the email you registered with.</p>
        </div>
        <Card>
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}
          <form onSubmit={handleForgotPassword} className="space-y-4">
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
            <button type="button" onClick={() => goToMode('login')} className={btnGhost}>
              <ChevronLeft className="w-4 h-4" />
              Back to Login
            </button>
          </form>
        </Card>
      </PageWrap>
    );
  }

  // --- Reset confirm ---
  if (authMode === 'resetConfirm') {
    return (
      <PageWrap>
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-zinc-100">Enter Reset Code</h1>
          <p className="text-sm text-zinc-400">Check your email for the 6-digit code.</p>
        </div>
        <Card>
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}
          <form onSubmit={handleConfirmReset} className="space-y-4">
            <OTPInput value={resetCode} onChange={setResetCode} />
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                className={`${inputClass} pl-10 pr-10`}
                type={showNewPassword ? 'text' : 'password'}
                placeholder="New password (min 8 characters)"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowNewPassword(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button type="submit" disabled={isLoading} className={btnPrimary}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isLoading ? 'Resetting…' : 'Reset Password'}
            </button>
            <button type="button" onClick={() => goToMode('login')} className={btnGhost}>
              <ChevronLeft className="w-4 h-4" />
              Back to Login
            </button>
          </form>
        </Card>
      </PageWrap>
    );
  }

  // ============================================================
  // Register — hardened 3-step form
  // ============================================================

  if (authMode === 'register') {
    return (
      <PageWrap wide>
        {/* Header with logo */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center mb-2">
            <img src={revlumaLogo} alt="Revluma" className="h-9 w-auto" />
          </div>
          <h1 className="text-xl font-bold text-zinc-100">Apply to the Revluma Affiliate Partnership Programme</h1>
          <p className="text-sm text-zinc-400">Step {step} of 3 — {
            step === 1 ? 'Personal Details' : step === 2 ? 'Channels & Audience' : 'Commitment'
          }</p>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5">
          {[1, 2, 3].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-500 ${s < step ? 'bg-violet-500' : s === step ? 'bg-violet-400' : 'bg-zinc-800'}`} />
          ))}
        </div>

        <Card>
          {renderAlert(errorText, 'error')}

          {/* Step 1 — Personal & Credentials */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="Full name (first & last)"
                  value={fullName} onChange={e => setFullName(e.target.value)} />
              </div>

              {/* Username with availability indicator */}
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10 pr-10`} placeholder="Username (min 3 chars)"
                  value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs">
                  {checkingUsername && <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />}
                  {!checkingUsername && usernameAvailable === true && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {!checkingUsername && usernameAvailable === false && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                </span>
              </div>
              {usernameAvailable === false && (
                <p className="text-xs text-red-400 -mt-1">Username taken</p>
              )}
              {usernameAvailable === true && (
                <p className="text-xs text-emerald-400 -mt-1">Username available</p>
              )}

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} type="email" placeholder="Email address"
                  value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
              </div>

              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="Phone number (with country code)"
                  value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} />
              </div>

              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <select className={`${inputClass} pl-10`} value={country} onChange={e => setCountry(e.target.value)}>
                  <option value="NG">Nigeria</option>
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="CA">Canada</option>
                  <option value="AU">Australia</option>
                  <option value="GH">Ghana</option>
                  <option value="KE">Kenya</option>
                  <option value="IN">India</option>
                  <option value="ZA">South Africa</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              {/* Password with strength meter */}
              <div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-10 pr-10`}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password (min 8 characters)"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= pwdStrength ? strengthColors[pwdStrength] : 'bg-zinc-800'}`} />
                      ))}
                    </div>
                    <p className={`text-xs ${strengthTextColors[pwdStrength]}`}>
                      {strengthLabels[pwdStrength]}
                      {pwdStrength < 3 && <span className="text-zinc-600"> — add uppercase, numbers, symbols</span>}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10 pr-10`}
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowConfirmPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-400 -mt-1">Passwords do not match</p>
              )}
              {confirmPassword && password === confirmPassword && password.length >= 8 && (
                <p className="text-xs text-emerald-400 -mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Passwords match
                </p>
              )}
            </div>
          )}

          {/* Step 2 — Social & Audience */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-zinc-400">Distribution channels</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${channelCount >= 2 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {channelCount}/2 min
                </span>
              </div>

              <div className="relative">
                <Twitter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="Twitter/X handle"
                  value={twitterHandle} onChange={e => setTwitterHandle(e.target.value)} />
              </div>
              <div className="relative">
                <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="Instagram handle"
                  value={instagramHandle} onChange={e => setInstagramHandle(e.target.value)} />
              </div>
              <div className="relative">
                <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="LinkedIn URL"
                  value={linkedInProfile} onChange={e => setLinkedInProfile(e.target.value)} />
              </div>
              <div className="relative">
                <Youtube className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="YouTube channel URL"
                  value={youtubeChannel} onChange={e => setYoutubeChannel(e.target.value)} />
              </div>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="TikTok handle"
                  value={tiktokHandle} onChange={e => setTiktokHandle(e.target.value)} />
              </div>
              <div className="relative">
                <Facebook className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="Facebook profile URL"
                  value={facebookProfile} onChange={e => setFacebookProfile(e.target.value)} />
              </div>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="Website URL"
                  value={website} onChange={e => setWebsite(e.target.value)} />
              </div>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="Newsletter URL"
                  value={newsletterUrl} onChange={e => setNewsletterUrl(e.target.value)} />
              </div>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-10`} placeholder="Community URL (Discord, Slack, etc.)"
                  value={communityUrl} onChange={e => setCommunityUrl(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
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
              </div>
            </div>
          )}

          {/* Step 3 — Commitment */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Your affiliate experience</label>
                <select className={inputClass} value={affiliateExperience} onChange={e => setAffiliateExperience(e.target.value)}>
                  {['Beginner', 'Intermediate', 'Advanced', 'Expert'].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Why do you want to join?
                  <span className={`ml-1 ${whyJoin.length < 15 ? 'text-zinc-600' : 'text-emerald-500'}`}>
                    ({whyJoin.length} chars)
                  </span>
                </label>
                <textarea
                  className={`${inputClass} resize-none h-28`}
                  placeholder="Tell us about your audience and how you plan to promote Revluma…"
                  value={whyJoin}
                  onChange={e => setWhyJoin(e.target.value)}
                />
              </div>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input type="checkbox" checked={termsAgreement} onChange={e => setTermsAgreement(e.target.checked)}
                  className="mt-0.5 accent-violet-500" />
                <span className="text-xs text-zinc-400 group-hover:text-zinc-300 transition">
                  I agree to the <span className="text-violet-400">Partnership Terms & Conditions</span> and confirm my information is accurate.
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input type="checkbox" checked={marketingConsent} onChange={e => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 accent-violet-500" />
                <span className="text-xs text-zinc-400 group-hover:text-zinc-300 transition">
                  I consent to receiving partner updates and commission notifications.
                </span>
              </label>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-1">
            {step > 1 && (
              <button type="button" onClick={handlePrevStep} className={btnGhost}>
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            )}
            {step < 3 ? (
              <button type="button" onClick={handleNextStep} className={btnPrimary}>
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" disabled={isLoading} onClick={handleSignUpCompletion} className={btnPrimary}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {isLoading ? 'Submitting…' : 'Submit Application'}
              </button>
            )}
          </div>
        </Card>

        <p className="text-center text-xs text-zinc-500">
          Already have an account?{' '}
          <button onClick={() => goToMode('login')} className="text-violet-400 hover:underline">Log in</button>
        </p>
      </PageWrap>
    );
  }

  // ============================================================
  // Login (default)
  // ============================================================

  return (
    <PageWrap>
      <LogoHeader subtitle="Sign in to your partner account" />

      <Card>
        {renderAlert(errorText, 'error')}
        {renderAlert(successText, 'success')}

        <form onSubmit={handleLogin} className="space-y-4">
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
              className={`${inputClass} pl-10 pr-10`}
              type={showLoginPassword ? 'text' : 'password'}
              placeholder="Password"
              value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button type="button" onClick={() => setShowLoginPassword(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition">
              {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="text-right -mt-1">
            <button type="button"
              onClick={() => { setAuthModeInternal('forgot'); setErrorText(''); setSuccessText(''); }}
              className="text-xs text-zinc-500 hover:text-violet-400 transition">
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={isLoading || rateLimited}
            className={btnPrimary}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {isLoading ? 'Signing in…' : rateLimited ? `Retry in ${rateLimitCountdown}s` : 'Sign In'}
          </button>
        </form>
      </Card>

      <p className="text-center text-xs text-zinc-500">
        Don't have an account?{' '}
        <button onClick={() => goToMode('register')} className="text-violet-400 hover:underline">
          Apply to join
        </button>
      </p>
      <p className="text-center text-xs text-zinc-600">
        <button onClick={onBackToLanding} className="hover:text-zinc-400 transition">← Back to site</button>
      </p>
    </PageWrap>
  );
}