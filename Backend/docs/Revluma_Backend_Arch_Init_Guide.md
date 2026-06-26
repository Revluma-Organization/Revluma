## Revluma Backend Architecture & Initialization Guide

This document details the foundational setup, directory structure, core dependencies, and initial lifecycle verification for the Revluma backend engine. This system is designed as a modular, scalable decoupled backend optimized for secure, performance-critical operations.

## 1. Directory Structure
The backend workspace is structured to strictly isolate concerns, enforce architectural normalization, and support advanced automated pipelines (queues, cron scheduling, and analytics integration).

Backend/
├── docs/                      # API Contracts, OpenAPI/Swagger specifications
├── prisma/                    # Schema models and migration history
└── src/
    ├── configs/               # Environment variables, database singletons, and security policies
    ├── controllers/           # HTTP Request handlers and orchestration layer
    ├── cron/                  # Automated scheduled background jobs
    ├── integration/           # Third-party API integrations and webhooks
    ├── intelligence/          # Data analytics and intelligence engines
    ├── middlewares/           # Request interceptors (auth, rate-limiting, error handling)
    ├── pipeline/              # Sequential stream processing and transformers
    ├── queue/                 # Message queuing and asynchronous workers
    ├── routes/                # API router entry points mapped to controllers
    ├── services/              # Core business logic layer (isolated from HTTP layer)
    ├── utils/                 # Global helper functions and shared constants
    ├── app.js                 # Express Application instantiation & middleware pipeline
└── server.js                  # HTTP Server lifecycle manager.


## 2.Core Dependency Matrix
The application leverages industry-standard production packages categorized by domain responsibility:
Web Framework & System Layer

## express:
  Lightweight HTTP framework for routing and middleware configuration.

## dotenv: 
  Injector for context-specific system environment variables.

## Security Architecture
cors: Enforces specific cross-origin origin configurations.
helmet: Secures HTTP response headers against standard security vectors (XSS, clickjacking).
express-rate-limit: Protects public APIs against Brute Force and Denial-of-Service (DoS) vectors.

## Identity & Access Management
bcrypt: High-entropy cryptographic hashing engine for passwords.
jsonwebtoken: Stateless token system for authentication.
express-validator: Declarative request parameter sanitization and schema checking.

## Persistence & Data ORM
pg: Direct PostgreSQL client driver pool manager.
@prisma/client: Type-safe automated database query building.
prisma (Dev): Structural database migration schema control engine.

## Utilities & Telemetry
winston: Universal asynchronous logging system with decoupled transport layers.
node-cron: Tiny task scheduler for automated background maintenance jobs.

## 3.Execution Lifecycle Flow
The backend startup sequence guarantees data integrity by executing explicit structural checks before starting the networking listener interface.

[ .env Configuration ] 
         │
         ▼
[ src/configs/env.js ] ──► (Validates keys; throws error if absent)
         │
         ▼
[ src/configs/database.js ] ──► (Verifies database pool connection via query)
         │
         ▼
[ src/app.js ] ──► (Mounts security core, standard parsers, & /health)
         │
         ▼
[ src/server.js ] ──► (Binds port listener to environment variable)

## 4.Initial System Verification
Server Startup
To boot up the application ecosystem locally with telemetry streaming enabled:
cd Backend
npm run dev
## 5.Core Health-Check Validation
The application provides a zero-dependency endpoint to check if the network stack and runtime loop are operational.

## Endpoint: GET /health
Expected Status: 200 OK
Payload Specification:  {
  "status": "ok",
  "timestamp": "2026-06-20T21:20:49.000Z"
}

## 6.Production Readiness Status
·  Architecture Verification: Decoupled layout confirmed.
·   Environment Gatekeeper: Functional. Server terminates safely if configuration values are missing.
·  Database Integration: Confirmed. Pooling and driver adapter interface verified against Supabase.
·  Health Diagnostics: Passed.
