# REPORT A — REVLUMA USER AUTHENTICATION SYSTEM AUDIT

---

## Executive Summary

The Revluma main-platform authentication system is a **deferred-creation, OTP-verified flow** built on Express 5, Prisma ORM, and PostgreSQL. It uses HTTP-only session cookies as the primary auth mechanism, with a legacy JWT Bearer fallback retained for backward compatibility.

The architecture is **materially sound** but carries several high-severity issues — most critically: the forgot-password token is **leaked directly to the client in the API response**, and there is **no brute-force protection on OTP verification** (allowing unlimited guesses against a 6-digit code). Addressing these two issues is mandatory before production launch.

**Overall Scores**
| Dimension | Score |
|---|---|
| Security | 61 / 100 |
| Reliability | 72 / 100 |
| Scalability | 65 / 100 |
| Production Readiness | 64 / 100 |

---

## 1. System Overview & Architecture

### Authentication Flow

```
Browser
  │
  ├─ POST /api/auth/register
  │    └─ Creates PendingRegistration (hashed password, hashed OTP)
  │    └─ Issues pendingToken (JWT, 24h)
  │
  ├─ POST /api/auth/verify-email         [pendingToken required]
  │    └─ bcrypt.compare(OTP)
  │    └─ Sets pendingRegistration.emailVerified = true
  │
  ├─ POST /api/auth/complete-registration [pendingToken required]
  │    └─ Prisma $transaction → creates Tenant + User + TenantProfile + PasswordHistory
  │    └─ Deletes PendingRegistration
  │
  ├─ POST /api/session/login
  │    └─ bcrypt.compare(password)
  │    └─ Checks lockedUntil, failedLoginAttempts
  │    └─ invalidateAllUserSessions → createSession (HTTP-only cookie)
  │    └─ Returns csrfToken (HMAC-SHA256, 30-min TTL)
  │
  ├─ GET  /api/session/me   (unauthenticated: 401; authenticated: user payload)
  ├─ POST /api/session/logout   [csrfProtection]
  └─ POST /api/auth/forgot-password / reset-password
```

### Components Involved

| Component | File |
|---|---|
| Registration route | `src/routes/auth.js` |
| Session login/logout | `src/routes/authSession.js` |
| Session middleware | `src/middleware/sessionAuth.js` |
| Pending-token middleware | `src/middleware/pendingAuth.js` |
| Password/email utilities | `src/lib/auth-utils.js` |
| Email delivery | `src/services/emailService.js` |
| Database schema | `prisma/schema.prisma` |

---

## 2. Registration Analysis

### Flow

1. `POST /api/auth/register` — validates fields, hashes password (bcrypt cost 12), generates OTP, upserts `PendingRegistration`, sends OTP email, returns `pendingToken` (JWT).
2. `POST /api/auth/verify-email` — `authenticatePending` middleware validates JWT, `bcrypt.compare` against OTP hash, marks `emailVerified = true`.
3. `POST /api/auth/complete-registration` — verifies email flag, creates Tenant/User inside a `$transaction`, deletes `PendingRegistration`.

### Field-by-Field Analysis

