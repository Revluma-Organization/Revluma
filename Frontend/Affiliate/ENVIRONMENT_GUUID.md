# REVLUMA GROWTH OPERATING SYSTEM (GOS)
## Master Environment Setup, Integration Architecture, & Production Deployment Blueprint

This blueprint constitutes the definitive guide for configuring, securing, and deploying the **Revluma Affiliate Partner Platform** into production environments. No simulated systems or static mock databases are utilized at scale; the entire codebase is structured to transition cleanly from local sandboxed states to real-time, production-grade cloud services once environment credentials are provided.

---

## SECTION 1: SYSTEM ENVIRONMENT ARCHITECTURE

To ensure high-performance telemetry and complete data privacy, Revluma splits variables into two strict security tiers:

1. **Client-safe Variables (`VITE_` Bundled):** Inged by Vite during the client build phase. These are bundled directly into static web assets and are accessible inside browser developer tools. They must **only** be used for public backend URLs and client-safe public keys.
2. **Server-only Secret Variables:** Reserved strictly for private environment injection. These are accessible exclusively within Node/Express backend runtimes (e.g., `process.env.GEMINI_API_KEY`) and are **never** bundled or transmitted to the client viewport. Keep high-privilege keys, webhook signatures, and database master passwords in this tier.

---

## SECTION 2: PRODUCTION ENVIRONMENT VARIABLE DICTIONARY

