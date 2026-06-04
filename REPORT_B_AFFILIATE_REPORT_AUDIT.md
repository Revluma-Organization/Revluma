# REPORT B — REVLUMA AFFILIATE AUTHENTICATION SYSTEM AUDIT

---

## Executive Summary

The Revluma Affiliate authentication system is a **multi-step, application-review-gated registration flow** that shares the same PostgreSQL database and Express backend as the main platform. Affiliates register, verify their email, complete registration (which auto-creates a session), and then await manual admin approval before accessing the dashboard.

The system has several **critical and high** issues: the verification code is hashed with SHA-256 instead of bcrypt — making it crackable in milliseconds from a DB breach — there is a **broken `resendVerificationEmail` function that references undefined variables** (a runtime crash bug), and newly registered affiliates are **auto-approved at status APPROVED** in the transaction instead of being placed in `PENDING_REVIEW` as intended. There is also no affiliate-specific login route, forcing affiliates to use the main platform's `/api/session/login`, which does not enforce affiliate-specific status gating at login time.

**Overall Scores**
| Dimension | Score |
|---|---|
| Security | 55 / 100 |
| Reliability | 58 / 100 |
| Scalability | 60 / 100 |
| Production Readiness | 55 / 100 |

---

## 1. System Overview & Architecture

### Affiliate Authentication Flow

```
Browser (Affiliate Frontend SPA)
  │
  ├─ GET  /api/affiliate-auth/check-username?username=...   [rate: 30/min]
  ├─ GET  /api/affiliate-auth/check-email?email=...         [rate: 30/min]
  │
  ├─ POST /api/affiliate-auth/register                      [rate: 5/hr]
  │    └─ affiliateAuthService.registerAffiliate()
  │    └─ Validates ≥2 distribution channels
  │    └─ bcrypt.hash(password, 10)   ← cost 10 (should be 12)
  │    └─ SHA-256 hash of OTP         ← WEAK (Finding B-01)
  │    └─ Upserts PendingRegistration
  │    └─ Fires verification email in background (non-blocking)
  │
  ├─ POST /api/affiliate-auth/verify-email
  │    └─ SHA-256 compare (constant-time) ← hash itself is weak (B-01)
  │    └─ Sets emailVerified = true, authState = PENDING_REVIEW
  │
  ├─ POST /api/affiliate-auth/complete-registration
  │    └─ affiliateAuthService.completeAffiliateRegistration()
  │    └─ $transaction: Tenant + User + AffiliateProfile + PasswordHistory
  │    └─ AffiliateProfile.status = AUTH_STATES.APPROVED   ← BUG (B-03)
  │    └─ invalidateAllUserSessions + createSession (auto-login)
  │    └─ Returns session cookie + csrfToken
  │
  ├─ POST /api/session/login   (shared with main platform)
  │    └─ No affiliate status check at login time           ← Finding B-05
  │
  └─ GET  /api/affiliate-auth/application-status
       └─ Unauthenticated — exposes status by pendingRegistrationId  ← B-06
```

### Components Involved

| Component | File |
|---|---|
| Affiliate auth routes | `src/routes/affiliateAuth.js` |
| Affiliate auth service | `src/services/affiliateAuthService.js` |
| Session middleware (shared) | `src/middleware/sessionAuth.js` |
| Affiliate status guard | `src/middleware/affiliateStatusGuard.js` |
| Role middleware | `src/middleware/roleAuth.js` |
| Admin routes | `src/routes/v1/affiliateAdmin.js` |
| Dashboard routes | `src/routes/v1/affiliate-dashboard.js` |
| Email service | `src/services/emailService.js` |
| Frontend API client | `Frontend/Affiliate/src/lib/api.ts` |
| Frontend auth UI | `Frontend/Affiliate/src/components/AuthInterface.tsx` |
| Schema | `prisma/schema.prisma` |

---

## 2. Registration Analysis

### Required Fields
`email`, `password`, `firstName`, `lastName`, `username`, `phoneNumber`, `country`, `audienceNiche`, `audienceSize`, `affiliateExperience`, `whyJoin`

### Optional Fields
`twitterHandle`, `instagramHandle`, `linkedinProfile`, `youtubeChannel`, `tiktokHandle`, `facebookProfile`, `website`, `newsletterUrl`, `communityUrl`, `otherPlatform1`, `otherPlatform2`, `referralSource`

### Business Rule: Minimum 2 Distribution Channels
Enforced in `affiliateAuthService.countDistributionChannels()` and frontend `validateStep2()`. ✅

