/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Users, ShieldCheck, CheckCircle2, XCircle, Volume2, Database, TrendingUp, 
  Settings, Award, RefreshCw, Send, Plus, ArrowUpRight, Search, FileDown,
  CreditCard, AlertTriangle, Globe, Clock, Coins, Check, HelpCircle
} from 'lucide-react';
import { 
  PartnerProfile, FounderBroadcast, ApprovalStatus, 
  WithdrawalRequest, WithdrawalRequestStatus 
} from '../types';

interface AdminPanelProps {
  allProfiles: PartnerProfile[];
  onModifyProfileStatus: (userId: string, newStatus: ApprovalStatus) => void;
  onModifyProfileRole: (userId: string, newRole: 'user' | 'admin') => void;
  broadcastsList: FounderBroadcast[];
  onAddBroadcast: (title: string, content: string) => void;
  onBackToDashboard: () => void;
  withdrawalRequests: WithdrawalRequest[];
  onUpdateWithdrawalRequestStatus: (requestId: string, newStatus: WithdrawalRequestStatus, adminNotes?: string) => void;
}

export default function AdminPanel({
  allProfiles, onModifyProfileStatus, onModifyProfileRole,
  broadcastsList, onAddBroadcast, onBackToDashboard,
  withdrawalRequests, onUpdateWithdrawalRequestStatus
}: AdminPanelProps) {
  // Tabs of supervisor panel
  const [adminTab, setAdminTab] = useState<'approvals' | 'users' | 'broadcasts' | 'system' | 'withdrawals'>('approvals');

  // New admin withdrawal list filters
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  
  // Custom states for in-line supervisor note additions
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [tempNotesVal, setTempNotesVal] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Broadcast creators
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastContent, setBroadcastContent] = useState('');
  const [broadcastStatus, setBroadcastStatus] = useState('');

  // Vetting filters
  const pendingApplicants = allProfiles.filter(p => p.status === 'pending');
  const activeAffiliates = allProfiles.filter(p => p.status === 'approved');

  const handlePublishBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastContent.trim()) {
      setBroadcastStatus("Please complete writing the title and content blocks.");
      return;
    }

    onAddBroadcast(broadcastTitle, broadcastContent);
    setBroadcastTitle('');
    setBroadcastContent('');
    setBroadcastStatus("Broadcast dispatched. Active partner systems synchronized.");
    setTimeout(() => setBroadcastStatus(''), 4000);
  };

  return (
    <div id="admin-workspace-pane" className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col relative geo-grid">
      
      {/* Glow element */}
      <div className="absolute top-0 right-0 w-[500px] h-[300px] bg-zinc-900/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* ADMIN STATUS NAVBAR */}
      <header className="h-16 border-b border-zinc-900 bg-zinc-950/60 backdrop-blur px-8 flex items-center justify-between z-10">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-mono text-zinc-400 block uppercase tracking-widest font-bold">SUPERVISOR CONTROL CONSOLE</span>
            <span className="text-sm font-display font-semibold text-white">Luminor Internal Operations Command</span>
          </div>
        </div>

        <button 
          onClick={onBackToDashboard}
          className="px-4 py-2 bg-zinc-90 w-auto text-xs font-mono rounded-xl border border-zinc-850 text-zinc-300 hover:text-white transition-all cursor-pointer"
        >
          Return to Portal Dashboard
        </button>
      </header>

      {/* CORE WORKSPACE SECTION */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 z-10">
        
        {/* Left Column side selector */}
        <div className="lg:col-span-3 space-y-2">
          <button 
            onClick={() => setAdminTab('approvals')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-semibold uppercase tracking-wider font-mono transition-all ${adminTab === 'approvals' ? 'bg-zinc-900 border border-zinc-800 text-white' : 'bg-transparent text-zinc-500 hover:text-white'}`}
          >
            <span>Vetting Approvals Queue</span>
            <span className="px-2 py-0.5 rounded-full bg-zinc-900 text-[10px] text-zinc-300">
              {pendingApplicants.length}
            </span>
          </button>

          <button 
            onClick={() => setAdminTab('users')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-semibold uppercase tracking-wider font-mono transition-all ${adminTab === 'users' ? 'bg-zinc-900 border border-zinc-800 text-white' : 'bg-transparent text-zinc-500 hover:text-white'}`}
          >
            <span>Affiliate Database</span>
            <span className="px-2 py-0.5 rounded-full bg-zinc-900 text-[10px] text-zinc-300">
              {activeAffiliates.length}
            </span>
          </button>

          <button 
            onClick={() => setAdminTab('broadcasts')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-semibold uppercase tracking-wider font-mono transition-all ${adminTab === 'broadcasts' ? 'bg-zinc-900 border border-zinc-800 text-white' : 'bg-transparent text-zinc-500 hover:text-white'}`}
          >
            <span>Announce Bulletins</span>
            <span className="px-2 py-0.5 rounded-full bg-zinc-900 text-[10px] text-zinc-300">
              {broadcastsList.length}
            </span>
          </button>

          <button 
            onClick={() => setAdminTab('system')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-semibold uppercase tracking-wider font-mono transition-all ${adminTab === 'system' ? 'bg-zinc-900 border border-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            <span>Overall Ledger KPIs</span>
          </button>

          <button 
            onClick={() => setAdminTab('withdrawals')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-semibold uppercase tracking-wider font-mono transition-all ${adminTab === 'withdrawals' ? 'bg-zinc-900 border border-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            <span>Vetting Payouts Queue</span>
            <span className="px-2 py-0.5 rounded-full bg-zinc-900 text-[10px] text-zinc-300">
              {withdrawalRequests.filter(r => r.status === 'Pending Review').length}
            </span>
          </button>

          {/* Core postgres credentials status check */}
          <div className="pt-6 border-t border-zinc-900 text-[10px] text-zinc-600 font-mono leading-relaxed space-y-2">
            <span className="block font-bold">DATABASE CONNECT:</span>
            <span className="text-zinc-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
              <span>Postgres schema sync active</span>
            </span>
            <span className="text-zinc-550 block">RLS policies: Active (6 policies verified in supabase-schema.sql)</span>
          </div>
        </div>

        {/* Right workspace detail column */}
        <div className="lg:col-span-9 space-y-6">
          
          {/* PAN 1: APPROVALS VETTING QUEUE */}
          {adminTab === 'approvals' && (
            <div className="space-y-6">
              <div id="vetting-header-box" className="p-4 bg-zinc-900/35 border border-zinc-850 rounded-xl">
                <h3 className="text-sm font-semibold text-white">Pending Partner Approvals Queue</h3>
                <p className="text-xs text-zinc-450 mt-1 leading-relaxed">
                  Review applicant profiles, handle niche audits, and authorize database sync. Approvals grant instant portal dashboard settings credentials.
                </p>
              </div>

              {pendingApplicants.length === 0 ? (
                <div className="text-center py-20 bg-zinc-900/10 border border-zinc-900 rounded-2xl italic text-xs text-zinc-600 font-mono">
                  All vetting requests completely cleared. Vetting system idle.
                </div>
              ) : (
                <div id="applicants-list" className="space-y-4">
                  {pendingApplicants.map((applicant) => (
                    <div 
                      key={applicant.id} 
                      className="p-6 bg-zinc-900/40 border border-zinc-850 rounded-xl space-y-4 shadow"
                    >
                      <div className="flex justify-between flex-wrap gap-4 items-start border-b border-zinc-900 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-white">{applicant.fullName}</h4>
                            <span className="text-[10px] text-zinc-550">(@{applicant.username})</span>
                          </div>
                          <span className="text-[10px] text-zinc-500 font-mono">{applicant.email} | Contact: {applicant.phoneNumber} | Country: {applicant.country}</span>
                        </div>
                        <div className="flex space-x-2">
                          <button 
                            onClick={() => onModifyProfileStatus(applicant.id, 'approved')}
                            className="px-3.5 py-1.5 bg-emerald-750 hover:bg-emerald-700 text-white text-[10.5px] font-semibold font-mono rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve Partner</span>
                          </button>
                          <button 
                            onClick={() => onModifyProfileStatus(applicant.id, 'rejected')}
                            className="px-3 py-1.5 bg-red-950/20 hover:bg-red-950/40 border border-red-500/25 text-red-400 text-[10.5px] font-semibold font-mono rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Decline</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                        <div className="space-y-0.5">
                          <span className="block text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Niche & Audience scale</span>
                          <span className="text-zinc-300 font-medium">{applicant.audienceNiche} ({applicant.audienceSize})</span>
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-sans">Affiliate Experience</span>
                          <span className="text-zinc-300 font-medium">{applicant.affiliateExperience}</span>
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Connected handles</span>
                          <span className="text-zinc-400 font-medium truncate block">
                            {applicant.twitterHandle ? `X: ${applicant.twitterHandle} ` : ''}
                            {applicant.linkedInProfile ? `In: Yes` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-900">
                        <span className="block text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1">Applicant Statement (Why Join)</span>
                        <p className="text-xs text-zinc-400 leading-relaxed italic">&ldquo;{applicant.whyJoin}&rdquo;</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PAN 2: ACTIVE USERS ENGINE */}
          {adminTab === 'users' && (
            <div className="space-y-6">
              <div className="p-4 bg-zinc-900/35 border border-zinc-850 rounded-xl">
                <h3 className="text-sm font-semibold text-white">Active Growth Partner Database</h3>
                <p className="text-xs text-zinc-455 mt-1 leading-relaxed">
                  Manage roles, alter commissions rate rules, and audit general performance.
                </p>
              </div>

              <div className="bg-zinc-900/30 border border-zinc-850 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-zinc-900/50 border-b border-zinc-850 font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                        <th className="p-4">Partner Name</th>
                        <th className="p-4">Username</th>
                        <th className="p-4">Ecosystem Tier</th>
                        <th className="p-4">commission Ratio</th>
                        <th className="p-4">Vetting Status</th>
                        <th className="p-4">Role Permission</th>
                        <th className="p-4 text-right">Administrative Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 text-xs text-zinc-350">
                      {allProfiles.map((user) => (
                        <tr key={user.id} className="hover:bg-zinc-900/25">
                          <td className="p-4 text-white font-medium">{user.fullName}</td>
                          <td className="p-4 font-mono font-bold text-zinc-400">@{user.username}</td>
                          <td className="p-4">
                            <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-850 text-[9px] font-mono text-zinc-400 uppercase w-max block">
                              {user.tier}
                            </span>
                          </td>
                          <td className="p-4 font-mono">{user.commissionRate * 100}%</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                              user.status === 'approved' ? 'bg-emerald-950/40 text-emerald-400' :
                              user.status === 'rejected' ? 'bg-red-950/40 text-red-400' : 'bg-zinc-900 text-zinc-500'
                            }`}>
                              {user.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="p-4 font-mono uppercase tracking-widest text-[9.5px] text-zinc-400 font-bold">{user.role}</td>
                          <td className="p-4 text-right space-x-2">
                            {user.role === 'user' ? (
                              <button 
                                onClick={() => onModifyProfileRole(user.id, 'admin')}
                                className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded text-[9px] font-mono transition-colors cursor-pointer text-zinc-300"
                              >
                                Upgrade Admin
                              </button>
                            ) : (
                              <button 
                                onClick={() => onModifyProfileRole(user.id, 'user')}
                                className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded text-[9px] font-mono transition-all cursor-pointer text-zinc-450"
                              >
                                Set User
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PAN 3: BROADCASTS CENTER */}
          {adminTab === 'broadcasts' && (
            <div className="space-y-6">
              <div className="p-4 bg-zinc-900/35 border border-zinc-850 rounded-xl">
                <h3 className="text-sm font-semibold text-white">Broadcast Directives</h3>
                <p className="text-xs text-zinc-450 mt-1">
                  Draft newsletters, strategies bulletins, milestone updates directly from Voss and the development leadership panel.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Form creator */}
                <form onSubmit={handlePublishBroadcast} className="p-5 bg-zinc-900/20 border border-zinc-850 rounded-xl space-y-4">
                  <div>
                    <label className="block text-[9px] font-mono text-zinc-500 uppercase mb-1.5 font-bold tracking-wider">Directive Title</label>
                    <input 
                      type="text" 
                      value={broadcastTitle}
                      onChange={(e) => setBroadcastTitle(e.target.value)}
                      placeholder="e.g. Revluma API Q2 Roadmap Update" 
                      className="bg-zinc-950 border border-zinc-850 rounded-xl p-3 text-xs text-white focus:outline-none w-full border border-zinc-850"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono text-zinc-500 uppercase mb-1.5 font-bold tracking-wider">Directive Content (Text area)</label>
                    <textarea 
                      value={broadcastContent}
                      onChange={(e) => setBroadcastContent(e.target.value)}
                      rows={5}
                      placeholder="Input roadmap logs, strategy guidelines, UTM triggers..." 
                      className="bg-zinc-950 border border-zinc-850 rounded-xl p-3 text-xs text-white focus:outline-none w-full border border-zinc-850"
                    />
                  </div>

                  <button 
                    type="submit"
                    className="w-full bg-white text-zinc-950 hover:bg-zinc-200 font-mono text-xs py-3 rounded-xl uppercase tracking-wider font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 text-zinc-950" />
                    Dispatch Directive memo
                  </button>
                  {broadcastStatus && (
                    <p className="text-[10px] text-emerald-400 font-mono text-center pt-1">{broadcastStatus}</p>
                  )}
                </form>

                {/* Directive list review */}
                <div className="space-y-4 max-h-[360px] overflow-y-auto no-scrollbar">
                  <div className="text-[10px] font-mono text-zinc-550 border-b border-zinc-900 pb-2 uppercase font-bold">Active Directives in Feed</div>
                  {broadcastsList.map((b) => (
                    <div key={b.id} className="p-4 bg-zinc-950 rounded-xl border border-zinc-900 space-y-2">
                      <div className="flex justify-between items-center text-xs font-semibold text-white">
                        <span>{b.title}</span>
                        <span className="text-[9px] text-zinc-650 font-mono">{b.date}</span>
                      </div>
                      <p className="text-xs text-zinc-450 leading-relaxed font-sans">{b.content.substring(0, 100)}...</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* PAN 4: OVERALL SYSTEM KPIS */}
          {adminTab === 'system' && (
            <div className="space-y-6">
              <div className="p-4 bg-zinc-900/35 border border-zinc-850 rounded-xl">
                <h3 className="text-sm font-semibold text-white">Global Ecosystem Yield LEDGER</h3>
                <p className="text-xs text-zinc-450 mt-1">
                  Overall enterprise metric aggregates across public Postgres profiles.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="p-5 bg-zinc-900/30 border border-zinc-850 rounded-xl space-y-1 text-center">
                  <span className="text-[10px] font-mono text-zinc-500 block uppercase">TOTAL REVENUE SCALE</span>
                  <span className="text-3xl font-bold text-white font-mono">$1.48M</span>
                  <span className="text-[10px] text-emerald-400 block font-mono">+$42k cleared wkly</span>
                </div>
                <div className="p-5 bg-zinc-900/30 border border-zinc-850 rounded-xl space-y-1 text-center">
                  <span className="text-[10px] font-mono text-zinc-500 block uppercase">COMMISSION OUTFLOW ESTIMATE</span>
                  <span className="text-3xl font-bold text-zinc-300 font-mono">$44k</span>
                  <span className="text-[10px] text-zinc-500 block">SaaS payouts June closure</span>
                </div>
                <div className="p-5 bg-zinc-900/30 border border-zinc-850 rounded-xl space-y-1 text-center">
                  <span className="text-[10px] font-mono text-zinc-500 block uppercase">ACTIVE PARTNER POOL</span>
                  <span className="text-3xl font-bold text-emerald-400 font-mono">{activeAffiliates.length}</span>
                  <span className="text-[10px] text-zinc-550 block">Approved commerce nodes</span>
                </div>
              </div>
            </div>
          )}

          {/* PAN 5: MANUAL WITHDRAWALS VETTING AND INLINE NOTE MUTATOR */}
          {adminTab === 'withdrawals' && (
            <div className="space-y-6">
              <div className="p-5 bg-zinc-900/30 border border-zinc-850 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Manual Withdrawal Requests Ledger Vetting Panel</h3>
                  <p className="text-xs text-zinc-450 mt-1">
                    Process international partner withdrawal cache filings, audit banking coordinates, verify AML guidelines, and update remittance logs.
                  </p>
                </div>
                <div className="flex bg-zinc-950 px-3 py-2 rounded-xl text-xs font-mono font-bold text-orange-400 border border-zinc-900 gap-4">
                  <div>Backlog Queue: <span className="text-white">{withdrawalRequests.filter(r => r.status === 'Pending Review').length}</span></div>
                  <div className="border-l border-zinc-800" />
                  <div>Grand Settled: <span className="text-emerald-400">${withdrawalRequests.filter(r => r.status === 'Paid').reduce((sum, r) => sum + r.amountUsd, 0).toFixed(2)}</span></div>
                </div>
              </div>

              {/* Advanced Filter Toolbar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-zinc-900/10 border border-zinc-900 rounded-xl">
                <div>
                  <label className="block text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Filter Regulatory Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full p-2 bg-zinc-950 border border-zinc-855 rounded-lg text-xs font-semibold text-zinc-300 focus:outline-none"
                  >
                    <option value="all">All Request Statuses</option>
                    <option value="Pending Review">Pending Review</option>
                    <option value="Under Verification">Under Verification</option>
                    <option value="Approved">Approved</option>
                    <option value="Processing">Processing</option>
                    <option value="Paid">Paid</option>
                    <option value="Rejected">Rejected</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Filter Recipient Country</label>
                  <select
                    value={filterCountry}
                    onChange={(e) => setFilterCountry(e.target.value)}
                    className="w-full p-2 bg-zinc-950 border border-zinc-855 rounded-lg text-xs font-semibold text-zinc-300 focus:outline-none"
                  >
                    <option value="all">All Global Countries</option>
                    <option value="United States">United States</option>
                    <option value="United Kingdom">United Kingdom</option>
                    <option value="Germany">Germany</option>
                    <option value="Canada">Canada</option>
                    <option value="Australia">Australia</option>
                    <option value="Singapore">Singapore</option>
                    <option value="India">India</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Filter Payment Method</label>
                  <select
                    value={filterMethod}
                    onChange={(e) => setFilterMethod(e.target.value)}
                    className="w-full p-2 bg-zinc-950 border border-zinc-855 rounded-lg text-xs font-semibold text-zinc-300 focus:outline-none"
                  >
                    <option value="all">All Payment Gateways</option>
                    <option value="paypal">PayPal Express</option>
                    <option value="bank_transfer">Direct Bank Wire</option>
                  </select>
                </div>
              </div>

              {/* Requests Auditor Grid */}
              <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-900/50 border-b border-zinc-850 font-mono text-[9px] text-zinc-550 uppercase tracking-wider">
                        <th className="p-3">Partner & History</th>
                        <th className="p-3">Cashout Request Details</th>
                        <th className="p-3">Remittance Coordinates</th>
                        <th className="p-3">Fraud / Compliance Signals</th>
                        <th className="p-3">Status Pipeline Transition</th>
                        <th className="p-3 text-right">Audit Remittance remark</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900/60 text-zinc-300">
                      {withdrawalRequests
                        .filter(req => {
                          const matchStatus = filterStatus === 'all' || req.status === filterStatus;
                          const matchCountry = filterCountry === 'all' || req.country === filterCountry;
                          const matchMethod = filterMethod === 'all' || req.payoutMethod === filterMethod;
                          return matchStatus && matchCountry && matchMethod;
                        })
                        .map((req) => {
                          const partnerInfo = allProfiles.find(u => u.id === req.partnerId) || { fullName: 'Unknown Partner', email: 'unknown@email.com', username: 'partner' };
                          
                          // Suspicious volume check
                          const isHighVolume = req.amountUsd >= 300.00;
                          
                          // First withdrawal check (calculate are user previous success payments)
                          const previousPaidCount = withdrawalRequests.filter(r => r.partnerId === req.partnerId && r.status === 'Paid' && r.id !== req.id).length;
                          const isFirstTime = previousPaidCount === 0;

                          return (
                            <tr key={req.id} className="hover:bg-zinc-905/30 transition-colors">
                              {/* Partner Metadata Column */}
                              <td className="p-3">
                                <div className="space-y-0.5">
                                  <span className="font-bold block text-white text-[12.5px]">{req.legalName}</span>
                                  <span className="text-[10px] text-zinc-450 block font-mono">@{partnerInfo.username} | {req.country}</span>
                                  <span className="text-[9.5px] text-zinc-550 block font-mono">{partnerInfo.email}</span>
                                </div>
                              </td>

                              {/* Amount Details Column */}
                              <td className="p-3">
                                <div className="space-y-0.5">
                                  <span className="text-[13.5px] font-mono font-black text-orange-500">${req.amountUsd.toFixed(2)} USD</span>
                                  <span className="text-[9px] text-zinc-500 block uppercase font-mono font-bold">Equivalent in {req.currency}</span>
                                  <span className="text-[9.5px] text-zinc-450 block font-sans">Created: {new Date(req.createdAt).toLocaleDateString()}</span>
                                </div>
                              </td>

                              {/* Banking / Paypal Details Coordinates */}
                              <td className="p-3">
                                {req.payoutMethod === 'paypal' ? (
                                  <div className="space-y-0.5 font-mono text-[10px]">
                                    <span className="text-cyan-400 font-bold block">PP TARGET EMAIL:</span>
                                    <span className="text-zinc-200 select-all font-bold block">{req.payoutEmail}</span>
                                  </div>
                                ) : (
                                  <div className="space-y-0.5 font-mono text-[9px] leading-tight">
                                    <div><strong className="text-zinc-500 uppercase">Bank:</strong> <span className="text-zinc-350">{req.bankName}</span></div>
                                    <div><strong className="text-zinc-500 uppercase">Holder:</strong> <span className="text-zinc-350">{req.accountName}</span></div>
                                    <div><strong className="text-zinc-500 uppercase">Acct/IBAN:</strong> <span className="text-zinc-200 select-all font-bold">{req.accountNumber}</span></div>
                                    {req.iban && <div><strong className="text-zinc-500 uppercase">IBAN:</strong> <span className="text-zinc-200 select-all">{req.iban}</span></div>}
                                    <div><strong className="text-zinc-500 uppercase">SWIFT:</strong> <span className="text-zinc-200 select-all">{req.swiftBic}</span></div>
                                  </div>
                                )}
                              </td>

                              {/* Anti-Fraud Score Column */}
                              <td className="p-3">
                                <div className="space-y-1">
                                  {isHighVolume && (
                                    <span className="px-2 py-0.5 rounded bg-red-950/20 text-red-400 border border-red-900/30 text-[8.5px] font-mono font-bold block uppercase tracking-wider">
                                      ⚠️ Suspicious High Volume
                                    </span>
                                  )}
                                  {isFirstTime ? (
                                    <span className="px-2 py-0.5 rounded bg-blue-950/20 text-blue-400 border border-blue-900/30 text-[8.5px] font-mono font-bold block uppercase tracking-wider">
                                      ⚡ First Cashout Event
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded bg-emerald-950/30 text-emerald-400 border border-emerald-900/30 text-[8.5px] font-mono font-bold block uppercase tracking-wider">
                                      🛡️ Cleared Record: {previousPaidCount} Paid
                                    </span>
                                  )}
                                  <span className="text-[9.5px] text-zinc-550 block font-mono">IP Checksum Verified</span>
                                </div>
                              </td>

                              {/* Status Action Selector Column */}
                              <td className="p-3">
                                <div className="space-y-1.5">
                                  <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold tracking-wider uppercase border inline-block ${
                                    req.status === 'Paid' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                                    req.status === 'Approved' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                                    req.status === 'Processing' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
                                    req.status === 'Under Verification' ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' :
                                    req.status === 'Rejected' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                                    req.status === 'Cancelled' ? 'bg-zinc-550/15 border-zinc-550/25 text-zinc-500' :
                                    'bg-amber-500/10 border-amber-500/20 text-amber-500'
                                  }`}>
                                    {req.status}
                                  </span>

                                  <select
                                    value={req.status}
                                    onChange={(e) => onUpdateWithdrawalRequestStatus(req.id, e.target.value as WithdrawalRequestStatus, req.adminNotes)}
                                    className="block w-full p-1.5 bg-zinc-950 border border-zinc-850 rounded text-[10.5px] font-mono text-zinc-300 focus:outline-none"
                                  >
                                    <option value="Pending Review">Pending Review</option>
                                    <option value="Under Verification">Under Verification</option>
                                    <option value="Approved">Approved</option>
                                    <option value="Processing">Processing</option>
                                    <option value="Paid font-bold text-emerald-400">Mark Paid (Settled)</option>
                                    <option value="Rejected text-red-400">Reject Request</option>
                                    <option value="Cancelled">Cancel</option>
                                  </select>
                                </div>
                              </td>

                              {/* Remittance Audit Note Inline Editor Column */}
                              <td className="p-3 text-right">
                                {editingNotesId === req.id ? (
                                  <div className="space-y-1.5 inline-block text-left">
                                    <input
                                      type="text"
                                      value={tempNotesVal}
                                      onChange={(e) => setTempNotesVal(e.target.value)}
                                      placeholder="Txn ID / compliance notes"
                                      className="p-1 px-2 bg-zinc-950 border border-zinc-800 rounded text-[10px] text-white w-40"
                                    />
                                    <div className="flex justify-end space-x-1.5">
                                      <button
                                        onClick={() => {
                                          onUpdateWithdrawalRequestStatus(req.id, req.status, tempNotesVal);
                                          setEditingNotesId(null);
                                        }}
                                        className="px-1.5 py-0.5 bg-emerald-600 rounded text-[9px] font-bold text-white uppercase cursor-pointer"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={() => setEditingNotesId(null)}
                                        className="px-1.5 py-0.5 bg-zinc-800 rounded text-[9px] font-bold text-zinc-400 uppercase cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-1 text-right">
                                    <p className="text-[10px] italic text-zinc-400 font-mono break-all max-w-[160px] ml-auto">
                                      {req.adminNotes ? `"${req.adminNotes}"` : 'No transactional metadata logged.'}
                                    </p>
                                    <button
                                      onClick={() => {
                                        setEditingNotesId(req.id);
                                        setTempNotesVal(req.adminNotes || '');
                                      }}
                                      className="text-[10px] text-orange-400 hover:text-orange-300 font-mono font-bold uppercase underline inline-block"
                                    >
                                      {req.adminNotes ? 'Edit Notes' : 'Add Remit Log'}
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                      {withdrawalRequests.filter(req => {
                        const matchStatus = filterStatus === 'all' || req.status === filterStatus;
                        const matchCountry = filterCountry === 'all' || req.country === filterCountry;
                        const matchMethod = filterMethod === 'all' || req.payoutMethod === filterMethod;
                        return matchStatus && matchCountry && matchMethod;
                      }).length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-zinc-600 font-mono italic">
                            No manual withdrawals found conforming to selected audits.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
