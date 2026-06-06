import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, User, Mail, Lock, Phone, Globe, Twitter, Linkedin, Instagram,
  Layers, CheckSquare, Info, ChevronRight, ChevronLeft, Loader2, Link2,
  Send, CheckCircle2, AlertCircle, Eye, EyeOff, Youtube, Hash, Facebook,
  FileText, Users, RefreshCw, ArrowLeft, X, Clock, AlertTriangle, ExternalLink
} from 'lucide-react';
import { PartnerProfile } from '../types';
import * as api from '../lib/api';
import revlumaLogo from '../assets/images/Revluma-logo.png';
import type { AuthMode } from '../App';

interface AuthInterfaceProps {
  onAuthSuccess: (profile: PartnerProfile) => void;
  onBackToLanding: () => void;
  onRouteChange: (mode: AuthMode) => void;
  initialMode?: AuthMode;
  currentUser?: PartnerProfile | null;
}

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

const SOCIAL_PLATFORMS = [
  { key: 'twitterHandle', icon: Twitter, label: 'X (Twitter)', placeholder: '@username' },
  { key: 'instagramHandle', icon: Instagram, label: 'Instagram', placeholder: '@username' },
  { key: 'linkedInProfile', icon: Linkedin, label: 'LinkedIn', placeholder: 'Profile URL' },
  { key: 'youtubeChannel', icon: Youtube, label: 'YouTube', placeholder: 'Channel URL' },
  { key: 'tiktokHandle', icon: Hash, label: 'TikTok', placeholder: '@username' },
  { key: 'facebookProfile', icon: Facebook, label: 'Facebook', placeholder: 'Profile URL' },
  { key: 'website', icon: ExternalLink, label: 'Website', placeholder: 'https://...' },
  { key: 'newsletterUrl', icon: FileText, label: 'Newsletter', placeholder: 'Substack, Beehiiv, etc.' },
  { key: 'communityUrl', icon: Users, label: 'Community', placeholder: 'Discord, Slack, etc.' },
] as const;