### Field-by-Field Validation

#### Email
- **Frontend validation:** regex + availability pre-check via `GET /check-email` ✅
- **Backend validation:** `validateEmail()` ✅
- **Normalization:** `normalizeEmail()` (lowercase + trim) ✅
- **Uniqueness check:** `user.findUnique + pendingRegistration.findUnique` in service ✅
- **Race condition:** Same gap as System A — check-then-upsert is not atomic. DB unique constraint catches it at upsert. ⚠️
- **Disposable email blocking:** ❌ Missing

#### Username
- **Availability check:** `affiliateProfile.findUnique({ where: { username: normalized } })` ✅
- **Normalization:** lowercased before check and storage ✅
- **Minimum length:** 3 characters ✅
- **Maximum length:** 50 characters ✅
- **DB uniqueness:** `@@unique` on `AffiliateProfile.username` ✅
- **Race condition:** Check-then-upsert gap. Two concurrent registrations with the same username can pass the `findUnique` check simultaneously. The `pendingRegistration` upsert uses email as the unique key — username is stored in `onboardingData` JSON, so the DB does **not** enforce username uniqueness at the pending stage. Duplicate usernames are only caught at `completeAffiliateRegistration` when `affiliateProfile.create` runs. If two users concurrently call `complete-registration` with the same username, one will receive a Prisma P2002 error. ⚠️

#### Password
- **Validation:** `validatePasswordStrength()` ✅
- **Hashing:** `bcrypt.hash(data.password, 10)` — **cost 10 instead of 12** ⚠️
- **`console.log` near password:** ❌ Lines 96–98 in `affiliateAuthService.js`

#### `whyJoin`
- **Max length:** 2,000 chars via `sanitizeString` ✅
- **Minimum meaningful content enforced:** Frontend requires ≥15 chars ✅

#### Social Handles
- **Sanitization:** `sanitizeString(value, maxLen)` strips `<>` and truncates ✅
- **URL validation:** None — users can enter any string in URL fields ⚠️

---

## 3. Username Availability System

| Check | Status |
|---|---|
| DB unique constraint on `AffiliateProfile.username` | ✅ |
| Case-insensitive normalization | ✅ lowercase |
| Minimum length (3 chars) | ✅ |
| Maximum length (50 chars) | ✅ |
| Race condition at pending stage | ❌ Username stored in JSON — not DB-constrained at pending stage |
| Race condition at complete-registration | ⚠️ Possible, caught by P2002 but error not user-friendly |
| Reserved username blocklist | ❌ Missing (e.g., `admin`, `revluma`, `support` can be registered) |

### Reserved Username Fix

```javascript
// In affiliateAuthService.registerAffiliate():
const RESERVED_USERNAMES = new Set([
  'admin', 'revluma', 'support', 'help', 'billing', 'security',
  'api', 'www', 'mail', 'info', 'sales', 'team', 'partner', 'affiliate'
]);

const normalized = data.username.toLowerCase().trim();
if (RESERVED_USERNAMES.has(normalized)) {
  throw new Error('USERNAME_RESERVED');
}
```

---

## 4. Email Validation System

### Verification Code — Affiliate Flow

**File:** `src/services/affiliateAuthService.js`, line 99

```javascript
const verificationCodeHash = crypto.createHash('sha256').update(data.verificationCode).digest('hex');
```

**Risk:** SHA-256 is not a password-hashing function. It is deterministic and can be reversed against a pre-computed rainbow table of all 900,000 possible 6-digit codes in milliseconds. If an attacker obtains the `verificationCodeHash` from the database, they can recover the code instantly and verify any unconfirmed account.

**This is different from System A** which correctly uses `bcrypt.hash(otp, 12)`.

**Fix:** Use `bcrypt.hash(code, 10)` (or at minimum `crypto.scryptSync` with a salt). See Finding B-01 below.

### Resend Verification — Broken Function

**File:** `src/services/affiliateAuthService.js`, lines 197–226

The `resendVerificationEmail` function contains a **copy-paste bug** — it references `normalizedEmail` and `data` variables that are **not in scope** (they are local to `registerAffiliate`):

```javascript
// BROKEN CODE inside resendVerificationEmail():
const pendingRegistration = await prisma.pendingRegistration.upsert({
  where: { email: normalizedEmail },  // ← ReferenceError: normalizedEmail is not defined
  update: {
    firstName: data.firstName,        // ← ReferenceError: data is not defined
    ...
  }
});
```

