# Backend D/S Implementation Handoff

## Boundary

This is the work order for the Backend team. No file under `Backend/` was
changed by the Python implementation.

- Backend owns Prisma, migrations, Node gateway code, schedules, and live data.
- Python owns feature computation, model/fallback decisions, Business State,
  agent reasoning, and briefing content.
- Use additive migrations. Do not rename current tables, columns, or APIs.
- Test on a disposable PostgreSQL database before any production migration.
- Keep MLflow/DagsHub credentials in Python only.

## Work order

| Order | Exact location | Required work |
|---:|---|---|
| 1 | `Backend/prisma/schema.prisma` | Add the columns, models, relations, constraints, and indexes below. |
| 2 | `Backend/prisma/migrations/<timestamp>_add_ds_contract/migration.sql` | Generate a forward migration. Do not edit `0_baseline`. |
| 3 | `Backend/src/services/mlService.js` | Add Node-to-Python wrappers. No controller may create a separate Axios client. |
| 4 | `Backend/src/services/shopifySync.js` | Persist order items and call RFM after a successful commerce-sync commit. |
| 5 | `Backend/src/services/schedulerService.js` | Add bounded, locked jobs for state, alerts, outcomes, churn, and briefings. |
| 6 | `Backend/server.js` | Start schedulers after startup and stop them during graceful shutdown. |
| 7 | `Backend/src/controller/revController.js` | Keep calls through `mlService`; add only authenticated result/action handlers. |
| 8 | Tests beside each changed module | Add migration, tenancy, gateway, idempotency, and scheduler tests below. |

## 1. Prisma changes

### Existing `customers` model

Add nullable fields so rollout does not invent historical scores:

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

Add indexes:

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

### Existing `recommendations` model

Add `channel String?`, `paused_at DateTime? @db.Timestamptz(6)`,
`pause_reason String?`, `outcome_checked_at DateTime? @db.Timestamptz(6)`, and
index `(status, evaluate_after)`. Keep `evaluation_window_hrs`,
`evaluate_after`, `status`, `action_params`, and `metadata`. Reuse
`recommendations` and `recommendation_outcomes`; do not add duplicate tables.

### New `sequence_sends` model

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

### New `sequence_events` model

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

### New `order_items` model

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

### New state and queue models

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
   - Organization FK; nullable Business State FK with set-null delete.
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

Add reverse Prisma relations to `organizations`, `users`, `stores`, `orders`,
`customers`, `sequences`, `business_states`, `recommendations`, and
`recommendation_outcomes` as required by the foreign keys.

## 2. `mlService.js` wrappers

Every wrapper must require `PYTHON_SERVICE_URL` and `ML_INTERNAL_KEY` without
logging them; send `X-Internal-Key`, `X-Correlation-ID`, and JSON content type;
use a timeout and `maxRedirects: 0`; return `{ success, data?, error? }`; and log
only safe identifiers, latency, status, and sanitized error type.

| Python call | Backend trigger |
|---|---|
| `POST /internal/rfm-sync` `{ store_id }` | After successful store-sync commit. |
| Business State due rebuild | Every minute; Python selects 15/5/1-minute cadence. |
| Alert queue drain | After rebuild and every minute for recovery. |
| `POST /internal/morning-briefings` | 05:00 UTC daily. |
| Due recommendation outcomes | Worker selects `evaluate_after <= now`. |
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
model_name, model_version, decision_at
```

Use an idempotency key from sequence, customer, message number, and decision
time. Before sending, recheck consent and atomically claim the row. Base SMS
cadence on actual prior `sent_at`.

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
`view_checkout`. Mutating actions require confirmation and idempotency.

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

- Every minute: due Business State rebuilds and alert delivery recovery.
- Daily UTC: churn scoring in bounded customer pages.
- 05:00 UTC: `/internal/morning-briefings` under a date lock.
- 05:10 UTC: verify one briefing per active organization; retry only missing or
  failed organizations.
- Configured interval: due recommendation outcomes using `evaluate_after` and
  `outcome_checked_at`.

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
- Churn sends all 21 features; stale responses cannot overwrite newer scores.
- Send-time builds exactly 24 ordered local-hour rates and prevents SMS sends
  less than 24 hours apart.
- Webhook retries do not duplicate sequence events.
- Queue workers use atomic claims and cannot duplicate outcomes or alerts.
- 05:00 scheduling uses UTC, date locking, and graceful shutdown.
- 44-day inactivity is excluded; 45-day inactivity is included.
- `champion` is VIP; `loyal` is not.
- Conversation writes remain atomic under concurrency.
- Oversized, PII/credential-bearing, and cross-tenant orchestrator inputs fail.
- Unknown tools fail; mutating tools require authorization and confirmation.
- Logs and public responses contain no internal key, DagsHub credential, PII,
  or customer context payload.

Backend work is complete only when migration, generated client, wrappers,
schedulers, tests, canary, monitoring, and rollback evidence all pass.
