/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PartnerRole = 'user' | 'admin';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface PartnerProfile {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phoneNumber: string;
  country: string;
  twitterHandle?: string;
  instagramHandle?: string;
  linkedInProfile?: string;
  website?: string;
  audienceNiche: string;
  audienceSize: string;
  affiliateExperience: string;
  whyJoin: string;
  status: ApprovalStatus;
  role: PartnerRole;
  createdAt: string;
  tier: 'Affiliate' | 'Growth' | 'Elite' | 'Founding Ambassador';
  commissionRate: number; // e.g. 0.20 = 20%
  avatarUrl?: string;
  password?: string;
  termsAccepted?: boolean;
  marketingConsent?: boolean;
  emailVerified?: boolean;
  emailVerificationCode?: string;
}

export type ReferralStatus = 
  | 'Waitlist Joined'
  | 'Account Created'
  | 'Trial Started'
  | 'Active Subscriber'
  | 'Cancelled'
  | 'Pending';

export interface ReferredUser {
  id: string;
  emailMasked: string;
  signupDate: string;
  status: ReferralStatus;
  planName: 'Basic' | 'Enterprise' | 'Scale' | 'None';
  monthlyValue: number;
  lifetimeValue: number;
  lastActive: string;
  campaignTag?: string;
}

export interface EarningRecord {
  id: string;
  referralId: string;
  amount: number;
  recurring: boolean;
  status: 'pending' | 'cleared' | 'withdrawn';
  date: string;
  planName: string;
}

export interface LeaderboardUser {
  rank: number;
  username: string;
  tier: string;
  points: number;
  referralsCount: number;
  revenueGenerated: number;
  avatarSeed: string;
}

export interface CampaignInfo {
  tag: string;
  source: string;
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
  date: string;
  author: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'commission' | 'signup' | 'badge' | 'payout' | 'broadcast';
}

export type WithdrawalRequestStatus = 
  | 'Pending Review' 
  | 'Under Verification' 
  | 'Approved' 
  | 'Processing' 
  | 'Paid' 
  | 'Rejected' 
  | 'Cancelled';

export interface WithdrawalRequest {
  id: string;
  partnerId: string;
  amountUsd: number;
  payoutMethod: 'paypal' | 'bank_transfer' | 'crypto_future';
  payoutEmail?: string;
  legalName: string;
  country: string;
  currency: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  iban?: string;
  swiftBic?: string;
  routingNumber?: string;
  branchName?: string;
  additionalNotes?: string;
  status: WithdrawalRequestStatus;
  adminNotes?: string;
  createdAt: string;
  processedAt?: string;
  updatedAt: string;
}