This means `POST /api/affiliate-auth/resend-verification` **will always throw a `ReferenceError`** at runtime, causing a 500 error to the user.

**Fix:** See Finding B-02 below.

---

## 5. Password System

| Check | Status |
|---|---|
| Algorithm | bcrypt ✅ |
| Salt rounds | **10** (should be 12) ⚠️ |
| Validation | `validatePasswordStrength()` ✅ |
| History check | `PasswordHistory` table, 5 records ✅ |
| `console.log` near password | ❌ Lines 96–98 |
| Transmission security | Cookie `secure: isProduction` ✅ |

---

## 6. Authentication Security Audit — Findings

---

### FINDING-B-01 — CRITICAL: OTP Hashed with SHA-256 (Not bcrypt/scrypt)

**File:** `src/services/affiliateAuthService.js`, line 99
**File:** `src/services/affiliateAuthService.js`, line 191 (resend path, when fixed)

```javascript
// CURRENT — VULNERABLE
const verificationCodeHash = crypto.createHash('sha256').update(data.verificationCode).digest('hex');
```

**Why it is wrong:** SHA-256 is fast by design. An attacker who obtains the `verificationCodeHash` column from the `pending_registrations` table can precompute all 900,000 possible 6-digit OTP hashes in under 1 second. This gives them the plaintext OTP and allows immediate email verification of any account, completely bypassing the email-ownership check.

**System A uses `bcrypt.hash(otp, 12)` for the same operation.** The discrepancy means System B is significantly weaker than System A despite sharing the same schema.

**Risk:** Complete bypass of email verification. **CRITICAL.**

**Fix:**
```javascript
// Store (in registerAffiliate and resendVerificationEmail):
const verificationCodeHash = await bcrypt.hash(data.verificationCode, 10);

// Verify (in verifyAffiliateEmail):
const isValidCode = await bcrypt.compare(code, pending.verificationCodeHash);
// Remove the SHA-256 timingSafeEqual block entirely.
```

Note: The route already passes raw `code` to `verifyAffiliateEmail` — only the storage and comparison logic needs to change.

---

### FINDING-B-02 — CRITICAL: `resendVerificationEmail` Has Undefined Variable Crash

**File:** `src/services/affiliateAuthService.js`, lines 196–226

```javascript
async resendVerificationEmail(pendingId, email) {
  // ...
  const t0 = Date.now();
  console.log(`[registerAffiliate] About to upsert pendingRegistration for ${normalizedEmail}...`);
  // ↑ normalizedEmail is NOT defined in this function's scope

  const pendingRegistration = await prisma.pendingRegistration.upsert({
    where: { email: normalizedEmail },   // ← ReferenceError
    update: {
      firstName: data.firstName,         // ← ReferenceError
      ...
    }
  });
}
```

This is a copy-paste from `registerAffiliate` that was never adapted. Every call to `resendVerificationEmail` throws a `ReferenceError` before any DB work is done, returning a 500 to the user. Users who need to re-request their verification code cannot do so.

**Risk:** Resend verification is completely broken. Users who don't receive their first code are permanently stuck. **CRITICAL.**

**Fix — Replace the broken upsert block with the correct logic:**

```javascript
async resendVerificationEmail(pendingId, email) {
  const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
  if (!pending) throw new Error('PENDING_REGISTRATION_NOT_FOUND');

  if (email && pending.email !== email.toLowerCase().trim()) {
    throw new Error('EMAIL_MISMATCH');
  }
  if (pending.emailVerified) throw new Error('EMAIL_ALREADY_VERIFIED');

  const onboardingData = pending.onboardingData || {};
  const attempts = (onboardingData.resendAttempts || 0) + 1;
  if (attempts > MAX_RESEND_ATTEMPTS) throw new Error('RESEND_LIMIT_EXCEEDED');

  const verificationCode = crypto.randomInt(100000, 999999).toString();
  const verificationCodeHash = await bcrypt.hash(verificationCode, 10); // use bcrypt (B-01 fix)
  const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.pendingRegistration.update({
    where: { id: pendingId },
    data: {
      verificationCodeHash,
      verificationExpiresAt,
      expiresAt,
      onboardingData: { ...onboardingData, resendAttempts: attempts },
      updatedAt: new Date()
    }
  });

  await this.logAuthEvent('verification_resent', {
    newStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
    metadata: { pendingId, email: pending.email, attempt: attempts }
  });

  return {
    message: 'Verification code resent',
    expiresAt: verificationExpiresAt,
    verificationCode,  // returned to route, which fires email
    firstName: pending.firstName,
    email: pending.email
  };
}
```

