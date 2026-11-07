# TASK 211 — Evidence-backed recommendations and selected-finding continuity

**Consolidated Task:** 211 (original Tasks 241–245)  
**Implementation status:** locally implemented and regression-tested; deployment and authenticated active-store acceptance are separate gates.

## Contracts and authoritative evidence

`python/src/intelligence/recommendations.py` implements `rev-selected-finding-v1` and `rev-recommendation-v1`. A recommendation has a deterministic recommendation ID, finding ID/version, tenant/store scope, investigation ID, concrete step, rationale, validation method, evidence references, priority, dependencies, limitations, lifecycle and read-only action state. It never contains a Shopify mutation or an execution request.

Node accepts only a finding UUID from the browser. `findingChatContext.js` verifies that the finding and its store belong to the authenticated organization and forwards only `{finding_id, selection_source, selected_at}`. Client-provided titles, evidence, organization IDs and store IDs are not authoritative. Python then re-resolves that identifier through the existing tenant/store-scoped finding tool. Missing, malformed, foreign or cross-store references fail closed without falling back to a latest finding.

The existing `intelligence_findings` row and finding-evidence item remain authoritative. No parallel finding store or campaign/sequence execution record was introduced. Authorized stale, historical and uncertified rows remain available as qualified records; this does not promote their underlying business observations to current verified evidence.

## Recommendation quality and lifecycle

Canonical finding-specific templates cover revenue/order movement, returning customers, refunds, checkout abandonment, inventory and integration failures. Each step identifies the records or comparison to inspect and how to validate a later observation. Recommendations do not promise recovered revenue, causation, merchant action or completion.

Generation is bounded to three recommendations, deduplicated by normalized subject/step, and prioritized by current evidence eligibility, lifecycle, severity and explicit prerequisites rather than unsupported financial-impact scores. Missing, failed, disconnected, contradictory, unsupported and stale evidence produce qualified or prerequisite-only advice. Verified zero remains a value. Independent valid findings are not erased by an unrelated partial domain.

Finding-version changes create new recommendation identities. Prior versions are marked superseded in bounded history; stale or otherwise invalid current evidence invalidates current advice; recorded lifecycle resolution remains historical evidence and never proves that Rev executed anything. Resource references are capped at 20 and recommendation/investigation history at six entries.

## Context precedence and continuity

Selection precedence is:

1. explicit current finding/user selection;
2. the server-persisted selected finding for a continuing conversation;
3. ordinary relevant conversation context;
4. general context.

An explicit topic change clears selected-finding scope even if a client also supplies an old selection. Selected follow-ups use the finding investigation path and preserve the identifier. Natural follow-ups do not become prompts or bypass evidence retrieval.

Python-owned persistence writes bounded selection/recommendation state into `conversations.context_window`. Node-owned JSON and SSE persistence now performs the same update atomically with nested `jsonb_set`, scoped by both conversation and organization. Only the compact identifier/selection metadata and at most three compact recommendation lifecycle records are stored. Non-investigation responses without a selection result do not erase existing context; an explicit topic-change result clears it.

The Dashboard restores the selected reference from persisted response history, retains it on follow-ups, and displays stale/invalidated qualifications. An explicit topic change omits `findingId` entirely. Its `?finding=` query is removed only after that turn finishes, avoiding navigation that could abort the replacement stream. Terminal, superseded and invalidated recommendations are not presented as current actions.

## Independent Node boundary and read-only audit

`Backend/src/services/revRecommendations.js` independently checks contract versions, UUIDs, organization scope, evidence membership, duplicate IDs, specific rationale/validation fields, lifecycle and non-execution. `mlService.js` applies this validation to Python responses before controller persistence or streaming.

The Task 211 diff adds no Shopify/API mutation route, price/discount/inventory/order/refund/customer-message/configuration operation, or write-capable merchant endpoint. Conversation and internal message persistence are application-chat storage, not commerce execution. Display, acknowledgement and selection never set `executed`, an execution outcome, merchant confirmation or independent verification.

## Verification boundary

The 60 scenarios in `python/tests/test_task_211_recommendations.py` use isolated synthetic fixtures and explicitly do not represent live merchant evidence. They cover recommendation quality, partial evidence, lifecycle/history, prioritization/deduplication, dependencies, read-only behavior, real tenant-scoped retrieval, follow-ups, persisted two-turn supersession, topic changes and forged references. Node and Dashboard suites add independent boundary, persistence and UI continuity coverage.

Local success is not production acceptance. Deployment identity and authenticated behavior on `revluma-test-store-v1.myshopify.com` must be recorded separately; `/ready`, a visible recommendation card, or a merged pull request is not continuity or evidence-justification proof.
