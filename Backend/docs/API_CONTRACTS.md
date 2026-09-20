# Authentication API Contract

Base path: `/api/v1/auth`.

All JSON responses use `{ success, data?, error?, code? }`. The frontend must send
`credentials: 'include'` on every request so the HttpOnly refresh cookie is stored
and sent. Access tokens are returned in `data.access_token` and must be sent as
`Authorization: Bearer <access_token>`.

## Google signup and login

`POST /google`

Request:

```json
{
    "credential": "<Google Identity Services ID token>",
    "terms_agreed": true,
    "organization": {
        "brand_name": "Acme",
        "storeUrl": "https://acme.example",
        "storeCategory": "Apparel",
        "country": "NG",
        "state": "Lagos"
    },
    "preferences": { "monthlyRevenue": "0-10k" }
}
```

`credential` is always required. `terms_agreed: true` is required only when
creating a new Google account. `organization` is optional; omitted fields use
the Google name and `Unspecified` defaults so the user can finish onboarding.

Success (`200`): creates a session and returns the same shape as password login:

```json
{
    "success": true,
    "data": {
        "access_token": "<JWT>",
        "user": {
            "id": "<uuid>",
            "full_name": "Ada Lovelace",
            "email": "ada@example.com",
            "onboarding_completed": false
        }
    }
}
```

The server also sets `refresh_token` as an HttpOnly, Secure, `SameSite=None`
cookie in HTTPS environments. In local HTTP development it uses `Secure=false`
and `SameSite=Lax`. The raw refresh token is never returned in JSON.

Existing password account (`409`):

```json
{
    "success": false,
    "code": "GOOGLE_ACCOUNT_LINK_REQUIRED",
    "error": "An account already exists for this email. Log in with your password, then link Google from your account settings."
}
```

Other Google errors: `400` for a missing credential, `401` for an invalid or
unverified credential, `403` for a suspended/deleted account, and `503` when
`GOOGLE_CLIENT_ID` is not configured.

## Link a Google account

`POST /google/link` requires a valid access-token header and the same email as
the authenticated Revluma account:

```json
{ "credential": "<Google Identity Services ID token>" }
```

Success (`200`): `{ "success": true, "data": { "google_linked": true } }`.
The endpoint returns `409` with `GOOGLE_EMAIL_MISMATCH` when the emails differ,
or `GOOGLE_ACCOUNT_CONFLICT` when the Google identity is already linked.

## Refresh, logout, and required environment

`POST /refresh` rotates the HttpOnly refresh cookie and returns
`{ "success": true, "data": { "access_token": "<JWT>" } }`. The frontend must
call it with credentials included and retry the original request once after a
`401` access-token response. Refresh-token reuse invalidates the token family.

`POST /logout` revokes the current refresh token and clears the cookie.
`POST /logout-all` requires an access token and revokes every session.

Required auth-related environment variables are `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN`,
`FRONTEND_URL`, `NODE_ENV`, and `GOOGLE_CLIENT_ID`, in addition to the database
variables listed in the backend setup documentation. Configure the Google
OAuth client with the frontend origin and use its client ID as
`GOOGLE_CLIENT_ID`.
# Revluma Backend
## [2026-06-17] 
Revluma Backend Architecture & Engineering Documentation
This document serves as the official technical overview and setup documentation for the Revluma backend infrastructure. It details the system architecture, configuration hurdles encountered, version control setup, and the engineering design implemented to bridge enterprise Prisma constraints with cloud connection layers.

1. Core Stack Architecture
The backend infrastructure is engineered on a decoupled, modern Node.js stack optimized for reliability, rapid development cycles, and serverless edge compatibility.
Runtime Environment: Node.js (v24.13.0)
Web Framework: Express.js (Running on Port 8080)
Process Manager: Nodemon (Configured for automated runtime hot-reloading)
Object-Relational Mapper (ORM): Prisma Client (v7.8.0)
Database Infrastructure: PostgreSQL hosted via Supabase Cloud Engine
Connection Utility Layer: Native pg (node-postgres) connection pooling with explicit TLS/SSL handshakes
Core Server & Runtime Environment
Infrastructure: Established a scalable Node.js runtime environment leveraging Express.js to manage robust, asynchronous RESTful API routing architectures.
Development Workflow: Configured Nodemon hot-reloading for automated runtime compilation, accelerating local development cycles and debugging capabilities.
Security & Configuration: Separated secrets from source code by enforcing environment-variable injection using a strict .env schema architecture.

