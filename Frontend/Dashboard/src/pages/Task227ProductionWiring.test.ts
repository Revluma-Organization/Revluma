import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveApiBaseUrl, createRequestId } from "@/lib/api";
import { resolveProfileMembership, storedOrganizationId, type ProfileMembership } from "@/lib/auth/organization";
import { normalizeIntegrationState } from "@/lib/integrationState";
import { parseCommandCenterResponse } from "@/lib/commandCenterContract";
import {
  UNKNOWN_STORE, buildStarters, hasWebhookGap, isSyncIncomplete, isSyncStale,
  storeContextFromResponse, storeLabel, type StoreContext,
} from "@/lib/revStoreContext";
import { commandCenterReturnRoute, investigationRoute, safeWorkspaceRoute } from "@/lib/workspaceNavigation";
import { shouldRetryWorkspaceQuery } from "@/lib/queryClient";
import { explainWorkspaceError } from "@/lib/workspaceCommunication";
import { contrastRatio, navigationMode, workspaceDesign } from "@/lib/workspaceDesign";

const member = (id: string, status = "active"): ProfileMembership => ({
  id: `membership-${id}`, role: "owner", organization_id: id, status,
  joined_at: null, organizations: { id, company_name: id },
});

describe("T227 API configuration and contracts — 20 scenarios", () => {
  it.each([
    ["trims and preserves the versioned production base", " https://api.example.com/api/v1/ ", "https://api.example.com/api/v1"],
    ["adds the version suffix to an origin", "https://api.example.com", "https://api.example.com/api/v1"],
    ["adds the version suffix to a service path", "https://example.com/backend", "https://example.com/backend/api/v1"],
    ["preserves an explicit port in development", "http://localhost:8000/api/v1", "http://localhost:8000/api/v1", false],
    ["allows non-production loopback", "http://127.0.0.1:8000", "http://127.0.0.1:8000/api/v1", false],
    ["uses the development default", undefined, "http://localhost:8000/api/v1", false],
    ["accepts the live Render API target", "https://revluma-backend-vrsd.onrender.com/api/v1", "https://revluma-backend-vrsd.onrender.com/api/v1"],
  ])("%s", (_name, raw, expected, production = true) => {
    expect(resolveApiBaseUrl(raw, production)).toBe(expected);
  });
  it.each([
    ["rejects an absent production target", undefined],
    ["rejects an empty production target", "   "],
    ["rejects production HTTP", "http://api.example.com"],
    ["rejects production localhost", "https://localhost/api/v1"],
    ["rejects production IPv4 loopback", "https://127.0.0.1/api/v1"],
    ["rejects production IPv6 loopback", "https://[::1]/api/v1"],
    ["rejects non-HTTP schemes", "ftp://api.example.com"],
    ["rejects embedded username", "https://merchant@api.example.com"],
    ["rejects embedded password", "https://user:secret@api.example.com"],
    ["rejects query parameters", "https://api.example.com/api/v1?token=secret"],
    ["rejects fragments", "https://api.example.com/api/v1#secret"],
    ["rejects malformed URLs", "not a URL"],
  ])("%s", (_name, raw) => {
    expect(() => resolveApiBaseUrl(raw, true)).toThrow();
  });
  it("creates a non-empty correlation identifier without merchant data", () => {
    expect(createRequestId()).toMatch(/^[a-zA-Z0-9-]+$/);
  });
});