#### Email
- **Frontend validation:** regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` in `auth-utils.js`, max 255 chars ✅
- **Backend validation:** `validateEmail()` called in route ✅
- **Normalization:** `email.toLowerCase()` before DB queries ✅
- **Uniqueness:** `prisma.user.findUnique` + `pendingRegistration.findUnique` before insert ✅
- **DB constraint:** `@@unique` on `users.email` ✅
- **Disposable email blocking:** ❌ Not present
- **Race condition:** The check-then-insert gap is not atomic. Two concurrent registrations with the same email can both pass the `findUnique` check before either upsert runs. The Prisma `upsert` on `pendingRegistration` mitigates this at the pending stage, and the DB unique constraint catches it at `complete-registration`, but the error response at that stage (P2002) discloses an account already exists.

#### Password
- **Minimum length:** 8 characters ✅
- **Maximum length:** 128 characters ✅
- **Complexity:** Requires 3 of 4 character classes ✅
- **Common-pattern blocking:** regex patterns for `password`, `qwerty`, `abc123`, etc. ✅
- **Sequential/repeated chars blocked:** ✅
- **Hashing:** `bcrypt`, cost factor **12** ✅
- **Password history:** Stores last 5 hashes, checked on reset ✅
- **Transmission:** Password only travels over HTTPS (enforced by `secure: isProduction` on cookie) ✅

#### First/Last Name
- **Required:** ✅
- **Max length:** 100 chars ✅
- **Sanitization:** Only `.trim()` — no HTML stripping at this layer ⚠️
- **Stored in:** `PendingRegistration.firstName/lastName`, then `User.fullName`

---

## 3. Username Availability System

The main platform **does not have a username concept** — users are identified by email and `fullName`. No username uniqueness risk applies to System A.

---

## 4. Email Validation System

### Verification OTP (Pending Registration Flow)

- **Generation:** `crypto.randomInt(100000, 999999)` — 900,000 possible values ✅
- **Storage:** `bcrypt.hash(otp, 12)` — hashed at rest ✅
- **Expiry:** 15 minutes ✅
- **Comparison:** `bcrypt.compare` ✅
- **Brute-force protection:** ❌ **MISSING** — no attempt counter or lockout on `POST /api/auth/verify-email`. An attacker with a valid `pendingToken` can make unlimited guesses. At 10 guesses/second, a 6-digit OTP is broken in ~25 hours. At higher concurrency, much faster.

### Verification Code (Session-Based Flow — `authSession.js`)

- **Storage:** OTP stored **in plaintext** in `EmailVerificationCode.code` ❌
- **Comparison:** `crypto.timingSafeEqual` ✅ (but plaintext at rest is the primary risk)
- **Expiry:** 15 minutes ✅
- **Prior codes invalidated on resend:** `updateMany({ used: false }, { used: true })` ✅

---

## 5. Password System

| Check | Status |
|---|---|
| Algorithm | bcrypt ✅ |
| Salt rounds | 12 ✅ |
| Minimum length | 8 ✅ |
| Maximum length | 128 (bcrypt safe) ✅ |
| Common patterns blocked | ✅ |
| Sequential chars blocked | ✅ |
| Repeated chars blocked | ✅ |
| Complexity (3/4 classes) | ✅ |
| Password history (last 5) | ✅ |
| Pre-hashed storage | ✅ |
| Transmission only over HTTPS | ✅ (in production) |
| `console.log(password)` present | ❌ Yes — see Finding #6 |

---

## 6. Authentication Security Audit — Findings

---

### FINDING-A-01 — CRITICAL: Forgot-Password Token Leaked in API Response

**File:** `src/routes/auth.js`, line 455
**Function:** `router.post('/forgot-password', ...)`

```javascript
// CURRENT CODE — VULNERABLE
res.status(200).json({
  message: 'If that email exists, a reset code has been sent',
  token  // ← raw reset token returned to caller
});
```

**Why it is wrong:** The `token` value is the reset credential. Returning it in the response body means any attacker who can observe HTTP traffic (shared proxy logs, browser history, JavaScript XSS) obtains a direct password-reset capability without needing to access the email. The token is supposed to arrive only via the private email channel.

**Risk:** Account takeover without email access. **CRITICAL.**

**Fix:**
```javascript
// FIXED — remove `token` from response
res.status(200).json({
  message: 'If that email exists, a reset code has been sent'
});
// The reset flow must retrieve the token from the email only.
// To support token-based forms, store the token in a short-lived
// server-side session or send it embedded in the reset link/email.
```

---

### FINDING-A-02 — HIGH: No Brute-Force Protection on OTP Verification

**File:** `src/routes/auth.js`, lines 312–340
**Function:** `router.post('/verify-email', ...)`

**Why it is wrong:** A 6-digit OTP has 900,000 possible values. With no attempt counter or lockout, an attacker holding a valid `pendingToken` (which is returned in the register response) can brute-force the OTP at API rate.

**Fix:** Add an attempt counter to `PendingRegistration` and lock after N failures.

```javascript
// In prisma/schema.prisma — add to PendingRegistration model:
verificationAttempts  Int  @default(0)

// In verify-email route, before bcrypt.compare:
if (pending.verificationAttempts >= 5) {
  return res.status(429).json({ error: 'Too many attempts. Please request a new code.' });
}

