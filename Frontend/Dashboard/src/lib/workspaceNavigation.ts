// Task 225 — bounded local navigation only. Never carry access tokens, OAuth
// parameters, evidence payloads, or arbitrary external URLs in route state.
const RETURN_PARAM = "return_to";
const COMMAND_CENTER = "/dashboard/overview";

export function safeWorkspaceRoute(value: string | null | undefined): string {
  if (!value) return COMMAND_CENTER;
  try {
    const parsed = new URL(value, "https://workspace.invalid");
    if (parsed.origin !== "https://workspace.invalid" || parsed.pathname !== COMMAND_CENTER) return COMMAND_CENTER;
    // Only view/navigation hints survive. Finding context is revalidated by the
    // server on every investigation, never trusted because it came from a URL.
    const safe = new URLSearchParams();
    const finding = parsed.searchParams.get("finding");
    if (finding && /^[0-9a-f-]{36}$/i.test(finding)) safe.set("finding", finding);
    const section = parsed.searchParams.get("section");
    if (section && /^(priority|activity|evidence|health)$/.test(section)) safe.set("section", section);
    return `${COMMAND_CENTER}${safe.size ? `?${safe}` : ""}${parsed.hash && /^#[a-z-]{1,40}$/.test(parsed.hash) ? parsed.hash : ""}`;
  } catch { return COMMAND_CENTER; }
}

export function investigationRoute(route: string, commandCenterLocation: string): string {
  const parsed = new URL(route, "https://workspace.invalid");
  if (parsed.origin !== "https://workspace.invalid" || parsed.pathname !== "/dashboard/rev-intell") return "/dashboard/rev-intell";
  const finding = parsed.searchParams.get("finding");
  const result = new URLSearchParams();
  if (finding && finding.length <= 100) result.set("finding", finding);
  result.set(RETURN_PARAM, safeWorkspaceRoute(commandCenterLocation));
  return `${parsed.pathname}?${result}`;
}

export function commandCenterReturnRoute(search: string): string {
  return safeWorkspaceRoute(new URLSearchParams(search).get(RETURN_PARAM));
}

/** Preserve only the sanitized return hint when Rev changes conversation URLs. */
export function revConversationRoute(conversationId: string | null, findingId: string | null, returnHint: string | null): string {
  const params = new URLSearchParams();
  if (findingId !== null) params.set("finding", findingId);
  if (returnHint !== null) params.set(RETURN_PARAM, safeWorkspaceRoute(returnHint));
  const path = conversationId ? `/dashboard/rev-intell/${encodeURIComponent(conversationId)}` : "/dashboard/rev-intell";
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}