describe("T227 authentication and tenant restoration — 25 scenarios", () => {
  afterEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it.each([
    ["selects the requested active membership", [member("a"), member("b")], "b", "b"],
    ["does not substitute another tenant", [member("a")], "b", undefined],
    ["does not choose an inactive requested tenant", [member("a", "invited")], "a", undefined],
    ["does not choose a suspended requested tenant", [member("a", "suspended")], "a", undefined],
    ["automatically selects one active tenant when unspecified", [member("a")], undefined, "a"],
    ["does not choose between two active tenants", [member("a"), member("b")], undefined, undefined],
    ["does not auto-select an empty membership list", [], undefined, undefined],
    ["does not auto-select only invited memberships", [member("a", "invited")], undefined, undefined],
    ["requires selection when server returns null", [member("a")], null, undefined],
    ["uses the sole active among inactive memberships", [member("a"), member("b", "invited")], undefined, "a"],
    ["treats a missing status as active for legacy membership", [{ ...member("a"), status: undefined }], undefined, "a"],
    ["rejects a blank requested organization", [member("a")], "", undefined],
  ])("%s", (_name, memberships, selected, expected) => {
    expect(resolveProfileMembership(memberships, selected)?.organization_id).toBe(expected);
  });
  const jwt = (tenantId: string) => `x.${btoa(JSON.stringify({ tenantId }))}.y`;
  it.each([
    ["reads the Zustand tenant", { user: { tenant_id: "tenant-z" } }, "tenant-z"],
    ["reads the active organization fallback", { user: { active_organization_id: "tenant-a" } }, "tenant-a"],
    ["prefers tenant ID over active organization", { user: { tenant_id: "tenant-z", active_organization_id: "tenant-a" } }, "tenant-z"],
    ["reads a legacy JWT tenant hint", { accessToken: jwt("tenant-jwt") }, "tenant-jwt"],
    ["reads a legacy CSRF-token tenant hint", { csrfToken: jwt("tenant-csrf") }, "tenant-csrf"],
    ["ignores malformed token claims", { accessToken: "bad.token.value" }, undefined],
    ["ignores a token without tenant claims", { accessToken: jwt("") }, undefined],
    ["ignores an empty tenant", { user: { tenant_id: "" } }, undefined],
    ["ignores a non-string tenant", { user: { tenant_id: 42 } }, undefined],
    ["ignores unrelated persisted state", { user: { name: "Merchant" } }, undefined],
  ])("%s", (_name, state, expected) => {
    localStorage.setItem("rv-auth", JSON.stringify({ state }));
    expect(storedOrganizationId()).toBe(expected);
  });
  it.each([
    ["uses session storage when local storage has no session", "session"],
    ["prefers local storage over stale session state", "local"],
    ["ignores corrupt local JSON and uses valid session state", "corrupt"],
  ])("%s", (_name, mode) => {
    if (mode === "local") localStorage.setItem("rv-auth", JSON.stringify({ state: { user: { tenant_id: "local" } } }));
    if (mode === "corrupt") localStorage.setItem("rv-auth", "{");
    sessionStorage.setItem("rv-auth", JSON.stringify({ state: { user: { tenant_id: "session" } } }));
    expect(storedOrganizationId()).toBe(mode === "local" ? "local" : "session");
  });
});

const integrationFixture = () => ({
  contract_version: "rev-integration-state-v1", organization_id: "org-a", integration_id: "store-a",
  store: { id: "store-a", shop_domain: "revluma-test-store-v1.myshopify.com", provider: "shopify" },
  overall_status: "connected", status_reason: "verified", status_explanation: "Verified",
  merchant_action_required: false, recommended_next_step: null,
  authorization: { verification: "verified", valid: true, verified: true, missing_app_scopes: [] },
  synchronization: { state: "complete", running_domains: [], failed_domains: [], partial_domains: [] },
  evaluated_at: "2026-11-06T00:00:00Z",
});
describe("T227 Integrations contract — 15 scenarios", () => {
  it("accepts the active-store verified read-only state", () => {
    expect(normalizeIntegrationState(integrationFixture())?.store.shop_domain).toBe("revluma-test-store-v1.myshopify.com");
  });
  it.each([
    ["missing payload", null],
    ["array instead of object", []],
    ["unknown contract version", { ...integrationFixture(), contract_version: "v2" }],
    ["unknown overall state", { ...integrationFixture(), overall_status: "healthy" }],
    ["missing store identity", { ...integrationFixture(), store: { provider: "shopify" } }],
    ["missing authorization evidence", { ...integrationFixture(), authorization: null }],
    ["non-boolean authorization verification", { ...integrationFixture(), authorization: { verified: "yes", missing_app_scopes: [] } }],
    ["missing synchronization evidence", { ...integrationFixture(), synchronization: null }],
    ["invalid running-domain list", { ...integrationFixture(), synchronization: { state: "complete", running_domains: [null], failed_domains: [], partial_domains: [] } }],
    ["invalid failed-domain list", { ...integrationFixture(), synchronization: { state: "complete", running_domains: [], failed_domains: "orders", partial_domains: [] } }],
    ["invalid partial-domain list", { ...integrationFixture(), synchronization: { state: "complete", running_domains: [], failed_domains: [], partial_domains: [1] } }],
    ["invalid scope list", { ...integrationFixture(), authorization: { verified: true, missing_app_scopes: [null] } }],
    ["embedded access token", { ...integrationFixture(), status_explanation: "access_token=secret" }],
    ["embedded Shopify credential", { ...integrationFixture(), status_explanation: "shpat_abcdefgh" }],
  ])("fails closed for %s", (_name, payload) => {
    expect(normalizeIntegrationState(payload)).toBeNull();
  });
});

