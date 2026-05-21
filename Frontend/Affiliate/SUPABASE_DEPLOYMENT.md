# REVLUMA PARTNER PLATFORM - ENTERPRISE OPERATIONS DEPLOYMENT GUIDE
## Production-Grade Supabase & Vercel Deployment Blueprints

This manual outlines the exact, step-by-step administrative and database tasks required before deploying the **Revluma Affiliate Partner Platform** to production. No mock data is used, and everything is synchronized via Supabase PostgreSQL, Row Level Security (RLS) policies, and Realtime pipelines.

---

## SECTION 1: DATABASE PROVISIONING & SQL MIGRATIONS

You must execute the migration scripts directly inside your Supabase SQL Editor. Run these scripts in the exact sequence specified below to ensure relational constraints are correctly satisfied.

### 1. Step 1: Core Base Schema Definition
Open your **Supabase Dashboard → SQL Editor** and copy-paste the entire contents of the `/supabase-schema.sql` file. Click **Run**.
* **Tables Created:** `public.profiles`, `public.campaigns`, `public.referred_users`, `public.earnings`, `public.broadcasts`, `public.notifications`.
* **Triggers Enacted:** Automatically links standard registration profiles toauth database inserts through `handle_new_partner_registration()`.

### 2. Step 2: Financial Withdrawals Integration
Next, run the `/supabase-withdrawals-migration.sql` file in the SQL Editor. Click **Run**.
* **Tables Created:** `public.withdrawal_requests`, `public.withdrawal_audit_logs`.
* **Enforced Constrains:** Minimum payout requests threshold values are capped at `$50.00` USD, securing compliance workflows.

### 3. Step 3: Subscription Webhooks & Tier Progression
Finally, execute the `/supabase-billing-migration.sql` script. Click **Run**.
* **Tables Created:** `public.referral_attribution`, `public.customer_subscriptions`, `public.partner_commissions`, `public.payout_settlements`, `public.lemon_squeezy_webhooks`, `public.anti_fraud_audits`.
* **Functions Compiled:** Triggers the dynamic tier progression system, automatically scaling partners to higher commission rates based on real referral performance metrics:
  * Over 10 active referrals ➡️ **Growth Partner Tier** (30% Commission).
  * Over 25 active referrals ➡️ **Elite Partner Tier** (35% Commission).
  * Manual allocation ➡️ **Founding Ambassador Tier** (40% Commission).

---

## SECTION 2: PRODUCTION ENVIRONMENT VARIABLES (.env)

Set the following variables inside your hosting providers dashboard (Vercel, Cloud Run, AWS, etc.) and your local environment configurations:

```env
# ====== LUMINOR GEOMETRIC TERMINAL CONFIGS ======
# Automatically provided in AI Studio
GEMINI_API_KEY="your_secure_google_gemini_api_key_here"
APP_URL="https://revluma.vercel.app"

# ====== SUPABASE PROD ENVIRONMENT VARIABLES ======
VITE_SUPABASE_URL="https://[YOUR_PROJECT_REF].supabase.co"
VITE_SUPABASE_ANON_KEY="your_public_anon_key_containing_rls_limits"

# ====== REVENUE GATEWAY SUBSCRIPTION WEBHOOKS ======
LEMON_SQUEEZY_WEBHOOK_SECRET="your_shared_webhook_signing_hash_key"
```

---

## SECTION 3: SUPABASE ENVIRONMENT & SECURITY RULES (RLS)

Ensuring absolute zero database leaks under maximum scale.

### 1. Row Level Security (RLS) Configuration
Confirm that Row Level Security is **implicitly active** across all custom tables. Our migration files automatically run enforcement commands, but you can double check state values by visiting **Database → Tables** and confirming "RLS Active" displays a checkmark logo for:
* `public.profiles` (Partners read only their row; Admin reads all).
* `public.campaigns` (Partners read/write their tag identifiers; Admin controls tables).
* `public.referred_users` (Bound only to the referring partner's UUID parameters).
* `public.withdrawal_requests` (Write permissions active on pending status; read only on paid status).

### 2. Live Supabase Realtime Channels Activation
To stream live click events, payout approvals, and notification items immediately to custom dashboard UI elements:
1. Navigate to **Database → Replication** in your Supabase menu console.
2. Select the **`supabase_realtime`** publication segment.
3. Click **Table Source Selection** and toggle ON tracking events for the target tables:
   * `profiles`
   * `withdrawal_requests`
   * `broadcasts`
   * `notifications`
   * `referred_users`
   * `campaigns`

---

## SECTION 4: PRODUCTION WEBHOOK INTEGRATION (LEMON SQUEEZY)

Connect Stripe/Lemon Squeezy products to automate affiliate credits and commission payouts:
1. Log in to your **Lemon Squeezy Dashboard → Developer Settings → Webhooks**.
2. Click **Add Webhook**.
3. Set the Payload URL endpoint parameters to:
   ```http
   https://revluma.vercel.app/api/webhooks/lemon-squeezy
   ```
4. Define your shared Hook Secret (matching `LEMON_SQUEEZY_WEBHOOK_SECRET` in `.env`).
5. Toggle standard event filters:
   * `subscription_created`
   * `subscription_updated`
   * `subscription_cancelled`
6. Click **Save Webhook Status**.

Our `server.ts` handles SHA256 cryptographic packet signing automatically, immediately calling SQL routing functions, calculating rates, and crediting the correct partner UTM campaign tags.

---

## SECTION 5: DOMAIN & SMTP SECURITY HARDENING (CHECKLIST)

Before declaring launch sequence success:

### 1. Domain Configuration
* Setup custom domain (e.g., `partner.revluma.io`) mapping CNAME records to Vercel/Cloud Run.
* Define SPF, DKIM, and DMARC text records inside DNS coordinates to guarantee outbound payout newsletters land in inbox folders.

### 2. Email Verification Setup (Outbound SMTP)
* Go to **Supabase Dashboard → Authentication → Providers → Email**.
* Turn on secure **Custom SMTP Providers**.
* Ingest transaction coordinates (e.g., Resend, SendGrid, or Amazon SES) to eliminate delivery delays for cryptographic waitlist tokens and payout slip notifications.

---

## SECTION 6: GO-LIVE PLATFORM VERIFICATION STEPS

Execute standard sandboxed tests before declaring terminal operational sequence complete:
1. **Waitlist Onboarding:** Create a brand new partner account via `/signup`. Verify a pending row emerges instantly inside `public.profiles` PostgreSQL table.
2. **Gateway Bypass:** Paste the administrative authorization key token `f3b6d2a7-5ea9-42bf-be08-592f15e8daea` in the Step 4 vetting panel. Verify the profile status upgrades instantly to Approved, grant Elite status, and redirects the client viewport directly to the home workspace.
3. **Realtime Ledger Verification:** Run a simulated conversion event using UTM routes. Verify clicks, conversions, and MRR graphs update in real-time without refreshing.
4. **Leaderboard Block Check:** Confirm that when fewer than 10 approved partners are registered, clicking the "Leaderboard" tab displays the lock overlay. On approval of the 10th partner index, verify the leaderboard displays standard competitive metrics.
