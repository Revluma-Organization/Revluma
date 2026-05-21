import React, { useState, useEffect } from 'react';
import { 
  CreditCard, Webhook, Terminal, ShieldCheck, Cpu, Database, 
  RefreshCw, Code, ExternalLink, Play, Copy, Check, Sparkles, AlertTriangle, Info, Trash2
} from 'lucide-react';
import { PartnerProfile } from '../types';

interface LemonSqueezyHubProps {
  currentProfile: PartnerProfile;
  allProfiles: PartnerProfile[];
  isDark: boolean;
  theme: 'light' | 'dark';
  cardBg: string;
  textSubtleLabel: string;
  textTitleColor: string;
  tableHeaderBg: string;
  tableBorder: string;
}

export default function LemonSqueezyHub({
  currentProfile,
  allProfiles,
  isDark,
  theme,
  cardBg,
  textSubtleLabel,
  textTitleColor,
  tableHeaderBg,
  tableBorder
}: LemonSqueezyHubProps) {
  // Simulator Controls
  const [selectedEvent, setSelectedEvent] = useState<string>('subscription_payment_success');
  const [customerEmail, setCustomerEmail] = useState<string>('growth_partner_referral@gmail.com');
  const [selectedPlan, setSelectedPlan] = useState<'Starter Plan' | 'Growth Plan'>('Growth Plan');
  const [trialMode, setTrialMode] = useState<boolean>(false);
  const [churnMode, setChurnMode] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  
  // Real logs fetched from backend Express server
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [viewSchema, setViewSchema] = useState<'all' | 'subscriptions' | 'commissions' | 'fraud'>('all');
  const [activeSubTab, setActiveSubTab] = useState<'simulator' | 'logs' | 'architecture' | 'antifraud'>('simulator');

  const triggerCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 1500);
  };

  // Fetch log history from Server.ts
  const fetchLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetch('/api/lemon-squeezy/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to query Lemon Squeezy logs endpoint:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  // Trigger simulated webhook event via backend Express API
  const handleSimulateWebhook = async () => {
    setIsSimulating(true);
    try {
      const res = await fetch('/api/lemon-squeezy/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName: selectedEvent,
          userEmail: customerEmail,
          planName: selectedPlan,
          customValues: {
            partner_id: currentProfile.username,
            status: churnMode ? 'cancelled' : 'active',
            trial: trialMode,
            campaign_tag: 'google_ads_organic'
          }
        })
      });

      if (res.ok) {
        // Refresh local log list automatically
        await fetchLogs();
      }
    } catch (err) {
      console.error('Simulation post failed:', err);
    } finally {
      setIsSimulating(false);
    }
  };

  // Clear log history
  const handleClearLogs = async () => {
    try {
      const res = await fetch('/api/lemon-squeezy/clear-logs', { method: 'POST' });
      if (res.ok) {
        setLogs([]);
      }
    } catch (err) {
      console.error('Clear endpoint failed:', err);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 4000); // Poll logs every 4 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* Visual Header Banner */}
      <div className={`p-6 rounded-2xl relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border ${
        isDark ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-100'
      }`}>
        <div className="space-y-1 z-10">
          <div className="flex items-center space-x-2 text-xs text-orange-500 font-bold uppercase tracking-wider">
            <Webhook className="w-4 h-4 text-orange-500 shrink-0 animate-pulse" />
            <span>Lemon Squeezy Recurring Payments GOS</span>
          </div>
          <h2 className={`text-xl font-black tracking-tight ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>
            Financial Settlement Core
          </h2>
          <p className="text-xs text-zinc-500 max-w-xl">
            Luminor Terminal powered partnership payment system. Verified signatures, subscription upgrades, failed renewals, dynamic tiers progression, and clawback defense controls.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSubTab('simulator')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeSubTab === 'simulator' 
              ? 'bg-orange-500 text-white' 
              : `${isDark ? 'text-zinc-400 hover:text-white bg-zinc-900' : 'text-zinc-650 hover:bg-zinc-100 bg-zinc-100/50'}`
            }`}
          >
            Developer Sandbox
          </button>
          <button
            onClick={() => setActiveSubTab('logs')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeSubTab === 'logs' 
              ? 'bg-orange-500 text-white' 
              : `${isDark ? 'text-zinc-400 hover:text-white bg-zinc-900' : 'text-zinc-650 hover:bg-zinc-100 bg-zinc-100/50'}`
            }`}
          >
            Webhook Logs
            {logs.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
                {logs.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('architecture')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeSubTab === 'architecture' 
              ? 'bg-orange-500 text-white' 
              : `${isDark ? 'text-zinc-400 hover:text-white bg-zinc-900' : 'text-zinc-650 hover:bg-zinc-100 bg-zinc-100/50'}`
            }`}
          >
            Enterprise Schema SQL
          </button>
        </div>
      </div>

      {/* SUB-VIEW 1: SIMULATOR SANDBOX */}
      {activeSubTab === 'simulator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Webhook Form Simulator - Left */}
          <div className={`col-span-1 lg:col-span-7 p-6 rounded-2xl border ${cardBg} space-y-6 ${isDark ? 'border-zinc-900' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-orange-500" />
                <h3 className="font-extrabold text-sm font-sans tracking-tight">Recurring Event Sandbox Controller</h3>
              </div>
              <span className="px-2.5 py-1 text-[9px] font-mono font-bold bg-zinc-500/10 text-orange-400 rounded-md uppercase border border-orange-500/15 tracking-wide">
                Luminor Bypass Enabled
              </span>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className={`text-[10px] font-mono font-bold uppercase ${textSubtleLabel}`}>Select Lemon Squeezy Webhook Event</label>
                <select
                  value={selectedEvent}
                  onChange={(e) => setSelectedEvent(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border text-xs font-bold font-sans ${
                    isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                  }`}
                >
                  <option value="subscription_created">subscription_created (Customer starts a membership)</option>
                  <option value="subscription_payment_success">subscription_payment_success (Compounding payment processed successfully)</option>
                  <option value="subscription_payment_failed">subscription_payment_failed (Failed renewal / customer card declined)</option>
                  <option value="subscription_updated">subscription_updated (Upgrade Starter to Growth / pricing adjustment)</option>
                  <option value="refund_created">refund_created (Chargeback occurred / commission clawed back)</option>
                  <option value="subscription_cancelled">subscription_cancelled (Churn detected / access disabled)</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={`text-[10px] font-mono font-bold uppercase ${textSubtleLabel}`}>Customer Referral Email Target</label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border text-xs font-bold font-mono ${
                      isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                    }`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={`text-[10px] font-mono font-bold uppercase ${textSubtleLabel}`}>SaaS Subscription Product</label>
                  <select
                    value={selectedPlan}
                    onChange={(e) => setSelectedPlan(e.target.value as any)}
                    className={`w-full p-2.5 rounded-xl border text-xs font-bold ${
                      isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-850'
                    }`}
                  >
                    <option value="Starter Plan">Starter Plan ($49.00 / month)</option>
                    <option value="Growth Plan">Growth Plan ($99.00 / month)</option>
                  </select>
                </div>
              </div>

              {/* Toggle modifiers */}
              <div className="flex flex-wrap items-center gap-6 p-3 bg-zinc-500/5 rounded-xl border border-dashed border-zinc-500/10">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trialMode}
                    onChange={(e) => setTrialMode(e.target.checked)}
                    className="rounded text-orange-500 focus:ring-orange-500 w-4 h-4"
                  />
                  <span className="text-xs font-medium dark:text-zinc-300 text-zinc-700">Include Active Free Trial Period</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={churnMode}
                    onChange={(e) => setChurnMode(e.target.checked)}
                    className="rounded text-orange-500 focus:ring-orange-500 w-4 h-4"
                  />
                  <span className="text-xs font-medium dark:text-zinc-300 text-zinc-700">Flag as Cancelled / Expired status</span>
                </label>
              </div>

              <button
                onClick={handleSimulateWebhook}
                disabled={isSimulating}
                className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 font-bold text-xs tracking-wider uppercase text-white shadow-lg transition-all flex items-center justify-center gap-2"
              >
                {isSimulating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-white" />
                )}
                {isSimulating ? 'Processing webhook signal...' : 'Trigger & Post Webhook To Server'}
              </button>
            </div>

            <div className="pt-4 border-t border-zinc-500/10 space-y-3.5">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-orange-500">How Attribution Works:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3 bg-zinc-500/5 rounded-xl border border-zinc-500/10 text-center">
                  <span className="block text-xs font-bold font-mono text-cyan-400">90 Days</span>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-450 font-medium">Attribution Window</span>
                </div>
                <div className="p-3 bg-zinc-500/5 rounded-xl border border-zinc-500/10 text-center">
                  <span className="block text-xs font-bold font-mono text-emerald-400">compounding</span>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-450 font-medium">Recurring Models</span>
                </div>
                <div className="p-3 bg-zinc-500/5 rounded-xl border border-zinc-500/10 text-center">
                  <span className="block text-xs font-bold font-mono text-amber-400">30-Day Escrow</span>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-450 font-medium">Fraud Safety Halt</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats & System Status - Right */}
          <div className="col-span-1 lg:col-span-5 space-y-6">
            <div className={`p-6 rounded-2xl border ${cardBg} space-y-4 ${isDark ? 'border-zinc-900' : ''}`}>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
                <h3 className="font-extrabold text-sm font-sans tracking-tight block">Settlement Compliance Status</h3>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Production Webhook Url:</span>
                  <span className="font-mono font-bold text-[10px] bg-zinc-500/10 px-2 py-0.5 rounded text-orange-400">
                    /api/webhooks/lemon-squeezy
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Webhook Cryptographic Key:</span>
                  <span className="font-mono font-bold text-[10px] text-zinc-450">
                    Active (SHA256 Timing Safe Check)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Affiliate Level progression:</span>
                  <span className="font-mono font-bold text-emerald-500">
                    Automated (Relational SQL Trigger)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Active simulated database status:</span>
                  <div className="flex items-center gap-1.5 font-bold font-sans text-emerald-500">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    HEALTHY / SECURE
                  </div>
                </div>
              </div>
            </div>

            {/* Plan tier payouts */}
            <div className={`p-6 rounded-2xl border ${cardBg} space-y-4 ${isDark ? 'border-zinc-900' : ''}`}>
              <h3 className="font-extrabold text-sm font-sans tracking-tight">Recurring commission rules</h3>
              
              <div className="space-y-3.5">
                <div className="p-3 bg-zinc-500/5 rounded-xl border border-zinc-500/10 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="block text-xs font-black dark:text-zinc-200">Starter Plan Recurring</span>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-450 font-mono italic">$49/mo pricing tier</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-orange-500">20% ~ $9.80 / mo</span>
                </div>

                <div className="p-3 bg-zinc-500/5 rounded-xl border border-zinc-500/10 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="block text-xs font-black dark:text-zinc-200">Growth Plan Recurring</span>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-450 font-mono italic">$99/mo pricing tier</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-orange-500">30% ~ $29.70 / mo</span>
                </div>

                <div className="p-3 bg-zinc-500/5 rounded-xl border border-emerald-500/15 flex items-center justify-between bg-emerald-500/[0.02]">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="block text-xs font-black dark:text-zinc-200">Founding Ambassador rate</span>
                    </div>
                    <span className="text-[10px] text-zinc-550 italic">Aggregated Milestone level</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-500">35% compounding rate</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* SUB-VIEW 2: LOGSTREAM */}
      {activeSubTab === 'logs' && (
        <div className={`p-6 rounded-2xl border ${cardBg} space-y-6 ${isDark ? 'border-zinc-900' : ''}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-orange-500" />
                <h3 className="font-extrabold text-sm font-sans tracking-tight">Incoming Webhook Audit Logs Console</h3>
              </div>
              <p className="text-xs text-zinc-500">
                Incoming payloads from Lemon Squeezy payment processors logging signature validation statuses in real-time.
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={fetchLogs}
                disabled={isLoadingLogs}
                className={`p-2 rounded-xl border text-xs font-bold transition-all ${
                  isDark ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-white' : 'bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-700'
                }`}
                title="Force refresh webhook stream"
              >
                <RefreshCw className={`w-4 h-4 text-zinc-500 ${isLoadingLogs ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={handleClearLogs}
                className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/15 text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Flush Console
              </button>
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-dashed border-zinc-500/10 bg-zinc-500/[0.02] space-y-2">
              <AlertTriangle className="w-8 h-8 text-zinc-500 mx-auto" />
              <h4 className="text-xs font-bold dark:text-zinc-400">No Webhook Logs Recorded Yet</h4>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                Trigger simulated sandbox events on the Developer Sandbox tab to populate incoming secure streams!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {logs.map((log) => (
                <div key={log.id} className="p-4 rounded-xl border border-zinc-500/10 bg-zinc-500/[0.015] space-y-3 font-mono">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2.5">
                      <span className="px-2 py-0.5 text-[9px] font-bold bg-orange-500/15 text-orange-400 rounded border border-orange-500/15">
                        {log.eventName}
                      </span>
                      <span className="text-zinc-450 font-bold font-sans text-[10px]">
                        ID: {log.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide tracking-wider ${
                        log.status === 'verified' 
                        ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                        : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-650 dark:text-zinc-400 font-sans font-medium">
                    {log.details}
                  </p>

                  <div className="p-3 bg-zinc-950 rounded-lg text-[10px] text-zinc-300 overflow-x-auto border border-zinc-900">
                    <pre className="no-scrollbar">{JSON.stringify(log.payload, null, 2)}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-VIEW 3: SQL ARCHITECTURE SCHEMAS */}
      {activeSubTab === 'architecture' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* SQL List Selector - Left */}
          <div className="col-span-1 lg:col-span-4 space-y-2">
            <button
              onClick={() => setViewSchema('all')}
              className={`w-full p-4 rounded-xl border text-left text-xs font-bold transition-all flex items-center justify-between ${
                viewSchema === 'all' 
                ? 'bg-orange-500 border-orange-500 text-white shadow-md' 
                : `${isDark ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300' : 'bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-700'}`
              }`}
            >
              <span>Full Migration Stack</span>
              <Database className="w-4 h-4 shrink-0" />
            </button>
            <button
              onClick={() => setViewSchema('subscriptions')}
              className={`w-full p-4 rounded-xl border text-left text-xs font-bold transition-all flex items-center justify-between ${
                viewSchema === 'subscriptions' 
                ? 'bg-orange-500 border-orange-500 text-white shadow-md' 
                : `${isDark ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300' : 'bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-700'}`
              }`}
            >
              <span>Subscriptions Table</span>
              <CreditCard className="w-4 h-4 shrink-0" />
            </button>
            <button
              onClick={() => setViewSchema('commissions')}
              className={`w-full p-4 rounded-xl border text-left text-xs font-bold transition-all flex items-center justify-between ${
                viewSchema === 'commissions' 
                ? 'bg-orange-500 border-orange-500 text-white shadow-md' 
                : `${isDark ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300' : 'bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-700'}`
              }`}
            >
              <span>Commissions Engine Trigger</span>
              <Code className="w-4 h-4 shrink-0" />
            </button>
          </div>

          {/* SQL viewer Panel - Right */}
          <div className={`col-span-1 lg:col-span-8 p-6 rounded-2xl border ${cardBg} space-y-4 ${isDark ? 'border-zinc-900' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-orange-500" />
                <h3 className="font-extrabold text-sm font-sans tracking-tight">PostgreSQL Relational Relational Schema</h3>
              </div>
              <button
                onClick={() => triggerCopy(sqlSnippets[viewSchema], 'copysql')}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 ${
                  isDark ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-white' : 'bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-700'
                }`}
              >
                {copiedText === 'copysql' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedText === 'copysql' ? 'Copied SQL!' : 'Copy Script'}
              </button>
            </div>

            <div className="p-4 bg-zinc-950 rounded-xl text-[10px] text-zinc-300 overflow-x-auto border border-zinc-900 max-h-[450px] font-mono select-text">
              <pre>{sqlSnippets[viewSchema]}</pre>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const sqlSnippets: Record<string, string> = {
  all: `-- Active database schema stack automatically verified inside supabase-schema.sql
-- Run standard migration inside your production postgres databases:

CREATE TABLE public.customer_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lemon_squeezy_id TEXT UNIQUE NOT NULL, -- "sub_12345"
    partner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    customer_email TEXT NOT NULL,
    plan_name TEXT NOT NULL, -- 'Starter Plan' | 'Growth Plan'
    status TEXT NOT NULL, -- 'active' | 'trial' | 'cancelled'
    billing_interval TEXT NOT NULL DEFAULT 'monthly',
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    subscription_created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.partner_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.customer_subscriptions(id),
    base_billing_amount_cents INTEGER NOT NULL,
    commission_rate NUMERIC(4,3) NOT NULL,
    commission_earned_cents INTEGER NOT NULL,
    delay_payout_until TIMESTAMP WITH TIME ZONE NOT NULL,
    payout_status payout_status DEFAULT 'pending'
);`,
  subscriptions: `-- customer_subscriptions holds active records tracked to referrers
-- Keeps strict constraints with indexed emails:

CREATE TABLE public.customer_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lemon_squeezy_id TEXT UNIQUE NOT NULL,
    partner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    customer_email TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    status TEXT NOT NULL,
    billing_interval TEXT NOT NULL DEFAULT 'monthly',
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sub_ls_id ON public.customer_subscriptions(lemon_squeezy_id);
CREATE INDEX idx_sub_partner ON public.customer_subscriptions(partner_id);

ALTER TABLE public.customer_subscriptions ENABLE ROW LEVEL SECURITY;`,
  commissions: `-- Automatic Dynamic Milestone Tier Upgrades:
-- Increases partner commission percentage levels based on cumulative revenue:

CREATE OR REPLACE FUNCTION public.recalculate_partner_growth_tier()
RETURNS TRIGGER AS $$
DECLARE
    total_accrued_recurring_revenue INTEGER;
    target_tier public.partner_tier;
    target_rate NUMERIC(4,2);
BEGIN
    SELECT COALESCE(SUM(amount_paid_cents), 0) INTO total_accrued_recurring_revenue
    FROM public.customer_subscriptions
    WHERE partner_id = NEW.partner_id AND status = 'active';

    IF total_accrued_recurring_revenue >= 1500000 THEN
        target_tier := 'Founding Ambassador'::public.partner_tier;
        target_rate := 0.35;
    ELSIF total_accrued_recurring_revenue >= 500000 THEN
        target_tier := 'Elite'::public.partner_tier;
        target_rate := 0.30;
    ELSIF total_accrued_recurring_revenue >= 100000 THEN
        target_tier := 'Growth'::public.partner_tier;
        target_rate := 0.25;
    ELSE
        target_tier := 'Affiliate'::public.partner_tier;
        target_rate := 0.20;
    END IF;

    UPDATE public.profiles
    SET tier = target_tier, commission_rate = target_rate
    WHERE id = NEW.partner_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`
};
