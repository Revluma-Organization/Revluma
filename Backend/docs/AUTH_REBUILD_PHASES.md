Phase 1 — Architecture Discovery & Security Audit

Goal: Understand the current authentication system before changing anything.

Scope
Scan the entire backend.
Discover all authentication flows.
Map every route.
Map every middleware.
Find every JWT generation.
Find every JWT verification.
Find every protected route.
Find every public route.
Find every auth helper.
Find every organization ownership check.
Find every Prisma query touching users.
Find every cache touching auth.
Find every AI endpoint requiring authentication.
Find every background worker.
Find every streaming endpoint.
Deliverables
Authentication architecture diagram.
Route map.
JWT lifecycle diagram.
Session lifecycle.
Threat model.
Vulnerability report.
Technical debt report.
Production readiness report.

Do NOT modify code in this phase.

Phase 2 — Database & Identity Architecture

Goal: Build a proper identity foundation.

Redesign database.

Introduce models for:

Users
Organizations
Organization Members
Roles
Permissions
Permission Groups
Sessions
Refresh Tokens
API Keys
Devices
Login Attempts
Audit Logs
MFA
Recovery Codes
Invitations
OAuth Accounts
Service Accounts
Deliverables
Updated Prisma schema
Migrations
Indexes
Constraints
Foreign Keys

Nothing else.

Phase 3 — JWT & Session System

Replace the prototype JWT architecture.

Implement:

Access Tokens
Refresh Tokens
Session IDs
JWT IDs
Token rotation
Refresh reuse detection
Session expiration
Idle timeout
Absolute timeout
Device tracking
Device revocation
Logout
Logout All Devices

JWTs must include:

iss
aud
sub
sid
jti
exp
nbf
iat
organizationId
tokenType

Verify everything.

Phase 4 — Authentication Flow

Rebuild every authentication flow.

Includes:

Signup
Login
Logout
Email Verification
Forgot Password
Reset Password
Change Password
Resend Verification
Account Lockout
Suspended Users
Deleted Users
Disabled Users

Test every edge case.

Phase 5 — Authorization (RBAC + ABAC)

This is the biggest phase.

Implement:

Organization

↓

Membership

↓

Roles

↓

Permissions

↓

Policies

Support:

Owner

Admin

Manager

Developer

Support

Billing

Read Only

Custom Roles

Attribute checks:

Organization

Subscription

Ownership

Plan

Feature Flags

Everything must be middleware-driven.

Phase 6 — Multi-Tenant Isolation

Every database query.

Every endpoint.

Every AI request.

Every export.

Every upload.

Every analytics query.

Every embedding search.

Every prompt.

Every vector search.

Everything must be tenant isolated.

Never trust client organization IDs.

Organization context must come from authentication.

Phase 7 — Enterprise Security

Implement:

MFA

Step-up Authentication

TOTP

Recovery Codes

Password History

Breached Password Detection

Risk Detection

Impossible Travel

Device Fingerprinting

Adaptive Login

Suspicious Activity Detection

CAPTCHA

Progressive Delays

Bot Detection

Credential Stuffing Protection

Rate Limiting

Replay Protection

CSRF

CORS

Security Headers

XSS Protection

Phase 8 — Machine-to-Machine Authentication

Create a production API Key system.

Features:

Hashed Keys

Scopes

Expiration

Rotation

Revocation

Service Accounts

Internal Workers

Python Workers

Webhook Verification

Signed Requests

Constant Time Comparison

Audit Logs

Phase 9 — AI & Internal Services

Secure:

Node.js

↓

Python

↓

Workers

↓

Queues

↓

Streaming

↓

Embeddings

↓

LLMs

↓

Vector Search

Requirements:

No tenant leakage.

No prompt leakage.

No stream survives logout.

Workers authenticate each request.

Queues verify identity.

Phase 10 — Observability & Monitoring

Add enterprise logging.

Track:

Login

Logout

Failures

Password Changes

Permission Changes

Role Changes

MFA

API Keys

Sessions

Organizations

Billing Changes

Danger Zone

Everything should include:

Timestamp

Actor

Organization

IP

Device

Correlation ID

Request ID

Security Score

Risk Score

Phase 11 — Testing & Chaos Engineering

Automatically generate tests.

Unit Tests

Integration Tests

Authentication Tests

Authorization Tests

JWT Tests

Session Tests

Replay Tests

Refresh Tests

Tenant Isolation Tests

AI Isolation Tests

Worker Tests

Load Tests

Stress Tests

Chaos Tests

Race Conditions

Memory Leaks

Connection Leaks

Redis Failure

Supavisor Failure

Database Failover

Worker Crash

Cache Poisoning

Everything must pass.

Phase 12 — Final Enterprise Audit

Run another complete audit.

Verify:

Everything fixed.

Nothing regressed.

No security issues introduced.

Output:

Executive Summary
Security Score (/100)
Authentication Score
Authorization Score
JWT Score
Session Score
Tenant Isolation Score
AI Security Score
API Security Score
Infrastructure Score
Compliance Score
Production Readiness
Enterprise Readiness
SOC 2 Readiness
Remaining Risks
Technical Debt
Future Improvements
Execution Rules (Apply to Every Phase)

Every phase should follow the same workflow:

Analyze the existing implementation relevant to that phase.
Identify architectural flaws, security gaps, and code smells.
Produce a plan before changing code.
Implement improvements using enterprise best practices.
Refactor existing code instead of layering hacks on top.
Generate database migrations where required.
Write comprehensive tests for all new functionality.
Verify that no existing features are broken.
Document every change, why it was made, and any migration steps.
Provide a completion report with fixed issues, remaining risks, and a checklist before proceeding to the next phase.