// After a failed compare:
await prisma.pendingRegistration.update({
  where: { id: pendingId },
  data: { verificationAttempts: { increment: 1 } }
});

// On success, the row is marked verified (attempts no longer matter).
```

---

### FINDING-A-03 — HIGH: OTP Stored in Plaintext (Session Flow)

**File:** `src/routes/authSession.js`, lines 392–415
**File:** `prisma/schema.prisma` — `EmailVerificationCode.code`

**Why it is wrong:** `EmailVerificationCode.code` stores the raw 6-digit OTP. A database dump, SQL injection, or misconfigured backup exposes all valid OTPs, allowing immediate account takeover for unverified accounts.

**Fix:** Store a `SHA-256` hash (or bcrypt hash) of the code, compare server-side.

```javascript
// Store:
const codeHash = crypto.createHash('sha256').update(code).digest('hex');
await prisma.emailVerificationCode.create({
  data: { userId: user.id, email, code: codeHash, expiresAt }
});

// Verify:
const providedHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
const isValid = crypto.timingSafeEqual(
  Buffer.from(providedHash, 'hex'),
  Buffer.from(verificationCode.code, 'hex')
);
```

---

### FINDING-A-04 — HIGH: `console.log(password)` in Affiliate Service (Cross-System Contamination)

**File:** `src/services/affiliateAuthService.js`, lines 96–98

```javascript
console.log(`[affiliateAuthService] Hashing password for ${data.email}...`);
const passwordHash = await bcrypt.hash(data.password, 10);  // also: cost 10 not 12
console.log(`[affiliateAuthService] Password hashed for ${data.email}`);
```

**Why it is wrong:** While not directly in System A, the shared logger pipeline may expose password-adjacent log lines in log aggregators. The email address is also logged in correlation with the password operation timing, which is an information leak. More critically, this code also uses **bcrypt cost 10** instead of the system standard of 12.

**Fix:** Remove both `console.log` calls. They serve no production purpose. Change `bcrypt.hash(data.password, 10)` to `bcrypt.hash(data.password, 12)`.

---

### FINDING-A-05 — MEDIUM: Rate Limiting on Login Uses IP Only (Bypassable)

**File:** `src/routes/authSession.js`, lines 37–43

```javascript
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,  // 15 attempts per IP in 15 minutes
  ...
});
```

**Why it is wrong:** Rate limiting is applied per IP address. Distributed attacks from botnets bypass this entirely. Additionally, the DB-level lockout (10 failed attempts → 15-min lockout) resets the counter on lockout, meaning an attacker who knows the lockout threshold can stop at 9 attempts, wait, and continue indefinitely.

**Fix:**
1. Add per-email lockout tracking using the existing Redis `bumpLockoutAttempt` infrastructure (already present in `auth.js` but not wired to `authSession.js`).
2. Reduce the DB lockout threshold from 10 to 5 failed attempts.

---

### FINDING-A-06 — MEDIUM: CSRF Token Stored in `sessionStorage`

**File:** `Frontend/Affiliate/src/lib/api.ts`, line 20

```typescript
const csrfToken = sessionStorage.getItem('csrf_token') ?? '';
```

**Why it is wrong:** `sessionStorage` is accessible by any JavaScript on the page. An XSS vulnerability anywhere on the affiliate frontend defeats CSRF protection. The CSRF token should be stored in memory (JavaScript variable / React state), not `sessionStorage`.

**Fix:** Store the CSRF token in a React context/state variable (module-level or component state), populated after login. Never write it to `sessionStorage` or `localStorage`.

---

### FINDING-A-07 — MEDIUM: Broken `status` Comparison in `pendingAuth.js`

**File:** `src/middleware/pendingAuth.js`, line 29

```javascript
const status = err.name === 'TokenExpiredError' ? 401 : 401;
// Both branches return 401 — the ternary is dead code
```

**Why it is wrong:** The intent was likely to distinguish between expired and invalid tokens (e.g., 401 vs. 400), but both branches return 401. This is a dead-code bug that obscures error semantics.

**Fix:**
```javascript
const status = err.name === 'TokenExpiredError' ? 401 : 400;
```

---

### FINDING-A-08 — MEDIUM: CSRF Token TTL Mismatch vs. Session TTL

**File:** `src/middleware/sessionAuth.js`, lines 7, 33

```javascript
const CSRF_TOKEN_TTL_MS = 30 * 60 * 1000;   // 30 minutes
const SESSION_EXPIRY_DAYS = 7;               // 7 days (sliding window)
```

**Why it is wrong:** The CSRF token expires every 30 minutes but the session lasts 7 days (refreshed on each request). Clients that go quiet for >30 minutes then make a state-changing request will receive a `403 Invalid CSRF token` with no recovery path unless the frontend proactively calls `GET /api/session/csrf-token`. This is a reliability gap, not a security hole.

**Fix:** Either extend the CSRF TTL to match the session window, or implement automatic CSRF refresh on 403 in the API client.

---

### FINDING-A-09 — MEDIUM: No Rate Limiting on `POST /api/auth/resend-verification`

**File:** `src/routes/auth.js`, lines 273–309 — no rate limiter applied.

**Why it is wrong:** An attacker can trigger unlimited emails from Revluma's SendGrid account to any address, causing email abuse and potential SendGrid account suspension.

**Fix:** Add an `express-rate-limit` middleware (e.g., max 3 per 10 minutes per IP + per email).

---

### FINDING-A-10 — LOW: `trust proxy` Setting Is Global and Unscoped

**File:** `server.js`, line 19

```javascript
app.set('trust proxy', 1);
```

**Why it is wrong:** Trusting all proxy hops unconditionally means `req.ip` reflects the leftmost `X-Forwarded-For` header value, which a client can forge if the infrastructure doesn't strip it first. Rate limiters keyed on `req.ip` can be bypassed.

**Fix:** Set `trust proxy` to the actual number of known reverse-proxy hops (e.g., `1` is correct for Render; verify the deployment topology). Ensure your load balancer strips external `X-Forwarded-For` headers before they reach the app.

---

### FINDING-A-11 — LOW: `PASSWORD_RESET_CODE_HASH_COST = 12` on Hot Path

**File:** `src/routes/auth.js`, line 16

```javascript
const PASSWORD_RESET_CODE_HASH_COST = 12;
```

The forgot-password route hashes the OTP at cost 12. A 6-digit OTP does not need bcrypt protection — it is already a high-entropy random value. Using bcrypt here adds ~300ms of latency on every reset request for no security benefit. The OTP is also single-use and short-lived (1 hour).

**Fix:** Replace `bcrypt.hash(code, 12)` for the OTP with `crypto.createHash('sha256').update(code).digest('hex')`. Reserve bcrypt for passwords only.

---

### FINDING-A-12 — LOW: Deprecated `auth.js` Middleware File Not Removed

**File:** `src/middleware/auth.js`

The file is marked `DEPRECATED` but still exists and is still a valid import. Stale code left in place becomes a maintenance hazard and can be accidentally re-imported.

**Fix:** Delete the file after confirming no callers remain (run `grep -r "require.*middleware/auth" Backend/src`).

---

### FINDING-A-13 — LOW: Helmet CSP Disabled in Non-Production

**File:** `server.js`, lines 27–29

```javascript
app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false
}));
```

CSP is disabled in development. While acceptable for developer experience, this means developers never see CSP violations and may introduce inline scripts that will break in production. Consider enabling a report-only CSP in development.

---

## 7. Login System Audit

| Check | Status |
|---|---|
| Constant-time password comparison | ✅ (bcrypt.compare is constant-time) |
| Generic error messages (no enumeration) | ✅ "Invalid email or password" |
| Failed-attempt counter | ✅ `failedLoginAttempts` in DB |
| Lockout after 10 failures (15 min) | ✅ |
| Session rotation on login | ✅ `invalidateAllUserSessions` before `createSession` |
| HTTP-only session cookie | ✅ |
| `secure` cookie flag in production | ✅ |
| `sameSite` cookie flag | ✅ `none` (production), `lax` (dev) |
| CSRF token issued on login | ✅ |
| Email verification required before login | ✅ |
| Rate limiter on login endpoint | ✅ (15 req / 15 min per IP) |
| Per-account lockout | ✅ (DB-level) |
| Rate limit bypassable via distributed IPs | ❌ (Finding A-05) |
| Login attempts counter reset on lockout | ⚠️ counter resets to 0 on lockout — see A-05 |

---

## 8. Forgot Password Flow

| Check | Status |
|---|---|
| Token generation | `crypto.randomBytes(32).toString('hex')` ✅ |
| OTP generation | `crypto.randomInt(100000, 999999)` ✅ |
| OTP hashed at rest | `bcrypt.hash(code, 12)` ✅ |
| Expiry | 1 hour ✅ |
| Single-use enforcement | `usedAt` timestamp ✅ |
| Email enumeration prevention | Generic message ✅ |
| **Token leaked in API response** | ❌ **CRITICAL — Finding A-01** |
| No attempt counter on code entry | ❌ Finding A-02 applies here too |
| Old tokens not invalidated on new request | ⚠️ Multiple active reset tokens possible per user |

**Additional Fix Needed:** Invalidate all previous open reset tokens for a user when a new one is created.

```javascript
// Before creating new token:
await prisma.passwordResetToken.updateMany({
  where: { userId: user.id, usedAt: null },
  data: { usedAt: new Date() }
});
```

---

## 9. Email Infrastructure Audit

- **Provider:** SendGrid (primary), SMTP (fallback)
- **Templates:** HTML inline — XSS risk in `fullName` interpolation (see below)
- **Delivery failure handling:** `try/catch` with logger, non-blocking for welcome emails ✅
- **Missing:** No retry queue for failed verification emails (a transient SendGrid failure during registration fails the entire flow with a `502`)
- **Missing:** No monitoring/alerting on SendGrid quota exhaustion
- **No SPF/DKIM/DMARC configuration visible** in repository (should be in DNS, confirm separately)

### XSS in Email Template Interpolation

**File:** `src/services/emailService.js`, line 172 (and multiple other templates)

```javascript
<p>Hi ${fullName},</p>
```

`fullName` is user-controlled input. While email clients render HTML, a name like `<img src=x onerror=...>` won't execute JavaScript in most email clients. However, the vetting notification email at line 231–244 renders `affiliateProfile.fullName`, `phoneNumber`, `country` etc. directly into HTML for the **internal admin inbox**, where the risk is higher if the admin views emails in a web-based client that renders HTML without escaping.

**Fix:** Escape all user-provided values before interpolating into HTML email templates:

```javascript
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

