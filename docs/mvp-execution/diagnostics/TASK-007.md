# REVLUMA — TASK 007 EXECUTION REPORT

> Recovered 2026-10-30 from the user-supplied combined report export `Pasted text(20261029-230806).txt` (native file `libfile_faf38cccba4c819186fc21f5afec36f9`). Historical inspected revision: `cfb41b7b468bfecd537d841d55c450ff21673342`. Original verdict: **PASS — architecture inspection**, not production runtime certification. Tests/results and limitations below are preserved as originally reported; no prior investigation was repeated.

> Tables were converted from exported tab-separated text for readability. Diagram labels in the supplied export were flattened; their original sequence is retained without inventing graph edges. Progress counts and next-task instructions below are historical.

Export-section SHA-256 (UTF-8, normalized newlines before formatting): `df2dca29265557bea1e941b6919741616d17d6dd442946b34ecca8cc87840c63`.

## Original execution report
Task: Map abandonment classification job
Phase: 1 — Reliable Data Foundation
Execution mode: Strictly read-only

I've inspected the Shopify checkout lifecycle, classification scheduler, Prisma models, and related order-handling code against the live Render deployment revision.

The central finding: Revluma uses a 15-minute inactivity rule, but its classification job does not independently verify that a Shopify purchase has not occurred. It relies on the checkout's existing status and completion timestamp. That distinction matters because an order can exist without having been successfully matched to its checkout.

## A. Inspection baseline

| Item | Verified value |
| --- | --- |
| Repository | Revluma-Organization/Revluma |
| Branch | main |
| Inspected commit | cfb41b7b468bfecd537d841d55c450ff21673342 |
| Production backend commit | cfb41b7b468bfecd537d841d55c450ff21673342 |
| Render deployment | dep-dbhqdso8v5cc7395g6i0 |
| Deployment status | Live |
| Production alignment | Confirmed |

The GitHub branch also contains a newer frontend-related commit, but Render's live backend deployment matches the inspected revision.

## B. Classification implementation
The primary classification function is:

promoteInactiveCheckouts()

Source: Backend/src/services/schedulerService.js:720–734

It is called by runStoreSync(), which is scheduled using Node.js setInterval.

The default execution interval is 15 minutes, configured through STORE_SYNC_INTERVAL_MS.

This means Revluma does not classify every checkout immediately when its 15-minute inactivity period expires. It evaluates eligible checkouts during the next scheduler run.

For example, a checkout might become eligible after 15 minutes but not be classified until almost 30 minutes after its last recorded activity, depending on scheduler timing.

## C. Actual classification query
The core implementation is:

const cutoff = new Date(Date.now() - ABANDONMENT_INACTIVITY_MS);

const result = await prisma.abandoned_carts.updateMany({
  where: {
    status: 'pending',
    recovered_at: null,
    updated_at: { lte: cutoff },
    stores: {
      platform: 'shopify',
      status: { in: ['active', 'connected', 'syncing'] },
    },
  },
  data: { status: 'abandoned' },
});

This establishes five eligibility requirements:


| Condition | Business meaning |
| --- | --- |
| status: 'pending' | Checkout has not already been classified as abandoned or recovered |
| recovered_at: null | No completion timestamp has been recorded |
| updated_at <= cutoff | At least 15 minutes since recorded checkout activity |
| platform: 'shopify' | Only Shopify stores are included |
| Store status active, connected, or syncing | Only eligible connected stores are included |

What is missing: There is no query against the orders table and no explicit check for an associated Shopify order.

The classification job therefore cannot distinguish a genuinely incomplete checkout from a checkout whose purchase was ingested but not reconciled.

## D. Fifteen-minute threshold
The threshold is defined in Backend/src/services/checkoutInactivity.js:3:

const ABANDONMENT_INACTIVITY_MS = 15 * 60 * 1000;

That's exactly 900,000 milliseconds.

The classification job computes the cutoff using the application's current time and compares it against abandoned_carts.updated_at.


| Time since last recorded activity | Eligible? |
| --- | --- |
| 14 minutes, 59 seconds | No |
| Exactly 15 minutes | Yes |
| 15 minutes, 1 second | Yes |
| Future-dated activity timestamp | No, until the cutoff catches up |
| Missing timestamp | Not established as eligible by this query |

The comparison is inclusive (<=), equivalent to an elapsed-time check of >= 15 minutes.

The Prisma schema uses PostgreSQL Timestamptz(6), so timestamps represent instants rather than relying on the merchant's local timezone.

Important: This threshold is not a configurable merchant preference in the inspected code.

## E. Complete execution architecture
The classification process runs inside the main Express backend, not a dedicated abandonment worker.

