export function resolveDashboardRoute(path: string): string {
    const trimmed = (path ?? "").trim();
    if (!trimmed) return "/dashboard/overview";
    if (trimmed === "/dashboard" || trimmed === "/dashboard/") return "/dashboard/overview";
    if (trimmed.startsWith("/dashboard")) return trimmed;
    if (trimmed.startsWith("/")) return `/dashboard${trimmed}`;
    return `/dashboard/${trimmed.replace(/^\/+/, "")}`;
}
