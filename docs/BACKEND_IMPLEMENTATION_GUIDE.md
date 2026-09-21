# Backend Integration Guide

## Boundary

This is the work order for the Backend team. No file under `Backend/` was
changed by the Python implementation.

- Backend owns Prisma, migrations, Node gateway code, schedules, and live data.
- Python owns feature computation, model/fallback decisions, Business State,
  agent reasoning, and briefing content.
- Use additive migrations. Do not rename current tables, columns, or APIs.
- Test on a disposable PostgreSQL database before any production migration.
- Keep MLflow/DagsHub credentials in Python only.

## Current audited state

The Prisma schema validates and the focused Backend contract tests pass when
their required test-only environment values are supplied. Raw commerce and
message webhook routes are mounted before JSON parsing, commerce signatures are
checked, webhook deliveries are deduplicated, the pixel endpoint uses a signed
store key, and the scheduler calls Business State, outcome, briefing, and store
sync jobs. These are foundations, not an end-to-end beta action flow.

The following gaps were verified in the current Backend code and must be fixed
before a connected test store can exercise every model and execute recovery
actions:

| Priority | Exact location | Verified gap and required result |
|---:|---|---|
| 1 | `Backend/src/controller/eventController.js` and a Backend feature worker | Single-event insertion and `feature_jobs` insertion are not atomic, batch ingestion creates no feature jobs, and no worker consumes `feature_jobs`. Commit each event with its idempotent job, claim jobs atomically, load the complete store-scoped session, call `POST /internal/features/compute`, persist the returned canonical snapshot, and continue the prediction chain. |
| 2 | `Backend/src/controller/eventController.js` | `ALLOWED_EVENT_TYPES` does not match `docs/PIXEL_EVENT_SPEC.md`. Replace it with all 16 specified names, including `SCROLL`, `PURCHASE_COMPLETED`, `CUSTOMER_CREATED`, `TEXT_COPIED`, `COUPON_REJECTED`, `TAB_SWITCH`, `EXIT_INTENT`, `FAILED_PAYMENT`, `FIELD_FOCUS`, and `FIELD_BLUR`; remove undocumented substitutes such as `PAYMENT_ATTEMPT`, `PURCHASE`, `COUPON_ATTEMPT`, `SEARCH`, and `SESSION_START` unless they are added as explicit compatibility aliases and normalized before storage. |
| 3 | `Backend/src/services/mlService.js` | Add wrappers for `/internal/features/compute`, `/predict/abandonment-probability`, `/predict/shopper-sensitivity`, and `/predict/offer-value`. Update `predictSendTime` to forward `X-Customer-ID` and `X-Merchant-ID`. Keep every Python call in this gateway. |
| 4 | Python deployment settings, `Backend/src/services/mlService.js`, and Backend health controller | Set `MODEL_RELEASE_CHANNEL=beta` only on the controlled beta Python deployment and restart it; absence or invalid configuration intentionally permits production aliases only. `checkPythonHealth` currently treats any HTTP 200 as ready. Require `status=ok`, `models_ready=true`, no `models_missing`, and an allowed `model_status` (`beta_ready` for the beta deployment or `ready` for production). Surface loaded model channels without exposing credentials. |
| 5 | `Backend/src/services/shopifySync.js` | `syncAbandonedCheckouts()` is a stub that always returns zero. Implement paginated GraphQL `abandonedCheckouts`, store carts and line items idempotently, reconcile recovered carts when orders arrive, and use a currently supported Shopify API version. |
| 6 | Shopify installation/configuration and `Backend/src/services/commerceWebhookService.js` | No code registers the webhook subscriptions and `webhook_registrations` is unused. Register the required app-specific subscriptions, or create shop-specific subscriptions after OAuth with GraphQL, persist their IDs, and reconcile them after reinstall or API-version changes. Handle order cancellation/deletion separately instead of treating every order topic as an upsert. |
| 7 | `Backend/src/services/commerceWebhookService.js` | Order updates increment `customers.orders_count` and `ltv` every time a distinct update delivery arrives. Recalculate aggregates from authoritative non-cancelled orders, or apply delta-safe updates in the same transaction. Enqueue RFM, feature, and outcome work after a committed order/customer/cart webhook. |
| 8 | `Backend/src/services/messageWebhookService.js` and `messageWebhookController.js` | SendGrid Event Webhooks use an ECDSA public key, signature header, timestamp header, raw bytes, and a JSON event array; the current generic HMAC/object handler does not implement that contract. Add provider-specific verification and mapping, delivery-level idempotency, bounce/failure handling, consent updates for unsubscribe events, and recommendation/order attribution. |
| 9 | `Backend/src/services/schedulerService.js` | No daily churn scoring job or feature-job worker exists. Alert rows can be marked `delivered` without creating a notification or sending anything, and queue rows are selected without an atomic claim. Add bounded workers with database-safe claims, retries, idempotency, actual delivery, and terminal evidence. |
| 10 | New Backend recovery/action service plus existing sequence tables | No service creates provider discounts, queues recovery messages, or writes `sequence_sends`; the current email utility handles account email only. Implement the controlled beta action flow described below and record every decision, provider ID, send, result, and failure. |
| 11 | `Backend/package.json` and Backend tests | `npm test` runs only the logout test. Make it execute every Backend test and add behavioral tests for webhook signatures, arrays, retries, queue claims, all five prediction wrappers, model readiness, consent, discount caps, provider failures, and tenant isolation. Align `@prisma/adapter-pg` with the Prisma 6.19.3 client/CLI or remove it if unused. |
| 12 | `Backend/server.js` | `connectDB()` is asynchronous, but startup does not await it before starting immediate scheduler jobs or accepting traffic. Use one async startup sequence: await the required database connection, initialize optional Redis with its documented fallback, start the HTTP listener, then start workers. On shutdown, stop workers, close the server, disconnect Prisma and Redis, and retain a bounded forced-exit timeout. |
| 13 | Backend dependency maintenance | The current lockfile audit reports seven known dependency findings (five high, one moderate, and one low). Review each dependency path, apply compatible targeted upgrades, rerun the full Backend suite, and document any finding that cannot yet be removed. Do not use an unreviewed forced audit fix. |