const commandFixture = () => ({
  success: true,
  data: {
    contract_version: "command-center-v1", retrieved_at: "2026-11-06T00:00:00Z",
    context: { organization_id: "org-a" }, briefing: { headline: "Briefing" },
    metrics: [], findings: [], evidence: { resources: [] },
  },
});
describe("T227 Command Center runtime contract — 20 scenarios", () => {
  it.each([
    ["accepts a complete briefing in the active tenant", commandFixture(), "org-a", true],
    ["accepts a complete briefing before tenant hydration", commandFixture(), null, true],
    ["rejects a mismatched tenant", commandFixture(), "org-b", false],
    ["rejects an unsuccessful envelope", { ...commandFixture(), success: false }, "org-a", false],
    ["rejects a missing data block", { success: true }, "org-a", false],
    ["rejects null data", { success: true, data: null }, "org-a", false],
    ["rejects an unknown contract version", { success: true, data: { ...commandFixture().data, contract_version: "v2" } }, "org-a", false],
    ["rejects missing tenant context", { success: true, data: { ...commandFixture().data, context: null } }, "org-a", false],
    ["rejects a blank tenant", { success: true, data: { ...commandFixture().data, context: { organization_id: "" } } }, "org-a", false],
    ["rejects a numeric tenant", { success: true, data: { ...commandFixture().data, context: { organization_id: 42 } } }, "org-a", false],
    ["rejects a missing briefing", { success: true, data: { ...commandFixture().data, briefing: null } }, "org-a", false],
    ["rejects malformed metrics", { success: true, data: { ...commandFixture().data, metrics: {} } }, "org-a", false],
    ["rejects null metrics", { success: true, data: { ...commandFixture().data, metrics: null } }, "org-a", false],
    ["rejects malformed findings", { success: true, data: { ...commandFixture().data, findings: {} } }, "org-a", false],
    ["rejects null findings", { success: true, data: { ...commandFixture().data, findings: null } }, "org-a", false],
    ["rejects missing evidence", { success: true, data: { ...commandFixture().data, evidence: null } }, "org-a", false],
    ["rejects malformed evidence resources", { success: true, data: { ...commandFixture().data, evidence: { resources: {} } } }, "org-a", false],
    ["rejects null evidence resources", { success: true, data: { ...commandFixture().data, evidence: { resources: null } } }, "org-a", false],
    ["rejects a null response", null, "org-a", false],
    ["rejects an undefined response", undefined, "org-a", false],
  ])("%s", (_name, payload, organization, valid) => {
    expect(parseCommandCenterResponse(payload as never, organization) !== null).toBe(valid);
  });
});

