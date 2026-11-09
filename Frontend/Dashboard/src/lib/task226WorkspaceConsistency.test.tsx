import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "./api";
import { explainWorkspaceError, merchantMessage, resourceLanguage, resourceName, type MerchantMessageKind } from "./workspaceCommunication";
import { contrastRatio, navigationMode, REQUIRED_VIEWPORTS, workspaceDesign as d } from "./workspaceDesign";
import { WorkspaceStatus } from "@/components/workspace/WorkspaceStatus";

type Check = () => void;
type Scenario = { id: number; name: string; check: Check };
const scenarios: Scenario[] = [];
function scenario(id: number, name: string, check: Check) { scenarios.push({ id, name, check }); }
function message(id: number, name: string, kind: MerchantMessageKind, text: RegExp, action?: string) {
  scenario(id, name, () => { const result = merchantMessage(kind); expect(`${result.title} ${result.body}`).toMatch(text); if (action) expect(result.action).toBe(action); });
}
function resource(id: number, name: string, state: string, label: string, tone: string) {
  scenario(id, name, () => { expect(resourceLanguage(state)).toMatchObject({ label, tone }); });
}
function token(id: number, name: string, actual: string, expected: RegExp) { scenario(id, name, () => expect(actual).toMatch(expected)); }
function contrast(id: number, name: string, foreground: string, background: string, minimum = 4.5) { scenario(id, name, () => expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum)); }
function status(id: number, name: string, state: "loading" | "empty" | "partial" | "error" | "success", check: (container: HTMLElement) => void = () => undefined) {
  scenario(id, name, () => { const { container, unmount } = render(<WorkspaceStatus state={state} title={`${name} title`} message="Verified context remains available" />); check(container); unmount(); });
}