function OTPInput({ value, onChange, length = 6 }: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const digits = value.padEnd(length, '').split('').slice(0, length);

  const handleChange = (idx: number, char: string) => {
    const digit = char.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = digit;
    const newVal = next.join('').replace(/ /g, '');
    onChange(newVal);
    if (digit && idx < length - 1) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
      const next = [...digits];
      next[idx - 1] = '';
      onChange(next.join('').replace(/ /g, ''));
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, length - 1);
    inputRefs.current[focusIdx]?.focus();
    e.preventDefault();
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {digits.map((d, idx) => (
        <input
          key={idx}
          ref={el => { inputRefs.current[idx] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d === ' ' ? '' : d}
          onChange={e => handleChange(idx, e.target.value)}
          onKeyDown={e => handleKeyDown(idx, e)}
          className="w-12 h-14 text-center text-xl font-mono font-bold bg-zinc-900 border-2 border-zinc-700 text-zinc-100 rounded-xl focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all duration-150 caret-transparent hover:border-zinc-500"
          autoComplete="one-time-code"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components defined OUTSIDE the main component so React never treats
// them as new component types on re-render. Defining them inside the parent
// causes remounting on every keystroke (new function reference = new type),
// which destroys input focus after each character typed.
// ---------------------------------------------------------------------------

const inputClass =
  'w-full bg-zinc-900/80 border border-zinc-700/80 text-zinc-100 placeholder-zinc-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all duration-150 hover:border-zinc-500';

const btnPrimary =
  'w-full flex items-center justify-center gap-2.5 bg-violet-600 hover:bg-violet-500 active:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-5 py-3 text-sm transition-all duration-150 shadow-lg shadow-violet-500/10 hover:shadow-violet-500/20';

const btnSecondary =
  'w-full flex items-center justify-center gap-2.5 border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 font-medium rounded-xl px-5 py-3 text-sm transition-all duration-150';

function LogoHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="text-center space-y-3 mb-2">
      <div className="flex items-center justify-center mb-2">
        <img src={revlumaLogo} alt="Revluma" className="h-10 w-auto" />
      </div>
      <p className="text-sm text-zinc-500">{subtitle}</p>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900/60 backdrop-blur-sm border border-zinc-800/80 rounded-2xl p-6 md:p-8 space-y-5 shadow-xl ${className}`}>
      {children}
    </div>
  );
}

function PageWrap({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 flex flex-col items-center justify-center px-4 py-12">
      <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'} space-y-6`}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

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
  const [backendReady, setBackendReady] = useState(false);

  // Attempt backend warmup on mount. Once the health endpoint responds we
  // consider the backend ready and allow registration submissions to proceed
  // immediately. If it isn't ready yet we check again right before submit.
  // FIX: Increased to 6 attempts with 15s timeout each to handle Render cold starts (~30-50s).
  useEffect(() => {
    let cancelled = false;
    async function warmUp(attempts = 6) {
      for (let i = 0; i < attempts; i++) {
        if (cancelled) return;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          const res = await fetch('/api/affiliate-auth/health', { signal: controller.signal });
          clearTimeout(timeout);
          if (res.ok) {
            console.log(`[WarmUp] Backend ready (attempt ${i + 1})`);
            if (!cancelled) setBackendReady(true);
            return;
          }
        } catch {
          console.log(`[WarmUp] Backend not ready (attempt ${i + 1})`);
        }
        if (i < attempts - 1) {
          const delay = Math.min(5000 + i * 3000, 15000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
      console.warn('[WarmUp] Backend did not respond after all attempts');
      if (!cancelled) setBackendReady(false);
    }
    warmUp();
    return () => { cancelled = true; };
  }, []);

  const [pendingUserId, setPendingUserId] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [pendingRegistrationId, setPendingRegistrationId] = useState('');

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameCheckError, setUsernameCheckError] = useState<string | null>(null);
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

  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [emailCheckError, setEmailCheckError] = useState<string | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const goToMode = useCallback((mode: AuthMode) => {
    setAuthModeInternal(mode);
    setErrorText('');
    setSuccessText('');
    if (mode !== 'forgot' && mode !== 'resetConfirm') {
      onRouteChange(mode);
    }
  }, [onRouteChange]);

  const latestCheckRef = useRef('');
  const latestEmailRef = useRef('');

  // Username availability check with debounce
  useEffect(() => {
    if (username.length < 3) {
      setUsernameAvailable(null);
      setUsernameCheckError(null);
      setCheckingUsername(false);
      return;
    }

    const timer = setTimeout(async () => {
      latestCheckRef.current = username;
      setCheckingUsername(true);
      setUsernameCheckError(null);
      try {
        console.log(`[UsernameCheck] Checking "${username}"...`);
        const data = await api.checkUsername(username);
        console.log(`[UsernameCheck] Done "${username}": available=${data.available}`);
        if (latestCheckRef.current === username) {
          setUsernameAvailable(data.available);
        }
      } catch (err: unknown) {
        if (latestCheckRef.current !== username) return;
        setUsernameAvailable(null);
        const e = err as { status?: number; message?: string; timedOut?: boolean };
        console.error(`[UsernameCheck] Error for "${username}":`, e?.message || err);
        if (e?.status === 429) {
          setUsernameCheckError('Rate limited — please wait');
        } else if (e?.timedOut) {
          setUsernameCheckError('Timed out — try again');
        } else if (e?.status === 400) {
          setUsernameCheckError('Invalid username format');
        } else {
          setUsernameCheckError('Could not verify — try again');
        }
      } finally {
        if (latestCheckRef.current === username) {
          setCheckingUsername(false);
        }
      }
    }, 400);

    return () => { clearTimeout(timer); };
  }, [username]);

  // Email availability check with debounce (only on register mode)
  useEffect(() => {
    if (authMode !== 'register' || email.length < 5 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailAvailable(null);
      setEmailCheckError(null);
      setCheckingEmail(false);
      return;
    }

    const timer = setTimeout(async () => {
      latestEmailRef.current = email;
      setCheckingEmail(true);
      setEmailCheckError(null);
      try {
        console.log(`[EmailCheck] Checking "${email}"...`);
        const data = await api.checkEmail(email);
        console.log(`[EmailCheck] Done "${email}": available=${data.available}`);
        if (latestEmailRef.current === email) {
          setEmailAvailable(data.available);
        }
      } catch (err: unknown) {
        if (latestEmailRef.current !== email) return;
        setEmailAvailable(null);
        const e = err as { status?: number; message?: string; timedOut?: boolean };
        console.error(`[EmailCheck] Error for "${email}":`, e?.message || err);
        if (e?.status === 429) {
          setEmailCheckError('Rate limited — please wait');
        } else if (e?.timedOut) {
          setEmailCheckError('Timed out — try again');
        } else {
          setEmailCheckError('Could not verify');
        }
      } finally {
        if (latestEmailRef.current === email) {
          setCheckingEmail(false);
        }
      }
    }, 500);

    return () => { clearTimeout(timer); };
  }, [email, authMode]);

  const socialFieldsMap: Record<string, string> = {
    twitterHandle, instagramHandle, linkedInProfile,
    youtubeChannel, tiktokHandle, facebookProfile, website,
    newsletterUrl, communityUrl
  };

  const channelCount = Object.values(socialFieldsMap).filter(c => c.trim().length > 0).length;

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
    if (emailAvailable === false)
      return 'This email is already registered. Please use a different email or log in.';
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
      return `At least 2 distribution channels are required (you've provided ${channelCount}). Add social channels like X (Twitter), Instagram, YouTube, LinkedIn, etc.`;
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
    setFullName(''); setUsername(''); setUsernameAvailable(null); setUsernameCheckError(null);
    setEmail(''); setEmailAvailable(null); setEmailCheckError(null); setPhoneNumber('');
    setTwitterHandle(''); setInstagramHandle('');
    setLinkedInProfile(''); setWebsite(''); setAudienceNiche('Shopify Growth');
    setAudienceSize('5,000 - 10,000'); setAffiliateExperience('Intermediate');
    setWhyJoin(''); setTermsAgreement(false); setMarketingConsent(false);
    setYoutubeChannel(''); setTiktokHandle(''); setFacebookProfile('');
    setNewsletterUrl(''); setCommunityUrl('');
    setStep(1);
  }

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
    console.log('[Login] Attempt', { email: loginEmail.toLowerCase().trim(), authMode });

    try {
      const { user } = await api.login(loginEmail, loginPassword);
      console.log('[Login] API success', { userId: user.id, email: user.email, role: user.role });

      let profile: Record<string, unknown> | undefined;
      try {
        const profileRes = await api.getProfile();
        profile = profileRes.profile as Record<string, unknown>;
        console.log('[Login] Profile fetched', { status: profile?.status });
      } catch (profileErr) {
        console.warn('[Login] Profile fetch failed, continuing without', profileErr);
      }

      const status = (profile?.status as string ?? '').toLowerCase();

      if (status === 'rejected') {
        console.log('[Login] User rejected');
        onAuthSuccess(buildPartnerProfile(user, profile));
        return;
      }

      if (status === 'pending_email_verification') {
        console.log('[Login] User needs email verification');
        setPendingEmail(loginEmail);
        setPendingUserId(user.id);
        goToMode('verifyEmail');
        setIsLoading(false);
        return;
      }

      if (status === 'pending' || status === 'pending_review') {
        console.log('[Login] User pending approval');
        setPendingEmail(loginEmail);
        setPendingUserId(user.id);
        goToMode('pendingApproval');
        setIsLoading(false);
        return;
      }

      console.log('[Login] Approved — navigating to dashboard');
      onAuthSuccess(buildPartnerProfile(user, profile));
    } catch (err: unknown) {
      const errObj = err as { status?: number; body?: { error?: string; retryAfter?: number } };
      console.error('[Login] FAILED', errObj);
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

  const handleSignUpCompletion = async (e?: React.FormEvent) => {
    e?.preventDefault();
    console.log('[Register] handleSignUpCompletion called', {
      step,
      channelCount,
      backendReady,
      rateLimited,
      rateLimitCountdown,
      hasFullName: !!fullName.trim(),
      hasUsername: !!username,
      usernameAvailable,
      emailAvailable,
      hasPassword: !!password,
      passwordsMatch: password === confirmPassword,
    });

    const err = validateStep3();
    if (err) {
      console.warn('[Register] Step 3 validation failed:', err);
      setErrorText(err);
      return;
    }
    console.log('[Register] Step 3 validation passed');

    if (channelCount < 2) {
      const msg = `Please provide at least 2 distribution channels. (found: ${channelCount})`;
      console.warn('[Register] Channel count check failed:', msg);
      setErrorText(msg);
      return;
    }
    console.log('[Register] Channel count OK:', channelCount);

    if (!backendReady) {
      console.warn('[Register] Backend not ready — will attempt anyway, may hit cold start');
      // FIX: Show an informational message so the user knows the server is waking up
      // rather than seeing a confusing timeout error immediately.
      setErrorText('The server is starting up (this can take ~30 seconds on first use). Submitting now — please wait...');
    }

    setIsLoading(true);
    if (backendReady) setErrorText('');
    console.log('[Register] Building payload...');

    try {
      const nameParts = fullName.trim().split(/\s+/);
      const payload = {
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
      };
      console.log('[Register] Payload built, calling api.affiliateRegister (timeout: 90s)...');

      let result;
      try {
        result = await api.affiliateRegister(payload);
        console.log('[Register] api.affiliateRegister RESPONSE:', result);
      } catch (firstErr: unknown) {
        const firstErrObj = firstErr as { timedOut?: boolean; status?: number; body?: { error?: string } };
        console.error('[Register] First attempt failed:', firstErrObj);

        if (firstErrObj?.timedOut) {
          console.warn('[Register] First attempt timed out — waiting 3s then auto-retrying once...');
          await new Promise(r => setTimeout(r, 3000));
          console.log('[Register] Retry attempt: calling api.affiliateRegister again...');
          try {
            result = await api.affiliateRegister(payload);
            console.log('[Register] Retry SUCCESS:', result);
          } catch (retryErr: unknown) {
            const retryErrObj = retryErr as { timedOut?: boolean; status?: number; body?: { error?: string } };
            console.error('[Register] Retry also failed:', retryErrObj);
            if (retryErrObj?.timedOut) {
              throw Object.assign(
                new Error('Backend did not respond within 90 seconds (2 attempts). The server may be cold-starting or unreachable.'),
                { timedOut: true, status: retryErrObj.status, body: retryErrObj.body }
              );
            }
            throw retryErr;
          }
        } else {
          throw firstErr;
        }
      }

      console.log('[Register] Setting state and navigating to verifyEmail');
      setPendingRegistrationId(result.pendingRegistrationId);
      setPendingEmail(email.toLowerCase().trim());
      setSuccessText(`Verification code sent to ${email}.`);
      clearForm();
      console.log('[Register] Navigating to verifyEmail mode');
      goToMode('verifyEmail');
    } catch (err: unknown) {
      const errObj = err as { status?: number; timedOut?: boolean; message?: string; body?: { error?: string } };
      console.error('[Register] FINAL ERROR:', errObj);
      if (errObj?.timedOut) {
        console.error('[Register] TIMEOUT detected in error handler');
        setErrorText('The server is taking too long to respond — it may be starting up. Please wait a moment and try submitting again.');
      } else if (errObj?.status === 429) {
        console.warn('[Register] RATE LIMITED');
        setErrorText('Too many registration attempts. Please try again later.');
      } else if (errObj?.status === 409) {
        console.warn('[Register] CONFLICT 409:', errObj.body?.error);
        setErrorText(errObj.body?.error || 'An account with this email or username already exists.');
      } else if (errObj?.body?.error) {
        console.error('[Register] Backend error response:', errObj.body.error);
        setErrorText(errObj.body.error);
      } else {
        console.error('[Register] Unknown error, falling back to message:', errObj.message);
        setErrorText(errObj?.message || 'Registration failed. Please try again.');
      }
    } finally {
      console.log('[Register] handleSignUpCompletion finished, setIsLoading(false)');
      setIsLoading(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = verifyCode.trim();
    if (code.length < 6) { setErrorText('Enter the complete 6-digit code.'); return; }
    setIsLoading(true);
    console.log('[VerifyEmail] Starting verification', { pendingRegistrationId, codeLength: code.length });
    try {
      console.log('[VerifyEmail] Step 1: Calling affiliateVerifyEmail...');
      const verifyResult = await api.affiliateVerifyEmail({ pendingRegistrationId, code });
      console.log('[VerifyEmail] Step 1 SUCCESS:', verifyResult);

      console.log('[VerifyEmail] Step 2: Calling affiliateCompleteRegistration...');
      const completeResult = await api.affiliateCompleteRegistration({ pendingRegistrationId });
      console.log('[VerifyEmail] Step 2 SUCCESS:', completeResult);

      if (completeResult.sessionEstablished) {
        console.log('[VerifyEmail] Step 3: Session auto-established');
      }

      if (completeResult.csrfToken) {
        sessionStorage.setItem('csrf_token', completeResult.csrfToken);
        console.log('[VerifyEmail] Step 3: CSRF token stored');
      }

      console.log('[VerifyEmail] Step 4: Calling /session/me...');
      const meData = await api.me();
      console.log('[VerifyEmail] Step 4 me SUCCESS:', { authenticated: meData.authenticated, hasUser: !!meData.user });

      if (meData.authenticated && meData.user) {
        try {
          console.log('[VerifyEmail] Step 5: Fetching profile...');
          const profileRes = await api.getProfile();
          console.log('[VerifyEmail] Step 5 profile SUCCESS:', { hasProfile: !!profileRes.profile });
          const profileData = profileRes.profile as Record<string, unknown>;
          const profile = buildPartnerProfile(meData.user, profileData);
          console.log('[VerifyEmail] All done — navigating to dashboard');
          onAuthSuccess(profile);
          return;
        } catch (profileErr) {
          console.error('[VerifyEmail] Step 5 profile FAILED, falling back to login:', profileErr);
        }
      }

      console.log('[VerifyEmail] Fallback: navigating to login');
      goToMode('login');
      setSuccessText('Your account is ready! Please log in.');
    } catch (err: unknown) {
      const errObj = err as { status?: number; body?: { error?: string }; message?: string };
      console.error('[VerifyEmail] FAILED', errObj);
      if (errObj?.status === 410) {
        setErrorText('This session has expired. Please register again.');
      } else if (errObj?.status === 400) {
        setErrorText(errObj?.body?.error || 'Invalid code. Please check and try again.');
      } else {
        setErrorText(errObj?.body?.error || errObj?.message || 'Verification failed.');
      }
    } finally { setIsLoading(false); }
  };

  useEffect(() => {
    if (verifyCode.length === 6 && authMode === 'verifyEmail') {
      handleVerifyEmail({ preventDefault: () => {} } as React.FormEvent);
    }
  }, [verifyCode]);

  const handleResendVerificationCode = async () => {
    setErrorText('');
    setSuccessText('');
    setIsLoading(true);
    console.log('[ResendCode] Requesting', { pendingRegistrationId, email: pendingEmail });
    try {
      const result = await api.affiliateResendVerification({ pendingRegistrationId, email: pendingEmail });
      console.log('[ResendCode] SUCCESS', result);
      setSuccessText(`A new code has been sent to ${pendingEmail}.`);
      setVerifyCode('');
    } catch (err: unknown) {
      const errObj = err as { status?: number; body?: { error?: string }; message?: string };
      console.error('[ResendCode] FAILED', errObj);
      setErrorText(errObj?.body?.error || errObj?.message || 'Failed to resend code. Please try again.');
    } finally { setIsLoading(false); }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');
    console.log('[ForgotPassword] Requesting', { email: forgotEmail.trim() });
    if (!forgotEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) {
      setErrorText('Enter a valid email address.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() })
      });
      const body = await res.json().catch(() => ({})) as { token?: string; error?: string };
      console.log('[ForgotPassword] Response', { status: res.status, hasToken: !!body.token, error: body.error });
      if (body.token) setResetToken(body.token);
      setSuccessText('If that email is registered, a reset code has been sent.');
      setAuthModeInternal('resetConfirm');
    } catch (err) {
      console.error('[ForgotPassword] Network error', err);
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
      const res = await fetch('/api/auth/reset-password', {
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

  const renderAlert = (text: string, type: 'error' | 'success') =>
    text ? (
      <div className={`flex items-start gap-3 p-4 rounded-xl text-sm backdrop-blur-sm ${
        type === 'error'
          ? 'bg-red-500/10 border border-red-500/25 text-red-300'
          : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'
      }`}>
        {type === 'error'
          ? <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-red-400" />
          : <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-emerald-400" />}
        <span className="leading-relaxed">{text}</span>
      </div>
    ) : null;

  if (authMode === 'rejected') {
    return (
      <PageWrap>
        <LogoHeader subtitle="Affiliate Partner Portal" />
        <Card>
          <div className="flex flex-col items-center text-center space-y-4 py-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100">Application Declined</h2>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">
              Unfortunately your affiliate application was not approved at this time.
              If you believe this is an error, please reach out to our support team.
            </p>
            <a href="mailto:support@revluma.app" className="text-sm text-violet-400 hover:text-violet-300 transition-colors font-medium">
              Contact Support →
            </a>
          </div>
          <button onClick={() => goToMode('login')} className={btnSecondary}>
            <ArrowLeft className="w-4 h-4" />
            Back to Login
          </button>
        </Card>
      </PageWrap>
    );
  }

  if (authMode === 'pendingApproval') {
    return (
      <PageWrap>
        <LogoHeader subtitle="Affiliate Partner Portal" />
        <Card>
          <div className="flex flex-col items-center text-center space-y-4 py-4">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Shield className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100">Application Under Review</h2>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">
              Your affiliate application has been submitted and is pending admin review.
              You'll receive an email notification once a decision has been made.
            </p>
            {pendingEmail && (
              <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/50 px-4 py-2 rounded-lg border border-zinc-700/50">
                <Mail className="w-3.5 h-3.5" />
                <span>{pendingEmail}</span>
              </div>
            )}
          </div>
          <button onClick={() => goToMode('login')} className={btnSecondary}>
            <ArrowLeft className="w-4 h-4" />
            Back to Login
          </button>
        </Card>
      </PageWrap>
    );
  }

  if (authMode === 'verifyEmail') {
    return (
      <PageWrap>
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center mb-1">
            <img src={revlumaLogo} alt="Revluma" className="h-10 w-auto" />
          </div>
          <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center">
            <Mail className="w-7 h-7 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Check your inbox</h1>
            <p className="text-sm text-zinc-400 mt-1">We sent a 6-digit code to</p>
            <p className="text-sm font-semibold text-violet-400 mt-0.5">{pendingEmail}</p>
          </div>
        </div>

        <Card>
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}

          {/* OTP input section */}
          <div className="text-center space-y-4">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">
              Enter verification code
            </p>
            <OTPInput value={verifyCode} onChange={setVerifyCode} />
            {verifyCode.length > 0 && verifyCode.length < 6 && (
              <p className="text-xs text-zinc-600">
                {6 - verifyCode.length} digit{6 - verifyCode.length !== 1 ? 's' : ''} remaining
              </p>
            )}
            {verifyCode.length === 6 && !isLoading && (
              <p className="text-xs text-violet-400 flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Code complete — verifying…
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={isLoading || verifyCode.length < 6}
            onClick={handleVerifyEmail}
            className={btnPrimary}
          >
            {isLoading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
              : <><CheckSquare className="w-4 h-4" /> Verify Email</>
            }
          </button>

          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-xs text-zinc-600">didn't receive it?</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={handleResendVerificationCode}
            className={btnSecondary}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Resend Code
          </button>
        </Card>

        <p className="text-center text-xs text-zinc-500">
          Already verified?{' '}
          <button onClick={() => goToMode('login')} className="text-violet-400 hover:underline font-medium">
            Log in
          </button>
        </p>
      </PageWrap>
    );
  }

  if (authMode === 'forgot') {
    return (
      <PageWrap>
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center mb-2">
            <Lock className="w-7 h-7 text-zinc-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Reset Password</h1>
          <p className="text-sm text-zinc-400">Enter the email you registered with.</p>
        </div>
        <Card>
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                className={`${inputClass} pl-11`}
                type="email"
                placeholder="Your email address"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <button type="submit" disabled={isLoading} className={btnPrimary}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isLoading ? 'Sending...' : 'Send Reset Code'}
            </button>
            <button type="button" onClick={() => goToMode('login')} className={btnSecondary}>
              <ChevronLeft className="w-4 h-4" />
              Back to Login
            </button>
          </form>
        </Card>
      </PageWrap>
    );
  }

  if (authMode === 'resetConfirm') {
    return (
      <PageWrap>
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center mb-2">
            <Lock className="w-7 h-7 text-zinc-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Enter Reset Code</h1>
          <p className="text-sm text-zinc-400">Check your email for the 6-digit code.</p>
        </div>
        <Card>
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}
          <form onSubmit={handleConfirmReset} className="space-y-5">
            <OTPInput value={resetCode} onChange={setResetCode} />
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                className={`${inputClass} pl-11 pr-11`}
                type={showNewPassword ? 'text' : 'password'}
                placeholder="New password (min 8 characters)"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowNewPassword(p => !p)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button type="submit" disabled={isLoading} className={btnPrimary}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </button>
            <button type="button" onClick={() => goToMode('login')} className={btnSecondary}>
              <ChevronLeft className="w-4 h-4" />
              Back to Login
            </button>
          </form>
        </Card>
      </PageWrap>
    );
  }

  if (authMode === 'register') {
    return (
      <PageWrap wide>
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center mb-2">
            <img src={revlumaLogo} alt="Revluma" className="h-10 w-auto" />
          </div>
          <h1 className="text-xl font-bold text-zinc-100">Apply to the Revluma Affiliate Partnership Program</h1>
          <p className="text-sm text-zinc-500">Step {step} of 3 — {
            step === 1 ? 'Personal Details' : step === 2 ? 'Channels & Audience' : 'Commitment'
          }</p>
        </div>

        <div className="flex gap-1.5">
          {[1, 2, 3].map(s => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
              s < step ? 'bg-violet-500' : s === step ? 'bg-violet-400' : 'bg-zinc-800'
            }`} />
          ))}
        </div>

        <Card>
          {renderAlert(errorText, 'error')}
          {renderAlert(successText, 'success')}

          {step === 1 && (
            <div className="space-y-4">
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-11`} placeholder="Full name (first & last)"
                  value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
              </div>

              <div className="relative">
                <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-11 pr-11`} placeholder="Username (min 3 chars)"
                  value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} autoComplete="username" />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {checkingUsername && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
                  {!checkingUsername && !usernameCheckError && usernameAvailable === true && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {!checkingUsername && !usernameCheckError && usernameAvailable === false && <AlertCircle className="w-4 h-4 text-red-400" />}
                  {!checkingUsername && usernameCheckError && <AlertCircle className="w-4 h-4 text-amber-400" />}
                </span>
              </div>
              {usernameCheckError && (
                <p className="text-xs text-amber-400 -mt-3 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {usernameCheckError}
                </p>
              )}
              {!usernameCheckError && usernameAvailable === false && (
                <p className="text-xs text-red-400 -mt-3 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Username taken
                </p>
              )}
              {!usernameCheckError && usernameAvailable === true && (
                <p className="text-xs text-emerald-400 -mt-3 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Username available
                </p>
              )}

              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-11 pr-11`} type="email" placeholder="Email address"
                  value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {checkingEmail && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
                  {!checkingEmail && !emailCheckError && emailAvailable === true &&
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {!checkingEmail && !emailCheckError && emailAvailable === false &&
                    <AlertCircle className="w-4 h-4 text-red-400" />}
                  {!checkingEmail && emailCheckError &&
                    <AlertCircle className="w-4 h-4 text-amber-400" />}
                </span>
              </div>
              {emailCheckError && (
                <p className="text-xs text-amber-400 -mt-3 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {emailCheckError}
                </p>
              )}
              {!emailCheckError && emailAvailable === false && (
                <p className="text-xs text-red-400 -mt-3 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Email already registered
                </p>
              )}
              {!emailCheckError && emailAvailable === true && (
                <p className="text-xs text-emerald-400 -mt-3 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Email available
                </p>
              )}

              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-11`} placeholder="Phone number (with country code)"
                  value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} autoComplete="tel" />
              </div>

              <div className="relative">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <select className={`${inputClass} pl-11 appearance-none cursor-pointer`} value={country} onChange={e => setCountry(e.target.value)}>
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

              <div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input className={`${inputClass} pl-11 pr-11`}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password (min 8 characters)"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                          i <= pwdStrength ? strengthColors[pwdStrength] : 'bg-zinc-800'
                        }`} />
                      ))}
                    </div>
                    <p className={`text-xs font-medium ${strengthTextColors[pwdStrength]}`}>
                      {strengthLabels[pwdStrength]}
                      {pwdStrength < 3 && <span className="text-zinc-600 font-normal"> — add uppercase, numbers & symbols</span>}
                    </p>
                  </div>
                )}
              </div>

              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input className={`${inputClass} pl-11 pr-11`}
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowConfirmPassword(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-400 -mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Passwords do not match
                </p>
              )}
              {confirmPassword && password === confirmPassword && password.length >= 8 && (
                <p className="text-xs text-emerald-400 -mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Passwords match
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-400 font-medium">Distribution Channels</p>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
                  channelCount >= 2
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                }`}>
                  {channelCount}/2 minimum
                </span>
              </div>
              <p className="text-xs text-zinc-500 -mt-1 mb-3">
                Provide at least 2 social channels where you create content or have a following.
              </p>

              {SOCIAL_PLATFORMS.map(({ key, icon: Icon, label, placeholder }) => (
                <div key={key} className="relative">
                  <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    className={`${inputClass} pl-11`}
                    placeholder={`${label} (${placeholder})`}
                    value={socialFieldsMap[key]}
                    onChange={e => {
                      const setters: Record<string, React.Dispatch<React.SetStateAction<string>>> = {
                        twitterHandle: setTwitterHandle, instagramHandle: setInstagramHandle,
                        linkedInProfile: setLinkedInProfile, youtubeChannel: setYoutubeChannel,
                        tiktokHandle: setTiktokHandle, facebookProfile: setFacebookProfile,
                        website: setWebsite, newsletterUrl: setNewsletterUrl,
                        communityUrl: setCommunityUrl
                      };
                      setters[key]?.(e.target.value);
                    }}
                    autoComplete="off"
                  />
                </div>
              ))}

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="relative">
                  <Layers className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <select className={`${inputClass} pl-11 appearance-none cursor-pointer`} value={audienceNiche} onChange={e => setAudienceNiche(e.target.value)}>
                    {['Shopify Growth', 'eCommerce', 'SaaS', 'Marketing', 'Fintech', 'Creator Economy', 'Other'].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="relative">
                  <Info className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <select className={`${inputClass} pl-11 appearance-none cursor-pointer`} value={audienceSize} onChange={e => setAudienceSize(e.target.value)}>
                    {['Under 1,000', '1,000 - 5,000', '5,000 - 10,000', '10,000 - 50,000', '50,000+'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs text-zinc-400 mb-2 font-medium">Your affiliate experience</label>
                <select className={`${inputClass} cursor-pointer`} value={affiliateExperience} onChange={e => setAffiliateExperience(e.target.value)}>
                  {['Beginner', 'Intermediate', 'Advanced', 'Expert'].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-2 font-medium">
                  Why do you want to join?
                  <span className={`ml-2 font-mono ${whyJoin.length >= 15 ? 'text-emerald-400' : 'text-zinc-600'}`}>
                    ({whyJoin.length} chars)
                  </span>
                </label>
                <textarea
                  className={`${inputClass} resize-none h-32 leading-relaxed`}
                  placeholder="Tell us about your audience and how you plan to promote Revluma..."
                  value={whyJoin}
                  onChange={e => setWhyJoin(e.target.value)}
                />
                {whyJoin.length > 0 && whyJoin.length < 15 && (
                  <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Minimum 15 characters required
                  </p>
                )}
              </div>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input type="checkbox" checked={termsAgreement} onChange={e => setTermsAgreement(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500/30 focus:ring-offset-0" />
                <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors leading-relaxed">
                  I agree to the <span className="text-violet-400 font-medium">Partnership Terms & Conditions</span> and confirm my information is accurate.
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input type="checkbox" checked={marketingConsent} onChange={e => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500/30 focus:ring-offset-0" />
                <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors leading-relaxed">
                  I consent to receiving partner updates and commission notifications.
                </span>
              </label>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {step > 1 && (
              <button type="button" onClick={handlePrevStep} className={btnSecondary}>
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
                {isLoading ? 'Submitting...' : 'Submit Application'}
              </button>
            )}
          </div>
        </Card>

        <p className="text-center text-xs text-zinc-500">
          Already have an account?{' '}
          <button onClick={() => goToMode('login')} className="text-violet-400 hover:underline font-medium">Log in</button>
        </p>
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      <LogoHeader subtitle="Sign in to your partner account" />

      <Card>
        {renderAlert(errorText, 'error')}
        {renderAlert(successText, 'success')}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              className={`${inputClass} pl-11`}
              type="email"
              placeholder="Email address"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              className={`${inputClass} pl-11 pr-11`}
              type={showLoginPassword ? 'text' : 'password'}
              placeholder="Password"
              value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button type="button" onClick={() => setShowLoginPassword(p => !p)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
              {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex justify-end -mt-1">
            <button type="button"
              onClick={() => { setAuthModeInternal('forgot'); setErrorText(''); setSuccessText(''); }}
              className="text-xs text-zinc-500 hover:text-violet-400 transition-colors font-medium">
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={isLoading || rateLimited}
            className={btnPrimary}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {isLoading ? 'Signing in...' : rateLimited ? `Retry in ${rateLimitCountdown}s` : 'Sign In'}
          </button>
        </form>
      </Card>

      <p className="text-center text-sm text-zinc-500">
        Don't have an account?{' '}
        <button onClick={() => goToMode('register')} className="text-violet-400 hover:underline font-medium">
          Apply to join
        </button>
      </p>
      <p className="text-center -mt-2">
        <button onClick={onBackToLanding} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">← Back to site</button>
      </p>
    </PageWrap>
  );
}