const store = (extra: Record<string, unknown> = {}) => ({
  id: "store-a", platform: "shopify", shop_domain: "revluma-test-store-v1.myshopify.com",
  connection_status: "connected", sync_status: "complete", status: "active", ...extra,
});
const storeResponse = (stores: unknown[]) => ({ success: true, data: { data: { stores } } });
describe("T227 Rev Intelligence context and read-only behavior — 25 scenarios", () => {
  it.each([
    ["rejects unsuccessful responses", { success: false, data: { stores: [] } }],
    ["rejects missing stores", { success: true, data: {} }],
    ["rejects an object store collection", storeResponse({})],
    ["rejects null store collection", storeResponse(null)],
    ["rejects a string store collection", storeResponse("stores")],
    ["rejects a missing response", undefined],
  ])("%s", (_name, response) => {
    expect(() => storeContextFromResponse(response as never)).toThrow("not verifiable");
  });
  it.each([
    ["uses the active Shopify store", store(), "revluma-test-store-v1.myshopify.com"],
    ["ignores a disconnected WooCommerce record", store({ platform: "woocommerce", connection_status: "disconnected" }), "revluma-test-store-v1.myshopify.com"],
  ])("%s", (_name, other, expected) => {
    expect(storeContextFromResponse(storeResponse([other, store()])).shopDomain).toBe(expected);
  });
  it("returns a truthful no-store state for an empty collection", () => {
    expect(storeContextFromResponse(storeResponse([]))).toEqual({ ...UNKNOWN_STORE, loaded: true });
  });
  it("ignores non-Shopify-only collections", () => {
    expect(storeContextFromResponse(storeResponse([store({ platform: "woocommerce" })])).connected).toBe(false);
  });
  it("selects a connected store over a newer disconnected store", () => {
    const result = storeContextFromResponse(storeResponse([
      store({ id: "old", connection_status: "disconnected", updated_at: "2026-11-06" }),
      store({ id: "active", updated_at: "2026-01-01" }),
    ]));
    expect(result.connected).toBe(true);
  });
  it("selects complete sync over incomplete sync for equal connection state", () => {
    const result = storeContextFromResponse(storeResponse([
      store({ id: "partial", sync_status: "in_progress" }), store({ id: "complete", sync_status: "complete" }),
    ]));
    expect(result.syncStatus).toBe("complete");
  });
  it.each([
    ["pending synchronization", { syncStatus: "pending" }, isSyncIncomplete, true],
    ["in-progress synchronization", { syncStatus: "in_progress" }, isSyncIncomplete, true],
    ["completed synchronization", { syncStatus: "complete" }, isSyncIncomplete, false],
    ["missing webhook coverage", { webhooksRegistered: 1, webhooksRequired: 2 }, hasWebhookGap, true],
    ["disconnected-store webhook counts", { connected: false, webhooksRegistered: 0, webhooksRequired: 2 }, hasWebhookGap, false],
  ])("%s", (_name, changes, predicate, expected) => {
    expect(predicate({ ...UNKNOWN_STORE, loaded: true, connected: true, platform: "shopify", ...changes } as StoreContext)).toBe(expected);
  });
  it("detects a stale connected-store snapshot", () => {
    expect(isSyncStale({ ...UNKNOWN_STORE, connected: true, lastSyncedAt: "2020-01-01T00:00:00Z" })).toBe(true);
  });
  it("does not invent staleness for a disconnected store", () => {
    expect(isSyncStale({ ...UNKNOWN_STORE, connected: false, lastSyncedAt: "2020-01-01T00:00:00Z" })).toBe(false);
  });
  it("strips only the Shopify hostname suffix from labels", () => {
    expect(storeLabel({ ...UNKNOWN_STORE, shopDomain: "https://revluma-test-store-v1.myshopify.com/admin" })).toBe("revluma-test-store-v1");
  });
  it.each([
    ["load failure offers retry and capability help", { loadError: true }, "Retry"],
    ["no store offers connection help", { loaded: true }, "Connect"],
    ["pending sync offers freshness help", { loaded: true, connected: true, syncStatus: "in_progress" }, "Sync"],
    ["ready store offers business investigation", { loaded: true, connected: true, syncStatus: "complete" }, "Overview"],
    ["stale ready store prioritizes freshness", { loaded: true, connected: true, lastSyncedAt: "2020-01-01T00:00:00Z" }, "Freshness"],
  ])("%s", (_name, context, label) => {
    const starters = buildStarters({ ...UNKNOWN_STORE, ...context } as StoreContext);
    expect(starters[0].label).toBe(label);
    expect(starters.every(item => !/activate|send campaign|draft sequence/i.test(item.sub))).toBe(true);
  });
});

describe("T227 cross-workspace navigation and isolation — 15 scenarios", () => {
  it.each([
    ["preserves the Command Center default", null, "/dashboard/overview"],
    ["preserves the plain Command Center route", "/dashboard/overview", "/dashboard/overview"],
    ["preserves a valid finding handoff", "/dashboard/overview?finding=11111111-1111-4111-8111-111111111111", "/dashboard/overview?finding=11111111-1111-4111-8111-111111111111"],
    ["preserves allowed evidence section", "/dashboard/overview?section=evidence", "/dashboard/overview?section=evidence"],
    ["rejects an external return URL", "https://evil.example/phish", "/dashboard/overview"],
    ["rejects a protocol-relative return URL", "//evil.example/phish", "/dashboard/overview"],
    ["rejects another local application route", "/dashboard/rev-intell", "/dashboard/overview"],
    ["rejects malformed finding identifiers", "/dashboard/overview?finding=merchant-secret", "/dashboard/overview"],
    ["rejects unknown sections", "/dashboard/overview?section=admin", "/dashboard/overview"],
    ["drops javascript URLs", "javascript:alert(1)", "/dashboard/overview"],
    ["drops unsafe hashes", "/dashboard/overview#%3Cscript%3E", "/dashboard/overview"],
    ["preserves safe anchors", "/dashboard/overview#evidence", "/dashboard/overview#evidence"],
  ])("%s", (_name, input, expected) => expect(safeWorkspaceRoute(input)).toBe(expected));
  it("revalidates findings through a bounded investigation route", () => {
    expect(investigationRoute("/dashboard/rev-intell?finding=finding-a", "/dashboard/overview?section=evidence")).toContain("finding=finding-a");
  });
  it("does not carry an external investigation destination", () => {
    expect(investigationRoute("https://evil.example", "/dashboard/overview")).toBe("/dashboard/rev-intell");
  });
  it("returns only a sanitized Command Center destination", () => {
    expect(commandCenterReturnRoute("?return_to=https%3A%2F%2Fevil.example")).toBe("/dashboard/overview");
  });
});