Backend/server.js: applicationstarts
startScheduler()
Immediate runStoreSync()
setInterval(runStoreSync)
runStoreSync()
Already running locally?
Skip
Acquire store-sync lock
promoteInactiveCheckouts()
Calculate now minus 15minutes
Prismaabandoned_carts.updateMany()
Database evaluates pending,unrecovered, inactive Shopifycheckouts
Atomically set status =abandoned
Log number promoted
Continue scheduled Shopifysynchronization
Release lock
Yes
No
Unavailable
Acquired
Source: Backend/server.js:19–25; Backend/src/services/schedulerService.js:720–780, 786–840.

Notice what the flowchart does not contain: a Shopify API completion lookup, an order reconciliation query, or a per-checkout verification stage. Those operations are not part of the classification function.

## F. What Revluma considers activity
Checkout activity is derived from Shopify timestamps.

The function lastCheckoutActivity() uses:

updated_at → updatedAt → created_at → createdAt → current time

Source: Backend/src/services/checkoutInactivity.js:5–9.


| Event | Timestamp affected | Effect on abandonment |
| --- | --- | --- |
| Checkout created | updated_at | Starts inactivity window |
| Checkout updated | updated_at | Resets eligibility if timestamp is newer |
| Customer changes checkout details | Shopify checkout updated_at | Treated as activity if reflected in a newer update |
| Duplicate checkout webhook | Usually same timestamp | Does not normally extend inactivity |
| Older incomplete webhook | Existing timestamp preserved | Does not reset inactivity |
| Historical checkout sync | Shopify updatedAt | Uses historical timestamp when supplied |
| Event without valid timestamp | Current processing time | May postpone classification |
| Completed checkout event | recovered_at, status | Removes checkout from scheduler eligibility |

Limitation: Shopify's checkout update timestamp is a resource-modification signal, not direct evidence of human activity.

Revluma currently does not distinguish those two concepts.

## G. Completion safeguards and purchase precedence
The implementation has three relevant protections.

## 1. Checkout completion event

nextCheckoutStatus() returns recovered when Shopify supplies completed_at.

## 2. Order reconciliation

upsertOrder() attempts to find a checkout using available Shopify identifiers. When a match is found, it marks the checkout recovered.

## 3. Classification query

The scheduler selects only pending records with recovered_at: null.

These safeguards work together when checkout and order records have been correctly linked.

However, the scheduler does not independently check for an existing matching order.

Purchase lifecycle scenarios

| Scenario | Assessment | Reason |
| --- | --- | --- |
| Purchase before classification, correctly reconciled | Implemented — not verified | Order handler changes checkout status before classification |
| Purchase before classification, not reconciled | Potential defect | Scheduler can classify an unmatched checkout as abandoned |
| Purchase after abandonment, correctly reconciled | Implemented — not verified | Order handler can change abandoned checkout to recovered |
| Delayed incomplete checkout event after completion | Implemented — not verified | Lifecycle helper preserves recovered |
| Concurrent classification and order completion | Partially implemented | Conditional scheduler update protects against stale selection, but ordering is not fully coordinated |
| Completed order arrives after classification | Partially implemented | Correction depends on successful order-to-checkout matching |

The critical distinction: Revluma protects a checkout once it knows that checkout is completed. It does not yet guarantee that every completed Shopify purchase is correctly identified before abandonment classification.

## H. Checkout state-transition map
The checkout lifecycle primarily uses pending, abandoned, and recovered.

pending
abandoned
recovered
Checkout ingested
At least 15 minutes inactive
Newer incomplete checkoutupdate
Completion evidence
Completion evidence
Delayed incomplete update
These transitions are implemented across:

checkoutInactivity.js:17–20
commerceWebhookService.js:243–245, 300–318
schedulerService.js:720–734
The database also supports legacy statuses such as in_sequence and lost, which appear in dashboard queries. They are not created by this classification job.

Important terminology issue: The status recovered currently represents both purchase completion and, in other areas of the product, recovery attribution. These are not equivalent business facts.

## I. Database persistence
The scheduler performs a single conditional Prisma updateMany().

It does not load checkout records into JavaScript, modify them individually, and then save them.

This is significant for concurrency: PostgreSQL evaluates the update conditions when executing the write.


| Database field | Classification behavior |
| --- | --- |
| status | Changed from pending to abandoned |
| updated_at | Preserved |
| abandoned_at | Preserved |
| recovered_at | Must be null; not modified |
| customer_id | Preserved |
| external_cart_id | Preserved |
| cart_value | Preserved |
| Associated orders | Not queried or modified |
| Product details | Not modified |

Source: schedulerService.js:720–734; prisma/schema.prisma:342–371.