---

### FINDING-B-03 — HIGH: New Affiliates Auto-Approved Instead of Pending Review

**File:** `src/services/affiliateAuthService.js`, line 393

```javascript
const affiliateProfile = await tx.affiliateProfile.create({
  data: {
    ...
    status: AUTH_STATES.APPROVED,  // ← Should be PENDING_REVIEW
    ...
  }
});
```

**Why it is wrong:** The entire affiliate flow is designed around a manual review process — the vetting notification email, the `PENDING_REVIEW` status, the `affiliateStatusGuard` middleware — yet the final `create` sets `status: APPROVED` immediately. Every affiliate who completes registration has full `APPROVED` access to the dashboard before any human review occurs.

The audit log at line 411 even explicitly records `previousStatus: AUTH_STATES.PENDING_REVIEW` as if the profile starts in review — but it never does.

**Risk:** Bypasses the entire affiliate vetting process. **HIGH.**

**Fix:**
```javascript
status: AUTH_STATES.PENDING_REVIEW,  // Was: AUTH_STATES.APPROVED
```

Also update the audit log call to reflect the actual transition:
```javascript
await this.logAuthEvent('registration_completed', {
  affiliateProfileId: result.affiliateProfile.id,
  previousStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
  newStatus: AUTH_STATES.PENDING_REVIEW,  // Was: APPROVED
  ...
});
```

---

### FINDING-B-04 — HIGH: No Brute-Force Protection on OTP Verification

**File:** `src/routes/affiliateAuth.js`, lines 353–387
**File:** `src/services/affiliateAuthService.js`, lines 236–292

There is no attempt counter or lockout on `POST /api/affiliate-auth/verify-email`. An attacker with a valid `pendingRegistrationId` (returned in the register response) can brute-force the OTP at API rate.

With SHA-256 hashing (B-01), this is even more dangerous — the attacker doesn't need to call the API at all if they have DB access.

**Fix:** Add `verificationAttempts` to `PendingRegistration` model, same as System A fix (Finding A-02). Lock after 5 failures.

---

### FINDING-B-05 — HIGH: No Affiliate Status Check at Login Time

**File:** `src/routes/authSession.js` — the shared login route
**File:** `server.js`, line 139 — `app.use('/api/session', sessionLimiter, require('./src/routes/authSession'));`

The affiliate frontend logs in via `POST /api/session/login`. This route:
1. Validates credentials ✅
2. Checks `emailVerified` ✅
3. Creates a session ✅
4. **Does NOT check the user's affiliate `status`** ❌

A suspended or rejected affiliate can log in and receive a valid session cookie. The only protection is the `affiliateStatusGuard` middleware on individual dashboard routes — but there is no guarantee all routes are protected (the `/api/affiliate/dashboard/*` routes in `affiliate-dashboard.js` use an inline `requireRole(['affiliate', 'admin'])` that only checks role, not affiliate status).

**Risk:** Suspended/rejected affiliates retain full session access. Any unguarded route becomes accessible. **HIGH.**

**Fix — Add affiliate status check in login route, after credential validation:**

```javascript
// In authSession.js login route, after successful password comparison:
if (user.role === 'affiliate') {
  const affiliateProfile = await prisma.affiliateProfile.findUnique({
    where: { userId: user.id },
    select: { status: true, rejectedReason: true, suspendedReason: true }
  });
  if (affiliateProfile) {
    if (affiliateProfile.status === 'SUSPENDED') {
      return sendErrorResponse(res, 403,
        affiliateProfile.suspendedReason || 'Account suspended',
        'ACCOUNT_SUSPENDED');
    }
    if (affiliateProfile.status === 'REJECTED') {
      return sendErrorResponse(res, 403,
        affiliateProfile.rejectedReason || 'Application rejected',
        'ACCOUNT_REJECTED');
    }
  }
}
```

Alternatively, create a dedicated `POST /api/affiliate-auth/login` route that includes this check.

---

### FINDING-B-06 — MEDIUM: `GET /application-status` Is Unauthenticated and Returns Sensitive State

**File:** `src/routes/affiliateAuth.js`, lines 442–473

```javascript
router.get('/application-status', async (req, res) => {
  const { pendingRegistrationId, userId } = req.query;
  const status = await affiliateAuthService.getApplicationStatus({ ... });
  return res.json({ ...status, authState: ... });
});
```