| Environment Variable Name | Target Scope | Associated Platform | Functional Purpose | Where to Obtain Coordinates |
| :--- | :--- | :--- | :--- | :--- |
| **`NODE_ENV`** | Server-Only | Node Runtime / Cloud Run | Controls optimization levels. Set to `production` to bypass Vite development middleware and enforce static serving. | Set manually in hosting dashboard. |
| **`APP_URL`** | Both | Deployment Host | The primary base URL of the deployed application. Highly critical for generating self-referential payment links and setting webhook targets. | Automatically injected by AI Studio or copy-pasted from your hosting domain (e.g., `https://partner.revluma.io`). |
| **`GEMINI_API_KEY`** | Server-Only | Google AI Studio | Powers the **AI Promotional Content Copilot**. Converts user metrics, tone preferences, and channel tags into marketing copy. | [Google AI Studio Console](https://aistudio.google.com/) |
| **`VITE_SUPABASE_URL`** | Client-safe | Supabase Project | The public public domain endpoint for your dedicated PostgreSQL cloud instance. | [Supabase Dashboard](https://supabase.com/) ➡️ Project Settings ➡️ API ➡️ Project URL |
| **`VITE_SUPABASE_ANON_KEY`** | Client-safe | Supabase Project | Public API token used to query database tables. Strongly gated and validated by Postgres Row Level Security (RLS) policies. | [Supabase Dashboard](https://supabase.com/) ➡️ Project Settings ➡️ API ➡️ `anon` `public` key |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Server-Only | Supabase Project | Overriding administrative credential. Bypasses all Row Level Security policies. **WARNING: Never expose this to the browser.** | [Supabase Dashboard](https://supabase.com/) ➡️ Project Settings ➡️ API ➡️ `service_role` (secret) |
| **`LEMON_SQUEEZY_API_KEY`** | Server-Only | Lemon Squeezy | Secret API token to index, verify, and validate customer checkout sessions, active subscriptions, and payout structures. | [Lemon Squeezy Dashboard](https://app.lemonsqueezy.com/) ➡️ Settings ➡️ API Keys |
| **`LEMON_SQUEEZY_WEBHOOK_SECRET`** | Server-Only | Lemon Squeezy | Secure HMAC SHA256 string defined by you to sign and cryptographically authenticate incoming webhooks representing transactions. | Create a secure high-entropy string and paste it both here and in Lemon Squeezy settings. |
| **`RESEND_API_KEY`** | Server-Only | Resend SMTP | Secret API token used to programmatically dispatch automated waitlist approvals, payout receipts, and server alerts. | [Resend Console](https://resend.com/) ➡️ API Keys |
| **`JWT_SECRET`** | Server-Only | Node Backend | Secret key for signing and validating session access tokens. | Generate a secure, high-entropy 32+ character string using `openssl rand -hex 32`. |
| **`NEXTAUTH_SECRET`** | Server-Only | NextAuth Host | Token encryption key. Only needed if migrating the application logic to NextAuth/Auth.js. | Generate a secure 32+ character string. |

---

## SECTION 3: PLATFORM SETUP & INTEGRATION INSTRUCTIONS

Follow these blueprints to wire our real integration hooks across target dashboards.

### 1. In your **SUPABASE DASHBOARD (Database Layer)**
To provision a real-time, cloud-connected datastore:
1. Create a brand-new project inside [Supabase](https://supabase.com/).
2. Navigate to the **SQL Editor** tab from your project side-menu.
3. Open the following sql files found at the folder root of this workspace and execute them in this exact order:
   - **`supabase-schema.sql`** (Creates core tables: `profiles`, `campaigns`, `referred_users`, `earnings`, `broadcasts`, `notifications`).
   - **`supabase-withdrawals-migration.sql`** (Configures financial withdrawal requested tables, parameters, and minimum limits).
   - **`supabase-billing-migration.sql`** (Configures webhook tables, conversion logs trackers, and automated tier progression procedures).
4. Go to **Database** ➡️ **Replication** ➡️ **`supabase_realtime`** publication segment and toggle replication ON for:
   - `profiles`
   - `withdrawal_requests`
   - `broadcasts`
   - `notifications`
   - `referred_users`
   - `campaigns`
5. Go to **Project Settings** ➡️ **API** and copy `Project URL` and `anon` `public` keys. Put them into `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### 2. In your **LEMON SQUEEZY DASHBOARD (Billing Layer)**
To synchronize affiliate referrals and credit conversions:
1. Log in to [Lemon Squeezy](https://app.lemonsqueezy.com/).
2. Navigate to **Developer Settings** ➡️ **Webhooks** ➡️ **Add Webhook**.
3. Set your target Payload URL to:
   ```http
   https://partner.revluma.io/api/webhooks/lemon-squeezy
   ```
   *(Replacing `partner.revluma.io` with your actual APP_URL).*
4. Set the **Signing Secret** to match the value you designated in **`LEMON_SQUEEZY_WEBHOOK_SECRET`**.
5. Select the following event triggers:
   - `subscription_created`
   - `subscription_updated`
   - `subscription_cancelled`
6. Click **Save Webhook**.

### 3. In your **RESEND DASHBOARD (SMTP Notification Layer)**
To trigger real transactional email dispatch:
1. Log in to your [Resend Account](https://resend.com/).
2. Navigate to **Domains** ➡️ **Add Domain** and verify your domain records (DKIM and SPF records) within your DNS configurations to eliminate inbox delays or spam classification.
3. Go to **API Keys** ➡️ **Create API Key**.
4. Set permissions to Full Access and paste the resulting string directly into **`RESEND_API_KEY`**.

---

## SECTION 4: DEPLOYMENT STACK CONFIGURATION MATRIX

Depending on where you deploy, input your configuration values using the specific formatting below.

### Option A: Deploying to VERCEL
Ensure that you define the client-safe variables first. Use Vercel's environment settings:
* Under project settings, input:
  - `VITE_SUPABASE_URL` ➡️ `https://[PROJECT-ID].supabase.co`
  - `VITE_SUPABASE_ANON_KEY` ➡️ `[YOUR-PUBLIC-KEY]`
  - `GEMINI_API_KEY` ➡️ `[YOUR-GEMINI-AI-KEY]` (Server-Only, hidden)
  - `LEMON_SQUEEZY_WEBHOOK_SECRET` ➡️ `[YOUR-SIGNING-SECRET]`
  - `RESEND_API_KEY` ➡️ `[YOUR-RESEND-KEY]`
  - `JWT_SECRET` ➡️ `[YOUR-RANDOM-HEX]`

### Option B: Deploying to CLOUD RUN / DOCKER
In Dockerfiles or Cloud Run service configurations, pass raw env variables directly:
```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: revluma-gos
spec:
  template:
    spec:
      containers:
        - image: gcr.io/your-project/revluma
          env:
            - name: NODE_ENV
              value: "production"
            - name: GEMINI_API_KEY
              value: "AI_STUDIO_INJECTED_OR_MANUAL"
            - name: VITE_SUPABASE_URL
              value: "https://your-proj.supabase.co"
            - name: VITE_SUPABASE_ANON_KEY
              value: "your-anon-key"
            - name: LEMON_SQUEEZY_WEBHOOK_SECRET
              value: "rev_luma_secret_bypass_dev_mode"
```

---

## SECTION 5: PRE-FLIGHT PRODUCTION CHECKLIST

Before launching the applet into a live environment, confirm that each of the following configurations is successfully verified:

- [ ] **Database Connection Security:** Ensure all PostgreSQL tables inside your Supabase project have Row Level Security (RLS) enabled.
- [ ] **Zero-Key Sandbox Safety:** Verify that when `VITE_SUPABASE_URL` is empty, the application falls back safely and gracefully to client-side localStorage (`localDB` engine) so that onboarding remains flawless during demo phases.
- [ ] **JWT Key Entropy:** Ensure that `JWT_SECRET` is set to a secure 256-bit cryptographically random string inside the production dashboard environment parameters.
- [ ] **Realtime Event Slashes:** Confirm Postgres Replication channels are active on the Supabase database. This enables user accounts to observe click-tracking counters and pending payouts update within the dashboard instantly without manual refreshes.
- [ ] **Webhook Cryptographic Integrity:** Input the correct webhook secret inside Lemon Squeezy settings, guaranteeing that only authentic payloads from Lemon Squeezy can update user commissions.
- [ ] **DKIM/SPF Domain Passing:** Verify your domain records in Resend to ensure email dispatch metrics stay robust.
- [ ] **Admin Portal Security:** Paste raw secret key `f3b6d2a7-5ea9-42bf-be08-592f15e8daea` inside the Step 4 administrative vetting console during verification phases to confirm automated status conversions.
