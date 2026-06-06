# Affiliate Account Creation — 500 Error Audit Report

Date: 2026-06-06  
Endpoint: POST /api/affiliate-auth/register  
Client symptom: "Registration failed. Please try again." (HTTP 500)  
Console evidence: Three consecutive 500 responses on submission

---

## 1. Request Flow

Client (AuthInterface.tsx:handleSignUpCompletion)
  -> POST /api/affiliate-auth/register
  -> affiliateAuth.js:registerLimiter (5 req / hour)
  -> route body validation
  -> affiliateAuthService.registerAffiliate()
  -> prisma.pendingRegistration.upsert()
  -> emailService.sendVerificationEmail() [background]
  -> 201 { message, pendingRegistrationId, email, authState: PENDING_EMAIL_VERIFICATION }

---

## 2. What the Code Does Right (baseline is sound)

| Area | Detail |
|------|--------|
| Rate limiting | 5 registrations/hour per IP |
| Input validation | Required fields, email format, password strength, reserved username blocklist, minimum 2 distribution channels |
| Password hashing | bcrypt cost 12 |
| OTP hashing | bcrypt cost 10 (not plaintext / SHA-256) |
| Upsert key | `where: { email_accountType: { email, accountType: 'AFFILIATE' } }` — matches unique index |
| Auth state | PENDING_EMAIL_VERIFICATION → PENDING_REVIEW after verification |
| Response | Returns 201 with pendingRegistrationId so the frontend can advance to email verification |

---

## 3. Root-Cause Candidates (ordered by likelihood)

### 3.1 Database schema drift (HIGH)
The route/alias-specific comment in affiliateAuth.js:302-313 says:

> "Prisma compound unique key error — affiliateAuthService.registerAffiliate() must use
> `where: { email_accountType: { email, accountType: 'AFFILIATE' } }` in its upsert call,
> NOT `where: { email }` alone."

The service does use the correct compound key (affiliateAuthService.js:162-163), so if the DB is throwing a Prisma P2025 / P2018 error it is almost certainly because:

- The `pending_registrations` table does **not** have the `email_accountType` unique index in the target database, OR
- The Prisma client is out of sync with the schema (stale generated client).

**Evidence the index is in schema**: schema.prisma:467
```
@@unique([email, accountType], name: "email_accountType")
```
**What to check in the DB**:
```
SELECT indexname FROM pg_indexes WHERE tablename = 'pending_registrations';
```
If the index is missing, the upsert will throw and the route falls through to the generic 500 handler (affiliateAuth.js:315).

### 3.2 Upsert `create` branch is correct (NOT a factor)
Re-checking: `affiliateAuthService.js:179-192` already includes `accountType: 'AFFILIATE'` in the create block. This is **not** a contributing factor and was incorrectly flagged in an earlier draft of this report. The schema default is `USER`, but the explicit value overrides it here.

### 3.3 Server-side error swallowing / wrong message (LOW-MEDIUM)
The error handler at affiliateAuth.js:275-315 intentionally swallows most error details and maps specific strings to specific HTTP codes, but the final catch-all returns a generic 500. With the current log statements you should see the real `err.message` in your backend logs (`affiliate-auth/register FAILED`). If the logs are not being shipped (e.g. on Render free tier / log drain misconfigured), you will only see the generic client error.

### 3.4 `email_accountType` upsert Prisma version mismatch (LOW)
If the Prisma client was generated against a schema that did **not** have the compound unique constraint, the generated `upsert` query will produce an invalid WHERE clause and throw a runtime P2018 / `needs at least one of` error, which the route explicitly detects (affiliateAuth.js:305-313) and converts to 500.

### 3.5 CORS preflight / CSRF interference (LOW)
The `/register` route does not use `csrfProtection` middleware. The CSRF protection is only on `/complete-registration`. A CORS preflight failure would surface as a CORS error in the browser console, not a 500 with "Registration failed. Please try again.", so this is unlikely — but if `req.body` is being rejected at the body-parser level (e.g. malformed JSON), Express would return 400, not 500.

---

## 4. Why It Matters For The User

The user sees three 500s in a row. Each retry is rate-limited at 5/hour, so after ~3 attempts they are locked out for the remainder of the hour. The frontend shows a generic error and never advances to the email verification screen.

---

## 5. Remediation Steps

### Immediate (5 minutes)
1. Verify the unique index exists in the live database:
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename = 'pending_registrations';
   ```
   You should see `email_accountType` listed. If missing, apply the migration from `Backend/Auth-remediation-migration-.sql` or run:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS "email_accountType" ON public.pending_registrations ("email", "accountType");
   ```
2. Re-generate and push the Prisma client:
   ```bash
   npx prisma generate
   npx prisma migrate deploy   # on Render / production
   ```
3. Redeploy backend, then retest.

### Verification
1. Call `/api/affiliate-auth/health` until it returns 200.
2. Submit a fresh registration.
3. Confirm response is `201` with `authState: PENDING_EMAIL_VERIFICATION`.
4. Confirm the frontend advances to the `verifyEmail` mode and shows the OTP screen.

### After the Fix
- The post-submission flow is already correctly wired: route returns 201 → frontend sets `pendingRegistrationId` + `pendingEmail` → `goToMode('verifyEmail')` → user sees OTP input → after code entry `handleVerifyEmail` calls `/api/affiliate-auth/verify-email` then `/api/affiliate-auth/complete-registration` → final dashboard.

### Monitoring
- Add structured logging of `err.code` (Prisma code) and `err.message` in the catch block to the Render log drain so future DB constraint failures are visible without a support ticket.

---

## 6. Post-Submission Flow Assessment

The intended flow is:

```
handleSignUpCompletion
  -> POST /api/affiliate-auth/register
  -> 201 { pendingRegistrationId, authState: PENDING_EMAIL_VERIFICATION }
  -> setPendingRegistrationId / setPendingEmail
  -> goToMode('verifyEmail')
  -> user enters code
  -> POST /api/affiliate-auth/verify-email
  -> POST /api/affiliate-auth/complete-registration
  -> dashboard / onAuthSuccess
```

This flow is correctly implemented in the current code. The only reason the user never reaches the email verification step is that the `/register` endpoint returns 500 before the `goToMode('verifyEmail')` call can execute.

**Conclusion**: the email-verification step itself is fine; the blocker is upstream in the registration write path.