This endpoint is **fully unauthenticated**. Anyone who knows a `pendingRegistrationId` or `userId` can query the registration status of any affiliate applicant. `pendingRegistrationId` is returned in the register response and exposed to the frontend, making it semi-public.

The response includes `authState`, `emailVerified`, `step`, `expiresAt`, `rejectedReason`, `suspendedReason`.

**Risk:** Information disclosure — `rejectedReason` (admin-written text) and `suspendedReason` are exposed to anyone with a UUID. **Medium.**

**Fix:** Require either a session or the `pendingToken` JWT to access this endpoint. If it must remain public for pre-login status checks, strip `rejectedReason` and `suspendedReason` from unauthenticated responses.

---

### FINDING-B-07 — MEDIUM: `console.log` Statements in Production Service Code

**File:** `src/services/affiliateAuthService.js`, lines 96–98, 196, 226

```javascript
console.log(`[affiliateAuthService] Hashing password for ${data.email}...`);
// ...
console.log(`[registerAffiliate] About to upsert pendingRegistration for ${normalizedEmail}...`);
```

`console.log` bypasses the structured logger. These lines will appear in unstructured stdout on Render/production, making log aggregation unreliable. The password-adjacent log (line 96) is an information-leak risk in log aggregation systems.

**Fix:** Remove all `console.log` calls from `affiliateAuthService.js`. Use `logger.debug()` if tracing is needed in development.

---

### FINDING-B-08 — MEDIUM: bcrypt Cost Factor 10 (Should Be 12)

**File:** `src/services/affiliateAuthService.js`, line 97

```javascript
const passwordHash = await bcrypt.hash(data.password, 10);
```

The main platform uses cost 12 consistently. Affiliates' passwords use cost 10. Inconsistency makes password cracking from a DB breach faster for affiliates (approximately 4× faster: 2^12 / 2^10 = 4).

**Fix:** Change to `bcrypt.hash(data.password, 12)`.

---

### FINDING-B-09 — MEDIUM: Affiliate Dashboard Routes Don't Use `affiliateStatusGuard`

**File:** `src/routes/v1/affiliate-dashboard.js`, lines 12–22

```javascript
function requireRole(roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}
const affiliateOrAdmin = requireRole(['affiliate', 'admin']);
```

This inline middleware only checks `user.role === 'affiliate'`. It does **not** check `affiliateProfile.status`. A user with role `affiliate` but status `SUSPENDED` or `PENDING_REVIEW` can access all dashboard metrics routes.

Note: This finding is compounded by B-03 (everyone is APPROVED anyway) and B-05 (suspended users can still log in).

**Fix:** Replace the inline `requireRole` with the existing `affiliateStatusGuard.requireAffiliateStatus(['APPROVED'])` middleware:

```javascript
// In affiliate-dashboard.js:
const { requireAffiliateStatus } = require('../../middleware/affiliateStatusGuard');
const approvedOnly = requireAffiliateStatus(['APPROVED']);

router.get('/metrics', approvedOnly, async (req, res) => { ... });
router.get('/referral-links', approvedOnly, async (req, res) => { ... });
router.get('/click-analytics', approvedOnly, async (req, res) => { ... });
```

---

### FINDING-B-10 — MEDIUM: Admin Approval Route References Non-Existent Schema Fields

**File:** `src/routes/v1/affiliateAdmin.js`, lines 87–96

```javascript
const updatedProfile = await tx.affiliateProfile.update({
  where: { id: affiliateId },
  data: {
    status: 'APPROVED',
    approvedAt: new Date(),
    approvedBy: req.user.id,     // ← field not in schema
    reviewNotes: notes,           // ← field not in schema
    statusUpdatedAt: new Date(),  // ← field not in schema
    statusUpdatedBy: req.user.id  // ← field not in schema
  }
});
```

`approvedBy`, `reviewNotes`, `statusUpdatedAt`, `statusUpdatedBy` are not in `prisma/schema.prisma` for `AffiliateProfile`. Prisma will silently ignore unknown fields in some versions, but in strict mode this may throw a runtime error. The same issue exists in the reject and suspend routes.

**Risk:** Admin approval silently drops important audit data. **Medium.**

**Fix:** Add the missing fields to the Prisma schema:

