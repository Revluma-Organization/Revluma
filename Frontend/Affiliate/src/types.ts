// Shared type definitions for the Affiliate frontend

export interface PartnerProfile {
    id: string;
    username: string;
    fullName: string;
    email: string;
    avatarUrl?: string | null;
    tier: 'Affiliate' | 'Growth' | 'Elite' | 'Founding Ambassador' | string;
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
