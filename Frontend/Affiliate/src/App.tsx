/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import AuthInterface from './components/AuthInterface';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import { 
  getSupabase, isSupabaseConfigured, localDB 
} from './lib/supabaseClient';
import { 
  PartnerProfile, FounderBroadcast, ApprovalStatus, 
  WithdrawalRequest, WithdrawalRequestStatus 
} from './types';

// Concrete, highly realistic initial seeds
const initialProfilesSeed: PartnerProfile[] = [
  {
    id: 'admin_1',
    fullName: 'Alistair Voss',
    username: 'alistair',
    email: 'alistair@luminor.com',
    phoneNumber: '+1 (415) 890-2175',
    country: 'United States',
    twitterHandle: 'alistair_voss',
    instagramHandle: '',
    linkedInProfile: 'https://linkedin.com/in/alistairvoss',
    website: 'https://luminor.terminal',
    audienceNiche: 'SaaS Platforms, AI Infrastructure',
    audienceSize: '100k+',
    affiliateExperience: 'Vast enterprise partnership leader',
    whyJoin: 'Ecosystem development head and parent founder.',
    password: 'admin',
    termsAccepted: true,
    marketingConsent: true,
    status: 'approved',
    role: 'admin',
    tier: 'Founding Ambassador',
    commissionRate: 0.40,
    createdAt: '2026-05-01',
    emailVerified: true
  },
  {
    id: 'partner_1',
    fullName: 'Devon Carter',
    username: 'partner_growth',
    email: 'partner@revluma.io',
    phoneNumber: '+44 20 7946 0192',
    country: 'United Kingdom',
    twitterHandle: 'devon_growth',
    instagramHandle: '',
    linkedInProfile: 'https://linkedin.com/in/devoncarter',
    website: 'https://growthops.agency',
    audienceNiche: 'eCommerce Store Operators',
    audienceSize: '10k - 50k',
    affiliateExperience: 'I run D2C email networks and newsletters.',
    whyJoin: 'Keen to introduce Revluma tracking utilities directly to my existing clients.',
    password: 'partner',
    termsAccepted: true,
    marketingConsent: true,
    status: 'approved',
    role: 'user',
    tier: 'Growth',
    commissionRate: 0.30,
    createdAt: '2026-05-10',
    emailVerified: true
  },
  {
    id: 'pending_1',
    fullName: 'Marcus Thorne',
    username: 'pending_brand',
    email: 'pending@shopifydeals.com',
    phoneNumber: '+1 (310) 555-0143',
    country: 'Canada',
    twitterHandle: 'marcus_commerce',
    instagramHandle: '',
    linkedInProfile: '',
    website: 'https://shopifydeals.com',
    audienceNiche: 'Shopify Store Operators',
    audienceSize: '50k - 100k',
    affiliateExperience: 'Limited promo experience but highly eager.',
    whyJoin: 'I manage a large Shopify dealer bulletin.',
    password: 'pending',
    termsAccepted: true,
    marketingConsent: true,
    status: 'pending',
    role: 'user',
    tier: 'Affiliate',
    commissionRate: 0.20,
    createdAt: '2026-05-18',
    emailVerified: true
  }
];

const initialWithdrawalsSeed: WithdrawalRequest[] = [
  {
    id: 'req_1001',
    partnerId: 'partner_1', // Devon Carter (partner_growth)
    amountUsd: 150.00,
    payoutMethod: 'paypal',
    payoutEmail: 'partner@revluma.io',
    legalName: 'Devon Carter',
    country: 'United Kingdom',
    currency: 'USD',
    status: 'Paid',
    createdAt: '2026-05-02T10:30:00Z',
    updatedAt: '2026-05-03T15:00:00Z',
    adminNotes: 'PayPal transaction ID: PP-84920491-LUM'
  },
  {
    id: 'req_1002',
    partnerId: 'partner_1',
    amountUsd: 65.00,
    payoutMethod: 'bank_transfer',
    legalName: 'Devon Carter',
    country: 'United Kingdom',
    currency: 'GBP',
    bankName: 'HSBC UK plc',
    accountName: 'Devon Carter Consulting Services',
    accountNumber: 'GB33HSBC40051689403011',
    swiftBic: 'MIDLGB22',
    status: 'Pending Review',
    createdAt: '2026-05-18T14:22:00Z',
    updatedAt: '2026-05-18T14:22:00Z'
  }
];