```prisma
model AffiliateProfile {
  // ... existing fields ...
  approvedAt        DateTime?
  approvedBy        String?
  rejectedAt        DateTime?
  rejectedBy        String?
  suspendedAt       DateTime?
  suspendedBy       String?
  reviewNotes       String?
  statusUpdatedAt   DateTime?
  statusUpdatedBy   String?
}
```

Then run `pnpm --filter @workspace/db run push`.

---

### FINDING-B-11 — LOW: `sanitizeString` Strips Only `<>` — Insufficient XSS Protection

**File:** `src/routes/affiliateAuth.js`, lines 29–33

```javascript
function sanitizeString(s, maxLen = 255) {
  if (typeof s !== 'string') return '';
  return s.trim().replace(/[<>]/g, '').slice(0, maxLen);
}
```

Stripping only `<>` does not prevent XSS payloads via event handlers (`onerror`, `onload`), protocol injections (`javascript:`), or encoded variants. While the admin vetting email renders these fields in HTML, a payload like `" onmouseover="alert(1)` survives this sanitizer.

**Fix:** Escape HTML entities for all values rendered into email templates (see System A Report, Finding A — Email Templates section). Use a proper HTML escaping function, not a blocklist approach.

---

### FINDING-B-12 — LOW: Rate Limiter Limit for Registration Is Per-IP Only

**File:** `src/routes/affiliateAuth.js`, lines 51–57

```javascript
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  ...
});
```

5 registrations per hour per IP. A bot farm can enumerate with different IPs. There is no global registration rate monitoring or CAPTCHA.

**Fix:** Add a CAPTCHA (e.g., Cloudflare Turnstile) to the affiliate registration form for step 3 submission. This is a frontend change with server-side token verification.

---

### FINDING-B-13 — LOW: Vetting Email Sent to Hardcoded Fallback Address

**File:** `src/services/affiliateAuthService.js`, line 435

```javascript
const vettingEmail = process.env.AFFILIATE_VETTING_EMAIL 
  || process.env.RAPP_VETTING_EMAIL 
  || 'revluma.ai@gmail.com';
```

If neither env var is set, the vetting notification goes to `revluma.ai@gmail.com` — a Gmail address that should not be hardcoded in source code. This leaks an internal email address and creates a production risk if the address is incorrect.

**Fix:** Remove the hardcoded fallback. If neither env var is set, log a warning and skip the notification (or throw a startup error):

```javascript
const vettingEmail = process.env.AFFILIATE_VETTING_EMAIL || process.env.RAPP_VETTING_EMAIL;
if (!vettingEmail) {
  logger.error('AFFILIATE_VETTING_EMAIL is not configured — skipping vetting notification');
  return;
}
```

---

### FINDING-B-14 — LOW: `complete-registration` Has No CSRF Protection

**File:** `src/routes/affiliateAuth.js`, line 392

```javascript
router.post('/complete-registration', async (req, res) => { ... });
```

No `csrfProtection` middleware is applied. This is a state-changing endpoint (creates User, Tenant, AffiliateProfile, establishes session). CSRF attacks are possible if an attacker can trick a logged-out user's browser into submitting the request.

Note: The risk is partially mitigated because the request body requires a valid `pendingRegistrationId` that the attacker would need to know. But defense-in-depth suggests CSRF protection should still be applied.

**Fix:** Apply `csrfProtection` middleware. For unauthenticated pre-session endpoints, the client should first fetch an anonymous CSRF token from `GET /api/session/csrf-token` and include it in the request.

---

## 7. Affiliate Login System Audit

The affiliate frontend uses the **shared** `POST /api/session/login` route. There is no dedicated affiliate login endpoint.

| Check | Status |
|---|---|
| Credential validation | ✅ |
| Generic error messages | ✅ |
| Email verification required | ✅ |
| Failed-attempt lockout | ✅ (10 attempts → 15 min) |
| Session rotation on login | ✅ |
| HTTP-only session cookie | ✅ |
| Affiliate status check at login | ❌ Finding B-05 |
| Suspended affiliates blocked | ❌ Finding B-05 |
| Role-based routing post-login | ⚠️ Done in frontend only (client-side) |

---

## 8. Affiliate Approval Flow Audit

The intended flow:
1. Affiliate registers → `PENDING_REVIEW`
2. Vetting email → admin reviews manually
3. Admin calls `PATCH /api/affiliate/admin/approve/:id` → `APPROVED`
4. Referral link generated
5. Welcome email sent

**Actual flow (as-coded):**
1. Affiliate registers → **`APPROVED`** immediately (Bug B-03)
2. Vetting email sent → admin reviews (but affiliate already has access)
3. Admin approval is a no-op for status (already APPROVED)