describe("T227 failure and recovery — 15 scenarios", () => {
  it.each([
    ["retries a transport failure once", 0, { status: 0, message: "offline" }, true],
    ["retries rate limiting once", 0, { status: 429 }, true],
    ["retries a server failure once", 0, { status: 500 }, true],
    ["retries a gateway failure once", 0, { status: 503 }, true],
    ["does not retry caller cancellation", 0, { status: 0, message: "The request was cancelled." }, false],
    ["does not retry authentication", 0, { status: 401 }, false],
    ["does not retry authorization", 0, { status: 403 }, false],
    ["does not retry validation", 0, { status: 422 }, false],
    ["does not retry missing resources", 0, { status: 404 }, false],
    ["bounds transient retries to one", 1, { status: 500 }, false],
  ])("%s", (_name, count, error, expected) => expect(shouldRetryWorkspaceQuery(count, error)).toBe(expected));
  it.each([
    ["401 offers sign-in", { status: 401 }, "sign_in"],
    ["403 offers reconnect/access review", { status: 403 }, "reconnect"],
    ["429 requires waiting", { status: 429 }, "wait"],
    ["400 requires request review", { status: 400 }, "review"],
    ["503 offers retry without claiming success", { status: 503 }, "retry"],
  ])("%s", (_name, error, action) => {
    const message = explainWorkspaceError(error);
    expect(message.action).toBe(action);
    expect(message.body).not.toContain("secret");
  });
});

describe("T227 build, runtime and deployment configuration — 10 scenarios", () => {
  const vercel = JSON.parse(readFileSync("../../vercel.json", "utf8")) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    rewrites: Array<{ source: string; destination: string }>; outputDirectory: string; buildCommand: string;
  };
  const baseline = vercel.headers.find(item => item.source === "/(.*)")?.headers ?? [];
  it.each([
    "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security",
  ])("deploys the %s baseline header", key => expect(baseline.some(header => header.key === key)).toBe(true));
  it("builds the actual Dashboard package", () => expect(vercel.buildCommand).toContain("Frontend/Dashboard"));
  it("publishes the monorepo Frontend output", () => expect(vercel.outputDirectory).toBe("Frontend"));
  it("has one canonical login rewrite", () => expect(vercel.rewrites.filter(item => item.source === "/login")).toHaveLength(1));
  it("exposes request IDs through backend CORS", () => expect(readFileSync("../../Backend/src/app.js", "utf8")).toContain("exposedHeaders: ['X-Request-ID', 'Retry-After']"));
  it("keeps workspace design within a bounded content width", () => expect(workspaceDesign.breakpoints.contentMax).toBe(1320));
});

describe("T227 responsive navigation and accessible design tokens — 16 scenarios", () => {
  it.each([320, 375, 430, 600])("uses drawer navigation at %spx", width => expect(navigationMode(width)).toBe("drawer"));
  it.each([768, 1024, 1280, 1440, 1920])("uses persistent navigation at %spx", width => expect(navigationMode(width)).toBe("sidebar"));
  it.each([
    ["primary button", "#1F06AC", "#FFFFFF"],
    ["primary button hover", "#18058C", "#FFFFFF"],
    ["body text", "#344054", "#FFFFFF"],
    ["muted text", "#667085", "#FFFFFF"],
    ["positive text", "#067647", "#FFFFFF"],
    ["negative text", "#B42318", "#FFFFFF"],
  ])("meets AA text contrast for %s", (_name, foreground, background) => expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5));
  it("preserves 44px minimum control heights", () => {
    expect(`${workspaceDesign.control.primary} ${workspaceDesign.control.secondary} ${workspaceDesign.control.input}`).toContain("min-h-11");
  });
});
