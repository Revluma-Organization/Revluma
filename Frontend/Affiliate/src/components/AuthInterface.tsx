/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Shield, User, Mail, Lock, Phone, Globe, Twitter, Linkedin, Instagram, 
  Layers, CheckSquare, Info, ChevronRight, ChevronLeft, Loader2, Link2, Key, Send,
  Sparkles, CheckCircle2, AlertCircle
} from 'lucide-react';
import { PartnerProfile, ApprovalStatus } from '../types';

interface AuthInterfaceProps {
  onAuthSuccess: (profile: PartnerProfile) => void;
  onBackToLanding: () => void;
  allCreatedProfiles: PartnerProfile[];
  onCreateProfile: (profile: PartnerProfile) => void;
  onSendSimulatedEmail: (emailObj: { to: string; subject: string; body: string; isSystem: boolean }) => void;
}

export default function AuthInterface({ onAuthSuccess, onBackToLanding, allCreatedProfiles, onCreateProfile, onSendSimulatedEmail }: AuthInterfaceProps) {
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot' | 'resetConfirm' | 'submittedTokenVerification'>('login');
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');

  // Token Verification Flow State
  const [pendingUser, setPendingUser] = useState<PartnerProfile | null>(null);
  const [inputToken, setInputToken] = useState('');
  const [tokenVerified, setTokenVerified] = useState(false);

  const APPROVAL_TOKEN = "f3b6d2a7-5ea9-42bf-be08-592f15e8daea";

  // Fields
  // STEP 1 FIELDS: Personal & Credentials
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [country, setCountry] = useState('US');
  const [password, setPassword] = useState('');

  // STEP 2 FIELDS: Niche & Social handles
  const [twitterHandle, setTwitterHandle] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [linkedInProfile, setLinkedInProfile] = useState('');
  const [website, setWebsite] = useState('');
  const [audienceNiche, setAudienceNiche] = useState('Shopify Growth');
  const [audienceSize, setAudienceSize] = useState('5,000 - 10,000');

  // STEP 3 FIELDS: Commitment / Why Join
  const [affiliateExperience, setAffiliateExperience] = useState('Intermediate');
  const [whyJoin, setWhyJoin] = useState('');
  const [termsAgreement, setTermsAgreement] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  // Login inputs
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Forgot password inputs
  const [forgotEmail, setForgotEmail] = useState('');

  // Reset Password inputs (simulation)
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Validate Step 1 of Sign Up
  const validateStep1 = () => {
    if (!fullName.trim()) return "Full name is required.";
    if (!username.trim() || username.length < 3) return "Username must be at least 3 characters.";
    if (!email.trim() || !email.includes('@')) return "Enter a valid email address.";
    if (!phoneNumber.trim()) return "Phone number is required.";
    if (!password || password.length < 6) return "Password must be at least 6 characters.";
    return null;
  };

  // Validate Step 2
  const validateStep2 = () => {
    if (!audienceNiche.trim()) return "Please specify your target audience niche.";
    if (!audienceSize) return "Please choose your audience scale.";
    return null;
  };

  // Validate Step 3
  const validateStep3 = () => {
    if (!whyJoin.trim() || whyJoin.trim().length < 15) return "Please provide at least 15 characters explaining why you want to join.";
    if (!termsAgreement) return "You must read and agree to the partnership terms.";
    return null;
  };

  const handleNextStep = () => {
    setErrorText('');
    let err: string | null = null;
    if (step === 1) err = validateStep1();
    if (step === 2) err = validateStep2();

    if (err) {
      setErrorText(err);
    } else {
      setStep(prev => prev + 1);
    }
  };

  const handlePrevStep = () => {
    setErrorText('');
    setStep(prev => prev - 1);
  };

  // Registration Handler
  const handleSignUpCompletion = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');
    const err = validateStep3();
    if (err) {
      setErrorText(err);
      return;
    }

    setIsLoading(true);

    // Simulate database lookup and profile creation
    setTimeout(() => {
      // Check duplicate email
      const isEmailTaken = allCreatedProfiles.some(p => p.email.toLowerCase() === email.toLowerCase());
      if (isEmailTaken) {
        setErrorText("This email is already associated with an active partnership application.");
        setIsLoading(false);
        setStep(1);
        return;
      }

      // Check duplicate username
      const isUsernameTaken = allCreatedProfiles.some(p => p.username.toLowerCase() === username.toLowerCase());
      if (isUsernameTaken) {
        setErrorText("The selected username has already been registered.");
        setIsLoading(false);
        setStep(1);
        return;
      }

      // Create profile object
      const customProfile: PartnerProfile = {
        id: `usr_${Math.random().toString(36).substring(2, 10)}`,
        fullName,
        username,
        email: email.toLowerCase(),
        phoneNumber,
        country,
        twitterHandle: twitterHandle || undefined,
        instagramHandle: instagramHandle || undefined,
        linkedInProfile: linkedInProfile || undefined,
        website: website || undefined,
        audienceNiche,
        audienceSize,
        affiliateExperience,
        whyJoin,
        status: 'pending', // Starts as pending to demonstrate selective waitlisting!
        role: email.toLowerCase().includes('admin') || username.toLowerCase() === 'admin' ? 'admin' : 'user', // Backdoor for admin simulation
        createdAt: new Date().toISOString(),
        tier: 'Affiliate',
        commissionRate: 0.20
      };

      onCreateProfile(customProfile);
      setPendingUser(customProfile);
      setSuccessText("Your vetting request has been successfully queued. Welcome to the exclusive developer pipeline!");
      setAuthMode('submittedTokenVerification');
      setInputToken('');
      setTokenVerified(false);
      setIsLoading(false);
    }, 1200);
  };

  // Login handler
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');
    setSuccessText('');

    if (!loginEmail || !loginPassword) {
      setErrorText("Please fill out all credentials.");
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      // Look up inside our state system
      const partner = allCreatedProfiles.find(
        p => p.email.toLowerCase() === loginEmail.toLowerCase()
      );

      if (!partner) {
        setErrorText("Incorrect partner email or credentials.");
        setIsLoading(false);
        return;
      }

      // Vetting clearance logic check unless admin
      if (partner.status === 'pending' && partner.role !== 'admin') {
        setPendingUser(partner);
        setAuthMode('submittedTokenVerification');
        setSuccessText("Welcome back! Your application is submitted and pending review. Enter your approval token below to secure your spot immediately.");
        setIsLoading(false);
        return;
      }

      if (partner.status === 'rejected') {
        setErrorText("Application Declined: Your portfolio structure does not match our current distribution compliance guidelines.");
        setIsLoading(false);
        return;
      }

      // Successful login redirect
      onAuthSuccess(partner);
      setIsLoading(false);
    }, 1000);
  };

  // Verify approval partnership UUID token
  const handleVerifyApprovalToken = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');
    setSuccessText('');

    if (!pendingUser) {
      setErrorText("No pending partnership session found. Please register an account first.");
      return;
    }

    if (!inputToken.trim()) {
      setErrorText("Please enter your approval partnership token.");
      return;
    }

    const sanitizedInput = inputToken.trim().toLowerCase();
    const sanitizedToken = APPROVAL_TOKEN.toLowerCase();

    if (sanitizedInput !== sanitizedToken) {
      setErrorText("Invalid approval partnership token. Please check and try again, or await manual review from our administrators.");
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      // Create approved version of user profile
      const approvedProfile: PartnerProfile = {
        ...pendingUser,
        status: 'approved',
        tier: 'Elite', // Grant elite status on spot activation
        commissionRate: 0.35 // 35% commission rate
      };

      // Propagate the updated profile containing status approved to profiles in App
      onCreateProfile(approvedProfile);

      setSuccessText("Authorization verified! Token successfully assigned to standard pool allocation. Opening terminal...");
      setTokenVerified(true);
      setIsLoading(false);

      // Instant redirect
      setTimeout(() => {
        onAuthSuccess(approvedProfile);
      }, 1500);
    }, 1500);
  };

  // Simulated Forgot Password
  const handleForgotPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');
    if (!forgotEmail || !forgotEmail.includes('@')) {
      setErrorText("Enter your validated partner email.");
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      setSuccessText(`Password reset instructions and verification code dispatch successful. Check your vector inbox for ${forgotEmail}`);
      setAuthMode('resetConfirm');
      setIsLoading(false);
    }, 1200);
  };

  // Reset Confirmation
  const handleConfirmReset = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');
    if (!resetCode) {
      setErrorText("Input your 6-digit confirmation code.");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setErrorText("New password must be at least 6 characters.");
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      setSuccessText("Password override complete. Please login using your updated credentials.");
      setAuthMode('login');
      setIsLoading(false);
    }, 1000);
  };

  return (
    <div id="auth-root" className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 geo-grid relative">
      <div className="absolute top-0 right-0 left-0 h-[400px] glow-ambient opacity-50 z-0 pointer-events-none"></div>

      {/* Back to landing link top left */}
      <button 
        onClick={onBackToLanding} 
        className="absolute top-6 left-6 text-xs font-mono text-zinc-500 hover:text-white transition-colors flex items-center space-x-1.5 z-20 cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4 text-zinc-500" />
        <span>Back to Ecosystem Home</span>
      </button>

      {/* Branding Header */}
      <div className="mb-8 text-center relative z-10 select-none">
        <div className="inline-flex w-10 h-10 rounded-xl bg-white border border-zinc-200 items-center justify-center mb-3">
          <Layers className="w-5 h-5 text-zinc-950" />
        </div>
        <h2 className="font-display font-bold text-2xl text-white">REVLUMA PARTNER TERMINAL</h2>
        <span className="text-[10px] font-mono tracking-widest text-zinc-500">SECURE CLOUD OPERATIONS LAYER</span>
      </div>

      {/* Main Glass Vetting Card container */}
      <div className="w-full max-w-xl bg-zinc-900/60 border border-zinc-800/80 rounded-2xl glass-card px-8 py-8 relative z-10">
        
        {/* Error notification bar */}
        {errorText && (
          <div className="mb-6 p-4 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-400 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{errorText}</p>
          </div>
        )}

        {/* Success notification bar */}
        {successText && (
          <div className="mb-6 p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-400 flex items-start gap-2.5">
            <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{successText}</p>
          </div>
        )}

        {/* LOGIN MODE */}
        {authMode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-lg font-display font-medium text-white">Access Growth Dashboard</h3>
              <p className="text-xs text-zinc-500">Credentials must be vetted prior to active system authorization.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Ecosystem Partner Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3.5 w-4 h-4 text-zinc-600" />
                  <input 
                    type="email" 
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="partner@luminor.io" 
                    className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Access Key / Password</label>
                  <button 
                    type="button" 
                    onClick={() => setAuthMode('forgot')}
                    className="text-[10px] font-mono text-zinc-500 hover:text-white transition-colors"
                  >
                    Forgot Access key?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3.5 w-4 h-4 text-zinc-600" />
                  <input 
                    type="password" 
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••••••" 
                    className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button 
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 rounded-xl text-xs font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-all flex justify-center items-center gap-2 font-mono uppercase tracking-wider cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Bypassing Encryption Gateway...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 text-zinc-950" />
                    Verify & Access Terminal
                  </>
                )}
              </button>
            </div>

            <div className="text-center pt-2">
              <p className="text-xs text-zinc-500">
                New candidate?{" "}
                <button 
                  type="button" 
                  onClick={() => { setAuthMode('register'); setStep(1); }}
                  className="text-zinc-200 hover:text-white font-semibold underline decoration-zinc-700"
                >
                  Create Vetted Application
                </button>
              </p>
            </div>
          </form>
        )}

        {/* REGISTRATION SELECTIVE APPLICATION WIZARD */}
        {authMode === 'register' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center pb-4 border-b border-zinc-850">
              <div>
                <h3 className="text-base font-display font-medium text-white">Ecosystem Vetting Wizard</h3>
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mt-0.5">Step {step} of 3</span>
              </div>
               {/* Dynamic steps grid indicator */}
              <div className="flex space-x-1.5">
                <div className={`w-6 h-1 rounded-full ${step >= 1 ? 'bg-white' : 'bg-zinc-800'}`}></div>
                <div className={`w-6 h-1 rounded-full ${step >= 2 ? 'bg-white' : 'bg-zinc-800'}`}></div>
                <div className={`w-6 h-1 rounded-full ${step >= 3 ? 'bg-white' : 'bg-zinc-800'}`}></div>
              </div>
            </div>

            {/* STEP 1: Core Credentials */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-xl">
                  <p className="text-[11px] text-zinc-350 leading-relaxed font-sans font-medium">To keep Revluma's affiliate network secure and exclusive, our team manually verifies each applicant portfolio before granting console access.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Legal Full Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="text" 
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="John Doe" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Candidate Username</label>
                    <div className="relative">
                      <Layers className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="text" 
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="john_ceo" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Partner Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="email" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="john@example.com" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Contact Phone Number</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="text" 
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1-555-555-5555" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Country of residency</label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <select 
                        value={country} 
                        onChange={(e) => setCountry(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                      >
                        <option value="US">United States</option>
                        <option value="CA">Canada</option>
                        <option value="GB">United Kingdom</option>
                        <option value="AU">Australia</option>
                        <option value="DE">Germany</option>
                        <option value="FR">France</option>
                        <option value="SG">Singapore</option>
                        <option value="NG">Nigeria</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Access Security Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="password" 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-4">
                  <button 
                    type="button" 
                    onClick={() => setAuthMode('login')}
                    className="text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    Hold on, I have a vetted account
                  </button>
                  <button 
                    type="button" 
                    onClick={handleNextStep}
                    className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-zinc-800 border border-zinc-705 text-white hover:bg-zinc-700 justify-end transition-all flex items-center gap-1.5"
                  >
                    <span>Distribution Channel</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Distribution & Volume parameters */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">X / Twitter Handle <span className="text-zinc-600 font-normal">(Optional)</span></label>
                    <div className="relative">
                      <Twitter className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="text" 
                        value={twitterHandle}
                        onChange={(e) => setTwitterHandle(e.target.value)}
                        placeholder="@username" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">LinkedIn Profile URL <span className="text-zinc-600 font-normal">(Optional)</span></label>
                    <div className="relative">
                      <Linkedin className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="text" 
                        value={linkedInProfile}
                        onChange={(e) => setLinkedInProfile(e.target.value)}
                        placeholder="linkedin.com/in/..." 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Instagram Handle <span className="text-zinc-600 font-normal">(Optional)</span></label>
                    <div className="relative">
                      <Instagram className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="text" 
                        value={instagramHandle}
                        onChange={(e) => setInstagramHandle(e.target.value)}
                        placeholder="@username" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Partner Website / Blog <span className="text-zinc-600 font-normal">(Optional)</span></label>
                    <div className="relative">
                      <Link2 className="absolute left-3 top-3.5 w-3.5 h-3.5 text-zinc-650" />
                      <input 
                        type="text" 
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        placeholder="https://myagency.com" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-9 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Primary Audience Niche</label>
                    <select 
                      value={audienceNiche} 
                      onChange={(e) => setAudienceNiche(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 px-4 text-xs text-white focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="Shopify Store Owners">Shopify Store Owners</option>
                      <option value="D2C Brand Growth Leads">D2C Brand Growth Leads</option>
                      <option value="SaaS Founders & Creators">SaaS Founders & Creators</option>
                      <option value="eCommerce Operations Managers">eCommerce Operations Managers</option>
                      <option value="Tech Infosec / Databases">Tech Infosec / Databases</option>
                      <option value="Digital Agencies & Consulting">Digital Agencies & Consulting</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Aggregate Audience Scale / Reach</label>
                    <select 
                      value={audienceSize} 
                      onChange={(e) => setAudienceSize(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 px-4 text-xs text-white focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="Under 1,000">Under 1,000 members</option>
                      <option value="1,000 - 5,000">1,000 - 5,000 members</option>
                      <option value="5,000 - 25,000">5,000 - 25,000 members</option>
                      <option value="25,000 - 100,000">25,000 - 100,000 members</option>
                      <option value="100,000+">100,000+ members</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-between pt-4">
                  <button 
                    type="button" 
                    onClick={handlePrevStep}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-zinc-950 border border-zinc-850 text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                  <button 
                    type="button" 
                    onClick={handleNextStep}
                    className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-zinc-800 border border-zinc-705 text-white hover:bg-zinc-700 transition-all flex items-center gap-1.5"
                  >
                    <span>Commitment & Submit</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Vetting Context & Terms */}
            {step === 3 && (
              <form onSubmit={handleSignUpCompletion} className="space-y-4">
                <div>
                  <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1.5 font-bold tracking-wider">Affiliate Experience Tier</label>
                  <select 
                    value={affiliateExperience} 
                    onChange={(e) => setAffiliateExperience(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 px-4 text-xs text-white focus:outline-none"
                  >
                    <option value="No Prior Experience">No prior referrers experience</option>
                    <option value="Beginner (<$1k earned)">Beginner, low tier conversions</option>
                    <option value="Intermediate">Intermediate, refer commerce tools or databases</option>
                    <option value="High-Performance Master">High-performance agency / network owner</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-mono text-zinc-400 uppercase mb-1 text-bold tracking-wider mb-1.5">Why do you wish to join the Revluma Growth Ecosystem?</label>
                  <textarea 
                    value={whyJoin}
                    onChange={(e) => setWhyJoin(e.target.value)}
                    rows={3}
                    placeholder="Describe your distribution channels, typical clients, or email campaign frequency (minimum 15 characters)..." 
                    className="w-full bg-zinc-950 border border-zinc-850 rounded-xl p-3 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                {/* Consent checkboxes */}
                <div className="space-y-3 pt-2">
                  <label className="flex items-start gap-2.5 cursor-pointer text-zinc-400 select-none">
                    <input 
                      type="checkbox" 
                      checked={termsAgreement}
                      onChange={(e) => setTermsAgreement(e.target.checked)}
                      className="mt-0.5 rounded bg-zinc-950 border-zinc-850 text-zinc-100 focus:ring-0 cursor-pointer"
                    />
                    <span className="text-[10px] leading-snug">I confirm that all candidate fields are legally accurate and I agree to the compliance auditing of commissions payments.</span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer text-zinc-400 select-none">
                     <input 
                      type="checkbox" 
                      checked={marketingConsent}
                      onChange={(e) => setMarketingConsent(e.target.checked)}
                      className="mt-0.5 rounded bg-zinc-950 border-zinc-850 text-zinc-100 focus:ring-0 cursor-pointer"
                    />
                    <span className="text-[10px] leading-snug">I authorize Luminor Terminal to send campaign bulletins and developer directives via my contact email.</span>
                  </label>
                </div>

                <div className="flex justify-between pt-4 border-t border-zinc-850 mt-6">
                  <button 
                    type="button" 
                    onClick={handlePrevStep}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-zinc-950 border border-zinc-850 text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                  <button 
                    type="submit"
                    disabled={isLoading}
                    className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-all flex items-center gap-1.5 font-mono uppercase tracking-widest cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <span>Submit Application</span>
                        <Send className="w-3.5 h-3.5 text-zinc-950" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* FORGOT PASSWORD VIEW */}
        {authMode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-lg font-display font-medium text-white">Reset Gateway Credentials</h3>
              <p className="text-xs text-zinc-500">Provide your verified partner email. A 6-digit cryptographic authentication token will be dispatched.</p>
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Your Partner Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 w-4 h-4 text-zinc-650" />
                <input 
                  type="email" 
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="partner@luminor.io" 
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button 
                type="button" 
                onClick={() => setAuthMode('login')}
                className="text-xs text-zinc-500 hover:text-white transition-colors"
              >
                Back to Sign In
              </button>
              <button 
                type="submit"
                disabled={isLoading}
                className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-zinc-800 border border-zinc-705 text-white hover:bg-zinc-700 transition-all flex items-center gap-1.5 font-mono"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Dispatching...
                  </>
                ) : (
                  <>
                    <span>Dispatch Reset Token</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* RESET CONFIRMATION CODE VIEW */}
        {authMode === 'resetConfirm' && (
          <form onSubmit={handleConfirmReset} className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-lg font-display font-medium text-white">Cryptographic Verification</h3>
              <p className="text-xs text-zinc-500">Define your verified 6-digit override keys and construct a new security password.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1.5">6-Digit crypt code</label>
                <div className="relative">
                  <Key className="absolute left-3 top-3.5 w-4 h-4 text-zinc-650" />
                  <input 
                    type="text" 
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="000 000" 
                    maxLength={6}
                    className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Construct New Access Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3.5 w-4 h-4 text-zinc-650" />
                  <input 
                    type="password" 
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••" 
                    className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button 
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 rounded-xl text-xs font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-all flex justify-center items-center gap-2 font-mono uppercase tracking-wider"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resetting Password Keys...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 text-zinc-950" />
                    Authorize Password Reset
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* SUBMITTED VETTING & TOKEN VERIFICATION VIEW */}
        {authMode === 'submittedTokenVerification' && (
          <form onSubmit={handleVerifyApprovalToken} className="space-y-6">
            <div className="space-y-1 text-center pb-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-1">Step 4 // Final Verification Check</span>
              <h3 className="text-xl font-display font-semibold text-white">Application Vetting Pipeline</h3>
              <p className="text-xs text-zinc-400">Exclusive distribution network restricted to 100 high-performance spot allocations.</p>
            </div>

            {/* MESSAGE CARD */}
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-white uppercase tracking-wider">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Application Submitted Successfully</span>
              </div>
              <p className="text-[11px] text-zinc-350 leading-relaxed font-sans font-medium">
                Your portfolio details have been registered. To prevent abuse and guarantee the high quality of our performance ecosystem, our team manually reviews and verifies registration sources before granting console dashboard entry.
              </p>
              
              <div className="pt-2 border-t border-zinc-800 grid grid-cols-2 gap-2 text-[10px] font-mono text-zinc-400">
                <div>
                  <span className="text-zinc-500 block">PROPOSED NICHE:</span>
                  <span className="text-zinc-200 truncate block">{pendingUser?.audienceNiche || 'eCommerce Store Owners'}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">CURRENT STATUS:</span>
                  <span className="text-amber-400 font-bold block">● Awaiting Review</span>
                </div>
              </div>
            </div>

            {/* TOKEN INPUT CARD */}
            <div className="p-5 bg-zinc-950/40 border border-zinc-850 rounded-2xl space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-zinc-350 font-semibold uppercase tracking-wider">
                  <Key className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span>Enter Exclusive Approval Token</span>
                </div>
                <p className="text-[11px] text-zinc-500 leading-normal">
                  Enter your assigned UUID partnership token to instantly bypass the queue, verify your status, and activate your dashboard.
                </p>
              </div>

              <div>
                <input 
                  type="text"
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  placeholder="e.g. f3b6d2a7-5ea9-42bf-be08-592f15e8daea"
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-xl py-3 px-4 text-xs font-mono text-white placeholder-zinc-700 text-center uppercase tracking-widest focus:outline-none focus:border-white/50"
                  disabled={isLoading || tokenVerified}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || tokenVerified}
                className="w-full py-3.5 px-4 rounded-xl text-xs font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-all flex justify-center items-center gap-2 font-mono uppercase tracking-wider cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-950" />
                    Verifying UUID On Ledger...
                  </>
                ) : tokenVerified ? (
                  <>
                    <Sparkles className="w-4 h-4 text-zinc-950 animate-bounce" />
                    Access Token Cleared ! Loading Dashboard...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 text-zinc-950" />
                    Verify Approval Token
                  </>
                )}
              </button>
            </div>

            <div className="text-center pt-2">
              <button 
                type="button" 
                onClick={() => {
                  setAuthMode('login');
                  setErrorText('');
                  setSuccessText('');
                }}
                className="text-xs text-zinc-500 hover:text-white transition-colors cursor-pointer"
              >
                Return to terminal login gateway
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Selective Vetting Info box underneath */}
      <div className="max-w-xl text-center mt-6 text-[11px] text-zinc-600 font-mono leading-relaxed p-1">
        <span>SECURITY CORE ID: c4cd099f // Luminor Terminal processes and logs credentials in a highly secure sandbox environment using enterprise PostgreSQL schemas.</span>
      </div>
    </div>
  );
}