| Check | Status |
|---|---|
| `PENDING_REVIEW` on registration | ❌ Bug B-03 |
| Vetting notification email sent | ✅ |
| Manual admin approval endpoint | ✅ |
| Admin approval audit log | ✅ |
| Referral link generation on approval | ✅ |
| Status check enforced on dashboard | ❌ Finding B-09 |
| Rejection reason stored | ✅ |
| Suspension reason stored | ✅ |

---

## 9. Affiliate Session Management

| Check | Status |
|---|---|
| Session created on `complete-registration` | ✅ (auto-login) |
| `invalidateAllUserSessions` before new session | ✅ |
| HTTP-only cookie | ✅ |
| Sliding window (7-day) | ✅ |
| `GET /session/me` usable for session check | ✅ |
| Session invalidated on `logout` | ✅ |
| Global logout (all sessions) | ✅ |
| Session not destroyed on suspension | ❌ Suspending an affiliate does not invalidate their active sessions |

**Fix for active-session invalidation on suspension:**

```javascript
// In affiliateAdmin.js PATCH /suspend/:affiliateId, after updating profile:
const { invalidateAllUserSessions } = require('../../middleware/sessionAuth');
const userRecord = await prisma.user.findUnique({
  where: { id: result.userId },  // need userId on profile
  select: { id: true, tenantId: true }
});
if (userRecord) {
  await invalidateAllUserSessions(userRecord.id, userRecord.tenantId);
}
```

---

## 10. Database Audit — Affiliate Tables

| Model | Index Status |
|---|---|
| `AffiliateProfile.userId` | `@unique + @@index` ✅ |
| `AffiliateProfile.username` | `@unique + @@index` ✅ |
| `AffiliateProfile.status` | `@@index` ✅ |
| `AffiliateProfile.accessTokenId` | `@@index` ✅ |
| `ReferralLink.referralCode` | `@unique + @@index` ✅ |
| `ReferralClick.referralLinkId` | `@@index` ✅ |
| `ReferralClick.affiliateId` | `@@index` ✅ |
| `ReferralClick.createdAt` | `@@index` ✅ |
| `AffiliateReferral.partnerId` | `@@index` ✅ |
| `AffiliateStatusAuditLog.affiliateProfileId` | `@@index` ✅ |

**Issues:**
- `AffiliateProfile` missing `approvedBy`, `rejectedBy`, `suspendedBy`, `reviewNotes`, `statusUpdatedAt` columns (B-10)
- `PendingRegistration` missing `verificationAttempts` counter (B-04)
- `AffiliateStatusAuditLog.affiliateProfileId` stores the string `'pending'` when logged before the profile exists (line 26 in service) — referential integrity not enforced since it's a plain `String` not a FK

---

## 11. API Security Audit — Affiliate Endpoints

| Endpoint | Auth Required | CSRF | Rate Limited | Status |
|---|---|---|---|---|
| `GET /api/affiliate-auth/check-username` | No | No | 30/min | ✅ |
| `GET /api/affiliate-auth/check-email` | No | No | 30/min | ✅ |
| `POST /api/affiliate-auth/register` | No | No | 5/hr | ✅ |
| `POST /api/affiliate-auth/verify-email` | No | No | No | ❌ B-04 |
| `POST /api/affiliate-auth/resend-verification` | No | No | Max 10 total | ❌ BROKEN B-02 |
| `POST /api/affiliate-auth/complete-registration` | No | No | No | ❌ B-14 |
| `GET /api/affiliate-auth/application-status` | No | No | No | ❌ B-06 |
| `GET /api/affiliate-auth/health` | No | No | No | ✅ |
| `GET /api/affiliate/dashboard/metrics` | Session + role | No | No | ❌ B-09 |
| `GET /api/affiliate/dashboard/referral-links` | Session + role | No | No | ❌ B-09 |
| `PATCH /api/affiliate/admin/approve/:id` | Session + admin | No | No | ✅ |
| `PATCH /api/affiliate/admin/reject/:id` | Session + admin | No | No | ✅ |
| `PATCH /api/affiliate/admin/suspend/:id` | Session + admin | No | No | ✅ |

---

## 12. Middleware Audit — Affiliate

### `affiliateStatusGuard.requireAffiliateStatus`
- Queries DB for affiliate profile on every request ✅
- Returns status-specific error messages ✅
- **Not used on `/api/affiliate/dashboard/*` routes** ❌ B-09

