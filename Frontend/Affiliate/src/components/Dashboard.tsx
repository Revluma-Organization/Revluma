/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  BarChart3, Users, PiggyBank, Award, Copy, Check, Twitter, Linkedin, 
  Send, BrainCircuit, Play, Sparkles, BookOpen, Bell, Globe, 
  Settings, LogOut, Trash2, ArrowRight, Code, ShieldCheck, ChevronRight, 
  Volume2, HelpCircle, Plus, Info, RefreshCw, Layers, CheckCircle2, AlertTriangle, Crown,
  PlayCircle, Cpu, Sun, Moon, Search, Sliders, Calendar, MoreVertical, ExternalLink, HelpCircle as HelpIcon,
  Upload, Camera, CreditCard
} from 'lucide-react';
import { 
  PartnerProfile, ReferredUser, EarningRecord, LeaderboardUser, 
  CampaignInfo, FounderBroadcast, NotificationItem, WithdrawalRequest 
} from '../types';
import LemonSqueezyHub from './LemonSqueezyHub';
import WithdrawalPortal from './WithdrawalPortal';
import LeaderboardComingSoon from './LeaderboardComingSoon';
import { isSupabaseConfigured } from '../lib/supabaseClient';

const ProfessionalCrown = () => (
  <svg 
    viewBox="0 0 100 100" 
    className="w-10 h-10 animate-bounce drop-shadow-[0_4px_10px_rgba(234,179,8,0.4)] mb-1 shrink-0"
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="crownGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FFE082" />
        <stop offset="30%" stopColor="#FFC107" />
        <stop offset="70%" stopColor="#FF9800" />
        <stop offset="100%" stopColor="#DF9F17" />
      </linearGradient>
      <filter id="softGlow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#FFB300" floodOpacity="0.5" />
      </filter>
    </defs>
    <path 
      d="M20,75 C20,75 50,80 80,75 C80,75 80,79 80,81 C80,81 50,86 20,81 C20,79 20,75 20,75 Z" 
      fill="url(#crownGold)" 
    />
    <path 
      d="M20,67 C20,67 50,71 80,67 L80,74 C80,74 50,78 20,74 Z" 
      fill="#D4AF37" 
    />
    <circle cx="30" cy="71" r="2" fill="#E53935" />
    <circle cx="50" cy="72.5" r="2.5" fill="#1E88E5" />
    <circle cx="70" cy="71" r="2" fill="#43A047" />
    <path 
      d="M20,67 L15,35 L35,50 L50,22 L65,50 L85,35 L80,67 C80,67 50,71 20,67 Z" 
      fill="url(#crownGold)" 
      filter="url(#softGlow)"
    />
    <path 
      d="M20,67 L15,35 L35,50 L50,22 L51,22 L36,51 L21,68 Z" 
      fill="white" 
      opacity="0.15" 
    />
    <circle cx="15.5" cy="34" r="3.5" fill="url(#crownGold)" />
    <circle cx="15.5" cy="34" r="1" fill="#FFFFFF" opacity="0.8" />
    <circle cx="50.2" cy="21" r="4.5" fill="url(#crownGold)" />
    <circle cx="50.2" cy="21" r="1.5" fill="#FFFFFF" opacity="0.9" />
    <circle cx="84.5" cy="34" r="3.5" fill="url(#crownGold)" />
    <circle cx="84.5" cy="34" r="1" fill="#FFFFFF" opacity="0.8" />
  </svg>
);

interface DashboardProps {
  currentProfile: PartnerProfile;
  allProfiles: PartnerProfile[];
  onLogout: () => void;
  onModifyProfile: (updated: PartnerProfile) => void;
  onDeleteAccount: () => void;
  broadcastsList: FounderBroadcast[];
  onAddBroadcast: (title: string, content: string) => void;
  withdrawalRequests: WithdrawalRequest[];
  onAddWithdrawalRequest: (req: Omit<WithdrawalRequest, 'id' | 'createdAt' | 'updatedAt' | 'partnerId'>) => void;
  sentEmails: Array<{
    id: string;
    timestamp: string;
    to: string;
    subject: string;
    body: string;
    isSystem: boolean;
  }>;
  onClearEmailLogs?: () => void;
}