2. Infrastructure Configuration & Engineering Breakthroughs
During the baseline configuration of our data-access layer, a major architectural challenge arose involving Prisma v7's engine runtime specifications and cloud-pooled connection strings. The timeline below explains how these hurdles were engineered into a robust, cloud-ready database adapter system.
The Conflict: Edge Engine Constraints
The root workspace configuration file (prisma.config.ts) explicitly locks Prisma's client generator to an edge-optimized context:
When Prisma is targeted to run as a pure client engine, it forbids direct, out-of-the-box local connection hooks to database systems unless provided an enterprise Accelerate URL or a localized low-level driver adapter layer.
engineType: 'client'

The Solution: Driver Adapter Layer Abstraction
To circumvent this constraint without changing global project targets or utilizing costly external proxies, we refactored our system to decouple connection handshakes away from Prisma’s native binary core. We injected the @prisma/adapter-pg package alongside an explicit, fine-tuned pg.Pool structure.

+-----------------------------------+
|        Express API Routes         |
+-----------------------------------+
                  |
                  v
+-----------------------------------+
|      Prisma Client Instance       |
+-----------------------------------+
                  |
                  v
+-----------------------------------+
|    @prisma/adapter-pg Wrapper     |
+-----------------------------------+
                  |
                  v
+-----------------------------------+
|       pg.Pool (Native Driver)     |
+-----------------------------------+
                  | (Port  / SSL)
                  v
+-----------------------------------+
|      Supabase Cloud Postgres      |
+-----------------------------------+
Resolving Connection String & SASL Validation Bugs
Connecting directly using a Supabase pooled connection URL strings (via port 6543) caused string validation errors within Node’s memory layer (SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string).
To completely resolve this string-parsing bottleneck, the engine database module was rewritten to bypass basic connection-string URLs entirely. Instead, parameters are destructured and parsed into explicit properties with enforced string casts and required secure transport layers (ssl).

3 Database Layer & Data Modeling
Database Engine: Provisioned a relational PostgreSQL database instance to support strongly typed data models and complex relations.
Modern ORM Implementation: Integrated Prisma v7 as the data-access layer. Designed a modular schema.prisma architecture configuration to map, validate, and synchronize database entities smoothly.

3. Advanced Engine Customization & Driver Adaption
Edge Runtime Optimization: Addressed strict enterprise constraints imposed by a workspace prisma.config.ts configuration requiring an edge-compatible engine type (engineType: "client").
Connection Layer Abstraction: Engineered an explicit bridge utilizing the @prisma/adapter-pg and native pg connection pooling (Pool). This layout satisfies cutting-edge decoupled serverless execution targets while securely maintaining standard state connections locally.
4. Source Control & Repository Security Policies
The backend project has been initialized under strict local and remote Git version control tracking.
Security Guardrails (.gitignore)
To prevent the leakage of secure credentials, proprietary environment schemas, or bulky localized caching layers, a strict .gitignore pipeline is applied at the root directory level:
Plaintext
node_modules/
.env
.prisma/
dist/
*.log
Repository Baseline Execution Sequence
The following systemic sequence is invoked to establish baseline version control tracing cleanly:
git init — Instantiates a fresh tracking tree.
git add . — Stages project code files while filtering dependencies and secrets through .gitignore.
git commit -m "feat: initial backend setup with prisma and pg driver adapter" — Registers initial structural footprint safely.
git branch -M main — Migrates tracking context to standard main nomenclature.
Git Lifecycle Initialization: Configured structural version control tracking from scratch.
Security Guardrails: Enforced clean repository tracking by building a rigorous .gitignore pipeline, ensuring proprietary connection strings, local system architecture binaries, and dependency footprints (node_modules) are strictly isolated from remote tracking.

Auth Initialization
- Decoupled `app.js` (Express configuration) from `server.js` (Network listening).
- Formulated the directory schema for scalable MVC pattern (`src/controllers`, `src/routes`, `src/middlewares`).
- Initiated Enterprise Auth Strategy: Planned for request payload validation, cryptographic password hashing, and HttpOnly cookie management.