---

## 10. Database Audit

| Model | Index Status |
|---|---|
| `User.email` | `@unique` ✅ |
| `User.tenantId` | `@@index` ✅ |
| `PendingRegistration.email` | `@unique` ✅ |
| `PendingRegistration.expiresAt` | `@@index` ✅ |
| `UserSession.tokenHash` | `@unique + @@index` ✅ |
| `PasswordResetToken.token` | `@unique + @@index` ✅ |
| `PasswordResetToken.userId` | `@@index` ✅ |
| `EmailVerificationCode.userId` | `@@index` ✅ |
| `EmailVerificationCode.expiresAt` | `@@index` ✅ |

**Missing:** A cron job or scheduled cleanup for expired `PendingRegistration` rows. The `cleanupUnverifiedUser` function only cleans up `User` rows (emailVerified=false), not stale `PendingRegistration` rows. Stale rows accumulate indefinitely.

**Missing:** `PasswordHistory` has no limit enforced at DB level — only the last 5 are checked in code. The table grows unboundedly; add a delete-oldest trigger or cron.

---

## 11. API Security Audit — Auth Endpoints

| Endpoint | Auth Required | CSRF | Rate Limited | Notes |
|---|---|---|---|---|
| `POST /api/auth/register` | No | No | Yes (50/15min global) | ✅ |
| `POST /api/auth/verify-email` | pendingToken JWT | No | No | ❌ No OTP brute-force protection |
| `POST /api/auth/complete-registration` | pendingToken JWT | No | No | ✅ |
| `POST /api/auth/forgot-password` | No | No | No route-level limiter | ❌ No per-email rate limit |
| `POST /api/auth/reset-password` | No (uses token) | No | No | ❌ No attempt counter |
| `POST /api/session/signup` | No | No | 20/hr | ✅ |
| `POST /api/session/login` | No | No | 15/15min | ✅ |
| `POST /api/session/logout` | No (clears cookie) | Yes | 40/15min | ✅ |
| `GET /api/session/me` | Session | No | No | ✅ |
| `POST /api/session/verify-email` | Session | Yes | No | ✅ |
| `GET /api/session/csrf-token` | No | No | No | ✅ |

