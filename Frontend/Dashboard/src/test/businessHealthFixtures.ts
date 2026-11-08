// Task 218 — minimal valid fixtures for rev-business-health-v1 and
// rev-operational-activity-v1, shared by the panel tests and the Command
// Center page test (whose page-level API mock must answer the store-scoped
// Task 218 routes with contract-shaped payloads).
//
// Values are illustrative test data only. Note: no text in these fixtures may
// collide with the Task 216 page assertions (e.g. the exact word "system" or
// the amount "$18,420.00").

import type { BusinessHealthContract, OperationalActivityContract } from "@/lib/businessHealth";

const indicator = (extra: Record<string, unknown>) => ({
  id: "indicator",
  category: "revenue",
  status: "healthy",
  data_quality: "complete",
  title: "Revenue health",
  explanation: "Revenue is steady versus the previous 7 days.",
  value: 0,
  comparison_value: 0,
  change_pct: 0,
  metric_definition: "Illustrative metric definition.",
  currency: null,
  reporting_period: { label: "Last 7 days", start: "2026-11-01T00:00:00Z", end: "2026-11-08T00:00:00Z" },
  comparison_period: { label: "Previous 7 days", start: "2026-10-25T00:00:00Z", end: "2026-11-01T00:00:00Z" },
  timezone: "UTC",
  source_evidence: ["orders"],
  last_verified_at: "2026-11-08T11:50:00Z",
  freshness: "complete",
  coverage: {
    complete: true,
    data_quality: "complete",
    reason: "All required domains are fresh.",
    domains: [{ domain: "orders", state: "succeeded", freshness: "fresh", usable: true, last_succeeded_at: "2026-11-08T11:50:00Z" }],
  },
  confidence: null,
  limitations: [],
  next_step: null,
  status_changed_at: "2026-11-08T12:00:00Z",
  value_components: null,
  ...extra,
});

export function businessHealthFixture(extra: Record<string, unknown> = {}): BusinessHealthContract {
  return {
    contract_version: "rev-business-health-v1",
    organization_id: "merchant-a",
    store_id: "store-1",
    shop_domain: "revluma-test-store-v1.myshopify.com",
    generated_at: "2026-11-08T12:00:00Z",
    reporting_period: {
      current: { label: "Last 7 days", start: "2026-11-01T00:00:00Z", end: "2026-11-08T00:00:00Z" },
      comparison: { label: "Previous 7 days", start: "2026-10-25T00:00:00Z", end: "2026-11-01T00:00:00Z" },
      timezone: "UTC",
      period_basis: "rolling_7d_utc",
    },
    business_status: "healthy",
    business_status_explanation: "The most severe supported business state across complete indicators is healthy.",
    indicators: [
      indicator({ id: "revenue_health", category: "revenue", title: "Revenue health", value: 42510.5, comparison_value: 44840, change_pct: -5.2, currency: "USD", value_components: { gross: 44010.5, refunds: 1500, net: 42510.5, order_count: 312 }, source_evidence: ["orders", "order_refunds"] }),
      indicator({ id: "orders_health", category: "orders", title: "Orders health", value: 312, comparison_value: 337, change_pct: -7.4, source_evidence: ["orders"] }),
      indicator({ id: "checkout_health", category: "checkouts", title: "Checkout health", value: 9, comparison_value: 6, change_pct: 50, conversion_rate: 76.9, value_components: { abandoned_count: 9, completed_count: 31, at_risk_value: 1230.4 }, source_evidence: ["abandoned_carts"] }),
      indicator({ id: "product_availability_health", category: "product_availability", title: "Product availability health", value: 1180, change_pct: null, source_evidence: ["products", "inventory"] }),
      indicator({ id: "integration_health", category: "integration", title: "Integration health", value: "connected", change_pct: null, source_evidence: ["integration_state"] }),
    ],
    by_category: {},
    data_quality: { complete: ["revenue", "orders", "checkouts", "product_availability", "integration"], partial: [], stale: [], unavailable: [], unsupported: [], unknown: [] },
    affected_indicators_note: null,
    ...extra,
  } as BusinessHealthContract;
}

export function operationalActivityFixture(extra: Record<string, unknown> = {}): OperationalActivityContract {
  return {
    contract_version: "rev-operational-activity-v1",
    organization_id: "merchant-a",
    store_id: "store-1",
    shop_domain: "revluma-test-store-v1.myshopify.com",
    generated_at: "2026-11-08T12:00:00Z",
    window_days: 14,
    total: 2,
    returned: 2,
    has_more: false,
    next_cursor: null,
    limit: 15,
    items: [
      {
        event_id: "lifecycle:orders:succeeded:2026-11-08T11:50:00Z",
        type: "sync",
        category: "sync",
        severity: "info",
        title: "Synchronization completed for orders",
        detail: "",
        status: "succeeded",
        occurred_at: "2026-11-08T11:50:00Z",
        received_at: "2026-11-08T11:50:02Z",
        source: "store_sync_domain_states",
        link: "/integrations",
      },
      {
        event_id: "finding:abc",
        type: "finding",
        category: "finding",
        severity: "warning",
        title: "Net sales declined",
        detail: "finding type: revenue_change",
        status: "open",
        occurred_at: "2026-11-07T09:00:00Z",
        received_at: "2026-11-07T09:00:05Z",
        source: "intelligence_findings",
        link: "/findings",
      },
    ],
    ...extra,
  } as OperationalActivityContract;
}