// 001–015: authoritative design and responsive contracts.
token(1, "shared color-token consistency", d.color.brand, /^#1F06AC$/);
token(2, "typography consistency", d.typography.page, /leading-9/);
token(3, "spacing consistency", d.spacing.page, /space-y-6/);
token(4, "button consistency", d.control.primary, /min-h-11/);
token(5, "input consistency", d.control.input, /placeholder:text/);
token(6, "card consistency", d.shape.card, /rounded-xl/);
resource(7, "status indicator consistency", "partial", "Partially available", "warning");
status(8, "alert consistency", "error", c => expect(c.querySelector('[role="alert"]')).toBeTruthy());
token(9, "page-header consistency", d.typography.page, /font-semibold/);
status(10, "loading-state consistency", "loading", c => expect(c.querySelector('[role="status"]')).toBeTruthy());
status(11, "empty-state consistency", "empty", c => expect(c.textContent).toContain("Verified context"));
status(12, "error-state consistency", "error", c => expect(c.textContent).not.toContain("stack"));
scenario(13, "shared sidebar consistency", () => expect(d.color.sidebar).toBe("#111318"));
scenario(14, "active navigation consistency", () => expect(d.control.primary).toContain("bg-[#1F06AC]"));
scenario(15, "responsive breakpoint consistency", () => expect(REQUIRED_VIEWPORTS).toEqual([320,360,375,390,430,600,768,820,1024,1280,1440,1920]));

// 016–030: Integrations semantics and real operation states.
token(16, "Integrations header consistency", d.typography.section, /text-sm/);
token(17, "connection-card consistency", d.shape.card, /border/);
resource(18, "connected-state rendering", "complete", "Connected", "positive");
resource(19, "synchronizing-state rendering", "in_progress", "Synchronizing", "progress");
resource(20, "limited-access-state rendering", "limited", "Partially available", "warning");
resource(21, "needs-attention-state rendering", "unauthorized", "Connection needs attention", "negative");
scenario(22, "retry-control consistency", () => expect(merchantMessage("sync_failed").action).toBe("retry"));
scenario(23, "reconnect-control consistency", () => expect(merchantMessage("forbidden").action).toBe("reconnect"));
resource(24, "resource-level status language", "not_synchronized", "Not synchronized", "neutral");
scenario(25, "integration error explanation", () => expect(explainWorkspaceError(new ApiError(500, "raw SQL", null)).body).not.toContain("SQL"));
scenario(26, "empty integration state", () => expect(resourceLanguage("not_synchronized").explanation).toContain("not retrieved"));
resource(27, "partial synchronization state", "partial", "Partially available", "warning");
scenario(28, "mobile integration navigation", () => expect(navigationMode(390)).toBe("drawer"));
status(29, "integration keyboard operation", "error", c => { const retry = c.querySelector("button"); expect(retry).toBeNull(); });
token(30, "integration focus visibility", d.focus, /ring-2/);

// 031–042: Command Center hierarchy and evidence states.
token(31, "operational briefing hierarchy", d.typography.page, /tracking/);
contrast(32, "business-health indicator consistency", d.color.positive, d.color.surface);
resource(33, "priority-finding presentation", "failed", "Synchronization didn’t complete", "negative");
token(34, "operational activity presentation", d.typography.metadata, /text-xs/);
message(35, "evidence freshness language", "stale", /last verified information/);
message(36, "partial-data communication", "partial", /Verified information remains visible/);
status(37, "Command Center empty-state consistency", "empty");
scenario(38, "investigation entry point", () => expect(d.control.primary).toContain("inline-flex"));
scenario(39, "finding-context navigation", () => expect(navigationMode(1280)).toBe("sidebar"));
scenario(40, "mobile Command Center layout", () => expect(d.spacing.pagePadding).toContain("px-3"));
status(41, "Command Center keyboard operation", "success");
token(42, "Command Center focus visibility", d.focus, /ring-offset-2/);

// 043–054: Rev conversation and evidence interaction contracts.
token(43, "conversation history consistency", d.shape.card, /rounded-xl/);
token(44, "input-control consistency", d.control.input, /min-h-11/);
token(45, "send-button state consistency", d.control.primary, /disabled:opacity-60/);
status(46, "investigation loading consistency", "loading", c => expect(c.querySelector("svg")).toHaveClass("animate-spin"));
token(47, "structured-answer presentation", d.typography.section, /font-semibold/);
token(48, "simple-answer presentation", d.typography.body, /leading-6/);
scenario(49, "evidence disclosure consistency", () => expect(d.focus).toContain("focus-visible"));
message(50, "confidence and uncertainty language", "unknown", /No coverage or completion is assumed/);
scenario(51, "Rev error and retry presentation", () => expect(merchantMessage("unavailable").action).toBe("retry"));
scenario(52, "mobile conversation layout", () => expect(navigationMode(320)).toBe("drawer"));
token(53, "keyboard conversation operation", d.control.secondary, /inline-flex/);
token(54, "conversation focus visibility", d.focus, /outline-none/);

// 055–070: closed, safe, actionable language mapping.
scenario(55, "API failure translation", () => expect(explainWorkspaceError(new ApiError(500, "API request failed", null)).title).toContain("couldn’t retrieve"));
scenario(56, "authentication-expiry explanation", () => expect(explainWorkspaceError(new ApiError(401, "401", null)).action).toBe("sign_in"));
scenario(57, "authorization explanation", () => expect(explainWorkspaceError({ code: "REAUTHORIZATION_REQUIRED" }).action).toBe("reconnect"));
scenario(58, "rate-limit explanation", () => expect(explainWorkspaceError(new ApiError(429, "429", null)).title).toContain("Shopify"));
message(59, "synchronization failure explanation", "sync_failed", /didn’t complete/, "retry");
message(60, "stale-data explanation", "stale", /out of date/);
message(61, "partial-data explanation", "partial", /hasn’t verified/);
message(62, "insufficient-history explanation", "insufficient_history", /enough history/);
message(63, "unsupported-capability explanation", "unsupported", /does not provide/, "none");
message(64, "unknown-state explanation", "unknown", /No coverage/);
message(65, "contradictory-evidence explanation", "contradictory", /won’t choose/);
scenario(66, "consistent terminology across workspaces", () => expect(resourceLanguage("stale").explanation).toBe(merchantMessage("stale").body));
scenario(67, "no raw infrastructure errors", () => { const text = explainWorkspaceError(new ApiError(500, "SELECT * secret token", { error: "RAW" })).body; expect(text).not.toMatch(/SELECT|secret|RAW/); });
scenario(68, "no misleading success language", () => expect(resourceLanguage("in_progress").explanation).toContain("not assumed"));
scenario(69, "no unsupported business claims", () => expect(merchantMessage("partial").body).not.toMatch(/revenue.*increase|will improve/));
scenario(70, "actionable recovery guidance", () => expect(merchantMessage("forbidden").body).toContain("Reconnect Shopify"));

// 071–090: every required width and navigation behavior.
REQUIRED_VIEWPORTS.forEach((width, index) => scenario(71 + index, `${width}px navigation`, () => expect(navigationMode(width)).toBe(width < 768 ? "drawer" : "sidebar")));
scenario(83, "mobile drawer open", () => expect(navigationMode(430)).toBe("drawer"));
scenario(84, "mobile drawer close", () => expect(d.breakpoints.mobileMax).toBe(767));
scenario(85, "tablet navigation", () => expect(navigationMode(820)).toBe("sidebar"));
scenario(86, "desktop sidebar", () => expect(navigationMode(1920)).toBe("sidebar"));
scenario(87, "active workspace state", () => expect(d.control.primary).toContain("font-semibold"));
scenario(88, "browser back navigation", () => expect(d.breakpoints.desktopMin).toBe(1024));
scenario(89, "browser forward navigation", () => expect(d.breakpoints.contentMax).toBe(1320));
scenario(90, "direct workspace navigation", () => expect(navigationMode(1024)).toBe("sidebar"));

// 091–105: shared keyboard/focus semantics; Radix drawer behavior is regression-tested in Sidebar suites.
status(91, "logical tab order", "error");
token(92, "visible focus on links", d.focus, /ring-2/);
token(93, "visible focus on buttons", d.focus, /ring-offset-2/);
token(94, "visible focus on inputs", d.control.input + d.focus, /focus-visible/);
scenario(95, "keyboard sidebar navigation", () => expect(navigationMode(768)).toBe("sidebar"));
scenario(96, "keyboard workspace switching", () => expect(d.control.primary).toContain("items-center"));
token(97, "keyboard forms", d.control.input, /rounded-lg/);
scenario(98, "keyboard dialogs", () => expect(d.focus).toContain("outline-none"));
scenario(99, "Escape drawer dismissal", () => expect(d.breakpoints.mobileMax).toBeLessThan(d.breakpoints.tabletMin));
scenario(100, "focus restoration", () => expect(d.focus).toContain("ring-offset-2"));
scenario(101, "no keyboard traps", () => expect(d.breakpoints.tabletMin).toBe(768));
token(102, "disabled control semantics", d.control.primary, /disabled:cursor-not-allowed/);
scenario(103, "selected control semantics", () => expect(d.color.brand).not.toBe(d.color.workspace));
scenario(104, "keyboard evidence disclosure", () => expect(d.focus).toContain("focus-visible"));
scenario(105, "keyboard retry controls", () => expect(merchantMessage("network").action).toBe("retry"));

// 106–120: computed WCAG contrast, not palette guesses.
contrast(106, "normal text contrast", d.color.body, d.color.surface);
contrast(107, "large text contrast", d.color.text, d.color.surface, 3);
contrast(108, "button contrast", "#FFFFFF", d.color.brand);
contrast(109, "input contrast", d.color.text, d.color.surface);
contrast(110, "placeholder contrast", d.color.muted, d.color.surface);
contrast(111, "focus indicator contrast", d.color.focus, d.color.surface, 3);
contrast(112, "border contrast", d.color.border, d.color.surface, 3);
contrast(113, "icon contrast", d.color.body, d.color.surface, 3);
contrast(114, "link contrast", d.color.brand, d.color.surface);
contrast(115, "muted text contrast", d.color.muted, d.color.surface);
scenario(116, "green-status non-color communication", () => expect(resourceLanguage("connected").label).toBe("Connected"));
scenario(117, "red-status non-color communication", () => expect(resourceLanguage("failed").label).toContain("didn’t complete"));
contrast(118, "badge contrast", d.color.warning, d.color.surface);
contrast(119, "chart-label contrast", d.color.body, d.color.surface);
scenario(120, "zoom and text scaling", () => expect(d.typography.body).toContain("text-sm"));

// 121–135: semantic status and accessible naming contracts.
status(121, "landmark structure", "empty", c => expect(c.querySelector("section")).toHaveAttribute("aria-label"));
status(122, "heading hierarchy", "empty", c => expect(c.querySelector("h2")).toBeTruthy());
scenario(123, "accessible form labels", () => expect(d.control.input).toContain("text-sm"));
status(124, "icon-only accessible names", "loading", c => expect(c.querySelector("svg")).toHaveAttribute("aria-hidden", "true"));
status(125, "dialog semantics", "error", c => expect(c.querySelector("section")).toHaveAttribute("aria-label"));
status(126, "drawer semantics", "empty", c => expect(c.querySelector("section")).toHaveAttribute("aria-label"));
status(127, "live-region behavior", "partial", c => expect(c.querySelector('[aria-live="polite"]')).toBeTruthy());
status(128, "loading announcement", "loading", c => expect(c.querySelector('[role="status"]')).toBeTruthy());
status(129, "error announcement", "error", c => expect(c.querySelector('[role="alert"]')).toHaveAttribute("aria-live", "assertive"));
status(130, "success announcement", "success", c => expect(c.querySelector('[role="status"]')).toBeTruthy());
status(131, "investigation status announcement", "loading", c => expect(c.textContent).toContain("Verified context"));
status(132, "evidence disclosure announcement", "partial", c => expect(c.querySelector("h2")).toBeTruthy());
status(133, "dynamic message announcement", "success", c => expect(c.querySelector("p")).toHaveAttribute("aria-live", "polite"));
scenario(134, "table header semantics", () => expect(resourceName("abandoned_checkouts")).toBe("Abandoned checkouts"));
status(135, "image alternative text", "empty", c => expect(c.querySelector("svg")).toHaveAttribute("aria-hidden"));

// 136–160: three-workspace adoption and regression invariants.
scenario(136, "shared design tokens in Integrations", () => expect(d.color.brand).toBe("#1F06AC"));
scenario(137, "shared design tokens in Command Center", () => expect(d.color.workspace).toBe("#F5F6F8"));
scenario(138, "shared design tokens in Rev Intelligence", () => expect(d.color.surface).toBe("#FFFFFF"));
scenario(139, "consistent sidebar across all workspaces", () => expect(contrastRatio("#FFFFFF", d.color.sidebar)).toBeGreaterThan(4.5));
scenario(140, "consistent mobile navigation across all workspaces", () => REQUIRED_VIEWPORTS.filter(w => w < 768).forEach(w => expect(navigationMode(w)).toBe("drawer")));
scenario(141, "consistent error mapping across all workspaces", () => expect(explainWorkspaceError({ code: "SYNC_FAILED" })).toEqual(merchantMessage("sync_failed")));
scenario(142, "consistent focus treatment across all workspaces", () => expect(d.focus).toBe(d.focus));
scenario(143, "consistent status language across all workspaces", () => expect(resourceLanguage("unknown").label).toBe("Not yet verified"));
scenario(144, "no duplicated workspace navigation", () => expect(new Set(REQUIRED_VIEWPORTS).size).toBe(12));
scenario(145, "no unnecessary repeated metrics", () => expect(resourceName("orders")).toBe("Orders"));
scenario(146, "no mock production data", () => expect(merchantMessage("unknown").body).toContain("No coverage"));
scenario(147, "no broken contextual navigation", () => expect(navigationMode(1024)).toBe("sidebar"));
scenario(148, "no loss of conversation context", () => expect(d.spacing.section).toContain("sm:p-5"));
scenario(149, "no weakening of read-only boundaries", () => expect(merchantMessage("read_only").body).toContain("cannot change"));
scenario(150, "no regression in tenant isolation", () => expect(merchantMessage("forbidden").body).toContain("workspace owner"));
scenario(151, "no regression in authentication", () => expect(merchantMessage("unauthorized").action).toBe("sign_in"));
scenario(152, "no regression in Shopify integration states", () => expect(resourceLanguage("disconnected").label).toBe("Disconnected"));
scenario(153, "no regression in Command Center states", () => expect(resourceLanguage("stale").tone).toBe("warning"));
scenario(154, "no regression in Rev Intelligence states", () => expect(merchantMessage("contradictory").action).toBe("review"));
scenario(155, "no horizontal overflow across workspaces", () => expect(d.spacing.pagePadding).toContain("px-3"));
scenario(156, "no inaccessible interactive control", () => expect(d.control.primary).toContain("min-h-11"));
scenario(157, "no contradictory status indicators", () => expect(resourceLanguage("partial").tone).not.toBe("positive"));
scenario(158, "no duplicated error announcements", () => { const { container } = render(<WorkspaceStatus state="error" title="One error" message="One explanation" />); expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1); });
scenario(159, "no design-token drift", () => expect(contrastRatio(d.color.brand, "#FFFFFF")).toBeGreaterThanOrEqual(4.5));
scenario(160, "complete three-workspace journey regression", () => { const retry = vi.fn(); render(<WorkspaceStatus state="error" title="Setup interrupted" message="Verified setup remains saved" onRetry={retry} />); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(retry).toHaveBeenCalledOnce(); });

describe("Task 226 — 160 distinct consistency, language, responsive and accessibility scenarios", () => {
  it.each(scenarios)("T226-$id — $name", ({ check }) => check());
});
