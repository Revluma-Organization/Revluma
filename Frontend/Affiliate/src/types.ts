// Shared type definitions for the Affiliate frontend

export type MembershipTier = 'Affiliate' | 'Growth' | 'Elite' | 'Ambassador';

export interface PartnerProfile {
    id: string;
    username: string;
    fullName: string;
    email: string;
    avatarUrl?: string | null;
    tier: MembershipTier | string;
    role: 'affiliate' | 'admin' | string;
    status?: string;
    commissionRate: number;
    referralCode?: string;
    country?: string;
    phoneNumber?: string;
    twitterHandle?: string;
    instagramHandle?: string;
    linkedinProfile?: string;
    linkedInProfile?: string;
    website?: string;
    audienceNiche?: string;
    audienceSize?: string;
    affiliateExperience?: string;
    whyJoin?: string;
    createdAt?: string;
    termsAccepted?: boolean;
    marketingConsent?: boolean;
    emailVerified?: boolean;
    membershipTier?: MembershipTier;
    verificationStatus?: 'unverified' | 'verified' | 'pending';
    affiliateLevel?: number;
}

export interface ReferredUser {
    id: string;
    emailMasked: string;
    signupDate: string;
    status: string;
    planName?: string;
    monthlyValue: number;
    lifetimeValue: number;
    campaignTag?: string;
    lastActive?: string;
}

export interface EarningRecord {
    id: string;
    amount: number;
    currency: string;
    date: string;
    source?: string;
    note?: string;
}

export interface LeaderboardUser {
    username: string;
    tier?: string;
    avatarSeed?: string;
    clickRate?: number;
    rank?: number;
    points?: number;
    referralsCount: number;
    revenueGenerated: number;
}

export interface CampaignInfo {
    tag: string;
    source?: string;
    clicks: number;
    signups: number;
    trials: number;
    activeSubscribers: number;
    conversionRate: number;
    revenue: number;
}

export interface FounderBroadcast {
    id: string;
    title: string;
    content: string;
    date?: string;
    author?: string;
    createdAt?: string;
}

export interface NotificationItem {
    id: string;
    title: string;
    message: string;
    timestamp: string;
    read?: boolean;
    is_read?: boolean;
    type?: string;
}

export type WithdrawalRequestStatus =
    | 'Pending Review'
    | 'Under Verification'
    | 'Approved'
    | 'Processing'
    | 'Paid'
    | 'Rejected'
    | string;

export interface WithdrawalRequest {
    id: string;
    partnerId: string;
    amountUsd: number;
    payoutMethod: 'paypal' | 'bank_transfer' | string;
    payoutEmail?: string;
    legalName?: string;
    country?: string;
    currency?: string;
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
    iban?: string;
    swiftBic?: string;
    routingNumber?: string;
    branchName?: string;
    additionalNotes?: string;
    adminNotes?: string;
    status: WithdrawalRequestStatus;
    createdAt?: string;
    updatedAt?: string;
}

export type ApprovalStatus = 'approved' | 'pending' | 'rejected' | string;

export type AuthMode =
  | 'login'
  | 'register'
  | 'forgot'
  | 'resetConfirm'
  | 'verifyEmail'
  | 'pendingApproval'
  | 'rejected';

export interface TierInfo {
  name: MembershipTier;
  commissionRate: number;
  minReferrals: number;
  color: string;
  description: string;
  rewards: string[];
}

export const TIER_INFORMATION: TierInfo[] = [
  {
    name: 'Affiliate',
    commissionRate: 0.20,
    minReferrals: 0,
    color: 'orange',
    description: '20% Recurring First 12 Months',
    rewards: [
      'Basic Campaign Dashboard',
      'Standard Copy Center',
      'Standard Bank Payouts',
    ],
  },
  {
    name: 'Growth',
    commissionRate: 0.30,
    minReferrals: 10,
    color: 'indigo',
    description: '30% Recurring First 12 Months',
    rewards: [
      'Advanced Campaign UTMs',
      'Gemini Copy Assistant Access',
      'Custom Branding Collateral',
    ],
  },
  {
    name: 'Elite',
    commissionRate: 0.35,
    minReferrals: 30,
    color: 'cyan',
    description: '35% Recurring First 12 Months',
    rewards: [
      'Multi-attribution Campaign Channels',
      'Priority 24-hr Payout Clearance',
      'Private Discord & Slack Access',
      'Direct Engineering Consultation',
    ],
  },
  {
    name: 'Ambassador',
    commissionRate: 0.40,
    minReferrals: 50,
    color: 'emerald',
    description: '40% Recurring First 12 Months',
    rewards: [
      'Direct Access to Founder Syncs',
      'Customized Sign-up Landing Codes',
      'Co-marketing Press Campaigns',
      'Elite Advisory Board Invite',
    ],
  },
];

export function getTierInfo(tier: string): TierInfo {
  return TIER_INFORMATION.find(t => t.name === tier) ?? TIER_INFORMATION[0];
}
