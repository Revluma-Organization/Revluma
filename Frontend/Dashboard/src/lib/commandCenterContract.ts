import type { CommandCenterData, CommandCenterResponse } from "@/components/command-center/types";

/** Accept only a complete, current-tenant briefing; never reinterpret malformed data as empty. */
export function parseCommandCenterResponse(
  response: CommandCenterResponse | null | undefined,
  organizationId: string | null,
): CommandCenterData | null {
  const next = response?.data;
  if (response?.success !== true || next?.contract_version !== "command-center-v1") return null;
  if (typeof next.context?.organization_id !== "string" || !next.context.organization_id) return null;
  if (organizationId !== null && next.context.organization_id !== organizationId) return null;
  if (!next.briefing || !Array.isArray(next.metrics) || !Array.isArray(next.findings) ||
    !Array.isArray(next.evidence?.resources)) return null;
  return next;
}