---

## 12. Middleware Audit

### `sessionAuth.js — authenticate`
- Validates session cookie first, then falls back to JWT Bearer.
- Checks `emailVerified` on both paths. ✅
- Session validation includes expiry check and sliding-window renewal. ✅
- **Gap:** On JWT path, `req.user` is populated with a different shape (`tenant_id` vs. `tenantId`) than the session path. Downstream code that reads `req.user.tenantId` works on session auth but fails silently on JWT auth.

### `pendingAuth.js — authenticatePending`
- Validates JWT type claim (`type === 'pending_registration'`). ✅
- Dead-code ternary in error status (Finding A-07). ⚠️
- No expiry differentiation in error response. ⚠️

### `csrfProtection`
- Validates on all mutating methods. ✅
- HMAC-based with `timingSafeEqual`. ✅
- 30-minute TTL (mismatch with 7-day session — Finding A-08). ⚠️
- Anonymous CSRF tokens (`anon_...`) issued for pre-login forms. ✅

---

## 13. Frontend Authentication Audit

- Password strength meter present. ✅
- Confirm-password field present. ✅
- Show/hide password toggle. ✅
- `credentials: 'include'` on all fetch calls (required for cookie auth). ✅
- CSRF token stored in `sessionStorage` (Finding A-06). ❌
- Login form has no email enumeration protection client-side (shows exact backend error). ⚠️
- No protection against form replay after network error (retry sends duplicate registration). ⚠️