const initialBroadcastsSeed: FounderBroadcast[] = [
  {
    id: 'broad_1',
    title: 'Strategic Priorities for May 2026 (Launch Phase)',
    content: 'Partner teams: We officially deployed the Revluma automated cart-retrieval webhook integration system to Shopify App Stores tonight. Real-time logging shows an average recovery lift of 12.8%. If your contacts are losing visitors, direct them. Point them to the custom campaigns tags you instantiate in your portal. More visual assets have been uploaded.',
    date: 'May 16, 2026',
    author: 'Alistair Voss (Chief Architect)'
  }
];

export default function App() {
  // Navigation Router state
  const [view, setView] = useState<'landing' | 'auth' | 'dashboard' | 'admin'>('landing');

  // Manual withdrawal requests database state
  const [withdrawalRequests, setWithdrawalRequests] = useState<WithdrawalRequest[]>(() => {
    const local = localDB.getWithdrawals();
    if (local.length > 0) return local;
    localDB.setWithdrawals(initialWithdrawalsSeed);
    return initialWithdrawalsSeed;
  });

  // Outbound SMTP Delivery Log buffer
  const [sentEmails, setSentEmails] = useState<Array<{
    id: string;
    timestamp: string;
    to: string;
    subject: string;
    body: string;
    isSystem: boolean;
  }>>([]);

  // Database of user profiles (realistic profiles with password hashes)
  const [profiles, setProfiles] = useState<PartnerProfile[]>(() => {
    const local = localDB.getProfiles();
    if (local.length > 0) return local;
    localDB.setProfiles(initialProfilesSeed);
    return initialProfilesSeed;
  });

  // Current logged in active profile
  const [currentProfile, setCurrentProfile] = useState<PartnerProfile | null>(null);

  // Founder Broadcasts global state feed
  const [broadcasts, setBroadcasts] = useState<FounderBroadcast[]>(() => {
    const local = localDB.getBroadcasts();
    if (local.length > 0) return local;
    localDB.setBroadcasts(initialBroadcastsSeed);
    return initialBroadcastsSeed;
  });

  // Load production Supabase tables if credentials are set in environment
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    const loadSupabaseSystem = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        // Fetch profiles
        const { data: dbProfiles, error: pErr } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (!pErr && dbProfiles) {
          const mapped: PartnerProfile[] = dbProfiles.map((r: any) => ({
            id: r.id,
            fullName: r.full_name,
            username: r.username,
            email: r.email || `${r.username}@revluma.io`,
            phoneNumber: r.phone_number,
            country: r.country,
            twitterHandle: r.twitter_handle,
            instagramHandle: r.instagram_handle,
            linkedInProfile: r.linkedin_profile,
            website: r.website,
            audienceNiche: r.audience_niche,
            audienceSize: r.audience_size,
            affiliateExperience: r.affiliate_experience,
            whyJoin: r.why_join,
            status: r.status,
            role: r.role,
            tier: r.tier,
            commissionRate: Number(r.commission_rate || 0.20),
            createdAt: r.created_at
          }));
          setProfiles(mapped);
          localDB.setProfiles(mapped);
        }

        // Fetch withdrawals
        const { data: dbWithdrawals, error: wErr } = await supabase
          .from('withdrawal_requests')
          .select('*')
          .order('created_at', { ascending: false });

        if (!wErr && dbWithdrawals) {
          const mapped: WithdrawalRequest[] = dbWithdrawals.map((r: any) => ({
            id: r.id,
            partnerId: r.partner_id,
            amountUsd: Number(r.amount_usd),
            payoutMethod: r.payout_method,
            payoutEmail: r.payout_email,
            legalName: r.legal_name,
            country: r.country,
            currency: r.currency,
            bankName: r.bank_name,
            accountName: r.account_name,
            accountNumber: r.account_number,
            swiftBic: r.swift_bic,
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            adminNotes: r.admin_notes
          }));
          setWithdrawalRequests(mapped);
          localDB.setWithdrawals(mapped);
        }

        // Fetch broadcasts
        const { data: dbBroadcasts, error: bErr } = await supabase
          .from('broadcasts')
          .select('*')
          .order('created_at', { ascending: false });

        if (!bErr && dbBroadcasts) {
          const mapped: FounderBroadcast[] = dbBroadcasts.map((r: any) => ({
            id: r.id,
            title: r.title,
            content: r.content,
            date: new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            author: r.author
          }));
          setBroadcasts(mapped);
          localDB.setBroadcasts(mapped);
        }
      } catch (err) {
        console.warn("Supabase network request failed, preserving local workspace:", err);
      }
    };

    loadSupabaseSystem();

    // Subscribe to realtime database channels
    const supabase = getSupabase();
    if (!supabase) return;

    const profileChannel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        loadSupabaseSystem();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawal_requests' }, () => {
        loadSupabaseSystem();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'broadcasts' }, () => {
        loadSupabaseSystem();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, []);

  // Handlers for authentic registration and auth
  const handleRegisterUser = async (newProfile: PartnerProfile) => {
    const updatedProfiles = [...profiles, newProfile];
    setProfiles(updatedProfiles);
    localDB.setProfiles(updatedProfiles);
    setCurrentProfile(newProfile);
    setView('auth');

    // Attempt direct registration in Supabase
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.from('profiles').insert([{
          id: newProfile.id.includes('usr_') ? undefined : newProfile.id, // Supabase Auth inserts UUIDs
          full_name: newProfile.fullName,
          username: newProfile.username,
          phone_number: newProfile.phoneNumber,
          country: newProfile.country,
          twitter_handle: newProfile.twitterHandle,
          instagram_handle: newProfile.instagramHandle,
          linkedin_profile: newProfile.linkedInProfile,
          website: newProfile.website,
          audience_niche: newProfile.audienceNiche,
          audience_size: newProfile.audienceSize,
          affiliate_experience: newProfile.affiliateExperience,
          why_join: newProfile.whyJoin,
          status: 'pending',
          role: 'user',
          tier: 'Affiliate',
          commission_rate: 0.20
        }]);
      } catch (err) {
        console.error("Failed to commit profile to remote Supabase database:", err);
      }
    }
  };

  const handleLoginUser = (credential: string, passwordText: string): { success: boolean; error?: string } => {
    // Find either by email or username
    const userMatched = profiles.find(p => 
      (p.email.toLowerCase() === credential.toLowerCase() || p.username.toLowerCase() === credential.toLowerCase()) && 
      p.password === passwordText
    );

    if (userMatched) {
      setCurrentProfile(userMatched);
      if (userMatched.status === 'approved') {
        if (userMatched.role === 'admin') {
          setView('admin');
        } else {
          setView('dashboard');
        }
      } else {
        // Shown the onboarding waitlist/vetting queue
        setView('auth');
      }
      return { success: true };
    }

    return { success: false, error: 'Authorization rejected. Credentials do not match active database.' };
  };

  const handleLogout = () => {
    setCurrentProfile(null);
    setView('landing');
  };

  // Modify applicant approval status (Admin Panel capability)
  const handleModifyProfileStatus = async (userId: string, newStatus: ApprovalStatus) => {
    const updated = profiles.map(p => {
      if (p.id === userId) {
        const u = { ...p, status: newStatus };
        if (newStatus === 'approved') {
          u.commissionRate = 0.20;
          u.tier = 'Affiliate';
        }
        return u;
      }
      return p;
    });

    setProfiles(updated);
    localDB.setProfiles(updated);

    // Sync remote
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase
          .from('profiles')
          .update({ 
            status: newStatus,
            commission_rate: newStatus === 'approved' ? 0.20 : undefined,
            tier: newStatus === 'approved' ? 'Affiliate' : undefined
          })
          .eq('id', userId);
      } catch (err) {
        console.error("DB update error:", err);
      }
    }

    // Sync local active context if current logged-in user modified
    if (currentProfile && currentProfile.id === userId) {
      setCurrentProfile(prev => prev ? { ...prev, status: newStatus } : null);
    }
  };

  // Modify roles (Admin Panel capability)
  const handleModifyProfileRole = async (userId: string, newRole: 'user' | 'admin') => {
    const updated = profiles.map(p => p.id === userId ? { ...p, role: newRole } : p);
    setProfiles(updated);
    localDB.setProfiles(updated);

    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase
          .from('profiles')
          .update({ role: newRole })
          .eq('id', userId);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Profile modification (Dashboard Settings capability)
  const handleModifyProfile = async (updatedProfile: PartnerProfile) => {
    const updated = profiles.map(p => p.id === updatedProfile.id ? updatedProfile : p);
    setProfiles(updated);
    localDB.setProfiles(updated);
    setCurrentProfile(updatedProfile);

    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase
          .from('profiles')
          .update({
            full_name: updatedProfile.fullName,
            phone_number: updatedProfile.phoneNumber,
            country: updatedProfile.country,
            twitter_handle: updatedProfile.twitterHandle,
            linkedin_profile: updatedProfile.linkedInProfile,
            website: updatedProfile.website
          })
          .eq('id', updatedProfile.id);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Profile deletion (Dashboard capability)
  const handleDeleteAccount = async () => {
    if (!currentProfile) return;
    const targetId = currentProfile.id;
    const updated = profiles.filter(p => p.id !== targetId);
    setProfiles(updated);
    localDB.setProfiles(updated);
    setCurrentProfile(null);
    setView('landing');

    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.from('profiles').delete().eq('id', targetId);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Add Announcement Bulletins
  const handleAddBroadcast = async (title: string, content: string) => {
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.from('broadcasts').insert([{
          title,
          content,
          author: 'Luminor Dev Team'
        }]);
      } catch (err) {
        console.error(err);
      }
    } else {
      const newB: FounderBroadcast = {
        id: `broad_${Date.now()}`,
        title,
        content,
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        author: 'Luminor Dev Team'
      };
      const updated = [newB, ...broadcasts];
      setBroadcasts(updated);
      localDB.setBroadcasts(updated);
    }
  };

  const handleAddWithdrawalRequest = async (newRequest: Omit<WithdrawalRequest, 'id' | 'createdAt' | 'updatedAt' | 'partnerId'>) => {
    if (!currentProfile) return;
    const reqId = `req_${Math.floor(1000 + Math.random() * 9000)}`;
    const timestampStr = new Date().toISOString();
    
    const requestWithMetadata: WithdrawalRequest = {
      ...newRequest,
      id: reqId,
      partnerId: currentProfile.id,
      createdAt: timestampStr,
      updatedAt: timestampStr
    };

    const updated = [requestWithMetadata, ...withdrawalRequests];
    setWithdrawalRequests(updated);
    localDB.setWithdrawals(updated);

    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.from('withdrawal_requests').insert([{
          id: reqId,
          partner_id: currentProfile.id,
          amount_usd: newRequest.amountUsd,
          payout_method: newRequest.payoutMethod,
          payout_email: newRequest.payoutEmail,
          legal_name: newRequest.legalName,
          country: newRequest.country,
          currency: newRequest.currency,
          bank_name: newRequest.bankName,
          account_name: newRequest.accountName,
          account_number: newRequest.accountNumber,
          swift_bic: newRequest.swiftBic,
          status: 'Pending Review'
        }]);
      } catch (err) {
        console.error(err);
      }
    }

    // Send Admin SMTP notification
    const alertBody = `
[LUMINOR OUTBOUND TERMINAL RELAY SERVICE]
ALERT LEVEL: HIGH - FINANCE QUEUE INGESTION

A new manual withdrawal request from an affiliate partner has been filed in the system queue:

- Request ID: ${reqId}
- Partner Full Legal Name: ${newRequest.legalName} (.id: ${currentProfile.id})
- Affiliate Username: @${currentProfile.username}
- Amount: $${newRequest.amountUsd.toFixed(2)} USD (settlement currency: ${newRequest.currency})
- Method: ${newRequest.payoutMethod === 'paypal' ? 'PayPal' : 'Bank Transfer Wire'}
- Target Country Destination: ${newRequest.country}
- Settlement Destination Coordinates: 
  ${newRequest.payoutMethod === 'paypal' ? `PayPal account email: ${newRequest.payoutEmail}` : `Bank Name: ${newRequest.bankName} | Holder: ${newRequest.accountName} | Account/IBAN: ${newRequest.accountNumber} | SWIFT/BIC: ${newRequest.swiftBic}`}

Vetting Actions required:
1. Confirm referral settlement ledger clearance in Supers console.
2. Vett bank coordinates for compliance risk tags.
3. Mark status to Processing or Paid on dispatch.
    `;

    const adminEmail = {
      id: `smtp_${Math.floor(100000 + Math.random() * 900000)}`,
      timestamp: timestampStr,
      to: 'revluma.ai@gmail.com',
      subject: `[Luminor Terminal Alert] Manual Payout Ingested - ${reqId}`,
      body: alertBody.trim(),
      isSystem: true
    };

    const slipBody = `
Dear ${newRequest.legalName},

We have safely registered your manual settlement withdrawal request for $${newRequest.amountUsd.toFixed(2)} USD in our administrative ledger stream.

- Settlement Code (Tracking ID): ${reqId}
- Filing Timestamp: ${new Date(timestampStr).toUTCString()}
- Method Destination: ${newRequest.payoutMethod === 'paypal' ? 'PayPal Express' : 'Global Bank Wire Payout'}
- Currency Coordinates: ${newRequest.currency}
- Pipeline Status: Pending Review

Next Milestones:
Our compliance and financial operations team will manually audit the referral conversion logs. Manual payouts are typically reviewed, approved, and dispersed within 3-5 standard business days.

Once completed, you will receive another automated notification on this account stream.

If you have any questions or noticed any coordinate errors, please open a direct advisory ticket.

Best Regards,
The Alistair Voss Financial Command Team
Luminor Revluma Platform Services Ltd.
    `;

    const userEmail = {
      id: `smtp_${Math.floor(100000 + Math.random() * 900000)}`,
      timestamp: timestampStr,
      to: currentProfile.email,
      subject: `Revluma Affiliate Partner - Payout Queue Placement (${reqId})`,
      body: slipBody.trim(),
      isSystem: false
    };

    setSentEmails(prev => [adminEmail, userEmail, ...prev]);
  };

  const handleUpdateWithdrawalRequestStatus = async (requestId: string, newStatus: WithdrawalRequestStatus, adminNotes?: string) => {
    const timestampStr = new Date().toISOString();
    const updated = withdrawalRequests.map(req => {
      if (req.id === requestId) {
        const partnerInfo = profiles.find(p => p.id === req.partnerId);
        
        // Output email simulation update
        if (partnerInfo) {
          const statusEmailBody = `
Dear ${req.legalName},

Your withdrawal request has been updated inside our secure settlement ledger.

- Settlement Tracking ID: ${req.id}
- Latest Status Update: ${newStatus.toUpperCase()}
- Cleared Payout Value: $${req.amountUsd.toFixed(2)} USD
- Dispatch Notes / Remittance IDs: 
  "${adminNotes || 'No additional notes logged.'}"
- Timestamp: ${new Date(timestampStr).toUTCString()}

If this transaction has been marked "Paid", please verify with your financial institution or PayPal wallet. Wire transactions can take up to 2-3 additional business days to clear local networks.

For compliance, double check your ledger ID in your partner center.

Respectfully,
Vetting Command Group
Revluma Logistics division.
          `;

          const notifyEmail = {
            id: `smtp_${Math.floor(100000 + Math.random() * 900000)}`,
            timestamp: timestampStr,
            to: partnerInfo.email,
            subject: `[Payout Notification] Revluma Withdrawal Status Clear - ${req.id} (${newStatus})`,
            body: statusEmailBody.trim(),
            isSystem: false
          };

          setSentEmails(prevEmails => [notifyEmail, ...prevEmails]);
        }

        return {
          ...req,
          status: newStatus,
          adminNotes: adminNotes,
          updatedAt: timestampStr
        };
      }
      return req;
    });

    setWithdrawalRequests(updated);
    localDB.setWithdrawals(updated);

    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase
          .from('withdrawal_requests')
          .update({
            status: newStatus,
            admin_notes: adminNotes,
            updated_at: timestampStr
          })
          .eq('id', requestId);
      } catch (err) {
        console.error(err);
      }
    }
  };

  return (
    <div id="app-viewport-root" className="min-h-screen bg-zinc-950 font-sans antialiased text-zinc-100">
      
      {/* 1. LANDING PAGE PANEL */}
      {view === 'landing' && (
        <LandingPage 
          onNavigateToAuth={(mode) => setView('auth')}
          currentProfile={currentProfile}
          onNavigateToDashboard={() => {
            if (currentProfile?.role === 'admin') {
              setView('admin');
            } else {
              setView('dashboard');
            }
          }}
        />
      )}

      {/* 2. AUTHENTICATION & STEPPED REGISTRATION PANEL */}
      {view === 'auth' && (
        <AuthInterface 
          onAuthSuccess={(profile: PartnerProfile) => {
            setCurrentProfile(profile);
            if (profile.role === 'admin') {
              setView('admin');
            } else if (profile.status === 'approved') {
              setView('dashboard');
            } else {
              setView('auth');
            }
          }}
          onBackToLanding={() => setView('landing')}
          allCreatedProfiles={profiles}
          onCreateProfile={(profile: PartnerProfile) => {
            setProfiles(prev => {
              const matchedIndex = prev.findIndex(p => p.id === profile.id);
              let copies = [...prev];
              if (matchedIndex !== -1) {
                copies[matchedIndex] = profile;
              } else {
                copies = [...copies, profile];
              }
              localDB.setProfiles(copies);
              return copies;
            });
          }}
          onSendSimulatedEmail={(emailObj: { to: string; subject: string; body: string; isSystem: boolean }) => {
            const timestampStr = new Date().toISOString();
            const newEmail = {
              id: `smtp_${Math.floor(100000 + Math.random() * 900000)}`,
              timestamp: timestampStr,
              to: emailObj.to,
              subject: emailObj.subject,
              body: emailObj.body,
              isSystem: emailObj.isSystem
            };
            setSentEmails(prev => [newEmail, ...prev]);
          }}
        />
      )}

      {/* 3. PARTNER GOS DASHBOARD */}
      {view === 'dashboard' && currentProfile && (
        <Dashboard 
          currentProfile={currentProfile}
          allProfiles={profiles}
          onLogout={handleLogout}
          onModifyProfile={handleModifyProfile}
          onDeleteAccount={handleDeleteAccount}
          broadcastsList={broadcasts}
          onAddBroadcast={handleAddBroadcast}
          withdrawalRequests={withdrawalRequests}
          onAddWithdrawalRequest={handleAddWithdrawalRequest}
          sentEmails={sentEmails}
          onClearEmailLogs={() => setSentEmails([])}
        />
      )}

      {/* 4. SUPERVISOR CONTROL CONSOLE */}
      {view === 'admin' && currentProfile && currentProfile.role === 'admin' && (
        <AdminPanel 
          allProfiles={profiles}
          onModifyProfileStatus={handleModifyProfileStatus}
          onModifyProfileRole={handleModifyProfileRole}
          broadcastsList={broadcasts}
          onAddBroadcast={handleAddBroadcast}
          withdrawalRequests={withdrawalRequests}
          onUpdateWithdrawalRequestStatus={handleUpdateWithdrawalRequestStatus}
          onBackToDashboard={() => {
            setView('dashboard');
          }}
        />
      )}
    </div>
  );
}