### `affiliateStatusGuard.checkAffiliateAccess`
- Non-blocking, used for informational access checks ✅
- Silently passes on DB error (correct for non-blocking) ✅

### `roleAuth.requireRole`
- Simple role string comparison ✅
- No DB query — relies on JWT/session claim ✅
- Does not validate affiliate status ❌ B-05, B-09

---

## 13. Frontend Affiliate Auth Audit

- Multi-step registration (3 steps) with step-level validation ✅
- Backend warmup ping on mount (`/api/affiliate-auth/health`) ✅
- Username availability debounced check (400ms) ✅
- Email availability debounced check (500ms) ✅
- Password strength meter ✅
- Confirm password field ✅
- Channel count validation client-side ✅
- OTP input component with paste support ✅
- Rate-limit UI feedback (countdown timer) ✅
- CSRF token stored in `sessionStorage` ❌ Same as Finding A-06
- No CAPTCHA on registration submission ❌ B-12
- `console.log` statements with email addresses throughout (`[Login]`, `[Register]`, etc.) ⚠️ Should be removed from production builds

---

## 14. Production Readiness Assessment

| Dimension | Score | Blockers |
|---|---|---|
| Security | **55 / 100** | B-01 (SHA-256 OTP), B-03 (auto-approved), B-05 (no status check at login) |
| Reliability | **58 / 100** | B-02 (resend crashes), B-10 (admin fields missing) |
| Scalability | **60 / 100** | No cleanup jobs, no CAPTCHA, IP-only rate limits |
| **Production Ready** | **55 / 100** | Not safe until B-01, B-02, B-03 are fixed |

---

## Master Remediation Roadmap — System B

### Phase 1 — Critical (Fix Before Any Affiliates Register)
1. **B-01** Replace SHA-256 OTP hash with `bcrypt.hash(code, 10)` in `registerAffiliate` and `verifyAffiliateEmail`.
2. **B-02** Rewrite `resendVerificationEmail` to remove undefined variable references — function is currently broken at runtime.
3. **B-03** Change `status: AUTH_STATES.APPROVED` to `status: AUTH_STATES.PENDING_REVIEW` in `completeAffiliateRegistration`.

### Phase 2 — Security Hardening
4. **B-04** Add `verificationAttempts` counter + 5-attempt lockout to `verifyAffiliateEmail`.
5. **B-05** Add affiliate status check to `POST /api/session/login` for users with `role === 'affiliate'`.
6. **B-09** Replace inline `requireRole` in `affiliate-dashboard.js` with `requireAffiliateStatus(['APPROVED'])`.
7. **B-08** Change bcrypt cost in `affiliateAuthService` from 10 to 12.
8. **B-07** Remove all `console.log` calls from `affiliateAuthService.js`.
9. **B-06** Require authentication on `GET /application-status`, or strip sensitive fields from unauthenticated responses.
10. **B-13** Remove hardcoded fallback email from `sendVettingNotification`.

### Phase 3 — Reliability Improvements
11. **B-10** Add missing schema fields (`approvedBy`, `rejectedBy`, `suspendedBy`, `reviewNotes`, `statusUpdatedAt`, `statusUpdatedBy`) and run migration.
12. Add session invalidation when affiliate is suspended/rejected by admin.
13. **B-14** Apply CSRF protection to `complete-registration`.
14. **B-11** Implement proper HTML escaping in all email templates.

### Phase 4 — Scalability & Maintenance
15. Add CAPTCHA to affiliate registration form (B-12).
16. Add reserved username blocklist.
17. Add per-email rate limiting to resend-verification.
18. Add URL format validation for social channel fields.

### Phase 5 — Production Launch Checklist
- [ ] `AFFILIATE_VETTING_EMAIL` env var is set (not relying on hardcoded fallback)
- [ ] B-01, B-02, B-03 verified fixed and tested end-to-end
- [ ] Admin can approve, reject, and suspend affiliates — test each path
- [ ] Approved affiliate receives referral link in welcome email
- [ ] Suspended affiliate's session is invalidated immediately
- [ ] `NODE_ENV=production` is set in all production deployments
- [ ] No `console.log` statements remain in backend service files
- [ ] Prisma migration for new schema fields deployed to production
- [ ] SendGrid domain authentication confirmed (SPF, DKIM, DMARC)
- [ ] Vetting email delivery tested end-to-end
- [ ] `AFFILIATE_VETTING_EMAIL` set and monitored