One important discovery is that abandoned_at is not set when the scheduler classifies a checkout as abandoned.

The checkout handler normally initializes it using Shopify's checkout creation timestamp.

Consequently, abandoned_at does not necessarily mean the time abandonment occurred.

That distinction can affect historical reporting.

## J. Concurrency and duplicate execution
Existing safeguards
The scheduler has two relevant protections:

storeSyncRunning prevents overlapping executions inside one Node.js process.
acquireLock('store-sync') coordinates execution across instances when Redis is available.
The database query also requires status: 'pending'.

Once a checkout becomes abandoned, a repeated classification run will not select it again unless another operation changes its status back to pending.

Assessment

| Risk | Current protection |
| --- | --- |
| Repeated classification | Protected by pending-only selection |
| Two scheduler ticks in one process | Protected by local running flag |
| Two backend instances | Redis lock when available |
| Redis unavailable | Distributed locking unavailable |
| Concurrent checkout update | Conditional database update limits stale writes |
| Concurrent order completion | Partially protected; no shared transaction or checkout lock |
| Duplicate operational events | No event creation found in classification function |
| Duplicate metrics | Classification itself does not insert new checkout rows |

Classification idempotency: Implemented — not verified.

The scheduler is designed to avoid repeatedly changing an already abandoned record.

That does not guarantee the underlying checkout records are unique. Duplicate checkout records created during ingestion can still inflate downstream metrics.

## K. Runtime reliability
The classification job is part of the main Render backend service.

Source: Backend/server.js:19–25; schedulerService.js:736–840.


| Runtime behavior | Verified implementation |
| --- | --- |
| Starts with backend | Yes |
| Runs immediately at startup | Yes |
| Runs periodically | Yes |
| Default interval | 15 minutes |
| Separate worker required | No |
| Redis required for classification | No |
| Redis used for distributed locking | Yes, when available |
| Works without Redis | Yes, using process-local protection |
| Survives process shutdown | No; timers stop |
| Resumes after restart | Yes, when scheduler starts |
| Re-evaluates overdue checkouts | Yes |
| Records each missed scheduled run | Not found |

Render currently reports one backend instance on the free plan.

If the instance sleeps or restarts, classification pauses. On restart, the scheduler runs again and evaluates checkouts whose timestamps already satisfy the cutoff.

This provides overdue-checkout recovery, but not guaranteed execution at exactly 15 minutes.

The Redis lock has a default five-minute expiry. If a store-sync run exceeds that duration, another instance could potentially acquire the lock before the original run finishes. The database's conditional update still helps prevent duplicate classification.

## L. Historical synchronization
Historical Shopify checkouts are imported through:

Backend/src/services/shopifySync.js:248–300

The sync uses Shopify's original updatedAt timestamp when available.

That means a historical checkout can immediately qualify for abandonment during a subsequent scheduler run.

However, the sync does not guarantee that every historical checkout has been reconciled against a completed order before classification.

Potential consequence: Historical abandonment counts may include completed but unmatched purchases.

The full historical synchronization audit remains reserved for Task 008.

## M. Operational metrics and downstream effects
The classification job itself only updates checkout status and logs the number of affected rows.

It does not directly:

Send emails, SMS, or WhatsApp messages.
Trigger a recovery campaign.
Create an operational event.
Recalculate dashboard metrics.
Generate a Rev Intelligence finding.
Modify the Shopify store.
However, downstream services read checkout records.

Confirmed dashboard dependencies
Source: Backend/src/controller/dashboardController.js.


| Metric | How abandonment affects it |
| --- | --- |
| Abandoned Carts | Counts eligible abandoned records and overdue pending records |
| Revenue at Risk | Sums checkout values for abandoned or overdue pending records |
| Recovery Rate | Uses recovered-order counts against an abandoned-checkout denominator |
| Cart Recovery listing | Includes abandoned records and overdue pending records |
| Historical checkout charts | Uses checkout abandoned_at timestamps |

Two important findings emerged.

First, the dashboard can display a pending checkout as abandoned before the scheduler has updated its status. Its queries independently apply the 15-minute cutoff.

Second, some dashboard queries include recovered checkouts in their abandoned-checkout totals. This may be intentional historical accounting, but the denominator needs separate verification before those figures can be considered reliable.

The historical charts also use abandoned_at, which currently represents checkout creation time rather than the actual classification time.

These are metric-integrity concerns, not evidence that the scheduler itself is miscounting records.

## N. Error handling and observability
The classification function does not catch its own database errors.

Instead, runStoreSync() catches errors around the broader store-sync execution and logs a failure.

The scheduler releases its lock in a finally block.