---

## 14. Production Readiness Assessment

| Dimension | Score | Blockers |
|---|---|---|
| Security | **61 / 100** | A-01 (token leak), A-02 (OTP brute-force), A-03 (plaintext OTP) |
| Reliability | **72 / 100** | Email-send failure aborts registration (no retry); CSRF TTL mismatch |
| Scalability | **65 / 100** | Rate limiting is IP-only (bypassable); no stale-row cleanup |
| **Production Ready** | **64 / 100** | Not safe until A-01 and A-02 are fixed |

---

## Master Remediation Roadmap — System A

### Phase 1 — Critical (Fix Before Any Users)
1. **A-01** Remove `token` from `forgot-password` response body.
2. **A-02** Add `verificationAttempts` counter + lockout to OTP verification.

### Phase 2 — Security Hardening
3. **A-03** Hash OTPs in `EmailVerificationCode` table.
4. **A-04** Remove `console.log(password-related)` lines; standardize bcrypt cost to 12 everywhere.
5. **A-06** Move CSRF token from `sessionStorage` to in-memory React state.
6. **Email** Escape HTML in all email templates.
7. **A-08** Invalidate all old reset tokens when a new one is issued.
8. **A-09** Add per-email + per-IP rate limiting to resend-verification.

### Phase 3 — Reliability Improvements
9. **A-05** Add per-email Redis-backed lockout to login route (complement DB lockout).
10. Add retry queue for transient SendGrid delivery failures.
11. Fix CSRF TTL to match session window.

### Phase 4 — Scalability & Maintenance
12. Add cron to delete expired `PendingRegistration` rows.
13. Cap `PasswordHistory` rows per user (delete oldest beyond 10).
14. **A-12** Delete deprecated `middleware/auth.js`.

### Phase 5 — Launch Checklist
- [ ] `JWT_SECRET` / `CSRF_SECRET` are strong random secrets (≥ 256 bits), rotated from defaults
- [ ] `SESSION_SECRET` is set and differs from JWT secret
- [ ] `NODE_ENV=production` is set in all production deployments
- [ ] `trust proxy` matches your actual proxy topology
- [ ] `SENDGRID_API_KEY` is set; delivery tested end-to-end
- [ ] SendGrid domain authentication (SPF, DKIM, DMARC) confirmed
- [ ] Database backups enabled and tested
- [ ] Cron/scheduler for PendingRegistration cleanup deployed
- [ ] All `console.log` password-adjacent calls removed
