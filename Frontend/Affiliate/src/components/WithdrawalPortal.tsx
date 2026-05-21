import React, { useState } from 'react';
import { 
  CreditCard, ShieldCheck, HelpCircle, AlertTriangle, CheckCircle2, 
  ArrowRight, Info, Copy, Check, DollarSign, Send, Globe, History, Clock, FileText, ArrowUpRight
} from 'lucide-react';
import { PartnerProfile, WithdrawalRequest, WithdrawalRequestStatus } from '../types';

interface WithdrawalPortalProps {
  currentProfile: PartnerProfile;
  withdrawalRequests: WithdrawalRequest[];
  onAddWithdrawalRequest: (request: Omit<WithdrawalRequest, 'id' | 'createdAt' | 'updatedAt' | 'partnerId'>) => void;
  sentEmails: Array<{
    id: string;
    timestamp: string;
    to: string;
    subject: string;
    body: string;
    isSystem: boolean;
  }>;
  onClearEmailLogs?: () => void;
  isDark: boolean;
  theme: 'dark' | 'light';
  cardBg: string;
  textSubtleLabel: string;
  textTitleColor: string;
  tableHeaderBg: string;
  tableBorder: string;
}

export default function WithdrawalPortal({
  currentProfile,
  withdrawalRequests,
  onAddWithdrawalRequest,
  sentEmails,
  onClearEmailLogs,
  isDark,
  theme,
  cardBg,
  textSubtleLabel,
  textTitleColor,
  tableHeaderBg,
  tableBorder
}: WithdrawalPortalProps) {
  // Configurable minimum withdrawal threshold (in USD)
  const MIN_WITHDRAW_THRESHOLD = 50.00;

  // Let's calculate the user's balance dynamically:
  // We assume a generous lifetime accrued mock balance of $480.00 for our approved partner, in addition to active commission yields
  const lifetimeAccruedCleared = 480.00;

  // Filter requests that belong strictly to this user
  const userRequests = withdrawalRequests.filter(r => r.partnerId === currentProfile.id);

  // Sum of Paid (Completed)
  const totalWithdrawnUsd = userRequests
    .filter(r => r.status === 'Paid')
    .reduce((sum, r) => sum + r.amountUsd, 0);

  // Sum of Pending or approved/processing queue
  const totalPendingUsd = userRequests
    .filter(r => ['Pending Review', 'Under Verification', 'Approved', 'Processing'].includes(r.status))
    .reduce((sum, r) => sum + r.amountUsd, 0);

  // Available Balance = lifetimeAccrued - paid - pending/processing
  const availableBalanceUsd = Math.max(0, lifetimeAccruedCleared - totalWithdrawnUsd - totalPendingUsd);

  // Form State Multi-Step Multi-Currency Dynamic Wizard
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [formData, setFormData] = useState({
    amountUsd: '75.00',
    payoutMethod: 'paypal' as 'paypal' | 'bank_transfer',
    payoutEmail: currentProfile.email,
    legalName: currentProfile.fullName,
    country: currentProfile.country || 'United States',
    currency: 'USD',
    
    // Bank items
    bankName: '',
    accountName: '',
    accountNumber: '',
    iban: '',
    swiftBic: '',
    routingNumber: '',
    branchName: '',
    additionalNotes: '',
    verifyDetailsConsent: false,
    identityCertify: false
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [successAnimation, setSuccessAnimation] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showEmailsLog, setShowEmailsLog] = useState(false);

  // Country Currency Matrix mapping
  const countryCurrencyMap: Record<string, { currency: string; placeholder: string; requireIban: boolean }> = {
    'United States': { currency: 'USD', placeholder: 'Routing Number & Account', requireIban: false },
    'United Kingdom': { currency: 'GBP', placeholder: 'Sort Code & Account', requireIban: true },
    'Germany': { currency: 'EUR', placeholder: 'IBAN & SWIFT/BIC code', requireIban: true },
    'Canada': { currency: 'CAD', placeholder: 'Transit, Institution & Account', requireIban: false },
    'Australia': { currency: 'AUD', placeholder: 'BSB Number & Account', requireIban: false },
    'Singapore': { currency: 'SGD', placeholder: 'SWIFT/BIC & Local Account', requireIban: false },
    'India': { currency: 'INR', placeholder: 'IFSC Code & Bank Account Group', requireIban: false },
    'United Arab Emirates': { currency: 'AED', placeholder: 'IBAN Code Structure', requireIban: true }
  };

  const currentCountryConfig = countryCurrencyMap[formData.country] || { currency: 'USD', placeholder: 'Standard bank details', requireIban: false };

  // Trigger copy tool
  const triggerCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Handle country adjustment (updates currency automaticamente)
  const handleCountryChange = (c: string) => {
    const config = countryCurrencyMap[c] || { currency: 'USD' };
    setFormData(prev => ({
      ...prev,
      country: c,
      currency: config.currency
    }));
  };

  // Input fields validations for step Transitions
  const handleNextStep1 = () => {
    const parsedAmount = parseFloat(formData.amountUsd);
    if (isNaN(parsedAmount)) {
      setFormError('Please input a valid numeric sum.');
      return;
    }
    if (parsedAmount > availableBalanceUsd) {
      setFormError('Requested amount exceeds your available withdrawable balance.');
      return;
    }
    if (parsedAmount < MIN_WITHDRAW_THRESHOLD) {
      setFormError(`Minimum withdrawal is $${MIN_WITHDRAW_THRESHOLD.toFixed(2)}. Please adjust your cashout sum.`);
      return;
    }
    setFormError(null);
    setWizardStep(2);
  };

  const handleNextStep2 = () => {
    // Validate required info based on payout method
    if (!formData.legalName.trim()) {
      setFormError('Full legal name is required.');
      return;
    }

    if (formData.payoutMethod === 'paypal') {
      if (!formData.payoutEmail.trim() || !formData.payoutEmail.includes('@')) {
        setFormError('Please provide a valid registered PayPal payment email address.');
        return;
      }
    } else {
      // Bank validations
      if (!formData.bankName.trim()) {
        setFormError('Recipient bank name is required.');
        return;
      }
      if (!formData.accountName.trim()) {
        setFormError('Bank Account holder name is required.');
        return;
      }
      if (!formData.accountNumber.trim()) {
        setFormError('Account number or Account identifier is required.');
        return;
      }
      if (currentCountryConfig.requireIban && !formData.iban?.trim()) {
        setFormError('Structured IBAN parameter is required for European/UK wire transfers.');
        return;
      }
      if (!formData.swiftBic?.trim()) {
        setFormError('SWIFT / BIC code is mandatory for global manual operations.');
        return;
      }
    }

    setFormError(null);
    setWizardStep(3);
  };

  const handleSubmitRequest = () => {
    if (!formData.verifyDetailsConsent || !formData.identityCertify) {
      setFormError('Please verify and consent to both warning checkboxes before submission.');
      return;
    }

    const parsedAmount = parseFloat(formData.amountUsd);

    // Call state dispatcher
    onAddWithdrawalRequest({
      amountUsd: parsedAmount,
      payoutMethod: formData.payoutMethod,
      payoutEmail: formData.payoutMethod === 'paypal' ? formData.payoutEmail : undefined,
      legalName: formData.legalName,
      country: formData.country,
      currency: formData.currency,
      bankName: formData.payoutMethod === 'bank_transfer' ? formData.bankName : undefined,
      accountName: formData.payoutMethod === 'bank_transfer' ? formData.accountName : undefined,
      accountNumber: formData.payoutMethod === 'bank_transfer' ? formData.accountNumber : undefined,
      iban: formData.payoutMethod === 'bank_transfer' ? formData.iban : undefined,
      swiftBic: formData.payoutMethod === 'bank_transfer' ? formData.swiftBic : undefined,
      routingNumber: formData.payoutMethod === 'bank_transfer' ? formData.routingNumber : undefined,
      branchName: formData.payoutMethod === 'bank_transfer' ? formData.branchName : undefined,
      additionalNotes: formData.additionalNotes.trim() ? formData.additionalNotes : undefined,
      status: 'Pending Review'
    });

    setFormError(null);
    setSuccessAnimation(true);
    setTimeout(() => {
      setSuccessAnimation(false);
      setWizardStep(1);
      // Reset defaults
      setFormData(prev => ({
        ...prev,
        amountUsd: '75.00',
        payoutEmail: currentProfile.email,
        bankName: '',
        accountName: '',
        accountNumber: '',
        iban: '',
        swiftBic: '',
        routingNumber: '',
        branchName: '',
        additionalNotes: '',
        verifyDetailsConsent: false,
        identityCertify: false
      }));
    }, 4000);
  };

  return (
    <div className="space-y-6">
      {/* Visual Header Grid Banner */}
      <div className={`p-6 rounded-2xl relative overflow-hidden border ${isDark ? 'bg-zinc-950 border-zinc-900' : 'bg-white border-zinc-100'}`}>
        <div className="absolute top-0 right-0 w-[400px] h-full bg-orange-500/[0.02] rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-xs text-orange-500 font-bold uppercase tracking-wider">
              <CreditCard className="w-4 h-4 shrink-0 animate-pulse" />
              <span>SaaS Settlement Dashboard</span>
            </div>
            <h2 className="text-xl font-black tracking-tight dark:text-zinc-100 text-zinc-900">
              Partnership Wallet & Manual Payouts
            </h2>
            <p className="text-xs text-zinc-500 max-w-xl">
              Initiate global manual withdrawal requests, designate international multi-currency wire paths, and verify payment dispatch auditing timelines.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowEmailsLog(!showEmailsLog)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-mono font-bold border transition-all flex items-center gap-1.5 ${
                showEmailsLog 
                ? 'bg-orange-500 border-orange-500 text-white' 
                : `${isDark ? 'bg-zinc-900 border-zinc-805 text-zinc-300 hover:text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              SMTP Logs ({sentEmails.length})
            </button>
          </div>
        </div>
      </div>

      {/* Interactive State: Dispatched SMTP transmission audits */}
      {showEmailsLog && (
        <div className={`p-6 rounded-2xl border ${cardBg} border-dashed border-zinc-500/20 space-y-4 font-mono transition-all`}>
          <div className="flex justify-between items-center pb-2 border-b border-zinc-500/10">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h4 className="text-xs font-bold text-orange-500 uppercase tracking-widest">Active SMTP Outbound Delivery Queue</h4>
            </div>
            {onClearEmailLogs && sentEmails.length > 0 && (
              <button 
                onClick={onClearEmailLogs}
                className="text-[10px] text-zinc-500 hover:text-red-500 cursor-pointer"
              >
                Clear Email Buffer
              </button>
            )}
          </div>

          {sentEmails.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">No SMTP transfers triggered in this active session yet. Submit a request to witness real-time secure outbound signals.</p>
          ) : (
            <div className="space-y-4 max-h-[300px] overflow-y-auto no-scrollbar">
              {sentEmails.map((email) => (
                <div key={email.id} className="p-3.5 rounded-xl bg-black border border-zinc-900 space-y-2 text-[10.5px]">
                  <div className="flex justify-between text-zinc-500 text-[10px]">
                    <span>OUTBOUND TRANSACTION ID: {email.id}</span>
                    <span>{new Date(email.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div>
                    <span className="text-emerald-400 font-bold">SMTP TO: </span>
                    <span className="text-zinc-300 font-bold select-all">{email.to}</span>
                  </div>
                  <div>
                    <span className="text-orange-400 font-bold">SUBJECT: </span>
                    <span className="text-zinc-200 font-bold">{email.subject}</span>
                  </div>
                  <div className="p-2.5 bg-zinc-950 rounded-lg text-zinc-400 whitespace-pre-wrap select-text font-serif leading-normal border border-zinc-900 border-dashed">
                    {email.body}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CORE INFRASTRUCTURE GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* WALLET METRICS - LEFT COLUMN */}
        <div className="lg:col-span-4 space-y-6">
          <div className={`p-6 rounded-2xl border ${cardBg} space-y-4 ${isDark ? 'border-zinc-900' : ''}`}>
            <h3 className="font-extrabold text-sm font-sans tracking-tight">Ecosystem Ledger Balance</h3>
            
            <div className="space-y-1 border-b border-zinc-500/10 pb-3">
              <span className={textSubtleLabel}>Accrued Clear Assets</span>
              <div className="flex items-baseline justify-between">
                <span className={`text-3xl font-black font-mono tracking-tight ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>
                  ${lifetimeAccruedCleared.toFixed(2)}
                </span>
                <span className="text-[10px] text-emerald-500 font-bold font-mono">LTD ACCRUED</span>
              </div>
            </div>

            <div className="space-y-3.5">
              <div className="flex justify-between items-center">
                <div className="space-y-0.5">
                  <span className="block text-xs font-semibold text-zinc-500">Withdrawable Cash Balance</span>
                  <span className="text-[10px] text-zinc-400 font-medium">Ready for manual capture</span>
                </div>
                <span className="text-lg font-extrabold text-orange-500 font-mono">
                  ${availableBalanceUsd.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <div className="space-y-0.5">
                  <span className="block text-xs font-semibold text-zinc-500">Pending Review Hold</span>
                  <span className="text-[10px] text-zinc-400 font-medium font-sans">Active requests</span>
                </div>
                <span className="text-sm font-bold text-zinc-400 font-mono">
                  ${totalPendingUsd.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <div className="space-y-0.5">
                  <span className="block text-xs font-semibold text-zinc-500">Completed Payments</span>
                  <span className="text-[10px] text-zinc-400 font-medium">Transferred to recipient</span>
                </div>
                <span className="text-sm font-bold text-emerald-500 font-mono">
                  ${totalWithdrawnUsd.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="pt-3.5 border-t border-zinc-500/10 flex items-center gap-2 text-[10.5px] text-zinc-450 leading-relaxed bg-orange-500/[0.015] p-3 rounded-xl border border-dashed border-orange-500/10">
              <Info className="w-4 h-4 text-orange-500 shrink-0" />
              <span>Withdrawals are processed manually within <strong>3-5 operational business days</strong>. Safety buffer holds apply to dispute risks.</span>
            </div>
          </div>

          <div className={`p-6 rounded-2xl border ${cardBg} space-y-4.5 ${isDark ? 'border-zinc-900' : ''}`}>
            <h3 className="font-extrabold text-sm font-sans tracking-tight">Active Policy Config</h3>
            <div className="space-y-3 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-500">MIN CASH-OUT:</span>
                <span className="font-bold text-orange-400">${MIN_WITHDRAW_THRESHOLD.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">ESCROW HOLD BUFFER:</span>
                <span className="font-bold">30 Days Clearance</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">FRAUD COMPLIANCE FLAGS:</span>
                <span className="font-bold text-emerald-500">ACTIVE LOGS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">ROUTE GATEWAYS:</span>
                <span className="font-bold text-zinc-400">PayPal / Direct Wire</span>
              </div>
            </div>
          </div>
        </div>

        {/* WIZARD CARD PANEL - RIGHT COLUMN */}
        <div className="lg:col-span-8">
          {successAnimation ? (
            <div className={`p-12 rounded-2xl border flex flex-col items-center justify-center text-center space-y-4 h-full ${cardBg} ${isDark ? 'border-zinc-900' : ''}`}>
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 animate-bounce" />
              </div>
              <h3 className="text-lg font-black tracking-tight text-white font-sans">Withdrawal Request Dispatched</h3>
              <p className="text-xs text-zinc-400 max-w-sm leading-relaxed font-mono">
                Outbound SMTP transactional packets successfully cleared to revluma.ai@gmail.com and your partner profile. Revluma supervisors are vetting this ledger event.
              </p>
              <div className="w-32 h-1 bg-zinc-900 rounded-full overflow-hidden">
                <div className="h-full bg-orange-500 animate-[pulse_1.5s_infinite] w-full" />
              </div>
            </div>
          ) : (
            <div className={`p-6 rounded-2xl border ${cardBg} space-y-6 ${isDark ? 'border-zinc-900' : ''}`}>
              {/* Stepper Wizard Progress Indicators */}
              <div className="flex items-center justify-between pb-4 border-b border-zinc-500/10">
                <div className="flex items-center space-x-2">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-mono text-[10.5px] font-bold ${
                    wizardStep >= 1 ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-500'
                  }`}>1</div>
                  <span className={`text-[11px] font-bold font-sans ${wizardStep === 1 ? 'text-orange-500' : 'text-zinc-500'}`}>Amount</span>
                </div>

                <div className="w-10 h-0.5 bg-zinc-800" />

                <div className="flex items-center space-x-2">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-mono text-[10.5px] font-bold ${
                    wizardStep >= 2 ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-500'
                  }`}>2</div>
                  <span className={`text-[11px] font-bold font-sans ${wizardStep === 2 ? 'text-orange-500' : 'text-zinc-500'}`}>Coordinates</span>
                </div>

                <div className="w-10 h-0.5 bg-zinc-800" />

                <div className="flex items-center space-x-2">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-mono text-[10.5px] font-bold ${
                    wizardStep >= 3 ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-500'
                  }`}>3</div>
                  <span className={`text-[11px] font-bold font-sans ${wizardStep === 3 ? 'text-orange-500' : 'text-zinc-500'}`}>Disclaimers</span>
                </div>
              </div>

              {formError && (
                <div className="p-3 bg-red-500/10 border border-red-500/15 text-red-500 text-xs rounded-xl flex items-center gap-2 font-mono">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* STEP 1: VALUE & PAYOUT METHOD SELECTOR */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className={`text-[10px] font-mono font-bold uppercase tracking-wider ${textSubtleLabel}`}>Preferred Payout Method</label>
                      <div className="grid grid-cols-1 gap-2.5">
                        <label className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          formData.payoutMethod === 'paypal' 
                            ? 'bg-orange-500/10 border-orange-500 text-white shadow-inner' 
                            : 'bg-zinc-500/[0.02] border-zinc-500/10 hover:bg-zinc-500/5 text-zinc-400'
                        }`}>
                          <div className="flex items-center space-x-3">
                            <input 
                              type="radio" 
                              name="payoutMethod" 
                              checked={formData.payoutMethod === 'paypal'} 
                              onChange={() => setFormData(prev => ({ ...prev, payoutMethod: 'paypal' }))} 
                              className="hidden" 
                            />
                            <div className="space-y-0.5">
                              <span className="block text-xs font-bold dark:text-zinc-200 text-zinc-800">PayPal Express Transfer</span>
                              <span className="text-[10px] text-zinc-500 dark:text-zinc-450 italic">PayPal direct email deposit</span>
                            </div>
                          </div>
                        </label>

                        <label className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          formData.payoutMethod === 'bank_transfer' 
                            ? 'bg-orange-500/10 border-orange-500 text-white shadow-inner' 
                            : 'bg-zinc-500/[0.02] border-zinc-500/10 hover:bg-zinc-500/5 text-zinc-400'
                        }`}>
                          <div className="flex items-center space-x-3">
                            <input 
                              type="radio" 
                              name="payoutMethod" 
                              checked={formData.payoutMethod === 'bank_transfer'} 
                              onChange={() => setFormData(prev => ({ ...prev, payoutMethod: 'bank_transfer' }))} 
                              className="hidden" 
                            />
                            <div className="space-y-0.5">
                              <span className="block text-xs font-bold dark:text-zinc-200 text-zinc-800">Bank Wire / IBAN Sweep</span>
                              <span className="text-[10px] text-zinc-500 dark:text-zinc-450 italic">International SWIFT / Routing wire</span>
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="space-y-1.5 flex flex-col justify-start">
                      <label className={`text-[10px] font-mono font-bold uppercase tracking-wider ${textSubtleLabel}`}>Amount (USD$ equivalents)</label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-3 text-zinc-500 font-mono font-black text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.amountUsd}
                          onChange={(e) => setFormData(prev => ({ ...prev, amountUsd: e.target.value }))}
                          placeholder="0.00"
                          className={`w-full pl-8 p-2.5 rounded-xl border text-sm font-bold font-mono ${
                            isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                          }`}
                        />
                      </div>
                      <span className="text-[9.5px] font-mono text-zinc-500 italic mt-1.5">
                        Minimum withdrawal limit parameter is configured at <strong>$50.00</strong>. Available: ${availableBalanceUsd.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Disabled crypto warning */}
                  <div className="p-3 bg-zinc-500/5 border border-zinc-500/10 border-dashed rounded-xl flex items-center justify-between">
                    <span className="text-[10.5px] text-zinc-500 font-bold font-sans">🛡️ Extended Crypto & Defi Cashouts</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-500/10 text-[9px] text-zinc-450 font-bold">STRETCH GOAL INACTIVE</span>
                  </div>

                  <button
                    onClick={handleNextStep1}
                    className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs tracking-wider uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Proceed to Account Elements</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* STEP 2: DYNAMIC BANKING/PAYMENTS FIELDS */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className={`text-[10px] font-mono font-bold uppercase ${textSubtleLabel}`}>Legal Recipient Name</label>
                      <input
                        type="text"
                        value={formData.legalName}
                        onChange={(e) => setFormData(prev => ({ ...prev, legalName: e.target.value }))}
                        className={`w-full p-2.5 rounded-xl border text-xs font-bold font-sans ${
                          isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                        }`}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className={`text-[10px] font-mono font-bold uppercase ${textSubtleLabel}`}>Country Coordinates</label>
                      <select
                        value={formData.country}
                        onChange={(e) => handleCountryChange(e.target.value)}
                        className={`w-full p-2.5 rounded-xl border text-xs font-bold ${
                          isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                        }`}
                      >
                        <option value="United States">United States (USD)</option>
                        <option value="United Kingdom">United Kingdom (GBP)</option>
                        <option value="Germany">Germany (EUR / SEPA)</option>
                        <option value="Canada">Canada (CAD)</option>
                        <option value="Australia">Australia (AUD)</option>
                        <option value="Singapore">Singapore (SGD)</option>
                        <option value="India">India (INR)</option>
                        <option value="United Arab Emirates">United Arab Emirates (AED)</option>
                      </select>
                    </div>
                  </div>

                  {/* DYNAMIC FOR PAYPAL */}
                  {formData.payoutMethod === 'paypal' ? (
                    <div className="p-4 rounded-xl bg-zinc-500/5 border border-zinc-500/10 space-y-1.5">
                      <label className={`text-[10px] font-mono font-bold uppercase ${textSubtleLabel}`}>PayPal Registered Email Account</label>
                      <input
                        type="email"
                        value={formData.payoutEmail}
                        onChange={(e) => setFormData(prev => ({ ...prev, payoutEmail: e.target.value }))}
                        className={`w-full p-2.5 rounded-xl border text-xs font-medium font-mono ${
                          isDark ? 'bg-zinc-950 border-zinc-900 text-cyan-400' : 'bg-white border-zinc-200 text-zinc-800 font-bold'
                        }`}
                      />
                      <span className="text-[9.5px] text-zinc-500 block">Funds will deploy directly to this PayPal profile once cleared by risk management.</span>
                    </div>
                  ) : (
                    // DYNAMIC WIRE COORDINATES
                    <div className="p-4 rounded-xl bg-zinc-500/5 border border-zinc-500/10 space-y-4">
                      <div className="flex items-center space-x-1.5 text-xs text-orange-500 font-bold uppercase">
                        <Globe className="w-4 h-4" />
                        <span>Corporate Bank Account wire parameters ({currentCountryConfig.currency})</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className={`text-[10px] font-mono uppercase ${textSubtleLabel}`}>Bank Institution Name</label>
                          <input
                            type="text"
                            placeholder="e.g. JPMorgan Chase"
                            value={formData.bankName}
                            onChange={(e) => setFormData(prev => ({ ...prev, bankName: e.target.value }))}
                            className={`w-full p-2 rounded-xl border text-[11px] font-bold ${
                              isDark ? 'bg-zinc-950 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                            }`}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className={`text-[10px] font-mono uppercase ${textSubtleLabel}`}>Holder Account Name</label>
                          <input
                            type="text"
                            placeholder="Corporate / Individual legal label"
                            value={formData.accountName}
                            onChange={(e) => setFormData(prev => ({ ...prev, accountName: e.target.value }))}
                            className={`w-full p-2 rounded-xl border text-[11px] font-bold ${
                              isDark ? 'bg-zinc-950 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <label className={`text-[10px] font-mono uppercase ${textSubtleLabel}`}>Account Num or IBAN</label>
                          <input
                            type="text"
                            placeholder={currentCountryConfig.placeholder}
                            value={formData.accountNumber}
                            onChange={(e) => setFormData(prev => ({ ...prev, accountNumber: e.target.value }))}
                            className={`w-full p-2 rounded-xl border text-[11px] font-mono font-bold ${
                              isDark ? 'bg-zinc-950 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                            }`}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className={`text-[10px] font-mono uppercase ${textSubtleLabel}`}>SWIFT / BIC Coordinates</label>
                          <input
                            type="text"
                            placeholder="8 or 11 characters"
                            value={formData.swiftBic}
                            onChange={(e) => setFormData(prev => ({ ...prev, swiftBic: e.target.value }))}
                            className={`w-full p-2 rounded-xl border text-[11px] font-mono font-bold ${
                              isDark ? 'bg-zinc-950 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                            }`}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className={`text-[10px] font-mono uppercase ${textSubtleLabel}`}>Transit / Routing Num</label>
                          <input
                            type="text"
                            placeholder="If applicable"
                            value={formData.routingNumber}
                            onChange={(e) => setFormData(prev => ({ ...prev, routingNumber: e.target.value }))}
                            className={`w-full p-2 rounded-xl border text-[11px] font-mono font-bold ${
                              isDark ? 'bg-zinc-950 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className={`text-[10px] font-mono uppercase ${textSubtleLabel}`}>Advisory Notes / Custom Instructions (Optional)</label>
                    <textarea
                      placeholder="e.g. Please process using secondary consult entity."
                      rows={2}
                      value={formData.additionalNotes}
                      onChange={(e) => setFormData(prev => ({ ...prev, additionalNotes: e.target.value }))}
                      className={`w-full p-2 rounded-xl border text-xs font-semibold ${
                        isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                      }`}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setFormError(null); setWizardStep(1); }}
                      className={`w-1/3 py-2.5 rounded-xl border font-bold text-xs transition-all cursor-pointer ${
                        isDark ? 'bg-zinc-900 border-zinc-800 text-zinc-450 hover:bg-zinc-850' : 'bg-white border-zinc-200 text-zinc-650 hover:bg-zinc-50'
                      }`}
                    >
                      Back
                    </button>
                    <button
                      onClick={handleNextStep2}
                      className="w-2/3 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs tracking-wider uppercase transition-colors cursor-pointer"
                    >
                      Next: Disclaimers
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: WARNING SYSTEMS & SIGNATURE CONSENT */}
              {wizardStep === 3 && (
                <div className="space-y-5">
                  {/* WARNING DISCLOSURE BOX */}
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/15 text-xs text-amber-500 space-y-2 leading-relaxed">
                    <div className="flex items-center gap-2 font-black uppercase text-[10.5px] tracking-wide">
                      <AlertTriangle className="w-4 h-4 shrink-0 animate-bounce" />
                      <span>IMPORTANT COMPLIANCE DISCLOSURE STATEMENT</span>
                    </div>
                    <p className="font-sans font-medium text-amber-400">
                      Please carefully verify all payment details before submitting your withdrawal request. 
                      Revluma is not responsible for payout failures caused by incorrect banking or payment information submitted by the affiliate partner.
                    </p>
                  </div>

                  <div className="space-y-3.5 pt-1">
                    <label className="flex items-start space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.verifyDetailsConsent}
                        onChange={(e) => setFormData(prev => ({ ...prev, verifyDetailsConsent: e.target.checked }))}
                        className="rounded text-orange-500 focus:ring-orange-500 w-4 h-4 mt-0.5"
                      />
                      <span className="text-[11.5px] font-medium dark:text-zinc-300 text-zinc-700 leading-normal">
                        I confirm that all provided routing codes, emails, legal labels, and banking details are completely vetted and correct.
                      </span>
                    </label>

                    <label className="flex items-start space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.identityCertify}
                        onChange={(e) => setFormData(prev => ({ ...prev, identityCertify: e.target.checked }))}
                        className="rounded text-orange-500 focus:ring-orange-500 w-4 h-4 mt-0.5"
                      />
                      <span className="text-[11.5px] font-medium dark:text-zinc-300 text-zinc-700 leading-normal">
                        I certify that I am the beneficial owner of the connected settlement coordinate address or corporate agent entity.
                      </span>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setFormError(null); setWizardStep(2); }}
                      className={`w-1/3 py-2.5 rounded-xl border font-bold text-xs transition-all cursor-pointer ${
                        isDark ? 'bg-zinc-900 border-zinc-800 text-zinc-450 hover:bg-zinc-850' : 'bg-white border-zinc-200 text-zinc-650 hover:bg-zinc-50'
                      }`}
                    >
                      Back
                    </button>
                    <button
                      onClick={handleSubmitRequest}
                      className="w-2/3 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 font-bold text-xs tracking-wider uppercase text-white shadow-lg shadow-orange-500/10 transition-colors cursor-pointer"
                    >
                      Verify & Submit Request
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RECENT WITHDRAWAL REQUEST ACTIVITY HISTORY */}
      <div className={`p-6 rounded-2xl border ${cardBg} space-y-4 ${isDark ? 'border-zinc-900' : ''}`}>
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-orange-500" />
          <h3 className="font-extrabold text-sm font-sans tracking-tight">Withdrawal Requests Transaction Ledger</h3>
        </div>

        {userRequests.length === 0 ? (
          <p className="text-xs text-zinc-500 italic py-4">No historic withdrawals on record. Accrue $50.00 to deploy an operational payout trigger!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className={`${tableHeaderBg} border-b ${tableBorder} font-mono text-[9px] text-zinc-550 uppercase tracking-wider`}>
                  <th className="p-3">Cash-out ID (Tracking)</th>
                  <th className="p-3">Verification Timestamp</th>
                  <th className="p-3">Payout Gateway</th>
                  <th className="p-3">Cleared Sum</th>
                  <th className="p-3">Payout Target</th>
                  <th className="p-3">Regulatory Status</th>
                  <th className="p-3 text-right">Settlement Receipts</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-zinc-900/60 text-zinc-350' : 'divide-zinc-200/50 text-zinc-750'}`}>
                {userRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-zinc-500/5 transition-colors">
                    <td className="p-3 font-mono font-bold text-[10.5px] text-zinc-500 dark:text-zinc-450">
                      <div className="flex items-center space-x-1">
                        <span>{req.id}</span>
                        <button 
                          onClick={() => triggerCopy(req.id, req.id)}
                          className="hover:text-white text-zinc-650"
                        >
                          {copiedId === req.id ? <Check className="w-3 h-3 text-emerald-500 animate-scale" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </td>
                    <td className="p-3 font-medium text-[11px]">
                      {new Date(req.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })} at {new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-3 font-mono font-extrabold uppercase text-[10px]">
                      {req.payoutMethod === 'paypal' ? 'PayPal Express' : 'Global Bank Wire'}
                    </td>
                    <td className="p-3 font-mono font-extrabold text-orange-500">
                      ${req.amountUsd.toFixed(2)} {req.currency}
                    </td>
                    <td className="p-3 max-w-[150px] truncate font-mono text-[10.5px]">
                      {req.payoutMethod === 'paypal' ? req.payoutEmail : `${req.bankName} (${req.accountNumber?.slice(-4) || 'Wire'})`}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border font-sans ${
                        req.status === 'Paid' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                        req.status === 'Approved' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                        req.status === 'Processing' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
                        req.status === 'Under Verification' ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' :
                        req.status === 'Rejected' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                        req.status === 'Cancelled' ? 'bg-zinc-550/15 border-zinc-550/25 text-zinc-500 font-mono' :
                        'bg-amber-500/10 border-amber-500/20 text-amber-500' // Pending Review
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="p-3 text-right text-[11.5px] text-zinc-500 font-mono">
                      {req.adminNotes ? (
                        <span className="italic block max-w-[200px] text-right truncate text-[10px]" title={req.adminNotes}>
                          "{req.adminNotes}"
                        </span>
                      ) : (
                        <span className="italic text-zinc-600 block text-[10px]">— Waiting —</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
