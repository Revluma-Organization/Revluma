# Task 234 — Rev Intelligence architecture: implementation record

**Status:** implemented and locally verified; production incident attribution and authenticated production acceptance remain pending.

**Baseline:** `510517fb3a3af6021c16cfc2156bef0279985914`, active branch `arena/29f26490-revluma`.

## Confirmed gaps addressed

1. A clear general-definition request such as “What is Shopify?” had no deterministic knowledge route. Its `requires_store_data` decision depended on the intent model even though the understanding prompt and fallback specify definitions as general knowledge. Added a narrow definition fast path in `python/src/agents/investigation.py`; it applies only when no store intent/metric or explicit store reference is present. Store questions remain on the investigation path.
2. Concrete model IDs were represented as role-selection constants in `responder.py`, and `UNDERSTANDING_MODEL` asserted Sonnet while `understand()` actually called `role="fast"` through the central gateway. Replaced those misleading model strings with explicit `FAST_ROLE` / `DEEP_ROLE`; removed the stale model assertion. Anthropic concrete model IDs now have explicit optional environment overrides with the prior Haiku/Sonnet defaults. Gemini role and same-provider fallback behavior is unchanged; no cross-provider fallback is permitted.
3. Anthropic SDK failures were not normalized or given the same safe provider telemetry as Gemini. The gateway now maps common HTTP, authentication, network and timeout failures to the bounded existing failure categories; emits provider/model/role/status/category/elapsed-time events; and threads a validated correlation ID from investigation routing through understanding and knowledge composition. Existing Gemini provider events now include that correlation ID. Prompts, credentials and raw provider exception messages remain excluded from logs.

No migrations, provider credentials, tenant authorization, evidence schemas, Shopify permissions, write operations, customer data access, frontend contracts or external calls were added. Store tools remain allowlisted/read-only; the merchant-visible response does not reveal provider exception details.

## Files changed

- `python/src/agents/investigation.py` — deterministic definition route; safe correlation propagation into the router and route telemetry.
- `python/src/agents/understanding.py` — remove stale model-ID claim; add optional correlation propagation and safe classification telemetry.
- `python/src/agents/responder.py` — select fast/deep roles instead of vendor model-name constants; correlate deep knowledge composition and emit safe failure category metadata.
- `python/src/agents/model_gateway.py` — Anthropic model configuration, typed provider errors and safe correlated provider telemetry; Gemini correlation metadata.
- `python/tests/test_task234_rev_architecture.py` — general-definition routing/no-tool runtime tests and provider model/error/logging tests.
- `python/tests/test_rev_failure_routing.py` — assert the deep role rather than the old misleading model-name constant.
- Task 234 diagnosis, validation, audit-register and decision records.

The observed local implementation does **not** prove the historical production failure's cause. The code paths and evidence boundary are documented in `diagnostics/TASK-234-REV-INTELLIGENCE-ARCHITECTURE.md`.