| Failure | Current behavior | Recovery |
| --- | --- | --- |
| Database unavailable | Classification throws | Next scheduled run |
| Redis unavailable | Uses local lock | Continues on same instance |
| Redis lock held elsewhere | Skips run | Next scheduled run |
| Invalid checkout timestamp | Database eligibility depends on stored value | No special per-record repair |
| Backend restart | Current execution interrupted | Scheduler restarts with backend |
| Individual checkout invalid | No per-checkout isolation in bulk update | Whole operation may fail |
| Duplicate scheduled run | Local/Redis protections | Usually skipped |
| Order not reconciled | Not detected by classification | May remain incorrectly abandoned |

Existing logs
The scheduler records:

scheduler_inactive_checkouts_promoted

with the number of rows updated.

It also records broader store-sync failures and scheduler lock problems.

Observability gaps
The inspected implementation does not provide a dedicated classification-run record containing:

Run ID.
Exact start and completion timestamps.
Number of candidate checkouts evaluated.
Number excluded because of completed purchases.
Number excluded because of matching orders.
Checkout-level classification reasons.
Last successful classification time.
Per-store classification counts.
This makes it difficult to investigate why an individual checkout was classified as abandoned.

## O. Existing tests
The identified lifecycle test file is:

Backend/src/services/__tests__/checkoutInactivity.test.js

It contains tests for the inactivity threshold, timestamp selection, pending status, completion precedence, and stale-event handling.


| Test area | Coverage |
| --- | --- |
| Before 15 minutes | Present |
| Exactly 15 minutes | Present |
| More than 15 minutes | Present |
| New activity resets inactivity | Present |
| Historical Shopify timestamp preserved | Present |
| Completed checkout status precedence | Present |
| Stale checkout event | Present |
| Invalid timestamp | Present |
| Scheduler database update | Not established |
| Associated-order exclusion | Not established |
| Concurrent order completion | Not established |
| Duplicate scheduler execution | Not established |
| Multiple backend instances | Not established |
| Backend restart recovery | Not established |
| Historical import reconciliation | Not established |

Execution status: Tests were inspected but not executed. No passing runtime results are claimed.

## P. Findings register

| Severity | Finding | Source | Potential impact |
| --- | --- | --- | --- |
| Critical | Classification does not check for an existing completed order | schedulerService.js:720–734 | Completed purchases may appear abandoned |
| High | Checkout-to-order reconciliation is not guaranteed | commerceWebhookService.js:213–255 | Incorrect checkout lifecycle |
| High | Dashboard independently classifies overdue pending checkouts | dashboardController.js:47–66, 383–409 | Metrics may differ from persisted status |
| High | abandoned_at is not actual abandonment time | commerceWebhookService.js:313; schedulerService.js:730 | Misleading historical reporting |
| High | Duplicate checkout identifiers lack a database uniqueness guarantee | schema.prisma:370 | Inflated abandonment counts |
| Medium | Classification cadence can delay status changes | schedulerService.js:64–67, 837–840 | Delayed operational visibility |
| Medium | Resource updates are treated as customer activity | checkoutInactivity.js:5–9 | Inaccurate inactivity interpretation |
| Medium | Historical imports can become immediately eligible | shopifySync.js:221–271 | Historical count inaccuracies |
| Medium | Classification has limited checkout-level diagnostics | schedulerService.js:720–734 | Difficult production debugging |
| Medium | Redis-unavailable fallback lacks distributed locking | schedulerService.js:153–168 | Multiple-instance coordination risk |
| Medium | Classification-specific integration tests were not established | Existing test inventory | Runtime correctness unverified |

These are implementation findings and potential defects, not confirmed production incidents.

## TASK 007 — FINAL STATUS
PASS — Abandonment classification architecture fully mapped.
The classification implementation, scheduling, eligibility conditions, timestamp model, completion safeguards, persistence strategy, concurrency controls, historical-sync interaction, operational dependencies, error handling, and existing test coverage have been documented.

Production alignment: Confirmed against the live Render backend revision.

Runtime validation: Not performed. The PASS status means the architectural inspection is complete, not that the abandonment system has passed end-to-end production testing.

Changes made
None.

No code changes, database writes, migrations, deployments, scheduler executions, or Shopify operations were performed.

The task remained strictly read-only, as required by your engineering directive.

Revluma MVP Progress: 7 / 406 Tasks
TASK 007 — Completed.

Next in line: TASK 008 — Map historical Shopify synchronization job
Objective: Inspect how Revluma imports historical Shopify orders, customers, products, and abandoned checkouts; how pagination and timestamps work; how records are deduplicated; and how historical purchases are reconciled.

Task 008 has not been started.
