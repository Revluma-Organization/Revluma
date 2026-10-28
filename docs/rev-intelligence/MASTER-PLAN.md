# Rev Intelligence — Master Engineering Plan

Status: ACTIVE — Phase 01. Owner: Revluma engineering.
Principle: No phase passes solely because code was committed or deployed. Every gate needs recorded evidence.

## Operating contract
- Work sequentially: implement, test, inspect failures, fix, rerun, verify production, record evidence, then advance.
- Proceed with ordinary authorized repository changes, CI, and non-destructive deployments without repeated approvals.
- Require separate approval for irreversible data operations, production customer communications, payments, privilege expansion, and other consequential external actions.
- Never expose provider keys or merchant data in logs, prompts to web search, or tests.
- Do not fabricate merchant facts, action outcomes, research citations, or test results.
- Record every phase in docs/rev-intelligence/PHASE-STATUS.md with commit, tests, deploy, blockers and evidence.

## Phase 01 — Foundation and provider reliability
Scope: inventory architecture, validate syntax and full Python suite, repair failing tests, enable observable CI, verify provider selection/model compatibility/quota/network failures, implement bounded retries/timeouts, confirm deployed revision, test real authorized request.
Gate: Python tests pass; build passes; Gemini generation succeeds against live configuration or an explicitly approved working provider; errors are safely observable; no secret leakage; production smoke checks pass.

## Phase 02 — Natural conversation
Scope: conversation persistence, contextual follow-ups, intent handling, tone and identity, deterministic provider-failure responses, response streaming if supported, conversation evaluation set.
Gate: 20+ scripted multi-turn cases, >=95% context continuity, no canned reply masquerading as generated output, failure paths tested.

## Phase 03 — Verified merchant intelligence
Scope: organization-scoped tools for connection/sync, orders, checkout, customers, revenue and campaigns; data freshness, evidence identifiers, permissions, missing-data semantics.
Gate: zero cross-tenant access in security tests; zero invented metrics in acceptance tests; real store-status and empty-store scenarios pass.

## Phase 04 — Grounded public research
Scope: safe query isolation from private merchant context; web search tool; attribution and source validation; prompt-injection defenses; honest failure mode.
Gate: citations resolve to actual retrieved sources; private merchant data excluded from search queries; unsupported search is reported honestly.

## Phase 05 — Memory
Scope: per-merchant durable memories, explicit preference capture, relevance, expiration, deletion, correction, auditability.
Gate: multi-session continuity, tenant isolation, user correction/deletion, stale memory tests pass.

## Phase 06 — Business diagnosis
Scope: evidence-bound analytics, causal hypothesis vs proven fact distinction, scenario comparison, uncertainty, specialist routing, actionable recommendations.
Gate: benchmark merchant scenarios with evidence-based findings; numeric claims validated; missing-data and contradiction cases pass.

## Phase 07 — Proactive insights and actions
Scope: scheduled checks, deduplication, opportunity detection, previews, merchant approval, idempotent execution, audit log, retries and rollback where supported.
Gate: 100% approval enforcement for consequential actions; duplicate-action prevention; failure and recovery tests; no unapproved live messages or charges.

## Phase 08 — Product UX and production certification
Scope: adaptive chat/analysis/research presentation, markdown and citations, accessibility, mobile responsiveness, performance, security, load tests, monitoring, operational runbooks.
Gate: end-to-end tests, accessibility and security checks, monitored deployment, documented rollback, defined latency/error targets met or explicitly revised with evidence.

## Release policy
Phase state: NOT_STARTED -> IN_PROGRESS -> BLOCKED or VERIFIED. Only VERIFIED allows next phase. A deployment status of live does not imply verified functionality. Capture exact commands, test outputs, deployment IDs, and observed errors in the status log.