## Work order

| Order | Exact location | Required work |
|---:|---|---|
| 1 | `Backend/src/controller/eventController.js` and feature worker | Repair event-name consistency and make the source-event-to-feature-job path durable. |
| 2 | `Backend/src/services/mlService.js` | Add the missing feature/M1/M2/M5 wrappers and readiness validation. No controller may create a separate Axios client. |
| 3 | `Backend/src/services/shopifySync.js` and Shopify subscription setup | Implement abandoned-checkout ingestion, current GraphQL usage, and subscription reconciliation. |
| 4 | `Backend/src/services/commerceWebhookService.js` | Make order/customer/cart processing aggregate-safe and enqueue post-commit intelligence work. |
| 5 | `Backend/src/services/messageWebhookService.js` | Implement provider-specific signature and payload contracts, beginning with SendGrid ECDSA batches. |
| 6 | `Backend/src/services/schedulerService.js` | Add atomic feature, churn, alert, and action workers while retaining the existing state/outcome/briefing/store jobs. |
| 7 | New recovery/action service and authenticated controllers | Execute controlled beta discounts and messages with consent, limits, idempotency, audit, and a kill switch. |
| 8 | `Backend/server.js` | Make database readiness precede traffic and immediate jobs; close application resources during graceful shutdown. |
| 9 | `Backend/package.json`, dependency lockfile, and tests beside each changed module | Run the complete Backend suite, resolve compatible audit findings, and add integration, tenancy, gateway, idempotency, provider, and scheduler tests. |

## 0. Storefront events, commerce webhooks, and Python execution

This is the required end-to-end data path. Keep browser events and provider
webhooks separate: a browser pixel records shopper behavior, while a verified
provider webhook records server-side commerce or messaging outcomes.

```text
Storefront pixel -> event ingestion -> events table -> feature job -> Python pipeline
Provider webhook -> verified delivery -> commerce/outcome tables -> feature or outcome job
Python model decision -> recommendation/sequence records -> provider send
Provider delivery webhook -> sequence_events/recommendation_outcomes -> learning loop
```

### A. Storefront behavioral events

**Existing backend locations:**

- `Backend/src/route/eventRoute.js`
- `Backend/src/controller/eventController.js`
- `Backend/src/app.js`
- `docs/PIXEL_EVENT_SPEC.md`

Keep `POST /api/v1/events/ingest` as the browser-pixel ingestion endpoint.
It must accept the canonical event envelope from `PIXEL_EVENT_SPEC.md`, not an
ad hoc Shopify-only payload. A browser pixel does not possess a Shopify or
WooCommerce webhook secret, so it must not be treated as a signed provider
webhook.

The controller must perform these steps in this order:

1. Resolve the receiving store from a public, opaque store tracking key or a
   server-generated signed token. Do not trust a raw `store_id` supplied by a
   public browser request.
2. Validate `id`, `event_type`, `session_id`, `timestamp`, platform, payload
   shape, and maximum payload size against `PIXEL_EVENT_SPEC.md`.
3. Normalize the accepted timestamp to `events.created_at`, retain the
   original event ID as `events.source_event_id`, and set `events.source` to
   `pixel`.
4. Insert idempotently. A retry of the same pixel event must return success
   without creating another row.
5. Commit the event before scheduling feature computation. Return a small
   acknowledgement; do not wait for model inference in the storefront request.

Add these fields to the existing `events` model through the migration:

```text
source TEXT NOT NULL DEFAULT 'pixel'
source_event_id TEXT nullable
received_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
```

Add a unique partial index for non-null event IDs:

```text
UNIQUE (store_id, source, source_event_id) WHERE source_event_id IS NOT NULL
```

The existing controller no longer calls the former dead
`/api/features/compute` route, but its queue is incomplete. Make the event and
its `feature_jobs` row atomic, enqueue equivalent jobs for batch ingestion, and
consume them after commit. The worker must call the authenticated Python route
`POST /internal/features/compute`; the backend must not recreate feature
formulas in JavaScript.

### B. Shopify and WooCommerce server-to-server webhooks

**Existing backend locations requiring completion:**

- `Backend/src/route/commerceWebhookRoute.js`
- `Backend/src/controller/commerceWebhookController.js`
- `Backend/src/services/commerceWebhookService.js`
- The routes are already mounted in `Backend/src/app.js` before the global JSON
  parser with `express.raw({ type: 'application/json' })`; retain that order.

**Existing route shape:**

```text
POST /api/v1/webhooks/shopify/:topic
POST /api/v1/webhooks/woocommerce/:topic
```

The controller must first verify the raw request body signature, identify the
store from the verified provider domain/store identifier, deduplicate the
delivery, and only then parse/process the body. Shopify verification uses the
Shopify HMAC header and the app secret. WooCommerce verification uses the
configured webhook signature and the per-store webhook secret. Never parse the
body before signature verification, and never log raw webhook bodies or
secrets.

Register and process these topics:

| Provider event | Backend action after verified, idempotent receipt |
|---|---|
| Shopify `orders/create`, `orders/updated`, `orders/cancelled` | Upsert the order and line items, update customer aggregates, mark matching cart/recommendation outcomes where applicable, then enqueue RFM and feature/outcome work. |
| Shopify `customers/create`, `customers/update` | Upsert the customer identity/profile fields allowed by the schema. |
| Shopify `app/uninstalled` | Mark the store inactive, stop jobs, and revoke or securely retire provider access. |
| WooCommerce `order.created`, `order.updated`, `order.deleted` | Perform the same store-scoped order, line-item, outcome, RFM, and feature/outcome workflow. |
| WooCommerce `customer.created`, `customer.updated` | Upsert the allowed customer identity/profile fields. |

Use Shopify's current webhook-subscription process and a supported API version:
app-specific subscriptions are preferred when every shop uses the same topics;
shop-specific subscriptions must use `webhookSubscriptionCreate` after OAuth.
See [Shopify webhook subscriptions](https://shopify.dev/docs/apps/build/webhooks/subscribe).
New public-app Admin integrations must use GraphQL rather than extending the
legacy REST Admin implementation. See the
[Shopify REST Admin status](https://shopify.dev/docs/api/admin-rest) and
[GraphQL abandoned-checkout query](https://shopify.dev/docs/api/admin-graphql/latest/queries/abandonedCheckouts).

Use the storefront pixel, not provider order webhooks, for `PAGE_VIEW`, cart,
checkout-step, coupon-field, focus/blur, payment-attempt, and similar shopper
behavior. Provider webhooks are authoritative for completed, changed, or
cancelled commerce records. Normalize both sources through the event contract
where an event row is needed; do not manufacture behavioral events from an
order webhook.

### C. Messaging delivery webhooks and learning outcomes

**Existing backend locations requiring provider-specific completion:**

- `Backend/src/route/messageWebhookRoute.js`
- `Backend/src/controller/messageWebhookController.js`
- `Backend/src/services/messageWebhookService.js`

Add one raw-body, signature-verified route per messaging provider. Map verified
delivery callbacks to `sequence_events` using `external_message_id` and write
only the canonical `delivered`, `opened`, `clicked`, `converted`, or
`unsubscribed` event. The unique sequence-event key in this guide prevents
provider retries from double-counting outcomes. After a `converted` event or a
matching completed order, update the relevant recommendation outcome and leave
the due-outcome worker to create the learning signal.

For SendGrid, verify the ECDSA signature over the timestamp plus raw payload
using the configured public verification key and the
`X-Twilio-Email-Event-Webhook-Signature` and
`X-Twilio-Email-Event-Webhook-Timestamp` headers. Process the delivered JSON
array event by event. Do not reuse the generic HMAC-secret verifier. See
[SendGrid signed Event Webhooks](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features).

### D. Feature and prediction call order

`pipeline.py` owns feature formulas. The backend owns durable job dispatch and
calls only documented Python routes through `mlService.js` after a feature job
has produced a complete feature snapshot.

| Decision point | Required inputs | Python call | Persist after a successful response |
|---|---|---|---|
| Session has enough checkout behavior | Normalized event snapshot and customer-history features from the Python feature job | `POST /predict/abandonment-probability` | Intervention decision, model version, fallback flag, and safe decision metadata. |
| Abandonment intervention is warranted | Complete M2 feature vector | `POST /predict/shopper-sensitivity` | PSS/CSS/TSS, recovery action, channel priority, model version, and fallback flag. |
| Recovery action needs an offer | M2 output plus M5 feature vector | `POST /predict/offer-value` | Offer type, discount, expiry, expected probability, margin estimate, model version, and fallback flag. |
| A message is about to be queued | The exact send-time contract in section 2 | `POST /predict/send-time` | `send_at_utc`, local send time, confidence, reasoning layer, model version, and fallback flag in `sequence_sends.metadata`. |
| Daily or explicit customer review | The 21 churn features in section 2 | `POST /predict/churn-risk` | The mapped churn fields listed below. |
| Merchant conversation, alert, or scheduled insight | Authorized organization/user context only | `POST /orchestrate` | Sanitized response/audit record; execute only through the controlled beta policy below. |

Do not call Python from the public pixel request, from inside a database
transaction, or before the source event/order commit succeeds. Enqueue durable
work with an idempotency key instead. If Python is unavailable, preserve the
event and retry the job; never discard the shopper event or invent a model
decision.

### E. Controlled beta action execution

The beta must perform real actions for explicitly enrolled test stores; it must
not silently enable autonomous discounts or messages for every connected store.
Set `MODEL_RELEASE_CHANNEL=beta` on that Python deployment; do not put this
setting on an unrestricted production deployment. Confirm after restart that
`GET /health` reports `model_status=beta_ready`, `models_ready=true`, an empty
`models_missing` array, and `beta` for all eight expected model channels.
Use `store_settings` with `settings_group = "beta_automation"` for the merchant
opt-in and policy. Require these settings:

```json
{
  "enabled": true,
  "allowed_actions": ["cart_recovery_message", "percentage_discount"],
  "allowed_channels": ["email"],
  "max_discount_pct": 10,
  "max_messages_per_customer_24h": 1,
  "max_actions_per_store_24h": 100,
  "kill_switch": false
}
```

Implement a durable, store-scoped action job or equivalent transactional queue.
The flow is:

1. Persist the source event, feature snapshot, M1/M2/M5/M3 decisions, model
   versions, release channels, and fallback flags before enqueueing an action.
2. Execute only when the store is active, beta automation is enabled, the
   action is allowlisted, the global and store kill switches are off, the cart
   is still abandoned, and the customer has the required channel consent.
3. Apply the lowest of the M5 result, merchant cap, beta cap, and model hard cap.
   Never create a discount when the M5 decision or fallback says zero.
4. Create the Shopify discount with a stable idempotency key, one-customer use
   limit where supported, minimum order value, and M5 expiry. Persist the
   provider discount ID/code without logging it in ordinary application logs.
5. Generate the approved recovery copy, call M3 immediately before queueing,
   insert `sequence_sends` with immutable decision metadata, and send through
   the configured provider. Store the provider message ID and final status.
6. Process provider callbacks into `sequence_events`; reconcile a matching
   completed order to the cart, recommendation, sequence, and outcome.
7. Retry transport failures with bounded exponential backoff. Idempotency must
   prevent a retry from creating a second discount or message.
8. Stop new actions immediately when a kill switch, unsubscribe, consent
   removal, store disconnect, provider-auth failure, or rate limit is detected.

Merchant opt-in is the standing authorization for in-policy beta actions; a
separate confirmation is still required for anything outside the configured
action, channel, discount, frequency, or volume limits. Model promotion is
separate: do not move a synthetic version to the `production` alias merely
because it has been active for a period of time.

## 1. Prisma contracts

The current `Backend/prisma/schema.prisma` contains the fields and models in
this section and passes `prisma validate`. Keep these contracts intact, verify
that every forward migration has been applied to the target database, and add
only the action-queue fields or model chosen for the controlled beta flow.

### Existing `customers` model

The current nullable fields allow rollout without inventing historical scores:

| Field | Prisma/PostgreSQL type | Rule |
|---|---|---|
| `rfm_updated_at` | `DateTime? @db.Timestamptz(6)` | Write atomically with RFM fields. |
| `churn_probability` | `Float?` | Range 0-1. |
| `churn_tier` | `String?` | `HEALTHY`, `EARLY_WARNING`, `AT_RISK`, `HIGH_RISK`, or `CRITICAL`. |
| `win_back_urgency` | `String?` | `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`. |
| `primary_churn_signal` | `String?` | Copy Python response; do not recalculate. |
| `engagement_decay_score` | `Float?` | Range 0-100. |
| `recommended_channel` | `String?` | `email`, `sms`, `whatsapp`, or `push`. |
| `churn_offer_required` | `Boolean?` | Copy `offer_required`. |
| `churn_escalate_to_human` | `Boolean?` | Copy `escalate_to_human`. |
| `churn_model_version` | `String?` | Includes `fallback` when applicable. |
| `churn_score_fallback` | `Boolean?` | Copy `fallback`. |
| `churn_scored_at` | `DateTime? @db.Timestamptz(6)` | Latest accepted score completion. |

Retain these indexes:

- `(store_id, rfm_updated_at)`
- `(store_id, churn_tier, churn_scored_at)`
- `orders (customer_id, ordered_at DESC)`
- `events (customer_id, created_at DESC)`
- `events (customer_id, event_type, created_at DESC)`
- `customers (store_id, status, rfm_segment)`
- `customers (store_id, status, orders_count)`

Keep `orders.total`, `orders.coupon_used`, `orders.ordered_at`,
`events.session_id`, `events.event_type`, `events.payload`, and
`events.created_at` authoritative.

### Existing `orders`, `abandoned_carts`, and `ml_session_features` models

- Keep `orders.session_id String?`, `orders.discount_pct Float?`, and an index on
  `orders.session_id`. Validate `discount_pct` in the service layer as 0–25.
- Keep nullable `pss_score`, `css_score`, and `tss_score` integer fields on
  `abandoned_carts`, each validated as 0–100, plus nullable
  `recovery_action`, `sensitivity_model_version`, and
  `sensitivity_scored_at DateTime? @db.Timestamptz(6)`.
- Keep `cart_item_add_count Int?`, `cart_item_remove_count Int?`,
  `coupon_field_visited Boolean?`, and `failed_payment_count Int?` to
  `ml_session_features`. These fields complete the canonical 34-field shopper vector in
  `docs/PIXEL_EVENT_SPEC.md`; do not add `cursor_hesitation_score` as a second
  stored feature.
- Write the complete feature snapshot and the M2 response in one transaction
  after Python succeeds. Preserve the prior valid snapshot on transport failure.

### Existing `recommendations` model

Keep `channel String?`, `paused_at DateTime? @db.Timestamptz(6)`,
`pause_reason String?`, `outcome_checked_at DateTime? @db.Timestamptz(6)`, and
index `(status, evaluate_after)`. Keep `evaluation_window_hrs`,
`evaluate_after`, `status`, `action_params`, and `metadata`. Reuse
`recommendations` and `recommendation_outcomes`; do not add duplicate tables.

### Existing `sequence_sends` model

```text
id UUID PK
sequence_id UUID FK sequences.id ON DELETE CASCADE
recommendation_id UUID nullable FK recommendations.id ON DELETE SET NULL
store_id UUID FK stores.id ON DELETE CASCADE
customer_id UUID nullable FK customers.id ON DELETE SET NULL
external_message_id TEXT nullable
channel TEXT
status TEXT default queued
sent_at TIMESTAMPTZ(6) nullable
delivered_at TIMESTAMPTZ(6) nullable
metadata JSONB nullable
created_at TIMESTAMPTZ(6) default now
updated_at TIMESTAMPTZ(6) default now
```

Allow `queued`, `sent`, `delivered`, `failed`, and `cancelled`. Add unique
`(sequence_id, external_message_id)` and indexes `(recommendation_id, sent_at)`,
`(store_id, sent_at)`, `(customer_id, channel, sent_at)`, and `status`.

### Existing `sequence_events` model

```text
id UUID PK
sequence_send_id UUID FK sequence_sends.id ON DELETE CASCADE
event_type TEXT
external_event_id TEXT nullable
occurred_at TIMESTAMPTZ(6)
metadata JSONB nullable
created_at TIMESTAMPTZ(6) default now
```

Canonical events include `delivered`, `opened`, `clicked`, `converted`, and
`unsubscribed`. Add unique `(sequence_send_id, external_event_id)` and index
`(sequence_send_id, event_type, occurred_at)`. When a provider has no event ID,
derive a deterministic key from provider, message ID, type, and event time.

### Existing `order_items` model

```text
id UUID PK
order_id UUID FK orders.id ON DELETE CASCADE
store_id UUID FK stores.id ON DELETE CASCADE
external_line_item_id TEXT
external_product_id TEXT nullable
external_variant_id TEXT nullable
product_name TEXT
product_type TEXT nullable
quantity INTEGER CHECK > 0
unit_price DECIMAL(10,2)
line_total DECIMAL(12,2)
ordered_at TIMESTAMPTZ(6)
created_at TIMESTAMPTZ(6) default now
```

Add unique `(store_id, external_line_item_id)` and indexes `order_id`,
`(store_id, ordered_at)`, and `(store_id, product_type, ordered_at)`. Upsert the
order first, then its items, in the same store-scoped transaction.

### Existing state and queue models

1. `business_state_baselines`
   - UUID `id`; unique organization FK with cascade delete.
   - Nullable `event_rate_5m_30d`, `revenue_avg_30d`, `revenue_avg_90d`,
     `cart_abandonment_rate_30d`, and `returning_customer_rate_30d`.
   - JSONB `segment_distribution`, `day_of_week_baseline`,
     `seasonal_baseline`, and `metadata`.
   - `observation_started_at`, `observation_ended_at`, `computed_at`,
     `next_rebuild_at`, `created_at`, and `updated_at`.
   - Index `next_rebuild_at`.

2. `alert_queue`
   - Organization FK; nullable Business State FK named `business_state_id`
     with set-null delete. Do not use `source_state_id`; that field belongs to
     the separate recommendation-to-Business-State relationship.
   - `alert_type`, `severity`, `message`, nullable `action_url`, JSONB
     `payload`, `status`, `dedupe_key`, `available_at`, nullable
     `delivered_at`/`failed_at`, `attempt_count`, nullable `last_error`, and
     timestamps.
   - Statuses: `pending`, `processing`, `delivered`, `failed`.
   - Unique `(organization_id, dedupe_key)`; indexes `(status, available_at)`
     and `(organization_id, created_at DESC)`.

3. `audit_logs`
   - Organization FK; nullable user and recommendation FKs with set-null.
   - `entity_type`, nullable `entity_id`, `action`, JSONB `context`, and
     `created_at`.
   - Append only. Index `(organization_id, created_at DESC)` and
     `(entity_type, entity_id)`.

4. `morning_briefings`
   - Organization FK; `briefing_date`, `generated_at`, `merchant_name`,
     `greeting`, five JSONB sections, `has_concerns`, `fallback_used`, and
     timestamps.
   - Sections: `yesterday_in_numbers`, `todays_priority`, `active_concerns`,
     `opportunities`, and `overnight_log`.
   - Unique `(organization_id, briefing_date)`; index `(organization_id,
     generated_at DESC)`.

5. `model_feedback_queue`
   - Organization and recommendation FKs with cascade delete; nullable
     recommendation-outcome FK with set-null.
   - `model_name`, `signal_type`, JSONB `payload`, `status`,
     `idempotency_key`, `attempt_count`, nullable `processed_at`/`last_error`,
     and timestamps.
   - Statuses: `pending`, `processing`, `processed`, `failed`.
   - Unique `(organization_id, idempotency_key)`; indexes `(status,
     created_at)` and `recommendation_id`.

6. `strategic_memory`
   - Organization FK; nullable recommendation FK with set-null delete.
   - `entry_type`, JSONB `payload`, `created_at`.
   - Allow only service-owned writes. Index `(organization_id, created_at DESC)`.
   - Python writes `entry_type = reflection` when an observed recommendation
     outcome differs materially from its prediction.

7. `model_evaluation_metrics`
   - Organization FK; `model_name`, `metric_name`, numeric `metric_value`,
     `sample_size`, `observed_at`, and optional JSONB `metadata`.
   - Unique `(organization_id, model_name, metric_name, observed_at)` and
     index `(model_name, metric_name, observed_at DESC)`.
   - Record `randomized_policy_ctr_improvement` for send-time evaluation and
     `discount_rmse` for offer-value evaluation. The send-time metric is valid
     only for an approved randomized-control evaluation; do not copy the
     model's score-selected enrichment metric into this table. Python reads
     these aggregates for monthly monitoring; it does not write directly to
     backend-owned tables.

8. `churn_training_observations`
   - UUID `id`; organization, store, and customer FKs with cascade delete.
   - `prediction_at`, `observation_due_at`, nullable `finalized_at`, nullable
     `next_completed_order_at`, and nullable `observed_churn_tier`.
   - JSONB `feature_snapshot` containing all 21 canonical M4 fields exactly as
     sent to Python at `prediction_at`; never rebuild this snapshot from the
     customer's later profile.
   - `label_policy_version` text identifying the reviewed outcome-window policy
     used to assign `HEALTHY`, `AT_RISK`, `HIGH_RISK`, or `CRITICAL`.
   - Unique `(customer_id, prediction_at)`; indexes `(finalized_at,
     observed_churn_tier)` and `(store_id, observation_due_at)`.
   - Insert the observation in the same transaction that accepts the churn
     response. A worker may finalize it only after `observation_due_at` and
     must use completed, non-cancelled orders occurring after `prediction_at`.
     Product and data owners must approve the tier-window policy before the
     worker is enabled; never copy the model prediction into the observed label.

9. `sensitivity_training_observations`
   - UUID `id`; organization, store, customer, and optional abandoned-cart FKs.
   - `decision_at`, `observation_due_at`, nullable `finalized_at`, nullable
     Boolean `pss_label`, `css_label`, and `tss_label`, plus
     `label_policy_version` text.
   - JSONB `feature_snapshot` containing all 13 canonical M2 model fields at
     `decision_at`; never rebuild it from later customer state.
   - Unique `(customer_id, decision_at)`; indexes `(store_id,
     observation_due_at)` and `(finalized_at)`.
   - Finalize labels only through an approved experiment/outcome-attribution
     policy that can distinguish price, convenience, and trust response. Do not
     copy predicted scores or the selected recovery action into labels. Leave a
     label null when the outcome cannot support it; Python excludes such rows.

Retain the reverse Prisma relations on `organizations`, `users`, `stores`, `orders`,
`customers`, `sequences`, `business_states`, `recommendations`, and
`recommendation_outcomes` as required by the foreign keys.

### Intelligence-model data requirements

1. Keep event payloads available for `page_view` discount search/referrer data,
   coupon-field interactions, checkout steps, and failed-payment events.
2. Preserve `orders.session_id`, `orders.recovery_status`, `orders.discount_pct`,
   and the M2 scores captured with a recovery decision. These are required for
   real-data offer-value training; synthetic runs must not be promoted.
3. Persist every M2 decision-time feature set and its later attributed labels in
   `sensitivity_training_observations`. Do not infer a label merely because the
   model selected an action or a converted order exists.
4. Persist every M4 decision-time feature set in
   `churn_training_observations.feature_snapshot`, then finalize the observed
   tier only after its outcome window closes. Python rejects incomplete
   snapshots and reads no unfinalized rows.
5. Populate Business State `ml_signals` with safe aggregate margin and
   channel-profitability signals. Finance and Intelligence agents consume only
   that shared state and never query tables during a conversation.
6. Write the evaluation metrics above after outcome windows close. Do not infer
   model quality from a single recommendation or unlabelled delivery event.
7. Add a safe aggregate `ml_signals.marketing` payload to each Business State.
   It must contain per-channel delivery and outcome totals/rates, M2 recovery
   action counts, M3 send-time outcome summaries, and offer-type outcome
   summaries for a defined comparison window. The Marketing Agent must read
   this shared aggregate only; it must not query `sequence_events` during a
   conversation. This is required before it can identify a best-performing
   channel or flag discount dependency from measured results.

### Lab seed and derived-state workflow

Use `python/src/lab/lume_seed.py` only with a disposable lab database, an
existing organization UUID, and a dedicated store UUID for the scenario. The
generated transaction seeds only these source records:

- `stores`
- `customers`
- `orders`
- `abandoned_carts`
- `events`
- `business_state_baselines`

Do not manually insert `business_states` or `alert_queue` rows. After the seed
transaction commits, the backend must call the authenticated Python routes in
this order:

1. `POST /internal/rfm-sync` with
   `{ "store_id": "<scenario-store-uuid>" }`.
2. `POST /internal/business-state/rebuild` with
   `{ "organization_id": "<organization-uuid>" }`.

Python then calculates the RFM values, builds the current Business State, and
creates any qualifying alerts through the same code paths used outside the
lab. The backend must drain `alert_queue` through its normal transactional
worker; there is no separate Python alert-drain endpoint.

Use a fixed `--seed` and `--as-of` value when a repeatable comparison is
required. The generated SQL is synthetic test data, not a production backup or
approved training dataset. A scenario must not be reported as end-to-end ready
until `python/src/lab/scenarios/registry.json` has `pipeline_ready: true` and
the required Business State signals are actually available.

## 2. `mlService.js` wrappers

Every wrapper must require `PYTHON_SERVICE_URL` and `ML_INTERNAL_KEY` without
logging them; send `X-Internal-Key`, `X-Correlation-ID`, and JSON content type;
use a timeout and `maxRedirects: 0`; return `{ success, data?, error? }`; and log
only safe identifiers, latency, status, and sanitized error type.

| Python call | Backend trigger |
|---|---|
| `POST /internal/features/compute` `{ customer_id?, session_events }` | A claimed `feature_jobs` row after the complete store-scoped session has been loaded. Persist the returned `features` map before predictions. |
| `POST /predict/abandonment-probability` | After feature computation for an active checkout session. |
| `POST /predict/shopper-sensitivity` | After an M1 intervention decision, using the complete M2 feature contract. |
| `POST /predict/offer-value` | After M2 selects a recovery action that may use an offer. |
| `POST /internal/rfm-sync` `{ store_id }` | After successful store-sync commit. |
| `POST /internal/business-state/rebuild` `{ organization_id }` | Every minute for each due organization; Python writes the next 15/5/1-minute cadence. |
| Backend-owned alert queue drain; no Python endpoint | After rebuild and every minute for recovery. Call `POST /orchestrate` only when an alert needs agent-generated output. |
| `POST /internal/morning-briefings` | 05:00 UTC daily. |
| `POST /internal/recommendation-outcomes/evaluate` `{ limit }` | Configured interval; Python claims rows where `evaluate_after <= now`. Keep Backend batches between 1 and 100 and repeat while the returned count equals the batch size. |
| `POST /predict/churn-risk` | Daily and explicit customer re-score. |
| `POST /predict/send-time` | Before each recovery message is queued. |
| `POST /orchestrate` | Conversation, alert, or scheduler trigger. |

### Churn contract

Send `X-Customer-ID`, `X-Merchant-ID`, and these 21 model keys:

```text
past_orders_total, days_since_last_purchase, avg_order_value,
purchase_frequency_trend, rfm_recency_score, rfm_frequency_score,
rfm_monetary_score, historical_aov_trend, email_open_rate_30d,
email_open_rate_90d, email_open_rate_delta, sms_click_rate_30d,
site_visit_frequency_30d, site_visit_frequency_90d, site_visit_delta,
browse_to_cart_conversion_trend, coupon_dependency_score, return_rate,
support_contact_frequency_90d, discount_seeking_escalation,
unsubscribe_risk_score
```

The task heading says 24 but names 21; the named 21 are authoritative. Do not
invent three inputs. `customer_ltv` is auxiliary, not a model feature. New code
must use canonical names. Python temporarily accepts `sms_click_rate`,
`site_visit_frequency_delta`, and `browse_to_cart_trend`; canonical wins when
both exist.

Map the Python response directly:

```text
churn_probability -> churn_probability
churn_tier -> churn_tier
win_back_urgency -> win_back_urgency
primary_churn_signal -> primary_churn_signal
engagement_decay_score -> engagement_decay_score
recommended_channel -> recommended_channel
offer_required -> churn_offer_required
escalate_to_human -> churn_escalate_to_human
fallback -> churn_score_fallback
model_version -> churn_model_version
```

Capture `score_started_at` before the call. Update in one transaction only when
`churn_scored_at IS NULL OR churn_scored_at <= score_started_at`. A transport
failure keeps the last valid score. Start recovery only after commit, with an
idempotency key from customer, score date, tier, and model version. Never
auto-discount `EARLY_WARNING`.

### Send-time contract

Send:

```text
channel, recovery_action, cart_value_tier, customer_timezone_offset,
historical_open_probabilities, history_data_points,
days_since_last_purchase, failed_payment_attempt, risk_score,
sequence_message_number, previous_message_sent_at,
previous_message_opened, previous_message_clicked, last_sms_sent_at,
secondary_channel
```

- `historical_open_probabilities` is empty/omitted or exactly 24 local-hour
  floats from 0-1.
- Calculate each slot from prior `opened` events divided by prior sends.
- `history_data_points` is total eligible sends, not nonzero slots.
- Use `-1` when there is no prior purchase.
- Send canonical `premium` and `HYBRID_BUNDLE`; Python temporarily accepts
  aliases `high` and `HYBRID`.
- Persist `send_at_utc`; retain local `send_at` for audit and verify they are
  the same instant.
- Do not recalculate quiet hours, cadence, smoothing, or channel overrides.

Persist immutable decision evidence in `sequence_sends.metadata`:

```text
recovery_action, cart_value_tier, customer_timezone_offset,
historical_open_rate, history_data_points, days_since_last_purchase,
risk_score, reasoning_layer, model_confidence, model_fallback,
model_name, model_version, decision_at, policy_version,
eligible_send_slots, chosen_send_slot, assignment_arm,
assignment_probability
```

Use an idempotency key from sequence, customer, message number, and decision
time. Before sending, recheck consent and atomically claim the row. Base SMS
cadence on actual prior `sent_at`.

For M3 training and evaluation:

1. Freeze every feature above at `decision_at`; never rebuild historical rates
   or customer state after the outcome is known.
2. Set `assignment_arm` to `model`, `control`, or `exploration`. Record the
   actual probability of receiving that arm/slot in `assignment_probability`.
3. Product and data owners must approve the control-slot policy and exploration
   rate. Do not infer causal lift from model scores or ordinary historical sends.
4. Label a send only after 120 minutes have elapsed. The M3 engagement outcome
   is positive only when both canonical `opened` and `clicked` events occurred
   between `sent_at` and `sent_at + 120 minutes`.
5. Calculate CTR for eligible randomized model and control observations using
   the same attribution window. Write the absolute model-minus-control result
   to `model_evaluation_metrics.metric_value` with
   `metric_name = randomized_policy_ctr_improvement`, the total evaluated send
   count in `sample_size`, and
   `metadata.evaluation_design = randomized_control`.
6. Store one current rolling evaluation row per organization and observation
   time. Keep at least 500 eligible events across the latest organization-level
   evaluations in the trailing 30 days before production registration. Python
   uses only the latest valid row per organization and weights those rows by
   `sample_size`; incomplete or non-randomized records cannot satisfy the gate.

### Orchestrator contract

```json
{
  "organization_id": "UUID",
  "user_id": "authorized member UUID",
  "conversation_id": "optional owned conversation UUID",
  "message": "maximum 2000 characters",
  "trigger_type": "conversation | alert | scheduler",
  "trigger_priority": "low | normal | high | critical",
  "context_payload": {}
}
```

Limit serialized `context_payload` to 16 KiB. Exclude PII, credentials, headers,
cookies, provider payloads, and free-form order notes. Verify membership and
conversation ownership. Use a stable trigger occurrence key for retries.

Python returns proposals only. Backend may execute only these tools through
tenant- and role-checked handlers: `view_carts`, `view_customers`,
`view_revenue`, `create_campaign`, `view_analytics`, `view_products`, and
`view_checkout`. Mutating actions require idempotency and either explicit
per-action confirmation or a verified `beta_automation` opt-in whose limits
cover that exact action.

### Image review contract

Send `image_base64` and `image_media_type` together. Accept JPEG, PNG, WebP,
and GIF up to 8 MiB decoded. Reject data-URL wrappers, invalid base64,
unsupported types, excessive dimensions, and decompression bombs. Keep stored
assets private and tenant-scoped. Never execute campaign changes directly from
an ad evaluation.

## 3. Scheduler implementation

Create `Backend/src/services/schedulerService.js`; register it only from
`Backend/server.js`.

1. `startSchedulers()` returns every cron handle.
2. `stopSchedulers()` stops every handle during graceful shutdown.
3. Each job uses an in-process overlap guard and a distributed/database lock.
4. One organization failure does not stop the batch.
5. Page large jobs with durable cursors and bounded concurrency.
6. Do not start jobs automatically in unit tests.
7. Log counts, latency, and sanitized errors only.

Schedules:

- Every minute: select due organizations from
  `business_state_baselines.next_rebuild_at`, then call
  `POST /internal/business-state/rebuild` once per organization with
  `{ "organization_id": "<uuid>" }`. Python persists the next adaptive rebuild
  time. After each rebuild, and every minute for recovery, the backend must
  transactionally drain pending `alert_queue` rows. Alert delivery is a backend
  job, not a separate Python endpoint; call `POST /orchestrate` with
  `trigger_type = "alert"` only when agent-generated output is required.
- Daily UTC: churn scoring in bounded customer pages.
- 05:00 UTC: `/internal/morning-briefings` under a date lock.
- 05:10 UTC: verify one briefing per active organization; retry only missing or
  failed organizations.
- Configured interval: call
  `POST /internal/recommendation-outcomes/evaluate` with `{ "limit": 100 }`.
  Python transactionally claims due recommendations using `evaluate_after` and
  `outcome_checked_at`; repeat bounded calls while `processed` equals `limit`.

Claim queue rows transactionally with `FOR UPDATE SKIP LOCKED` or an equivalent
Prisma-safe pattern. Retries must not duplicate alerts, events, outcomes,
feedback items, or briefings.

## 4. Store sync

In `Backend/src/services/shopifySync.js`:

1. Upsert orders and completed-order line items in one store-scoped transaction.
2. Update `customers.orders_count` and `customers.ltv` atomically; exclude
   cancelled/failed orders.
3. Commit commerce data.
4. Call `/internal/rfm-sync` with the authoritative store UUID.
5. On RFM failure, retain commerce data and enqueue an idempotent retry.
6. Do not log returned customer IDs.

Rules: VIP is active `rfm_segment = champion`; `loyal` is not VIP. Dormant VIP
means at least 45 complete days since latest `orders.ordered_at`. A
second-purchase candidate has exactly one completed order. LTV milestones are
100, 500, 1,000, and 2,500 in normalized store currency; approaching means
within 15% below. Never use `customers.updated_at` as purchase inactivity.

## 5. Tenant and data security

- Include `organization_id` in organization-owned queries.
- Verify store ownership before store-owned queries.
- Never trust organization/store/customer IDs from public request bodies.
- Keep new tables server-only until application users are mapped to Supabase
  `auth.uid()` and RLS is tested.
- Use Prisma or parameterized SQL only.
- Never log internal keys, DagsHub credentials, feature vectors, PII, or raw
  webhook bodies.

## 6. Later integrations

Before claiming vector/RAG work is production-complete:

- Add tenant-filtered `merchant_memory_embeddings` after pinning an embedding
  model. Filter tenant, user visibility, active, and expiry before ranking.
- Provision a separate reviewed ecommerce-knowledge index containing source,
  publisher, publication/review dates, version, region, expiry, and hash.
- Expose bounded top-K retrieval (1-8) with timeout, similarity threshold,
  reviewed excerpts, and prompt-injection tests.

Until then, Python's bounded lexical merchant-memory fallback is authoritative
and must not be described as general-knowledge RAG.

## 7. Validation and deployment

1. Back up the target database and verify restore steps.
2. Apply the migration to a disposable clone.
3. Run `prisma format`, `prisma validate`, migration tests, and client generation.
4. Run gateway, scheduler, idempotency, and cross-tenant tests.
5. Deploy Backend with schedulers disabled.
6. Deploy Python and verify internal health/authentication.
7. Run one canary store through sync, RFM, churn, and send-time persistence.
8. Enable jobs gradually and monitor queues, duplicates, failures, latency,
   fallback rate, and Business State freshness.

Minimum acceptance tests:

- Migration applies to a current-schema clone and has a reviewed rollback.
- Cross-tenant reads/writes fail for every new model.
- Store sync calls RFM once only after commit; retry is idempotent.
- A committed pixel event always has exactly one durable feature job, including
  batch ingestion, and the worker persists the Python feature result once.
- Backend health fails readiness when any Python model is missing or the
  release channel is not allowed for that deployment.
- One opted-in test store completes M1 -> M2 -> M5 -> M3, creates at most one
  provider discount and message, and records the decision, send, callbacks,
  conversion, and outcome under retries.
- Churn sends all 21 features; stale responses cannot overwrite newer scores.
- Send-time builds exactly 24 ordered local-hour rates and prevents SMS sends
  less than 24 hours apart.
- Webhook retries do not duplicate sequence events.
- Pixel requests cannot select another store by changing a raw `store_id`, and
  duplicate pixel event IDs do not create duplicate `events` rows.
- Shopify and WooCommerce webhook routes reject invalid signatures before
  parsing a body; valid duplicate deliveries do not repeat order, RFM, or
  outcome work.
- The event controller no longer calls `/api/features/compute`; feature work is
  enqueued only after the normalized event has committed.
- Queue workers use atomic claims and cannot duplicate outcomes or alerts.
- 05:00 scheduling uses UTC, date locking, and graceful shutdown.
- 44-day inactivity is excluded; 45-day inactivity is included.
- `champion` is VIP; `loyal` is not.
- Conversation writes remain atomic under concurrency.
- Oversized, PII/credential-bearing, and cross-tenant orchestrator inputs fail.
- Unknown tools fail; mutating tools require authorization plus either verified
  beta opt-in or explicit confirmation.
- In-policy beta automation requires verified merchant opt-in; out-of-policy
  mutations still require explicit confirmation. Consent removal and either
  kill switch stop new sends immediately.
- Logs and public responses contain no internal key, DagsHub credential, PII,
  or customer context payload.

Backend work is complete only when migration, generated client, wrappers,
schedulers, tests, canary, monitoring, and rollback evidence all pass.