export default function Dashboard({ 
  currentProfile, allProfiles, onLogout, onModifyProfile, onDeleteAccount,
  broadcastsList, onAddBroadcast,
  withdrawalRequests, onAddWithdrawalRequest, sentEmails, onClearEmailLogs
}: DashboardProps) {
  // Real verified approved affiliate count for leaderboard locks
  const approvedAffiliatesCount = useMemo(() => {
    return allProfiles.filter(p => p.role === 'user' && p.status === 'approved').length;
  }, [allProfiles]);

  // Navigation tabs of Growth Operating System
  const [activeTab, setActiveTab] = useState<'home' | 'referrals' | 'earnings' | 'campaigns' | 'leaderboard' | 'assets' | 'copilot' | 'training' | 'settings' | 'billing'>('home');

  // Theme control state ("dark" | "light")
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('revluma_theme') as 'light' | 'dark') || 'dark';
  });

  // Track the hovered data element on our conversion line chart
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Multi-attribution Dynamic Campaigns state
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([
    { tag: 'twitter_intel', source: 'Twitter/X Post', clicks: 420, signups: 18, trials: 8, activeSubscribers: 4, conversionRate: 4.28, revenue: 796.00 },
    { tag: 'reddit_shopify', source: 'Reddit Thread', clicks: 310, signups: 12, trials: 4, activeSubscribers: 2, conversionRate: 3.87, revenue: 398.00 },
    { tag: 'agency_mailer', source: 'Email Newsletter', clicks: 580, signups: 42, trials: 22, activeSubscribers: 14, conversionRate: 7.24, revenue: 2786.00 },
    { tag: 'dev_blog_audit', source: 'Blog Post Portfolio', clicks: 120, signups: 5, trials: 3, activeSubscribers: 1, conversionRate: 4.16, revenue: 199.00 }
  ]);

  // Campaign UTM inputs
  const [newTag, setNewTag] = useState('');
  const [newSource, setNewSource] = useState('Twitter/X Profile');

  // Referral tracking database list state
  const [referrals, setReferrals] = useState<ReferredUser[]>([
    { id: 'ref_1', emailMasked: 'al***@vanguard.com', signupDate: '2026-05-12', status: 'Active Subscriber', planName: 'Scale', monthlyValue: 299.00, lifetimeValue: 897.00, campaignTag: 'agency_mailer', lastActive: '2 Hours Ago' },
    { id: 'ref_2', emailMasked: 'te***@shopifypartner.io', signupDate: '2026-05-14', status: 'Trial Started', planName: 'Basic', monthlyValue: 149.00, lifetimeValue: 0.00, campaignTag: 'reddit_shopify', lastActive: '1 Day Ago' },
    { id: 'ref_3', emailMasked: 'gr***@ecommercelabs.net', signupDate: '2026-05-15', status: 'Waitlist Joined', planName: 'None', monthlyValue: 0.00, lifetimeValue: 0.00, campaignTag: 'twitter_intel', lastActive: '3 Days Ago' },
    { id: 'ref_4', emailMasked: 'ma***@stellarbrands.co', signupDate: '2026-05-16', status: 'Active Subscriber', planName: 'Enterprise', monthlyValue: 499.00, lifetimeValue: 499.00, campaignTag: 'agency_mailer', lastActive: '1 Hour Ago' },
    { id: 'ref_5', emailMasked: 're***@growthops.agency', signupDate: '2026-05-18', status: 'Trial Started', planName: 'Scale', monthlyValue: 299.00, lifetimeValue: 0.00, campaignTag: 'twitter_intel', lastActive: '4 Hours Ago' },
    { id: 'ref_6', emailMasked: 'ch***@infinitesandbox.org', signupDate: '2026-05-19', status: 'Waitlist Joined', planName: 'None', monthlyValue: 0.00, lifetimeValue: 0.00, campaignTag: 'dev_blog_audit', lastActive: '5 Mins Ago' },
    { id: 'ref_7', emailMasked: 'st***@checkoutmagic.com', signupDate: '2026-05-19', status: 'Cancelled', planName: 'Basic', monthlyValue: 0.00, lifetimeValue: 149.00, campaignTag: 'reddit_shopify', lastActive: '2 Weeks Ago' }
  ]);

  // Invite referred candidate form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');

  // Clipboard copy state flags
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeCopiedTag, setActiveCopiedTag] = useState<string | null>(null);

  // Notifications read/unread
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    { id: 'not_1', title: 'Recurring Commission Cleared', message: 'Your recurring payment for referral al***@vanguard.com of $89.70 cleared.', timestamp: 'May 18, 2026', read: false, type: 'commission' },
    { id: 'not_2', title: 'Elite Status badge unlocked', message: 'Welcome to Tier 2: Growth Partner Ecosystem! Your commission rates spiked to 30%.', timestamp: 'May 15, 2026', read: false, type: 'badge' },
    { id: 'not_3', title: 'New Waitlist attribution', message: 'Partner code tracking linked a new Shopify store to your twitter segment.', timestamp: 'May 19, 2026', read: true, type: 'signup' }
  ]);

  // Settings pane edits
  const [billingAddress, setBillingAddress] = useState('Stripe Connect / Wallet connected');
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [payoutRoute, setPayoutRoute] = useState('Stripe Direct Transfer');
  const [isDeleting, setIsDeleting] = useState(false);

  // Automated Tour Onboarding Walkthrough Wizard System
  const [tourStep, setTourStep] = useState<number | null>(null);

  // AI content assistant State
  const [selectedChannel, setSelectedChannel] = useState('X');
  const [selectedAudience, setSelectedAudience] = useState('Shopify Store Owners');
  const [coreFeatures, setCoreFeatures] = useState('Automated Revenue Recovery, Subscriber Churn Forecasts');
  const [toneMode, setToneMode] = useState('Futuristic and Bold');
  const [aiIsGenerating, setAiIsGenerating] = useState(false);
  const [generatedAiContent, setGeneratedAiContent] = useState('');
  const [aiSimulationLabel, setAiSimulationLabel] = useState(false);

  // Search input query
  const [searchQuery, setSearchQuery] = useState('');

  // Avatar drag & manual selection upload states
  const [showAvatarUploader, setShowAvatarUploader] = useState(false);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [isAvatarDragging, setIsAvatarDragging] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // Launch Countdown splits state matching the uploaded image design
  const [countdown, setCountdown] = useState({
    days: '05',
    hours: '23',
    minutes: '35',
    seconds: '06'
  });

  const renderLeaderboardAvatar = (username: string, userTier: string, sizeClass: string = "w-10 h-10 rounded-xl text-xs") => {
    // Check if user is in our global profiles database (e.g. current partner, Devon, Alistair)
    const matchedProfile = allProfiles.find(p => p.username.toLowerCase() === username.toLowerCase());
    const url = matchedProfile ? matchedProfile.avatarUrl : (username === currentProfile.username ? currentProfile.avatarUrl : undefined);
    
    if (url) {
      return (
        <img 
          src={url} 
          alt={username}
          referrerPolicy="no-referrer"
          className={`${sizeClass} object-cover border border-zinc-200 dark:border-zinc-800`}
        />
      );
    }
    
    const parts = username.split('_').filter(Boolean);
    let initials = "";
    if (parts.length >= 2) {
      initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (username.length > 0) {
      initials = username.substring(0, 2).toUpperCase();
    } else {
      initials = "?";
    }
    
    let colorClass = "bg-zinc-100 border-zinc-200 text-zinc-650 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400";
    if (userTier === 'Founding Ambassador') {
      colorClass = "bg-emerald-500/15 border-emerald-500/30 text-emerald-400";
    } else if (userTier === 'Elite Partner' || userTier === 'Elite') {
      colorClass = "bg-cyan-500/15 border-cyan-500/30 text-cyan-400";
    } else if (userTier === 'Growth Partner' || userTier === 'Growth') {
      colorClass = "bg-indigo-500/15 border-indigo-500/30 text-indigo-400";
    } else if (userTier === 'Affiliate') {
      colorClass = "bg-orange-500/15 border-orange-500/30 text-orange-400";
    }

    return (
      <div className={`${sizeClass} flex items-center justify-center font-mono font-bold border shrink-0 ${colorClass} shadow-inner`}>
        {initials}
      </div>
    );
  };

  // Core visual metrics computing
  const totalClicks = campaigns.reduce((acc, c) => acc + c.clicks, 0);
  const activeReferralsCount = referrals.filter(r => r.status === 'Active Subscriber').length;
  const trialReferralsCount = referrals.filter(r => r.status === 'Trial Started').length;
  const waitlistReferralsCount = referrals.filter(r => r.status === 'Waitlist Joined').length;
  const grossLtvRevenue = referrals.reduce((acc, r) => acc + r.lifetimeValue, 0);
  
  // Commission amounts
  const monthlyCommissionEarnings = referrals
    .filter(r => r.status === 'Active Subscriber')
    .reduce((acc, r) => acc + r.monthlyValue * currentProfile.commissionRate, 0);

  const pendingCommissionsBalance = referrals
    .filter(r => r.status === 'Trial Started')
    .reduce((acc, r) => acc + r.monthlyValue * currentProfile.commissionRate, 0);

  // Leaderboard lists
  const [leaderboardTimeframe, setLeaderboardTimeframe] = useState<'weekly' | 'monthly'>('monthly');

  // Create deterministic high-end users for the leaderboard, then inject logged-in user dynamically.
  const generatedLeaderboardUsers = useMemo(() => {
    const listSeed = [
      { username: 'marion_stiedemann', baseReferrals: 135, baseRevenue: 42500, baseClickRate: 6.82, avatar: '🛡️', tier: 'Founding Ambassador' },
      { username: 'shannon_kautzer', baseReferrals: 112, baseRevenue: 34100, baseClickRate: 5.95, avatar: '💀', tier: 'Elite Partner' },
      { username: 'billy_mraz', baseReferrals: 98, baseRevenue: 28900, baseClickRate: 5.40, avatar: '👽', tier: 'Elite Partner' },
      { username: 'arthur_grimes', baseReferrals: 84, baseRevenue: 24200, baseClickRate: 4.85, avatar: '🧙‍♂️', tier: 'Elite Partner' },
      { username: 'bernadette_mclaughlin', baseReferrals: 71, baseRevenue: 19800, baseClickRate: 4.50, avatar: '🕵️‍♀️', tier: 'Elite Partner' },
      { username: 'alberta_spencer', baseReferrals: 63, baseRevenue: 17200, baseClickRate: 4.15, avatar: '👩‍🎤', tier: 'Elite Partner' },
      { username: 'leo_ruecker', baseReferrals: 58, baseRevenue: 15400, baseClickRate: 3.90, avatar: '👾', tier: 'Elite Partner' },
      { username: 'rudolph_boehm', baseReferrals: 51, baseRevenue: 13800, baseClickRate: 3.75, avatar: '🧟', tier: 'Elite Partner' },
      { username: 'amber_hustle', baseReferrals: 46, baseRevenue: 11900, baseClickRate: 3.60, avatar: '⚡', tier: 'Growth Partner' },
      { username: 'convert_god', baseReferrals: 42, baseRevenue: 10200, baseClickRate: 3.45, avatar: '🧠', tier: 'Growth Partner' },
      { username: 'saas_nomad', baseReferrals: 38, baseRevenue: 9100, baseClickRate: 3.30, avatar: '🎒', tier: 'Growth Partner' },
      { username: 'growth_oracle', baseReferrals: 35, baseRevenue: 8400, baseClickRate: 3.20, avatar: '🔮', tier: 'Growth Partner' },
      { username: 'recurring_roi', baseReferrals: 33, baseRevenue: 7800, baseClickRate: 3.10, avatar: '📈', tier: 'Growth Partner' },
      { username: 'mrr_vanguard', baseReferrals: 31, baseRevenue: 7100, baseClickRate: 3.00, avatar: '🗡️', tier: 'Growth Partner' },
      { username: 'apex_affiliate', baseReferrals: 29, baseRevenue: 6400, baseClickRate: 2.90, avatar: '🏔️', tier: 'Growth Partner' },
      { username: 'link_commander', baseReferrals: 27, baseRevenue: 5905, baseClickRate: 2.85, avatar: '🛰️', tier: 'Growth Partner' },
      { username: 'commission_czar', baseReferrals: 26, baseRevenue: 5600, baseClickRate: 2.80, avatar: '👑', tier: 'Growth Partner' },
      { username: 'funnel_samurai', baseReferrals: 24, baseRevenue: 5100, baseClickRate: 2.70, avatar: '⚔️', tier: 'Growth Partner' },
      { username: 'click_magnet', baseReferrals: 22, baseRevenue: 4700, baseClickRate: 2.60, avatar: '🧲', tier: 'Growth Partner' },
      { username: 'yield_wizard', baseReferrals: 21, baseRevenue: 4400, baseClickRate: 2.55, avatar: '🧙', tier: 'Growth Partner' },
      { username: 'sub_architect', baseReferrals: 19, baseRevenue: 4100, baseClickRate: 2.50, avatar: '📐', tier: 'Growth Partner' },
      { username: 'traffic_hacks', baseReferrals: 18, baseRevenue: 3800, baseClickRate: 2.45, avatar: '🚦', tier: 'Growth Partner' },
      { username: 'epic_recurrent', baseReferrals: 16, baseRevenue: 3400, baseClickRate: 2.40, avatar: '🎨', tier: 'Growth Partner' },
      { username: 'nordic_funnel', baseReferrals: 15, baseRevenue: 3150, baseClickRate: 2.35, avatar: '❄️', tier: 'Growth Partner' },
      { username: 'infinite_leads', baseReferrals: 14, baseRevenue: 2950, baseClickRate: 2.30, avatar: '♾️', tier: 'Affiliate' },
      { username: 'scale_ninja', baseReferrals: 13, baseRevenue: 2700, baseClickRate: 2.25, avatar: '🥷', tier: 'Affiliate' },
      { username: 'mrr_farmer', baseReferrals: 12, baseRevenue: 2500, baseClickRate: 2.20, avatar: '🌾', tier: 'Affiliate' },
      { username: 'ecom_pioneer', baseReferrals: 11, baseRevenue: 2280, baseClickRate: 2.15, avatar: '🚀', tier: 'Affiliate' },
      { username: 'affiliate_ops', baseReferrals: 10, baseRevenue: 2100, baseClickRate: 2.10, avatar: '⚙️', tier: 'Affiliate' },
      { username: 'buzz_marketeer', baseReferrals: 9, baseRevenue: 1900, baseClickRate: 2.05, avatar: '🐝', tier: 'Affiliate' },
      { username: 'pixel_pirate', baseReferrals: 9, baseRevenue: 1800, baseClickRate: 2.00, avatar: '🏴‍☠️', tier: 'Affiliate' },
      { username: 'revenue_hound', baseReferrals: 8, baseRevenue: 1650, baseClickRate: 1.95, avatar: '🐕', tier: 'Affiliate' },
      { username: 'growth_catalyst', baseReferrals: 8, baseRevenue: 1550, baseClickRate: 1.90, avatar: '🧪', tier: 'Affiliate' },
      { username: 'lead_architect', baseReferrals: 7, baseRevenue: 1400, baseClickRate: 1.85, avatar: '🏛️', tier: 'Affiliate' },
      { username: 'saas_conqueror', baseReferrals: 7, baseRevenue: 1300, baseClickRate: 1.80, avatar: '🏹', tier: 'Affiliate' },
      { username: 'referral_beacon', baseReferrals: 6, baseRevenue: 1180, baseClickRate: 1.75, avatar: '🚨', tier: 'Affiliate' },
      { username: 'digital_mrr', baseReferrals: 6, baseRevenue: 1100, baseClickRate: 1.70, avatar: '💻', tier: 'Affiliate' },
      { username: 'passive_sailor', baseReferrals: 5, baseRevenue: 980, baseClickRate: 1.65, avatar: '⛵', tier: 'Affiliate' },
      { username: 'hyper_links', baseReferrals: 5, baseRevenue: 920, baseClickRate: 1.60, avatar: '🔗', tier: 'Affiliate' },
      { username: 'earnings_vibe', baseReferrals: 4, baseRevenue: 850, baseClickRate: 1.55, avatar: '💎', tier: 'Affiliate' },
      { username: 'alpha_clicks', baseReferrals: 4, baseRevenue: 780, baseClickRate: 1.50, avatar: '🦊', tier: 'Affiliate' },
      { username: 'scale_ranger', baseReferrals: 3, baseRevenue: 650, baseClickRate: 1.45, avatar: '🤠', tier: 'Affiliate' },
      { username: 'saas_vetted', baseReferrals: 3, baseRevenue: 580, baseClickRate: 1.40, avatar: '✍️', tier: 'Affiliate' },
      { username: 'funnel_monk', baseReferrals: 3, baseRevenue: 520, baseClickRate: 1.35, avatar: '🧘', tier: 'Affiliate' },
      { username: 'growth_scout', baseReferrals: 2, baseRevenue: 420, baseClickRate: 1.30, avatar: '🎒', tier: 'Affiliate' },
      { username: 'commission_bee', baseReferrals: 2, baseRevenue: 380, baseClickRate: 1.25, avatar: '🐝', tier: 'Affiliate' },
      { username: 'yield_miner', baseReferrals: 2, baseRevenue: 320, baseClickRate: 1.20, avatar: '⛏️', tier: 'Affiliate' },
      { username: 'revenue_river', baseReferrals: 1, baseRevenue: 180, baseClickRate: 1.15, avatar: '🏞️', tier: 'Affiliate' },
      { username: 'click_champion', baseReferrals: 1, baseRevenue: 140, baseClickRate: 1.10, avatar: '🏅', tier: 'Affiliate' },
      { username: 'lead_scout', baseReferrals: 1, baseRevenue: 110, baseClickRate: 1.05, avatar: '🏕️', tier: 'Affiliate' },
    ];

    // Filter out user in case they already exist under the same username
    const cleanList = listSeed.filter(u => u.username !== currentProfile.username);

    // Calculate user real live properties
    const userReferrals = activeReferralsCount + waitlistReferralsCount;
    const userRevenue = grossLtvRevenue || (userReferrals * 242);
    const userClicksCount = totalClicks || 1;
    const userClickRateText = ((userReferrals / userClicksCount) * 100);
    const userClickRate = +Math.min(25, Math.max(0.5, userClickRateText)).toFixed(2) || 4.5;

    // Inject user
    cleanList.push({
      username: currentProfile.username,
      baseReferrals: userReferrals,
      baseRevenue: userRevenue,
      baseClickRate: userClickRate,
      avatar: '👑',
      tier: currentProfile.tier
    });

    // Sort descending by referrals, then revenue
    cleanList.sort((a, b) => b.baseReferrals - a.baseReferrals || b.baseRevenue - a.baseRevenue);

    // Map ranks and points
    return cleanList.map((usr, index) => {
      const rankVal = index + 1;
      const calculatedPoints = Math.round(usr.baseReferrals * 150 + usr.baseRevenue * 0.1);
      return {
        rank: rankVal,
        username: usr.username,
        tier: usr.tier,
        points: calculatedPoints,
        referralsCount: usr.baseReferrals,
        revenueGenerated: Math.round(usr.baseRevenue),
        avatarSeed: usr.avatar,
        clickRate: usr.baseClickRate
      };
    });
  }, [activeReferralsCount, waitlistReferralsCount, grossLtvRevenue, totalClicks, currentProfile]);

  const userLeaderboardStanding = useMemo(() => {
    return generatedLeaderboardUsers.find(u => u.username === currentProfile.username) || {
      rank: 51,
      username: currentProfile.username,
      tier: currentProfile.tier,
      points: 0,
      referralsCount: 0,
      revenueGenerated: 0,
      avatarSeed: '👑',
      clickRate: 0
    };
  }, [generatedLeaderboardUsers, currentProfile]);


  // Sync theme to localStorage and body background colors
  useEffect(() => {
    localStorage.setItem('revluma_theme', theme);
    if (theme === 'light') {
      document.body.style.backgroundColor = '#f4f5f7'; // Stripe light canvas
      document.body.style.color = '#111827';
    } else {
      document.body.style.backgroundColor = '#09090b'; // dark zinc screen
      document.body.style.color = '#f4f4f5';
    }
  }, [theme]);

  // Initiate Tour guide if they click "Get Walkthrough" or on first launch
  useEffect(() => {
    const hasSeenTour = localStorage.getItem('revluma_onboarding_tour_complete');
    if (!hasSeenTour) {
      setTourStep(1);
    }
  }, []);

  // Launch Countdown dynamic updates matching the split-flap design
  useEffect(() => {
    const baseTargetTime = new Date('2026-05-26T08:21:46Z').getTime();
    
    const calculateTime = () => {
      let diff = baseTargetTime - Date.now();
      
      // Safety: If the target is in the past, calculate relative offset to keep it active
      if (diff <= 0) {
        const relativeTarget = new Date();
        relativeTarget.setDate(relativeTarget.getDate() + 5);
        relativeTarget.setHours(relativeTarget.getHours() + 23);
        relativeTarget.setMinutes(relativeTarget.getMinutes() + 35);
        relativeTarget.setSeconds(relativeTarget.getSeconds() + 6);
        diff = relativeTarget.getTime() - Date.now();
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown({
        days: d.toString().padStart(2, '0'),
        hours: h.toString().padStart(2, '0'),
        minutes: m.toString().padStart(2, '0'),
        seconds: s.toString().padStart(2, '0')
      });
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const completeTour = () => {
    localStorage.setItem('revluma_onboarding_tour_complete', 'true');
    setTourStep(null);
  };

  // Clipboard Utilities
  const copyReferralLink = () => {
    const link = `https://revluma.io/partner/${currentProfile.username}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyAffiliateCode = () => {
    const code = `REVLUMA_${currentProfile.username.toUpperCase()}`;
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyCustomTagLink = (tag: string) => {
    const link = `https://revluma.io/partner/${currentProfile.username}?utm_source=partner&utm_campaign=${tag}`;
    navigator.clipboard.writeText(link);
    setActiveCopiedTag(tag);
    setTimeout(() => setActiveCopiedTag(null), 2000);
  };

  // UTM Generator Add Action
  const handleCreateUTMLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTag.trim()) return;

    const formattedTag = newTag.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const isDuplicate = campaigns.some(c => c.tag === formattedTag);
    if (isDuplicate) return;

    setCampaigns(prev => [
      ...prev,
      {
        tag: formattedTag,
        source: newSource,
        clicks: 0,
        signups: 0,
        trials: 0,
        activeSubscribers: 0,
        conversionRate: 0.0,
        revenue: 0.0
      }
    ]);
    setNewTag('');
  };

  // Simulated invite referrals
  const handleSendInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteStatus("Input validated client email.");
      return;
    }

    setInviteStatus("Inviting... Creating partner ledger.");
    setTimeout(() => {
      setReferrals(prev => [
        {
          id: `ref_${Date.now()}`,
          emailMasked: inviteEmail.substring(0, 3) + '***@' + inviteEmail.split('@')[1],
          signupDate: new Date().toISOString().split('T')[0],
          status: 'Pending',
          planName: 'None',
          monthlyValue: 0.0,
          lifetimeValue: 0.0,
          campaignTag: 'custom_invite',
          lastActive: 'Just Now'
        },
        ...prev
      ]);
      setInviteEmail('');
      setInviteStatus("Invitation dispatched. Client added to pending queue.");
    }, 1000);
  };

  // AI copilot dispatch system using real Gemini
  const handleGenerateAiPromo = async () => {
    setAiIsGenerating(true);
    setGeneratedAiContent('');
    setErrorTextGlobal('');

    try {
      const response = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: selectedChannel,
          targetAudience: selectedAudience,
          coreFeatures: coreFeatures,
          tone: toneMode
        })
      });

      const data = await response.json();
      if (response.ok) {
        setGeneratedAiContent(data.text);
        setAiSimulationLabel(data.simulated || false);
      } else {
        setErrorTextGlobal(data.error || "Failed to communicate with copywriting agent.");
      }
    } catch (e: any) {
      console.error(e);
      setErrorTextGlobal("Network configuration failed. Fallen back into secure simulation layers.");
    } finally {
      setAiIsGenerating(false);
    }
  };

  const [errorTextGlobal, setErrorTextGlobal] = useState('');

  const handleAvatarSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert("Invalid format: Please provide a PNG, JPG or web-safe image file.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      alert("Selected image is too large. Max size allowed is 3MB.");
      return;
    }
    setSelectedAvatarFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setAvatarPreviewUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsAvatarDragging(true);
  };

  const handleAvatarDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsAvatarDragging(false);
  };

  const handleAvatarDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsAvatarDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleAvatarSelect(e.dataTransfer.files[0]);
    }
  };

  const handleAvatarUploadSubmit = () => {
    if (!avatarPreviewUrl) return;
    setIsUploadingAvatar(true);
    setTimeout(() => {
      onModifyProfile({
        ...currentProfile,
        avatarUrl: avatarPreviewUrl
      });
      setIsUploadingAvatar(false);
      setSelectedAvatarFile(null);
      setAvatarPreviewUrl(null);
      setShowAvatarUploader(false);
      
      const newNotification: NotificationItem = {
        id: `noti_avatar_${Date.now()}`,
        title: 'Avatar Image Updated Successfully',
        message: 'Your partner profile identity has been synchronized across all Revluma tracking systems.',
        timestamp: 'Just Now',
        read: false,
        type: 'badge'
      };
      setNotifications(prev => [newNotification, ...prev]);
    }, 600);
  };

  const handleMarkNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read: true })));
  };

  const handleTierManualLevelUp = (targetTier: 'Affiliate' | 'Growth' | 'Elite' | 'Founding Ambassador') => {
    let rate = 0.20;
    if (targetTier === 'Growth') rate = 0.30;
    if (targetTier === 'Elite') rate = 0.35;
    if (targetTier === 'Founding Ambassador') rate = 0.40;

    onModifyProfile({
      ...currentProfile,
      tier: targetTier,
      commissionRate: rate
    });
  };

  // Modern dynamic trend metrics for calculation and custom SVG graphics
  const trendData = [
    { day: 'Mon', clicks: 140, registrations: 8 },
    { day: 'Tue', clicks: 210, registrations: 12 },
    { day: 'Wed', clicks: 350, registrations: 19 },
    { day: 'Thu', clicks: 290, registrations: 15 },
    { day: 'Fri', clicks: totalClicks > 500 ? totalClicks - 100 : 480, registrations: activeReferralsCount + 12 },
    { day: 'Sat', clicks: totalClicks > 500 ? totalClicks - 50 : 520, registrations: activeReferralsCount + 20 },
    { day: 'Sun', clicks: totalClicks, registrations: referrals.length },
  ];

  // Color theme logic mappings (Enterprise Grade palette)
  const isDark = theme === 'dark';
  
  // Theme Styles variables
  const containerBg = isDark ? "bg-[#09090b]" : "bg-[#f4f5f7]";
  const sidebarBg = isDark ? "bg-[#0b0b0e] border-r border-[#18181c]" : "bg-white border-r border-zinc-200/80";
  const mainWorkspaceBg = isDark ? "bg-[#09090b]" : "bg-[#f8f9fa]";
  const headerBg = isDark ? "bg-[#09090b]/45 border-b border-[#1c1c22]" : "bg-white border-b border-zinc-100";
  const cardBg = isDark 
    ? "bg-zinc-900/40 backdrop-blur-xl border border-zinc-850/80 shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:border-zinc-700/65 transition-all duration-300 rounded-2xl" 
    : "bg-white/60 backdrop-blur-xl border border-zinc-200/80 shadow-[0_8px_32px_rgba(31,38,135,0.03)] hover:border-zinc-300 transition-all duration-300 rounded-2xl";
  const cardInnerBg = isDark ? "bg-zinc-950/60 border border-zinc-805/50 rounded-xl" : "bg-zinc-50 border border-zinc-100 rounded-xl";
  const textTitleColor = isDark ? "text-white font-semibold font-display" : "text-zinc-900 font-semibold font-display";
  const textMutedColor = isDark ? "text-zinc-400 font-sans" : "text-zinc-500 font-sans";
  const textSubtleLabel = isDark ? "text-[9px] font-mono uppercase tracking-wider text-zinc-500" : "text-[9px] font-mono uppercase tracking-wider text-zinc-400";
  const inputElBg = isDark ? "bg-[#09090b] text-white border-[#24242c] focus:border-[#404050]" : "bg-white text-zinc-900 border-zinc-200 focus:border-zinc-400";
  const tableHeaderBg = isDark ? "bg-[#0e0e11]" : "bg-[#f8f9fa]";
  const tableBorder = isDark ? "border-[#1e1e24]" : "border-zinc-200/50";
  
  // Custom Timeline Gantt Milestones Database matching the theme
  const milestones = [
    { id: 1, title: 'Shopify Checkout Conversion Audit', site: 'checkoutmagic.com', days: [1, 2, 3], priority: 'LIVE ACTIVATION', priorityCol: 'bg-emerald-500', members: 'M1', status: 'In Progress' },
    { id: 2, title: 'Contract LTV Multiplier Activation', site: 'vanguard.com', days: [3, 4], priority: 'HIGH PRIORITY', priorityCol: 'bg-orange-500', members: 'M2', status: 'Completed' },
    { id: 3, title: 'Store Activity Logs Synchronization', site: 'growthops.agency', days: [5, 6, 7], priority: 'PAYOUT QUEUED', priorityCol: 'bg-indigo-500', members: 'M3', status: 'Under Review' },
    { id: 4, title: 'UTM Tracking Verification Check', site: 'shopifydeals.com', days: [2, 3, 4], priority: 'LOW PRIORITY', priorityCol: 'bg-zinc-500', members: 'M4', status: 'Awaiting Vetting' }
  ];

  return (
    <div id="dashboard-host" className={`min-h-screen flex ${containerBg} text-zinc-100 transition-all duration-300 font-sans`}>
      
      {/* ONBOARDING TOUR OVERLAYS (Walkthrough tutorial) */}
      {tourStep !== null && (
        <div id="onboarding-tour-modal" className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-7 max-w-md w-full relative space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-zinc-850">
              <div className="flex items-center space-x-2 text-rose-500">
                <BrainCircuit className="w-5 h-5 text-zinc-300" />
                <span className="font-display font-semibold text-sm text-zinc-100">GrowOps Partner Manual</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-550">Guide Step {tourStep} of 4</span>
            </div>

            {tourStep === 1 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-white">Dynamic KPI Center</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Analyze your overall referred conversions, clicks, annual recurring projections, and live dashboard rank vectors in real-time. Experience Stripe-like pixel transparency.
                </p>
              </div>
            )}

            {tourStep === 2 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-white">Advanced UTM Tracking engine</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Navigate to the <strong>Campaigns</strong> portal to instantiate custom attribution identifiers. Track which promotional channels clear the highest yield rate.
                </p>
              </div>
            )}

            {tourStep === 3 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-white">Autonomous AI Copywriter Agent</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Launch the <strong>AI Content Assistant</strong> to invoke server-side Gemini models. Instant copywriting tailored perfectly for Twitter/X threads, Reddit, or email loops.
                </p>
              </div>
            )}

            {tourStep === 4 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-white">Selective Partner Tiers</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Ascend across <strong>Affiliate, Growth, Elite, and Ambassador</strong> levels to unlock commissions rates up to 40% and private advisory access.
                </p>
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-zinc-850">
              <button 
                onClick={completeTour}
                className="text-[10px] font-mono text-zinc-500 hover:text-white transition-colors"
                id="skip-tour-btn"
              >
                Skip Handbook Walkthrough
              </button>
              <div className="flex space-x-2">
                {tourStep > 1 && (
                  <button 
                    onClick={() => setTourStep(prev => prev! - 1)}
                    className="px-3 py-1.5 rounded-lg text-[10px] bg-zinc-950 hover:bg-zinc-800 text-zinc-300 font-mono"
                  >
                    Prev
                  </button>
                )}
                {tourStep < 4 ? (
                  <button 
                    onClick={() => setTourStep(prev => prev! + 1)}
                    className="px-4 py-1.5 rounded-lg text-[10px] bg-white hover:bg-zinc-200 text-zinc-900 font-mono flex items-center gap-1 font-semibold"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                ) : (
                  <button 
                    onClick={completeTour}
                    className="px-4 py-1.5 rounded-lg text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white font-mono font-semibold"
                  >
                    Understand & Launch
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD LEFT COLUMN SIDEBAR */}
      <aside id="sidebar-left" className={`w-64 shrink-0 hidden md:flex flex-col justify-between z-10 ${sidebarBg} transition-all duration-300`}>
        
        {/* BRAND ID - PLANMATE INSPIRED */}
        <div className="p-6 border-b border-zinc-200/50 dark:border-zinc-900 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center shadow-[0_2px_10px_rgba(239,68,68,0.35)]">
              <Cpu className="w-4 h-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span className={`font-display font-bold text-xs tracking-wider uppercase ${isDark ? "text-white" : "text-zinc-900"}`}>REVLUMA GOS</span>
              <span className="text-[8px] text-zinc-400 dark:text-zinc-500 font-mono tracking-widest font-bold">OPERATIONS CENTER</span>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => setTourStep(1)}
            title="System Diagnostics HUD"
            className="p-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* NAVIGATION MENUS */}
        <div className="flex-1 py-7 px-4 space-y-1.5 overflow-y-auto no-scrollbar">
          <div className="text-[9px] font-mono tracking-widest font-bold text-zinc-400 dark:text-zinc-650 px-3 uppercase mb-2">Main Menu</div>
          
          <button 
            onClick={() => setActiveTab('home')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'home' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>Dashboard Home</span>
          </button>

          <button 
            onClick={() => setActiveTab('referrals')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'referrals' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>Referrals Database</span>
          </button>

          <button 
            onClick={() => setActiveTab('earnings')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'earnings' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <PiggyBank className="w-4 h-4 shrink-0" />
            <span>Ledger Earnings</span>
          </button>

          <button 
            onClick={() => setActiveTab('billing')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'billing' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <CreditCard className="w-4 h-4 shrink-0" />
            <span>Lemon Squeezy Hub</span>
          </button>

          <button 
            onClick={() => setActiveTab('campaigns')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'campaigns' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <Globe className="w-4 h-4 shrink-0" />
            <span>Campaign Center (UTM)</span>
          </button>

          <button 
            onClick={() => setActiveTab('copilot')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'copilot' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <BrainCircuit className="w-4 h-4 shrink-0" />
            <span className="flex items-center gap-1.5">
              AI Copy Copilot
              <Sparkles className="w-3 h-3 text-orange-400 dark:text-zinc-100 animate-pulse" />
            </span>
          </button>

          <div className="pt-4 text-[9px] font-mono tracking-widest font-bold text-zinc-400 dark:text-zinc-650 px-3 uppercase mb-2">Leaderboard</div>

          <button 
            onClick={() => setActiveTab('leaderboard')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'leaderboard' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <Award className="w-4 h-4 shrink-0" />
            <span>Leaderboard</span>
          </button>

          <button 
            onClick={() => setActiveTab('assets')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'assets' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span>Resource Assets</span>
          </button>

          <button 
            onClick={() => setActiveTab('training')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'training' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>Academy Knowledge</span>
          </button>

          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center space-x-3 px-3.5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeTab === 'settings' 
                ? 'bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]' 
                : `${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-900/50' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`
            }`}
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span>Portal Settings</span>
          </button>
        </div>

        {/* LOGGED IN USER DATA CARD BOTTOM */}
        <div className={`p-4 border-t ${isDark ? 'border-zinc-900 bg-[#0d0d10]' : 'border-zinc-100 bg-zinc-50/70'} space-y-3.5`}>
          <div className="flex items-center gap-3 relative group">
            <div className="relative">
              {currentProfile.avatarUrl ? (
                <img 
                  src={currentProfile.avatarUrl} 
                  alt={currentProfile.fullName}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover border border-zinc-200 dark:border-zinc-800"
                />
              ) : (
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm ${isDark ? 'bg-zinc-900 border border-zinc-800 text-orange-400' : 'bg-orange-100 border border-orange-200 text-orange-700'}`}>
                  {currentProfile.fullName.charAt(0)}
                </div>
              )}
              {/* Compact Floating Camera Button */}
              <button 
                onClick={() => setShowAvatarUploader(!showAvatarUploader)}
                className="absolute -bottom-1 -right-1 w-4.5 h-4.5 rounded-full bg-orange-500 hover:bg-orange-600 border border-white dark:border-zinc-950 flex items-center justify-center text-white shadow transition-transform scale-90 group-hover:scale-100 cursor-pointer"
                title="Update Avatar Icon"
              >
                <Camera className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-xs font-bold truncate ${isDark ? "text-white" : "text-zinc-900"}`}>{currentProfile.fullName}</div>
              <div className="text-[10px] text-zinc-500 font-mono tracking-wide truncate">@{currentProfile.username}</div>
            </div>
          </div>

          {/* Interactive uploader collapsible slot */}
          {showAvatarUploader && (
            <div className={`p-3 rounded-xl border mt-2 space-y-2.5 transition-all duration-300 animate-fade-in ${
              isDark ? 'bg-black/40 border-zinc-900' : 'bg-white border-zinc-200 shadow-md'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-mono font-bold text-orange-500 uppercase tracking-wider">Update Avatar</span>
                <button 
                  onClick={() => {
                    setShowAvatarUploader(false);
                    setSelectedAvatarFile(null);
                    setAvatarPreviewUrl(null);
                  }}
                  className="text-[8px] font-mono text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-bold uppercase transition"
                >
                  Cancel
                </button>
              </div>

              {/* Touch & Drag Trigger Box */}
              <div 
                onDragOver={handleAvatarDragOver}
                onDragLeave={handleAvatarDragLeave}
                onDrop={handleAvatarDrop}
                onClick={() => document.getElementById('sidebar-avatar-input')?.click()}
                className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-all ${
                  isAvatarDragging 
                    ? 'border-orange-500 bg-orange-500/5' 
                    : isDark 
                      ? 'border-zinc-805 hover:border-zinc-700 bg-zinc-950/20 hover:bg-zinc-900/15' 
                      : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50 hover:bg-zinc-100/50'
                }`}
              >
                <input 
                  type="file" 
                  id="sidebar-avatar-input"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleAvatarSelect(e.target.files[0]);
                    }
                  }}
                />
                
                {avatarPreviewUrl ? (
                  <div className="flex flex-col items-center space-y-1.5">
                    <img 
                      src={avatarPreviewUrl} 
                      alt="Preview"
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800 mx-auto"
                    />
                    <span className="text-[8px] font-mono text-emerald-500 font-medium truncate max-w-[130px] block">
                      {selectedAvatarFile?.name || "Ready to commit"}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="w-3.5 h-3.5 text-zinc-400 mx-auto" />
                    <p className="text-[8px] text-zinc-500 leading-tight">
                      <span className="text-orange-500 font-bold">Select File</span> or Drag & Drop (Max 3MB)
                    </p>
                  </div>
                )}
              </div>

              {/* CTA Action Save button */}
              {avatarPreviewUrl && (
                <button
                  onClick={handleAvatarUploadSubmit}
                  disabled={isUploadingAvatar}
                  className="w-full py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-400 text-white font-mono font-bold text-[8px] rounded-lg tracking-wider uppercase transition-colors flex items-center justify-center gap-1 shadow-sm"
                >
                  {isUploadingAvatar ? (
                    <>
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      <span>Syncing...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-2.5 h-2.5" />
                      <span>Upload Avatar</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          <div className="flex justify-between items-center text-[10px] border-t border-zinc-200/50 dark:border-zinc-900 pt-3 text-zinc-450 font-mono font-medium">
            <span>Comm: {(currentProfile.commissionRate * 100).toFixed(0)}%</span>
            <button 
              onClick={onLogout} 
              className="text-zinc-400 hover:text-red-500 flex items-center gap-1 transition-colors cursor-pointer text-[10px] font-semibold"
              id="logout-btn-sidebar"
            >
              <span>Logout</span>
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* DASHBOARD RIGHT COLUMN WORKSPACE */}
      <div className={`flex-1 flex flex-col min-h-screen overflow-y-auto ${mainWorkspaceBg} transition-all duration-300`}>
        
        {/* TOP STATUS BAR CONTAINER */}
        <header id="dashboard-header" className={`h-16 px-8 flex items-center justify-between sticky top-0 backdrop-blur z-20 ${headerBg} transition-all duration-200`}>
          
          <div className="flex items-center gap-4 flex-1">
            <div className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg bg-orange-500 text-white">
              <Cpu className="w-4 h-4" />
            </div>
            {/* Search controller matching Stripe mockups */}
            <div className="relative max-w-xs w-full hidden sm:block">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="w-4 h-4 text-zinc-400" />
              </span>
              <input 
                type="text" 
                placeholder="Search resources, clients, APIs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`py-2 pl-9 pr-4 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-all font-sans ${inputElBg}`}
              />
            </div>
          </div>

          <div className="flex items-center space-x-6">
            
            {/* Database Connection Status Badge */}
            <div className={`hidden sm:flex items-center space-x-1.5 text-[9px] font-mono tracking-wider font-semibold uppercase px-2.5 py-1 rounded-full border ${
              isSupabaseConfigured() 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-orange-500/10 text-orange-400 border-orange-500/20'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isSupabaseConfigured() ? 'bg-emerald-400 animate-pulse' : 'bg-orange-400'
              }`} />
              <span>{isSupabaseConfigured() ? 'Supabase Realtime Secured' : 'Local Sandbox Mode'}</span>
            </div>

            {/* Theme Toggle System (Light & Dark theme) */}
            <div className={`flex items-center p-1 rounded-xl shadow-inner ${isDark ? 'bg-zinc-900' : 'bg-zinc-100'}`}>
              <button 
                onClick={() => setTheme('light')}
                className={`p-1.5 rounded-lg transition-all ${theme === 'light' ? 'bg-white text-orange-500 shadow-sm' : 'text-zinc-500'}`}
                title="Sleek Shopify Light Theme"
              >
                <Sun className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => setTheme('dark')}
                className={`p-1.5 rounded-lg transition-all ${theme === 'dark' ? 'bg-zinc-950 text-orange-400 shadow-sm' : 'text-zinc-500'}`}
                title="Stripe Cyber Dark Theme"
              >
                <Moon className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Role indicator badge */}
            <div className={`hidden lg:flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono font-semibold ${isDark ? 'bg-zinc-900 border border-zinc-800 text-orange-400' : 'bg-orange-50 border border-orange-100 text-orange-600'}`}>
              <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-ping"></span>
              <span>VERIFIED: {currentProfile.role.toUpperCase()}</span>
            </div>

            {/* Notifications Dropdown Tray */}
            <div className="relative group cursor-pointer py-1">
              <span className="p-1 relative block">
                <Bell className={`w-4.5 h-4.5 transition-colors ${isDark ? 'text-zinc-300 group-hover:text-white' : 'text-zinc-600 group-hover:text-zinc-900'}`} />
                {notifications.some(n => !n.read) && (
                  <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-orange-500 rounded-full ring-2 ring-white dark:ring-zinc-950 animate-bounce"></span>
                )}
              </span>

              {/* Float popover notification box */}
              <div className={`absolute right-0 top-full mt-2 w-80 rounded-2xl p-5 shadow-xl hidden group-hover:block z-35 space-y-3 cursor-default transition-all duration-300 ${isDark ? 'bg-[#121215] border border-zinc-800' : 'bg-white border border-zinc-200'}`}>
                <div className="flex justify-between items-center text-[10px] font-mono border-b border-zinc-200/50 dark:border-zinc-800 pb-2">
                  <span className={`uppercase font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>Operational Inbox</span>
                  <button onClick={handleMarkNotificationsRead} className="text-orange-500 hover:text-orange-600 font-semibold">Mark all read</button>
                </div>
                <div className="space-y-3 max-h-64 overflow-y-auto pt-1">
                  {notifications.map(n => (
                    <div key={n.id} className="text-xs leading-relaxed space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span className={isDark ? 'text-zinc-200' : 'text-zinc-800'}>{n.title}</span>
                        <span className="text-[9px] text-zinc-400">{n.timestamp}</span>
                      </div>
                      <p className="text-zinc-500 dark:text-zinc-400 leading-normal text-[11px]">{n.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Mini Avatar indicators */}
            {currentProfile.avatarUrl ? (
              <img 
                src={currentProfile.avatarUrl} 
                alt={currentProfile.fullName}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover ring-2 ring-orange-500/20 shadow-inner"
              />
            ) : (
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ring-2 ring-orange-500/20 ${isDark ? 'bg-zinc-900 text-white' : 'bg-orange-500 text-white'}`}>
                {currentProfile.fullName.charAt(0)}
              </div>
            )}
          </div>
        </header>

        {/* Dynamic Mobile Tab Switcher */}
        <div id="mobile-nav" className="md:hidden flex px-6 py-2.5 border-b border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-900 overflow-x-auto gap-1 no-scrollbar">
          {['home', 'referrals', 'earnings', 'campaigns', 'copilot', 'leaderboard', 'settings'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-mono whitespace-nowrap font-bold tracking-wide uppercase ${
                activeTab === tab 
                  ? 'bg-orange-500 text-white' 
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* MASTER VIEWER SCREEN ACCORDING TO TABS */}
        <main className="p-8 space-y-8 flex-1">
          
          {/* TAB 1: HOME PANEL */}
          {activeTab === 'home' && (
            <div className="space-y-8">
              
              {/* Authorized state banner / debug switcher */}
              <div className={`p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all ${
                isDark ? 'bg-[#15151a] border border-[#272731]' : 'bg-orange-500/5 border border-orange-500/10'
              }`}>
                <div className="space-y-1">
                  <div className="flex items-center space-x-1.5 text-xs text-orange-500 dark:text-orange-400 font-bold uppercase tracking-wider">
                    <Sparkles className="w-4 h-4 text-orange-500 shrink-0" />
                    <span>Authorized Partner Enterprise Hub</span>
                  </div>
                  <p className={`text-xs leading-relaxed max-w-xl ${textMutedColor}`}>
                    Welcome to the Revluma high-performance ecosystem. Build UTM links, launch Gemini content pipelines, and scale referral payouts.
                  </p>
                </div>
                
                {/* Manual override debugging tools directly inside layout */}
                <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0">
                  <span className="text-[9px] font-mono text-zinc-400 dark:text-zinc-500 uppercase tracking-widest font-bold">Diagnostics HUD:</span>
                  <button 
                    onClick={() => handleTierManualLevelUp('Growth')}
                    className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded text-[9px] font-mono font-semibold transition-colors cursor-pointer"
                  >
                    Set Growth (30%)
                  </button>
                  <button 
                    onClick={() => handleTierManualLevelUp('Elite')}
                    className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded text-[9px] font-mono font-semibold transition-colors cursor-pointer"
                  >
                    Set Elite (35%)
                  </button>
                </div>
              </div>

              {/* Launch Countdown Component Inspired by the Split-Flap Image */}
              <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-[#0a0b10] border border-zinc-850 shadow-[0_4px_30px_rgba(0,0,0,0.5)] bg-gradient-to-br from-[#12131b] to-[#08080c] text-white">
                {/* Background Grid Pattern Accent */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293708_1px,transparent_1px),linear-gradient(to_bottom,#1f293708_1px,transparent_1px)] bg-[size:16px_28px] pointer-events-none opacity-40"></div>
                
                {/* Visual Glassy Ambient Lights */}
                <div className="absolute -top-12 -left-12 w-48 h-48 bg-orange-500/15 rounded-full blur-[80px] pointer-events-none"></div>
                <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-purple-500/10 rounded-full blur-[80px] pointer-events-none"></div>

                <div className="relative flex flex-col lg:flex-row items-center justify-between gap-6">
                  {/* Left Side Labels */}
                  <div className="space-y-2 text-center lg:text-left">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-[9px] font-mono tracking-widest text-orange-400 font-bold uppercase">
                      <Sparkles className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
                      <span>GROWTH PLATFORM PRE-REGISTRATION LIVE</span>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-black font-display tracking-tight text-white animate-fade-in">
                      Launch Countdown
                    </h3>
                    <p className="text-xs text-zinc-400 max-w-md leading-relaxed">
                      The official rollout of the Revluma SaaS partner ecosystem commences soon. Track conversion flow vectors and prepare affiliate campaigns.
                    </p>
                  </div>

                  {/* Right Side Split-Flap Clock matching the Uploaded Image */}
                  <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 bg-black/40 p-5 sm:p-6 rounded-2xl border border-zinc-900/60 backdrop-blur-md">
                    {/* Days Column */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-mono font-bold text-zinc-400 tracking-widest uppercase mb-2">DAYS</span>
                      <div className="relative bg-[#111218] rounded-xl border border-zinc-800/80 shadow-[0_4px_12px_rgba(0,0,0,0.8)] overflow-hidden w-16 sm:w-20 py-3.5 sm:py-4 text-center flex items-center justify-center">
                        {/* Split Flap Divider Line */}
                        <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-black shadow-[0_0.5px_0_rgba(255,255,255,0.08)] z-10" />
                        <span className="text-3xl sm:text-5xl font-extrabold font-mono text-white tracking-tight relative z-0">
                          {countdown.days}
                        </span>
                      </div>
                    </div>

                    {/* Hours Column */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-mono font-bold text-zinc-400 tracking-widest uppercase mb-2">HOURS</span>
                      <div className="relative bg-[#111218] rounded-xl border border-zinc-800/80 shadow-[0_4px_12px_rgba(0,0,0,0.8)] overflow-hidden w-16 sm:w-20 py-3.5 sm:py-4 text-center flex items-center justify-center">
                        {/* Split Flap Divider Line */}
                        <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-black shadow-[0_0.5px_0_rgba(255,255,255,0.08)] z-10" />
                        <span className="text-3xl sm:text-5xl font-extrabold font-mono text-white tracking-tight relative z-0">
                          {countdown.hours}
                        </span>
                      </div>
                    </div>

                    {/* Minutes Column */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-mono font-bold text-zinc-400 tracking-widest uppercase mb-2">MINUTES</span>
                      <div className="relative bg-[#111218] rounded-xl border border-zinc-800/80 shadow-[0_4px_12px_rgba(0,0,0,0.8)] overflow-hidden w-16 sm:w-20 py-3.5 sm:py-4 text-center flex items-center justify-center">
                        {/* Split Flap Divider Line */}
                        <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-black shadow-[0_0.5px_0_rgba(255,255,255,0.08)] z-10" />
                        <span className="text-3xl sm:text-5xl font-extrabold font-mono text-white tracking-tight relative z-0">
                          {countdown.minutes}
                        </span>
                      </div>
                    </div>

                    {/* Seconds Column */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-mono font-bold text-zinc-400 tracking-widest uppercase mb-2">SECONDS</span>
                      <div className="relative bg-[#111218] rounded-xl border border-zinc-800/80 shadow-[0_4px_12px_rgba(0,0,0,0.8)] overflow-hidden w-16 sm:w-20 py-3.5 sm:py-4 text-center flex items-center justify-center">
                        {/* Split Flap Divider Line */}
                        <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-black shadow-[0_0.5px_0_rgba(255,255,255,0.08)] z-10" />
                        <span className="text-3xl sm:text-5xl font-extrabold font-mono text-orange-500 tracking-tight relative z-0">
                          {countdown.seconds}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* HEADLINE SECTION (PlanMate inspired structure) */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="space-y-1">
                  <h2 className={`text-2xl tracking-tight ${textTitleColor}`}>
                    Stay Organized, Stay {currentProfile.fullName.split(' ')[0]} 👏
                  </h2>
                  <p className={`text-xs ${textMutedColor}`}>
                    Effortlessly manage campaigns, track live conversion values, and manage referrals in one unified system.
                  </p>
                </div>

                {/* Calendar Date Indicator */}
                <div className={`flex items-center gap-2.5 py-2 px-3.5 rounded-xl text-xs font-semibold ${isDark ? 'bg-[#141417]/80 border border-[#22222a] text-zinc-300' : 'bg-white border border-zinc-200 text-zinc-700 shadow-sm'}`}>
                  <Calendar className="w-4 h-4 text-orange-500" />
                  <span>20 May 2026 - 31 December 2026</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400 rotate-90" />
                </div>
              </div>

              {/* CORE METRIC GRID (Enterprise style, matching the mockup card look) */}
              <div id="metrics-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                
                {/* Card 1: Total Clicks */}
                <div className={`p-6 rounded-2xl space-y-4 flex flex-col justify-between ${cardBg}`}>
                  <div className="flex justify-between items-start">
                    <span className={textSubtleLabel}>Total Clicks Tracked</span>
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 dark:bg-blue-500/5 flex items-center justify-center border border-blue-500/20">
                      <Globe className="w-4 h-4 text-blue-500" />
                    </div>
                  </div>
                  <div>
                    <span className={`text-3xl font-bold font-mono tracking-tight ${textTitleColor}`}>{totalClicks}</span>
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono mt-1">+12% traffic velocity (24h)</p>
                  </div>
                </div>

                {/* Card 2: Completed Referrals */}
                <div className={`p-6 rounded-2xl space-y-4 flex flex-col justify-between ${cardBg}`}>
                  <div className="flex justify-between items-start">
                    <span className={textSubtleLabel}>Active Referrals</span>
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/5 flex items-center justify-center border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                  </div>
                  <div>
                    <span className={`text-3xl font-bold font-mono tracking-tight ${textTitleColor}`}>{activeReferralsCount} <span className="text-xs font-sans text-zinc-400 font-normal">verified</span></span>
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono mt-1">{referrals.length} total signups in database</p>
                  </div>
                </div>

                {/* Card 3: Pending Balance */}
                <div className={`p-6 rounded-2xl space-y-4 flex flex-col justify-between ${cardBg}`}>
                  <div className="flex justify-between items-start">
                    <span className={textSubtleLabel}>Pending Commission</span>
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 dark:bg-amber-500/5 flex items-center justify-center border border-amber-500/20">
                      <RefreshCw className="w-4 h-4 text-amber-500 animate-spin-slow" />
                    </div>
                  </div>
                  <div>
                    <span className={`text-3xl font-bold font-mono tracking-tight ${textTitleColor}`}>${pendingCommissionsBalance.toFixed(2)}</span>
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono mt-1">{trialReferralsCount} clients during trial window</p>
                  </div>
                </div>

                {/* Card 4: MRR Earnings */}
                <div className={`p-6 rounded-2xl space-y-4 flex flex-col justify-between ${cardBg}`}>
                  <div className="flex justify-between items-start">
                    <span className={textSubtleLabel}>Monthly Earnings</span>
                    <div className="w-7 h-7 rounded-lg bg-purple-500/10 dark:bg-purple-500/5 flex items-center justify-center border border-purple-500/20">
                      <PiggyBank className="w-4 h-4 text-purple-500" />
                    </div>
                  </div>
                  <div>
                    <span className={`text-3xl font-bold font-mono tracking-tight text-emerald-500`}>${monthlyCommissionEarnings.toFixed(2)}</span>
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono mt-1">Status: {currentProfile.tier} Base Rate</p>
                  </div>
                </div>

              </div>

              {/* VISUAL TREND CHARTING PANELS ROW (PlanMate styled Layout) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* Left Line Chart: Brand Activity Conversion Trend */}
                <div className={`lg:col-span-8 p-6 rounded-2xl space-y-4 flex flex-col justify-between ${cardBg}`}>
                  <div className="flex justify-between items-center pb-3 border-b border-zinc-200/40 dark:border-zinc-850">
                    <div className="space-y-0.5">
                      <span className={textSubtleLabel}>Ecosystem Trend Performance</span>
                      <h4 className="text-sm font-semibold text-zinc-800 dark:text-white">Task Completion and Clicks Over Time</h4>
                    </div>
                    <div className="flex items-center space-x-3 text-[10px] font-mono">
                      <span className="flex items-center gap-1.5 font-bold">
                        <span className="w-2.5 h-2.5 bg-orange-500 rounded-full"></span> 
                        <span className="text-zinc-650 dark:text-zinc-300">Clicks Flow (Max 500)</span>
                      </span>
                      <span className="flex items-center gap-1.5 font-bold">
                        <span className="w-2.5 h-2.5 bg-zinc-400 rounded-full"></span> 
                        <span className="text-zinc-650 dark:text-zinc-300">Conversion Nodes</span>
                      </span>
                    </div>
                  </div>

                  {/* Stunning Custom SVG Line Chart with Dynamic Hover States */}
                  <div className="h-44 relative bg-zinc-50/50 dark:bg-zinc-950/40 rounded-xl border border-zinc-200/50 dark:border-zinc-900 overflow-visible p-4">
                    <svg 
                      className="w-full h-full overflow-visible" 
                      viewBox="0 0 600 130" 
                      preserveAspectRatio="none"
                      onMouseLeave={() => setHoveredIndex(null)}
                    >
                      {/* Grid Horizontal Guidelines */}
                      <line x1="0" y1="10" x2="600" y2="10" stroke={isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"} />
                      <line x1="0" y1="50" x2="600" y2="50" stroke={isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"} />
                      <line x1="0" y1="90" x2="600" y2="90" stroke={isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"} />
                      <line x1="0" y1="120" x2="600" y2="120" stroke={isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"} />

                      {/* Click Traffic SVG Curve (Orange) */}
                      <path 
                        d="M 50,110 Q 130,80 210,60 T 370,45 T 530,20 T 600,25" 
                        fill="none" 
                        stroke="#f97316" 
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                      
                      {/* Conversion Registrations Trendline (Slate) */}
                      <path 
                        d="M 50,115 Q 130,105 210,95 T 370,80 T 530,65 T 600,70" 
                        fill="none" 
                        stroke={isDark ? "#71717a" : "#94a3b8"} 
                        strokeWidth="1.5"
                        strokeDasharray="3"
                        strokeLinecap="round"
                      />

                      {/* Render Interactive Hover Vertical Tracker Guideline */}
                      {hoveredIndex !== null && (
                        <>
                          <line 
                            x1={40 + hoveredIndex * (520 / 6)} 
                            y1="0" 
                            x2={40 + hoveredIndex * (520 / 6)} 
                            y2="130" 
                            stroke="rgba(249,115,22,0.15)" 
                            strokeWidth="2" 
                          />
                          {/* Anchor Dots */}
                          <circle 
                            cx={40 + hoveredIndex * (520 / 6)} 
                            cy={130 - (trendData[hoveredIndex].clicks / 500) * 100} 
                            r="5" 
                            fill="#f97316" 
                            stroke="white" 
                            strokeWidth="2" 
                          />
                          <circle 
                            cx={40 + hoveredIndex * (520 / 6)} 
                            cy={130 - (trendData[hoveredIndex].registrations / 30) * 100} 
                            r="4" 
                            fill="#71717a" 
                            stroke="white" 
                            strokeWidth="1.5" 
                          />
                        </>
                      )}

                      {/* Interactive Invisible hover trigger bars */}
                      {trendData.map((d, i) => {
                        const x = 40 + i * (520 / 6);
                        return (
                          <rect
                            key={i}
                            x={x - 20}
                            y="0"
                            width="40"
                            height="130"
                            fill="transparent"
                            className="cursor-pointer"
                            onMouseEnter={() => setHoveredIndex(i)}
                          />
                        );
                      })}
                    </svg>

                    {/* Interactive Custom Floating Tooltip */}
                    {hoveredIndex !== null && (
                      <div 
                        className="absolute p-3 rounded-xl border z-25 text-[10px] space-y-1 shadow-xl bg-white text-zinc-900 border-zinc-200"
                        style={{ 
                          left: `${Math.min(40 + hoveredIndex * (82 / 6), 75)}%`, 
                          top: '10%' 
                        }}
                      >
                        <span className="block font-bold font-mono uppercase text-[9px] text-zinc-400">Attribution Index Monitored</span>
                        <div className="font-semibold">{trendData[hoveredIndex].day} Performance</div>
                        <div className="flex justify-between gap-4 font-mono text-[9px]">
                          <span>Clicks Tracking:</span>
                          <span className="font-bold text-orange-600">{trendData[hoveredIndex].clicks}</span>
                        </div>
                        <div className="flex justify-between gap-4 font-mono text-[9px]">
                          <span>Conversions Rate:</span>
                          <span className="font-bold text-zinc-500">{trendData[hoveredIndex].registrations}</span>
                        </div>
                      </div>
                    )}

                    {/* Weekdays Labels inside coordinate scope */}
                    <div className="absolute bottom-2 left-6 right-6 flex justify-between text-[8px] font-mono uppercase font-bold text-zinc-400 dark:text-zinc-650">
                      {trendData.map((d, i) => <span key={i}>{d.day}</span>)}
                    </div>
                  </div>
                </div>

                {/* Right Bar Chart: Status Overview metrics split */}
                <div className={`lg:col-span-4 p-6 rounded-2xl space-y-4 flex flex-col justify-between ${cardBg}`}>
                  <div className="space-y-0.5 pb-2 border-b border-zinc-200/40 dark:border-zinc-850">
                    <span className={textSubtleLabel}>Distribution Channels</span>
                    <h4 className="text-sm font-semibold text-zinc-800 dark:text-white">Upcoming Tasks by Status</h4>
                  </div>

                  <div className="grid grid-cols-5 gap-3 items-end h-32 pt-2 relative">
                    {/* Status split bars */}
                    <div className="flex flex-col items-center gap-1.5 group h-full justify-end">
                      <div className="relative w-full rounded-t-lg bg-pink-500 hover:opacity-80 transition-all cursor-pointer" style={{ height: '35%' }}>
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono text-zinc-400 dark:text-zinc-500 font-bold">22%</span>
                      </div>
                      <span className="text-[8px] text-zinc-400 dark:text-zinc-600 font-mono tracking-tighter truncate w-full text-center">Backlog</span>
                    </div>

                    <div className="flex flex-col items-center gap-1.5 group h-full justify-end">
                      <div className="relative w-full rounded-t-lg bg-teal-500 hover:opacity-80 transition-all cursor-pointer" style={{ height: '55%' }}>
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono text-zinc-400 dark:text-zinc-500 font-bold">48%</span>
                      </div>
                      <span className="text-[8px] text-zinc-400 dark:text-zinc-600 font-mono tracking-tighter truncate w-full text-center">To Do</span>
                    </div>

                    <div className="flex flex-col items-center gap-1.5 group h-full justify-end">
                      <div className="relative w-full rounded-t-lg bg-orange-500 hover:opacity-80 transition-all cursor-pointer" style={{ height: '78%' }}>
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono text-zinc-400 dark:text-zinc-500 font-bold">78%</span>
                      </div>
                      <span className="text-[8px] text-zinc-400 dark:text-zinc-600 font-mono tracking-tighter truncate w-full text-center">In Progress</span>
                    </div>

                    <div className="flex flex-col items-center gap-1.5 group h-full justify-end">
                      <div className="relative w-full rounded-t-lg bg-emerald-500 hover:opacity-80 transition-all cursor-pointer" style={{ height: '44%' }}>
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono text-zinc-400 dark:text-zinc-500 font-bold">44%</span>
                      </div>
                      <span className="text-[8px] text-zinc-400 dark:text-zinc-600 font-mono tracking-tighter truncate w-full text-center">Done</span>
                    </div>

                    <div className="flex flex-col items-center gap-1.5 group h-full justify-end">
                      <div className="relative w-full rounded-t-lg bg-blue-500 hover:opacity-80 transition-all cursor-pointer" style={{ height: '72%' }}>
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono text-zinc-400 dark:text-zinc-500 font-bold">72%</span>
                      </div>
                      <span className="text-[8px] text-zinc-400 dark:text-zinc-600 font-mono tracking-tighter truncate w-full text-center">In Review</span>
                    </div>
                  </div>

                  <p className="text-[10px] text-zinc-450 dark:text-zinc-500 leading-normal font-sans text-center pt-2">
                    Visual distributions representing conversion tracking status of clients.
                  </p>
                </div>
              </div>

              {/* GANTT-Grid Horizontal Milestone Timeline Task Completion Over Time (Shopify style) */}
              <div className={`p-6 rounded-2xl space-y-5 ${cardBg}`}>
                <div className="flex justify-between items-center pb-3 border-b border-zinc-200/40 dark:border-zinc-850">
                  <div className="space-y-0.5">
                    <span className={textSubtleLabel}>Active Campaign Deliverables schedule</span>
                    <h3 className="text-sm font-semibold text-zinc-800 dark:text-white">Task Completion Over Time Timeline</h3>
                  </div>
                  <span className="px-3 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 text-zinc-454 dark:text-zinc-300 rounded-lg text-[9px] font-mono font-bold uppercase">Weekly view template</span>
                </div>

                {/* Grid schedule matrix */}
                <div className="overflow-x-auto space-y-4">
                  <div className="min-w-[640px] border border-zinc-200/60 dark:border-zinc-800/80 rounded-xl overflow-hidden">
                    
                    {/* Weekday indicators on columns */}
                    <div className="grid grid-cols-8 border-b border-zinc-200/60 dark:border-zinc-850 bg-zinc-50 dark:bg-zinc-900/40 text-[9px] font-mono font-bold text-zinc-400 dark:text-zinc-550 uppercase">
                      <div className="p-3 border-r border-zinc-200/50 dark:border-zinc-850">Campaign Element</div>
                      <div className="p-3 text-center border-r border-zinc-200/50 dark:border-[#202025]">F 13</div>
                      <div className="p-3 text-center border-r border-zinc-200/50 dark:border-[#202025]">S 14</div>
                      <div className="p-3 text-center border-r border-zinc-200/50 dark:border-[#202025]">S 15</div>
                      <div className="p-3 text-center border-r border-zinc-200/50 dark:border-[#202025]">M 16</div>
                      <div className="p-3 text-center border-r border-zinc-200/50 dark:border-[#202025]">T 17</div>
                      <div className="p-3 text-center border-r border-zinc-200/50 dark:border-[#202025]">W 18</div>
                      <div className="p-3 text-center">T 19</div>
                    </div>

                    {/* Milestone Item List */}
                    <div className="divide-y divide-zinc-200/50 dark:divide-zinc-900 bg-white dark:bg-transparent">
                      {milestones.map((mil) => (
                        <div key={mil.id} className="grid grid-cols-8 items-center text-xs">
                          
                          {/* Left Title block */}
                          <div className={`p-3.5 border-r border-zinc-200/50 dark:border-zinc-850 font-sans space-y-0.5 ${
                            isDark ? 'bg-[#0d0d10]' : 'bg-zinc-50/50'
                          }`}>
                            <span className={`block font-semibold truncate ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>{mil.title}</span>
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-650 font-mono tracking-wide truncate block">@{mil.site}</span>
                          </div>

                          {/* Day Grid coordinates plotting horizontal Gantt bars */}
                          <div className="col-span-7 p-3 relative h-full flex items-center">
                            
                            {/* Gantt block styled nicely */}
                            <div 
                              className={`absolute h-8 rounded-xl flex items-center justify-between px-3 text-[9px] font-bold text-white shadow-sm ring-1 ring-white/10 ${
                                mil.id === 1 ? 'bg-indigo-600/80' : 
                                mil.id === 2 ? 'bg-orange-600/80' : 
                                mil.id === 3 ? 'bg-emerald-600/80' : 
                                'bg-zinc-600/80'
                              }`}
                              style={{
                                left: `${((mil.days[0] - 1) / 7) * 100}%`,
                                width: `${(mil.days.length / 7) * 100}%`
                              }}
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <span className={`w-1.5 h-1.5 rounded-full ${mil.priorityCol}`}></span>
                                <span className="uppercase tracking-widest font-mono text-[8px] truncate">{mil.priority}</span>
                              </div>
                              <span className="text-[8.5px] font-bold italic font-mono shrink-0 hidden sm:inline">{mil.status}</span>
                            </div>

                          </div>

                        </div>
                      ))}
                    </div>

                  </div>
                </div>
              </div>

              {/* QUICK LINKS COPY BANNER & MANUAL VETTING INVITATIONS */}
              <div id="quick-links-panel" className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* Box 1: Custom referral hooks link dispatcher */}
                <div className={`p-6 rounded-2xl space-y-4 ${cardBg}`}>
                  <h4 className={`text-sm font-semibold ${isDark ? "text-white" : "text-zinc-800"}`}>Your Dedicated Distribution Handles</h4>
                  <p className={`text-xs ${textMutedColor} leading-relaxed`}>
                    Use these unique identifiers across email networks, sub-blogs, or newsletters. Traffic cookie lifetimes persist securely for 90 days.
                  </p>
                  
                  <div className="space-y-4 pt-2">
                    {/* Link Group */}
                    <div>
                      <span className={textSubtleLabel}>Master referral redirect URL</span>
                      <div className="flex mt-1">
                        <input 
                          type="text" 
                          readOnly 
                          value={`https://revluma.io/partner/${currentProfile.username}`}
                          className={`rounded-l-xl py-3 px-4 text-xs w-full focus:outline-none ${inputElBg}`}
                        />
                        <button 
                          onClick={copyReferralLink}
                          className="bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-[#24242c] border-l-0 rounded-r-xl px-4 flex items-center justify-center cursor-pointer text-zinc-500 hover:text-orange-500 transition-colors"
                        >
                          {copiedLink ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Code Group */}
                    <div>
                      <span className={textSubtleLabel}>Ecosystem backup promotional promo code</span>
                      <div className="flex mt-1">
                        <input 
                          type="text" 
                          readOnly 
                          value={`REVLUMA_${currentProfile.username.toUpperCase()}`}
                          className={`rounded-l-xl py-3 px-4 text-xs font-mono w-full focus:outline-none ${inputElBg}`}
                        />
                        <button 
                          onClick={copyAffiliateCode}
                          className="bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-[#24242c] border-l-0 rounded-r-xl px-4 flex items-center justify-center cursor-pointer text-zinc-500 hover:text-orange-500 transition-colors"
                        >
                          {copiedCode ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Box 2: Manual Vetting Inviter */}
                <div className={`p-6 rounded-2xl space-y-4 ${cardBg}`}>
                  <h4 className={`text-sm font-semibold ${isDark ? "text-white" : "text-zinc-800"}`}>Manual Vetting Partner Invitations</h4>
                  <p className={`text-xs ${textMutedColor} leading-relaxed`}>
                     Introduce other high-performance eCommerce store operators directly to bypass typical administrative vetting queue delays.
                  </p>

                  <form onSubmit={handleSendInvite} className="space-y-4 pt-1">
                    <div>
                      <span className={textSubtleLabel}>Reputed candidate Shopify/Brands email address</span>
                      <input 
                        type="email" 
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="brandowner@shopifydeals.com" 
                        className={`rounded-xl px-4 py-3 text-xs w-full focus:outline-none mt-1 ${inputElBg}`}
                      />
                    </div>
                    <div>
                      <button 
                        type="submit"
                        className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-mono py-3 rounded-xl transition-all cursor-pointer block text-center font-bold tracking-wider uppercase shadow-[0_4px_12px_rgba(249,115,22,0.15)]"
                      >
                        Dispatch Direct Vetting Invitation
                      </button>
                    </div>
                    {inviteStatus && (
                      <p className="text-[10px] text-zinc-500 font-mono text-center pt-1">{inviteStatus}</p>
                    )}
                  </form>
                </div>
              </div>

              {/* FOUNDER ROADMAP DIRECTIVES BOX */}
              {broadcastsList.length > 0 && (
                <div id="roadmaps-broadcasts" className={`p-6 rounded-2xl space-y-4 ${cardBg}`}>
                  <div className="flex items-center space-x-2 text-[10px] font-mono text-orange-500 uppercase tracking-widest font-bold">
                    <Volume2 className="w-4.5 h-4.5 text-orange-500 shrink-0" />
                    <span>FOUNDER BULLETINS & BOARD DIRECTIVES</span>
                  </div>
                  {broadcastsList.slice(0, 1).map((b) => (
                    <div key={b.id} className="space-y-2.5">
                      <div className="flex justify-between text-xs font-semibold text-zinc-800 dark:text-zinc-150">
                        <span>{b.title}</span>
                        <span className="text-[10px] text-zinc-400 font-mono">{b.date}</span>
                      </div>
                      <p className={`text-xs leading-relaxed pb-3 border-b border-zinc-200/50 dark:border-zinc-900 ${
                        isDark ? 'text-zinc-400' : 'text-zinc-650'
                      }`}>{b.content}</p>
                      <div className="text-[10px] text-zinc-450 font-mono">Issued by operational head: {b.author}</div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          )}


          {/* TAB 2: REFERRAL LOGS LIST */}
          {activeTab === 'referrals' && (
            <div className="space-y-6">
              <div className={`p-5 rounded-2xl ${cardBg}`}>
                <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Ecommerce Referral Ledger</h3>
                <p className={`text-xs leading-relaxed ${textMutedColor}`}>
                  Every user who signs up utilizing your partner UTM elements is captured securely below. Client database fields are systematically masked for GDPR and enterprise safety.
                </p>
              </div>

              <div className={`rounded-2xl overflow-hidden ${cardBg}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className={`${tableHeaderBg} border-b ${tableBorder} font-mono text-[9px] text-zinc-500 uppercase tracking-wider`}>
                        <th className="p-4">Masked Client ID</th>
                        <th className="p-4">Signup Date</th>
                        <th className="p-4">Status Token</th>
                        <th className="p-4">Subscription Plan</th>
                        <th className="p-4">Value / Mo</th>
                        <th className="p-4">Lifetime Yield</th>
                        <th className="p-4">Attribution Tag</th>
                        <th className="p-4">Last Telemetry</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-xs ${isDark ? 'divide-zinc-900 text-zinc-300' : 'divide-zinc-100 text-zinc-700'}`}>
                      {referrals.map((ref) => (
                        <tr key={ref.id} className="hover:bg-zinc-500/5 transition-colors">
                          <td className="p-4 font-mono font-medium">{ref.emailMasked}</td>
                          <td className="p-4 text-zinc-450">{ref.signupDate}</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold ${
                              ref.status === 'Active Subscriber' 
                                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                              ref.status === 'Trial Started' 
                                ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                              ref.status === 'Cancelled' 
                                ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                              'bg-zinc-100 text-zinc-500 border border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800'
                            }`}>
                              {ref.status}
                            </span>
                          </td>
                          <td className="p-4 font-semibold">{ref.planName}</td>
                          <td className="p-4 font-mono">${ref.monthlyValue}</td>
                          <td className="p-4 font-mono text-emerald-500 font-bold">${ref.lifetimeValue}</td>
                          <td className="p-4 font-mono text-[10px] text-orange-500">{ref.campaignTag || 'organic'}</td>
                          <td className="p-4 text-[10px] text-zinc-450 font-mono">{ref.lastActive}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}


          {/* TAB 3: EARNINGS PANELS STATEMENT */}
          {activeTab === 'earnings' && (
            <WithdrawalPortal 
              currentProfile={currentProfile}
              withdrawalRequests={withdrawalRequests}
              onAddWithdrawalRequest={onAddWithdrawalRequest}
              sentEmails={sentEmails}
              onClearEmailLogs={onClearEmailLogs}
              isDark={isDark}
              theme={theme}
              cardBg={cardBg}
              textSubtleLabel={textSubtleLabel}
              textTitleColor={textTitleColor}
              tableHeaderBg={tableHeaderBg}
              tableBorder={tableBorder}
            />
          )}


          {/* LEMON SQUEEZY BILLING HUB */}
          {activeTab === 'billing' && (
            <LemonSqueezyHub
              currentProfile={currentProfile}
              allProfiles={allProfiles}
              isDark={isDark}
              theme={theme}
              cardBg={cardBg}
              textSubtleLabel={textSubtleLabel}
              textTitleColor={textTitleColor}
              tableHeaderBg={tableHeaderBg}
              tableBorder={tableBorder}
            />
          )}


          {/* TAB 4: ADVANCED CAMPAIGNS (UTM MANAGER) */}
          {activeTab === 'campaigns' && (
            <div className="space-y-6">
              <div className={`p-6 rounded-2xl space-y-4 ${cardBg}`}>
                <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>Dynamic Campaign UTM Builder</h3>
                <p className={`text-xs leading-relaxed ${textMutedColor}`}>
                  Organize and divide traffic sources systematically. Generate unique attribution tags for individual articles, social networks, or newsletters, and watch click conversion ratios side-by-side.
                </p>

                <form onSubmit={handleCreateUTMLink} className={`grid grid-cols-1 sm:grid-cols-12 gap-4 items-end p-5 rounded-2xl ${cardInnerBg}`}>
                  <div className="sm:col-span-5">
                    <span className={textSubtleLabel}>Custom Attribution Tag (alphanumeric only)</span>
                    <input 
                      type="text" 
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="e.g. twitter_thread_may" 
                      className={`py-3 px-4 text-xs w-full focus:outline-none rounded-xl mt-1.5 ${inputElBg}`}
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <span className={textSubtleLabel}>Target Traffic Channel Source</span>
                    <select 
                      value={newSource} 
                      onChange={(e) => setNewSource(e.target.value)}
                      className={`p-3 text-xs focus:outline-none rounded-xl w-full mt-1.5 ${inputElBg}`}
                    >
                      <option value="Twitter/X Profile">Twitter/X Bio & Posts</option>
                      <option value="LinkedIn Profile">LinkedIn Articles</option>
                      <option value="Email Newsletter">Email Newsletter Blast</option>
                      <option value="Medium/Substack">Substack/Medium Blogs</option>
                      <option value="Shopify Community">Shopify Custom boards</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <button 
                      type="submit"
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-mono py-3 rounded-xl transition-all font-semibold uppercase flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_2px_10px_rgba(249,115,22,0.15)]"
                    >
                      <Plus className="w-4 h-4" />
                      Add Tag
                    </button>
                  </div>
                </form>
              </div>

              {/* ACTIVE UTM CAMPAIGNS METRICS GRID */}
              <div className={`rounded-2xl overflow-hidden ${cardBg}`}>
                <div id="campaigns-table" className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className={`${tableHeaderBg} border-b ${tableBorder} font-mono text-[9px] text-zinc-500 uppercase tracking-wider`}>
                        <th className="p-4">Attribution Tag</th>
                        <th className="p-4">Channel Source</th>
                        <th className="p-4">Clicks Registered</th>
                        <th className="p-4">Candidate Signups</th>
                        <th className="p-4">Trial Conversions</th>
                        <th className="p-4">Active subscriptions</th>
                        <th className="p-4">CTR Clearance Yield</th>
                        <th className="p-4">LTV Generated</th>
                        <th className="p-4 text-right">Quick copy link</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-xs ${isDark ? 'divide-zinc-900 text-zinc-350' : 'divide-zinc-200/50 text-zinc-750'}`}>
                      {campaigns.map((c) => (
                        <tr key={c.tag} className="hover:bg-zinc-500/5 transition-colors">
                          <td className="p-4 font-mono font-bold text-orange-550">utm_campaign={c.tag}</td>
                          <td className="p-4 text-zinc-500 dark:text-zinc-400">{c.source}</td>
                          <td className="p-4 font-mono">{c.clicks}</td>
                          <td className="p-4 font-mono">{c.signups}</td>
                          <td className="p-4 font-mono">{c.trials}</td>
                          <td className="p-4 font-mono text-emerald-500 font-bold">{c.activeSubscribers}</td>
                          <td className="p-4 font-mono text-zinc-400">{c.conversionRate}%</td>
                          <td className="p-4 font-mono font-bold">${c.revenue}</td>
                          <td className="p-4 text-right">
                            <button 
                              onClick={() => copyCustomTagLink(c.tag)}
                              className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg text-[9px] font-mono text-zinc-500 hover:text-orange-500 dark:text-zinc-400 dark:hover:text-white transition-all flex items-center gap-1 cursor-pointer ml-auto font-semibold"
                            >
                              {activeCopiedTag === c.tag ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-500" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 animate-pulse" />
                                  <span>Copy URL</span>
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}


          {/* TAB 5: LEADERBOARD SYSTEM */}
          {activeTab === 'leaderboard' && (
            approvedAffiliatesCount < 10 ? (
              <LeaderboardComingSoon currentApprovedCount={approvedAffiliatesCount} />
            ) : (
              <div className="space-y-8 animate-fade-in">
              
              {/* Header block themed after the uploaded pixel-art gaming style */}
              <div className="text-center py-6 space-y-2 relative overflow-hidden rounded-3xl bg-[#090b10] border border-zinc-800 p-8 shadow-[0_10px_40px_rgba(0,0,0,0.6)]">
                {/* Neon Mesh Accent */}
                <div className="absolute inset-0 bg-[#00ff22]/[0.01] bg-[radial-gradient(#00ff22_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none opacity-30"></div>
                
                <h2 className="text-2xl sm:text-4xl font-extrabold tracking-widest text-[#00ff66] font-mono uppercase drop-shadow-[0_0_15px_rgba(0,255,102,0.3)] select-none">
                  💎 LEADERBOARD 💎
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400 font-mono max-w-2xl mx-auto leading-relaxed">
                  Earn referral points and recurring commission yields from global Revluma partner accounts activity. Scale the network node and secure Ambassador tiers.
                </p>


              </div>

              {/* THREE-DIMENSIONAL PODIUM MATCHING THE DESIGN IN THE IMAGE */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end max-w-4xl mx-auto pt-4 relative select-none">
                
                {/* SECOND PLACE - MEDIUM PODIUM (LEFT) */}
                {generatedLeaderboardUsers[1] && (
                  <div className="flex flex-col items-center group order-2 md:order-1 transition-all duration-300 hover:translate-y-[-4px]">
                    {/* User Avatar & Info */}
                    <div className="mb-3 text-center space-y-1">
                      <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-[#00e1ff]/15 border-2 border-[#00e1ff] p-1 flex items-center justify-center shadow-[0_0_20px_rgba(0,225,255,0.2)]">
                        {renderLeaderboardAvatar(generatedLeaderboardUsers[1].username, generatedLeaderboardUsers[1].tier, "w-[52px] h-[52px] sm:w-[68px] sm:h-[68px] rounded-xl text-sm")}
                        <div className="absolute -top-2.5 -right-2 bg-[#00e1ff] text-[#090b10] font-mono text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm">
                          SILVER
                        </div>
                      </div>
                      <div className="text-zinc-300 font-mono text-xs font-bold pt-1">
                        [2] {generatedLeaderboardUsers[1].username}
                      </div>
                      <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        <strong>${generatedLeaderboardUsers[1].revenueGenerated.toLocaleString()}</strong> 
                        <span className="text-[9px] text-zinc-500">VOLUME</span>
                      </div>
                    </div>
                    {/* The Column Pedestal */}
                    <div className="w-full h-24 sm:h-28 bg-gradient-to-t from-zinc-950/90 to-zinc-900/40 border-t-2 border-zinc-800 rounded-2xl flex flex-col items-center justify-center shadow-2xl">
                      <span className="text-4xl font-extrabold text-[#00e1ff]/20 font-mono">II</span>
                      <span className="text-[9px] font-mono text-zinc-450 tracking-widest font-semibold">112 REFERRALS</span>
                    </div>
                  </div>
                )}

                {/* FIRST PLACE - ELEVATED CENTER PODIUM (MIDDLE) */}
                {generatedLeaderboardUsers[0] && (
                  <div className="flex flex-col items-center group order-1 md:order-2 transition-all duration-300 hover:translate-y-[-6px]">
                    {/* Professional Crown vector image */}
                    <ProfessionalCrown />
                    {/* User Avatar & Info */}
                    <div className="mb-3 text-center space-y-1">
                      <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-yellow-500/15 border-2 border-yellow-500 p-1 flex items-center justify-center shadow-[0_0_25px_rgba(234,179,8,0.25)]">
                        {renderLeaderboardAvatar(generatedLeaderboardUsers[0].username, generatedLeaderboardUsers[0].tier, "w-[68px] h-[68px] sm:w-[84px] sm:h-[84px] rounded-xl text-lg")}
                        <div className="absolute -top-2.5 -right-2 bg-yellow-500 text-black font-mono text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm">
                          CHAMPION
                        </div>
                      </div>
                      <div className="text-white font-mono text-xs sm:text-sm font-bold pt-1">
                        [1] {generatedLeaderboardUsers[0].username}
                      </div>
                      <div className="flex items-center justify-center gap-1.5 text-xs text-yellow-400 font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-ping"></span>
                        <strong>${generatedLeaderboardUsers[0].revenueGenerated.toLocaleString()}</strong> 
                        <span className="text-[9px] text-zinc-500">VOLUME</span>
                      </div>
                    </div>
                    {/* The Column Pedestal */}
                    <div className="w-full h-32 sm:h-36 bg-gradient-to-t from-zinc-950 to-zinc-850 border-t-2 border-yellow-500/40 rounded-2xl flex flex-col items-center justify-center shadow-[0_20px_50px_rgba(234,179,8,0.05)]">
                      <span className="text-5xl font-black text-yellow-500/15 font-mono">I</span>
                      <span className="text-[9px] font-mono text-zinc-400 tracking-widest font-bold">135 REFERRALS</span>
                    </div>
                  </div>
                )}

                {/* THIRD PLACE - SHORTEST PODIUM (RIGHT) */}
                {generatedLeaderboardUsers[2] && (
                  <div className="flex flex-col items-center group order-3 md:order-3 transition-all duration-300 hover:translate-y-[-4px]">
                    {/* User Avatar & Info */}
                    <div className="mb-3 text-center space-y-1">
                      <div className="relative w-16 h-16 rounded-2xl bg-orange-500/15 border-2 border-orange-500 p-1 flex items-center justify-center shadow-[0_0_20px_rgba(249,115,22,0.15)]">
                        {renderLeaderboardAvatar(generatedLeaderboardUsers[2].username, generatedLeaderboardUsers[2].tier, "w-[52px] h-[52px] rounded-xl text-sm")}
                        <div className="absolute -top-2.5 -right-2 bg-orange-500 text-white font-mono text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm">
                          BRONZE
                        </div>
                      </div>
                      <div className="text-zinc-305 font-mono text-xs font-bold pt-1">
                        [3] {generatedLeaderboardUsers[2].username}
                      </div>
                      <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        <strong>${generatedLeaderboardUsers[2].revenueGenerated.toLocaleString()}</strong> 
                        <span className="text-[9px] text-zinc-500">VOLUME</span>
                      </div>
                    </div>
                    {/* The Column Pedestal */}
                    <div className="w-full h-16 sm:h-20 bg-gradient-to-t from-zinc-950/80 to-zinc-900/30 border-t-2 border-zinc-800 rounded-2xl flex flex-col items-center justify-center shadow-xl">
                      <span className="text-3xl font-extrabold text-orange-500/20 font-mono">III</span>
                      <span className="text-[9px] font-mono text-zinc-450 tracking-widest font-semibold">98 REFERRALS</span>
                    </div>
                  </div>
                )}

              </div>

              {/* SEARCH BOX FOR DYNAMIC FILTERING */}
              <div className={`p-4 rounded-xl max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 ${cardBg}`}>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#00ff66] animate-pulse"></span>
                  <span className="text-xs font-mono font-bold text-zinc-400">QUALIFIED WORLD LEADERBOARD (TOP 50)</span>
                </div>
                <div className="w-full sm:w-72 relative">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text" 
                    placeholder="Search top ranking players..."
                    id="leaderboard-player-filter"
                    onChange={(e) => {
                      // Dynamically filter matching items
                      const value = e.target.value.toLowerCase();
                      const rows = document.querySelectorAll('.leaderboard-row');
                      rows.forEach(r => {
                        const uname = r.getAttribute('data-username')?.toLowerCase() || '';
                        const tier = r.getAttribute('data-tier')?.toLowerCase() || '';
                        if (uname.includes(value) || tier.includes(value)) {
                          r.classList.remove('hidden');
                        } else {
                          r.classList.add('hidden');
                        }
                      });
                    }}
                    className={`p-2 pl-9 text-xs focus:outline-none rounded-xl w-full ${inputElBg}`}
                  />
                </div>
              </div>

              {/* METABOARD TABLE CONTAINING TOP 50 ENTRIES */}
              <div className={`rounded-2xl overflow-hidden max-w-4xl mx-auto border border-zinc-800/50 shadow-2xl ${cardBg}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className={`${tableHeaderBg} border-b ${tableBorder} font-mono text-[10px] text-zinc-400 uppercase tracking-wider`}>
                        <th className="p-4 w-20">RANK</th>
                        <th className="p-4">PLAYER</th>
                        <th className="p-4 text-center">REFERRAL NO</th>
                        <th className="p-4">ESTIMATED REVENUE</th>
                        <th className="p-4">CLICK RATE</th>
                        <th className="p-4">ECOSYSTEM TIER</th>
                        <th className="p-4 text-right">POINTS YIELD</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-xs ${isDark ? 'divide-zinc-900/60 text-zinc-30 setting-colors' : 'divide-zinc-200/50 text-zinc-700'}`}>
                      {/* TOP 50 ROWS */}
                      {generatedLeaderboardUsers.slice(0, 50).map((user) => {
                        const isMainUser = user.username === currentProfile.username;
                        return (
                          <tr 
                            key={user.rank} 
                            data-username={user.username}
                            data-tier={user.tier}
                            className={`leaderboard-row transition-all duration-150 hover:bg-zinc-500/5 ${
                              isMainUser 
                                ? 'bg-orange-500/[0.08] dark:bg-orange-500/15 border-y-2 border-orange-500/30' 
                                : ''
                            }`}
                          >
                            <td className="p-4 font-mono font-bold">
                              <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                                user.rank === 1 ? 'text-yellow-400 bg-yellow-400/5' : 
                                user.rank === 2 ? 'text-zinc-400 bg-zinc-450/10' : 
                                user.rank === 3 ? 'text-orange-400 bg-orange-500/5' :
                                isMainUser ? 'text-orange-500 bg-orange-500/15 animate-pulse' : 'text-zinc-450'
                              }`}>
                                [{user.rank}]
                              </span>
                            </td>
                            <td className="p-4 font-semibold">
                              <div className="flex items-center gap-2">
                                {renderLeaderboardAvatar(user.username, user.tier, "w-6 h-6 rounded-lg text-[9px]")}
                                <span className={isMainUser ? 'text-orange-550 font-bold' : ''}>
                                  {user.username} {isMainUser ? '(You)' : ''}
                                </span>
                              </div>
                            </td>
                            <td className="p-4 text-center font-mono font-bold text-zinc-800 dark:text-zinc-200">
                              {user.referralsCount}
                            </td>
                            <td className="p-4 font-mono text-emerald-500 font-bold">
                              ${user.revenueGenerated.toLocaleString()}
                            </td>
                            <td className="p-4 font-mono text-zinc-500 dark:text-zinc-400 font-medium">
                              {user.clickRate}%
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-mono block w-max uppercase font-bold border ${
                                user.tier === 'Founding Ambassador' 
                                  ? 'bg-[#00ff66]/10 border-[#00ff66]/20 text-[#00ff66]' 
                                  : user.tier === 'Elite Partner' 
                                  ? 'bg-[#00e1ff]/10 border-[#00e1ff]/20 text-[#00e1ff]' 
                                  : user.tier === 'Growth Partner' 
                                  ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' 
                                  : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
                              }`}>
                                {user.tier}
                              </span>
                            </td>
                            <td className="p-4 text-right font-mono text-zinc-600 dark:text-zinc-400 font-bold">
                              {user.points.toLocaleString()} PTS
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
            )
          )}

          {/* TAB 6: AI CONTENT COPILOT (GEMINI POWERED) */}
          {activeTab === 'copilot' && (
            <div className="space-y-6">
              <div className={`p-6 rounded-2xl space-y-4 ${cardBg}`}>
                <div className="flex items-center space-x-2.5">
                  <div className="p-1.5 bg-orange-100 dark:bg-zinc-900 rounded-xl border border-orange-200 dark:border-zinc-800">
                    <BrainCircuit className="w-5 h-5 text-orange-500 animate-pulse" />
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>AI Content Assistant (Server-Side Gemini Pro)</h3>
                    <span className="text-[10px] font-mono text-zinc-450 uppercase tracking-widest block font-bold">Autonomous Copywriting Multi-Engine</span>
                  </div>
                </div>
                <p className={`text-xs leading-relaxed ${textMutedColor}`}>
                  Craft high-converting digital bulletins directly aligned with Revluma and Luminor Terminal positioning guidelines. Toggle your channels, highlight specific features, and trigger server-side Gemini generation.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                  {/* Controls */}
                  <div className={`space-y-4 p-5 rounded-2xl ${cardInnerBg}`}>
                    <div>
                      <label className="block text-[9px] font-mono uppercase mb-1.5 font-bold tracking-wider text-zinc-450">Target Marketing Channel</label>
                      <select 
                        value={selectedChannel} 
                        onChange={(e) => setSelectedChannel(e.target.value)}
                        className={`p-3 rounded-xl text-xs w-full focus:outline-none ${inputElBg}`}
                      >
                        <option value="X">Twitter / X Post</option>
                        <option value="Reddit">Reddit Informational Post</option>
                        <option value="LinkedIn">LinkedIn Business Update</option>
                        <option value="Email">Email Newsletter Outreach</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9px] font-mono uppercase mb-1.5 font-bold tracking-wider text-zinc-450">Target Audience Segment</label>
                      <select 
                        value={selectedAudience} 
                        onChange={(e) => setSelectedAudience(e.target.value)}
                        className={`p-3 rounded-xl text-xs w-full focus:outline-none ${inputElBg}`}
                      >
                        <option value="Shopify Store Owners">Shopify & WooCommerce Owners</option>
                        <option value="D2C Growth Directors">D2C Brand Growth Leads</option>
                        <option value="SaaS Founders & Builders">SaaS Founders & Builders</option>
                        <option value="Marketing Agencies">eCommerce Digital Agencies</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9px] font-mono uppercase mb-1.5 font-bold tracking-wider text-zinc-450">Highlighted Core Features</label>
                      <input 
                        type="text" 
                        value={coreFeatures}
                        onChange={(e) => setCoreFeatures(e.target.value)}
                        className={`p-3 rounded-xl text-xs w-full focus:outline-none ${inputElBg}`}
                        placeholder="e.g. Churn Forecasting, Auto Checkout Recovery"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-mono uppercase mb-1.5 font-bold tracking-wider text-zinc-450">Tone of Voice</label>
                      <select 
                        value={toneMode} 
                        onChange={(e) => setToneMode(e.target.value)}
                        className={`p-3 rounded-xl text-xs w-full focus:outline-none ${inputElBg}`}
                      >
                        <option value="Futuristic and Bold">Futuristic and Bold</option>
                        <option value="Minimalist and Technical">Minimalist and Technical</option>
                        <option value="D2C Insider urgencies">D2C Insider Urgency</option>
                        <option value="Intellectual and Calm">Intellectual and Calm</option>
                      </select>
                    </div>

                    <button 
                      onClick={handleGenerateAiPromo}
                      disabled={aiIsGenerating}
                      className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 text-white font-mono text-xs font-bold rounded-xl uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-[0_4px_12px_rgba(242,100,25,0.2)]"
                    >
                      {aiIsGenerating ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-white" />
                          Generative AI processing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-white animate-pulse" />
                          Construct Copywriting Masterpiece
                        </>
                      )}
                    </button>
                    {errorTextGlobal && (
                      <p className="text-[10px] text-red-500 font-mono text-center mt-1 font-semibold">{errorTextGlobal}</p>
                    )}
                  </div>

                  {/* Output Display */}
                  <div className={`flex flex-col justify-between p-5 rounded-2xl min-h-[300px] ${cardInnerBg}`}>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-[10px] font-mono text-zinc-400 dark:text-zinc-500 pb-2 border-b border-zinc-200/50 dark:border-zinc-850">
                        <span>GENERATED COPY OUTPUT</span>
                        <div className="flex items-center gap-2 font-bold uppercase">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                          <span>{aiSimulationLabel ? "Simulation Layer" : "Live Gemini Channel"}</span>
                        </div>
                      </div>

                      {generatedAiContent ? (
                        <div className={`text-xs font-sans leading-relaxed whitespace-pre-wrap select-all p-4 border rounded-xl ${
                          isDark ? 'text-zinc-300 bg-black/40 border-zinc-800' : 'text-zinc-800 bg-white border-zinc-150'
                        }`}>
                          {generatedAiContent}
                        </div>
                      ) : (
                        <div className="text-zinc-400 dark:text-zinc-600 text-xs font-mono text-center py-24 italic">
                          Toggle copywriting constraints and click generate. Powered by official Gemini-3.5-flash server routines.
                        </div>
                      )}
                    </div>

                    {generatedAiContent && (
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(generatedAiContent);
                        }}
                        className="w-full bg-orange-500 text-white hover:bg-orange-600 py-2.5 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Copy Promo To Clipboard
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}


          {/* TAB 7: PROMO BRANDS ASSETS PACK */}
          {activeTab === 'assets' && (
            <div className="space-y-6">
              <div className={`p-5 rounded-2xl ${cardBg}`}>
                <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Affiliate Brand Assets Pack</h3>
                <p className={`text-xs leading-relaxed ${textMutedColor}`}>
                  We maintain premium transparent graphic vector maps, landing page layouts, and copywriting guidelines to keep brand messaging unified.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {/* Asset 1 */}
                <div className={`p-5 rounded-2xl space-y-4 ${cardBg}`}>
                  <div className="h-32 bg-gradient-to-tr from-orange-400 to-amber-500 border border-orange-300 dark:border-zinc-900 rounded-xl flex flex-col justify-center items-center p-4 shadow-sm">
                    <span className="text-base font-display font-black text-white tracking-widest uppercase">REVLUMA GOS</span>
                    <span className="text-[8px] font-mono text-orange-100 mt-1 font-bold">VECTOR RESOURCE COLLATERAL</span>
                  </div>
                  <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider font-mono ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>Platform Branding SVG</h4>
                    <span className="text-[10px] text-zinc-450 block font-mono">Format: Transparent Vector Map</span>
                  </div>
                  <button className="w-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-90 w-full hover:dark:bg-zinc-805 border border-zinc-200 dark:border-zinc-800 text-[10px] py-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white font-mono font-bold uppercase cursor-pointer">
                    Download Resource File
                  </button>
                </div>

                {/* Asset 2 */}
                <div className={`p-5 rounded-2xl space-y-4 ${cardBg}`}>
                  <div className="h-32 bg-gradient-to-tr from-blue-600/20 via-zinc-900 to-indigo-600/20 border border-zinc-200 dark:border-zinc-900 rounded-xl flex flex-col justify-center items-center p-4">
                    <span className="text-sm font-display font-extrabold text-[#7c3aed] dark:text-blue-400 tracking-wider">AI Operations layer</span>
                    <span className="text-[8px] font-mono text-zinc-400 mt-1 font-semibold">1080x1080 Brand Assets pack</span>
                  </div>
                  <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider font-mono ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>eCommerce Churn Banner</h4>
                    <span className="text-[10px] text-zinc-450 block font-mono">Format: High-Res PNG Resource</span>
                  </div>
                  <button className="w-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-90 w-full hover:dark:bg-zinc-805 border border-zinc-200 dark:border-zinc-800 text-[10px] py-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white font-mono font-bold uppercase cursor-pointer">
                    Download Resource File
                  </button>
                </div>

                {/* Asset 3 */}
                <div className={`p-5 rounded-2xl space-y-4 ${cardBg}`}>
                  <div className={`h-32 rounded-xl flex flex-col justify-center items-center text-center p-4 border ${
                    isDark ? 'bg-zinc-950 border-zinc-900' : 'bg-zinc-50 border-zinc-100'
                  }`}>
                    <span className="block text-zinc-500 text-xs italic font-medium">Conversion UI Screenshot</span>
                    <span className="text-[8px] font-mono text-zinc-400 mt-1 font-bold">Luminor transactional mockups</span>
                  </div>
                  <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider font-mono ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>D2C Dashboard Screenshot</h4>
                    <span className="text-[10px] text-zinc-455 block font-mono">Format: Lossless PNG (2x Output)</span>
                  </div>
                  <button className="w-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-90 w-full hover:dark:bg-zinc-805 border border-zinc-200 dark:border-zinc-800 text-[10px] py-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white font-mono font-bold uppercase cursor-pointer">
                    Download Resource File
                  </button>
                </div>

              </div>
            </div>
          )}


          {/* TAB 8: TRAINING ACADEMY */}
          {activeTab === 'training' && (
            <div className="space-y-6">
              <div className={`p-4 rounded-2xl ${cardBg}`}>
                <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Academy Knowledge Portals</h3>
                <p className={`text-xs leading-relaxed ${textMutedColor}`}>
                  Understand Revluma's core target pain channels, audience profiles, and positioning matrices to effectively drive conversion loops.
                </p>
              </div>

              <div id="positioning-framework" className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* Left Card */}
                <div className={`p-6 rounded-2xl space-y-4 ${cardBg}`}>
                  <div className="inline-flex items-center space-x-1.5 text-xs text-orange-500 font-mono font-extrabold uppercase tracking-wide">
                    <CheckCircle2 className="w-4 h-4 text-orange-500" />
                    <span>Audience target positioning matrix</span>
                  </div>
                  <h4 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-zinc-950'}`}>Target: Shopify Store Owners & D2C Leads</h4>
                  <ul className={`space-y-3 text-xs leading-relaxed ${textMutedColor}`}>
                    <li>
                      <strong className={isDark ? "text-zinc-200" : "text-zinc-800"}>The Friction Root:</strong> Multi-brand e-commerce leaders lose up to 15% of checkout traffic to silent network interruptions, cart fatigue, and lack of customer activity logs.
                    </li>
                    <li>
                      <strong className={isDark ? "text-zinc-200" : "text-zinc-800"}>The Solution Blueprint:</strong> Revluma systematically tracks visitor activity on checkout pages and autonomously recovers sessions before customer fatigue triggers.
                    </li>
                  </ul>
                </div>

                {/* Right Card */}
                <div className={`p-6 rounded-2xl space-y-4 ${cardBg}`}>
                  <div className="inline-flex items-center space-x-1.5 text-xs text-orange-500 font-mono font-extrabold uppercase tracking-wide">
                    <CheckCircle2 className="w-4 h-4 text-orange-500" />
                    <span>Copywriting & Positioning formulas</span>
                  </div>
                  <h4 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-zinc-950'}`}>Value Proposition Messaging Map</h4>
                  <p className={`text-xs leading-relaxed ${textMutedColor}`}>
                    Avoid slang or rainbow startup aesthetics. Revluma addresses operational engineers and store builders. Position it as:
                  </p>
                  <blockquote className="border-l-2 border-orange-500 pl-3.5 italic text-xs text-zinc-500 dark:text-zinc-300 leading-relaxed font-sans font-medium">
                    &ldquo;Revluma maps customer transactions into active, predictive revenue recovery. It converts forward-looking data into autonomous decisions, increasing brand valuations quietly.&rdquo;
                  </blockquote>
                </div>
              </div>
            </div>
          )}


          {/* TAB 9: SETTINGS MANAGEMENT */}
          {activeTab === 'settings' && (
            <div className="space-y-6 animate-fade-in">
              <div className={`p-6 rounded-2xl max-w-2xl space-y-6 ${cardBg}`}>
                <h3 className={`text-base font-semibold border-b pb-3 ${isDark ? 'text-white border-zinc-850' : 'text-zinc-900 border-zinc-150'}`}>Ecosystem Settings Profile</h3>

                {/* Modern Avatar Sync Uploader Pane */}
                <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-6 ${
                  isDark ? 'bg-black/30 border-zinc-900' : 'bg-zinc-50 border-zinc-150'
                }`}>
                  <div className="flex items-center gap-4">
                    {currentProfile.avatarUrl ? (
                      <img 
                        src={currentProfile.avatarUrl} 
                        alt={currentProfile.fullName}
                        referrerPolicy="no-referrer"
                        className="w-16 h-16 rounded-2xl object-cover border-2 border-orange-500/30 shadow-md animate-fade-in"
                      />
                    ) : (
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-mono font-bold text-xl ${
                        isDark ? 'bg-zinc-900 border border-zinc-800 text-orange-400' : 'bg-orange-100 border border-orange-200 text-orange-750'
                      }`}>
                        {currentProfile.fullName.charAt(0)}
                      </div>
                    )}
                    <div>
                      <span className={`block text-xs font-bold uppercase tracking-wider ${isDark ? 'text-white' : 'text-zinc-805'}`}>
                        Partner Identity Seal
                      </span>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs leading-normal">
                        Upload your custom profile photo. Drag & drop files directly or browse your documents folder. Max size: 3MB.
                      </p>
                    </div>
                  </div>
                  
                  <div className="w-full md:w-auto shrink-0 flex flex-col gap-2">
                    <div 
                      onDragOver={handleAvatarDragOver}
                      onDragLeave={handleAvatarDragLeave}
                      onDrop={handleAvatarDrop}
                      onClick={() => document.getElementById('settings-avatar-input')?.click()}
                      className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all w-full md:w-56 ${
                        isAvatarDragging 
                          ? 'border-orange-500 bg-orange-500/5' 
                          : isDark 
                            ? 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/20 hover:bg-zinc-900/10' 
                            : 'border-zinc-200 hover:border-zinc-300 bg-zinc-100/50 hover:bg-zinc-200/50'
                      }`}
                    >
                      <input 
                        type="file" 
                        id="settings-avatar-input"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleAvatarSelect(e.target.files[0]);
                          }
                        }}
                      />
                      
                      {avatarPreviewUrl ? (
                        <div className="flex flex-col items-center gap-1.5 animate-fade-in">
                          <img 
                            src={avatarPreviewUrl} 
                            alt="Preview"
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-lg object-cover mx-auto shadow-sm"
                          />
                          <p className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono truncate max-w-[130px] font-semibold">{selectedAvatarFile?.name}</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <Upload className="w-4 h-4 text-zinc-400 mx-auto mb-0.5" />
                          <p className="text-[9px] text-zinc-500 leading-tight">
                            <span className="text-orange-500 font-bold">Select File</span> or Drop
                          </p>
                        </div>
                      )}
                    </div>

                    {avatarPreviewUrl && (
                      <button
                        onClick={handleAvatarUploadSubmit}
                        disabled={isUploadingAvatar}
                        className="w-full py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-400 text-white font-mono font-bold text-[9px] rounded-xl tracking-widest uppercase transition-all flex items-center justify-center gap-1.5 shadow"
                      >
                        {isUploadingAvatar ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Upload className="w-3 h-3" />
                        )}
                        <span>Commit Upload</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Profile Edit fields */}
                <div className="space-y-5">
                  <div>
                    <label className="block text-[10px] font-mono text-zinc-500 uppercase mb-1.5 font-bold tracking-wider">Connected payout wallet routing</label>
                    <select 
                      value={payoutRoute} 
                      onChange={(e) => setPayoutRoute(e.target.value)}
                      className={`p-3 rounded-lg text-xs focus:outline-none w-full ${inputElBg}`}
                    >
                      <option value="Stripe Direct Transfer">Stripe Connect Direct Transfer</option>
                      <option value="Global BIC Wire Bank Pay">Global BIC/IBAN Bank Wire Clearance</option>
                      <option value="Crypto Core Wallet (USDC/Sol)">USDC Stablecoin Core Wallet (Solana Network)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-zinc-500 uppercase mb-1.5 font-bold tracking-wider">Account Billing Parameters</label>
                    <input 
                      type="text" 
                      value={billingAddress}
                      onChange={(e) => setBillingAddress(e.target.value)}
                      className={`p-3 rounded-lg text-xs focus:outline-none w-full ${inputElBg}`}
                    />
                  </div>

                  <div className={`flex items-center justify-between p-4 rounded-xl border ${
                    isDark ? 'bg-black/40 border-zinc-900' : 'bg-zinc-50 border-zinc-150'
                  }`}>
                    <div className="space-y-0.5">
                      <span className={`block text-xs font-semibold ${isDark ? 'text-white' : 'text-zinc-800'}`}>Partner Activity Alerts</span>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Automate email alerts when client conversion levels level up.</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={emailAlerts}
                      onChange={(e) => setEmailAlerts(e.target.checked)}
                      className="rounded text-orange-500 focus:ring-0 cursor-pointer w-4 h-4 accent-orange-500"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-200/50 dark:border-zinc-805 flex justify-between">
                  <div className="space-y-1">
                    <span className={`block text-xs font-semibold ${isDark ? 'text-white' : 'text-zinc-800'}`}>Delete Growth Credentials</span>
                    <span className="block text-[10px] text-zinc-450 dark:text-zinc-550 leading-none">Permanently delete and purge your user entry from all schemas. This action is irreversible.</span>
                  </div>
                  <button 
                    onClick={() => {
                      if (confirm("Are you absolutely sure you want to delete your Revluma Partner account? All earned parameters and tracking tags will be wiped from Postgres public profiles.")) {
                        onDeleteAccount();
                      }
                    }}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 text-xs rounded-xl font-mono transition-colors cursor-pointer self-center font-bold uppercase tracking-wider"
                    id="delete-account-btn">Purge Account Entry</button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
