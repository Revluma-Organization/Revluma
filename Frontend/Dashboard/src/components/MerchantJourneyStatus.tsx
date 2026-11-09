import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw, Store } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { explainWorkspaceError, resourceLanguage, resourceName } from "@/lib/workspaceCommunication";
import { workspaceDesign } from "@/lib/workspaceDesign";
import { cn } from "@/lib/utils";

export type MerchantJourney = {
  contract_version: "rev-merchant-journey-v1";
  organization_id: string;
  selected_store_id: string | null;
  selected: {
    state: string; title: string; explanation: string; next_route: string;
    can_enter_workspace: boolean;
    store: { id: string; shop_domain: string } | null;
    required_resources: { resource: string; state: string; pagination_complete: boolean }[];
    limited_capabilities: { id: string; reasons: string[] }[];
  };
  stores: { id: string; shop_domain: string; state: string; can_enter_workspace: boolean }[];
};

function valid(data: MerchantJourney | undefined): data is MerchantJourney {
  return data?.contract_version === "rev-merchant-journey-v1" && typeof data.organization_id === "string" &&
    Array.isArray(data.stores) && typeof data.selected?.state === "string" &&
    ["/dashboard/overview", "/dashboard/integrations"].includes(data.selected.next_route);
}

export function MerchantJourneyStatus({ workspace = false }: { workspace?: boolean }) {
  const [params, setParams] = useSearchParams();
  const requestedStore = params.get("store_id");
  const [journey, setJourney] = useState<MerchantJourney | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      const suffix = requestedStore ? `?store_id=${encodeURIComponent(requestedStore)}` : "";
      const response = await api.get<{ success: boolean; data: MerchantJourney }>(`/stores/journey${suffix}`);
      if (request !== generation.current) return;
      if (response.data.success !== true || !valid(response.data.data)) throw new Error("Workspace status was not understood.");
      setJourney(response.data.data);
    } catch (reason) {
      if (request !== generation.current) return;
      setJourney(null);
      setError(explainWorkspaceError(reason, "setup status").body);
    } finally { if (request === generation.current) setLoading(false); }
  }, [requestedStore]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);

  // The useful briefing itself is the returning experience. Do not add a
  // redundant welcome panel once the merchant is already in Command Center.
  if (workspace && journey?.selected.can_enter_workspace) return null;
  return <section aria-labelledby="merchant-journey-heading" className="mb-5 rounded-xl border border-[#d0d5dd] bg-white p-4 text-[#101828] shadow-sm sm:p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#475467]"><Store className="h-4 w-4" aria-hidden="true" />Store setup</p>
        <h2 id="merchant-journey-heading" className="text-base font-semibold">{loading ? "Verifying your store setup…" : error ? "Setup status unavailable" : journey?.selected.title}</h2>
        <p role={error ? "alert" : "status"} aria-live="polite" className="mt-1 max-w-3xl text-sm leading-relaxed text-[#475467]">{loading ? "Revluma is checking authorization and synchronization separately." : error || journey?.selected.explanation}</p>
        {journey?.selected.store && <p className="mt-2 break-all text-xs text-[#667085]">{journey.selected.store.shop_domain}</p>}
        {journey && journey.selected.required_resources.length > 0 && !journey.selected.can_enter_workspace && <ul className="mt-3 flex flex-wrap gap-2 text-xs text-[#475467]" aria-label="Required synchronization resources">
          {journey.selected.required_resources.map(resource => <li key={resource.resource} className="rounded-full bg-[#f2f4f7] px-2.5 py-1">{resourceName(resource.resource)}: {resourceLanguage(resource.state).label}</li>)}
        </ul>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {(error || !loading) && <button type="button" onClick={() => void load()} disabled={loading} className={cn(workspaceDesign.control.secondary, workspaceDesign.focus)}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />Refresh status</button>}
        {journey && <Link to={journey.selected.next_route} className={cn(workspaceDesign.control.primary, workspaceDesign.focus)}>{journey.selected.can_enter_workspace ? "Open Command Center" : journey.selected.state === "authenticated_setup_required" ? "Connect Shopify" : "Review store setup"}<ArrowRight className="h-4 w-4" /></Link>}
      </div>
    </div>
    {journey && journey.stores.length > 1 && <div className="mt-4 border-t border-[#eaecf0] pt-3"><label htmlFor="journey-store" className="text-xs font-medium text-[#475467]">Store</label><select id="journey-store" value={journey.selected_store_id || ""} onChange={event => { const next = new URLSearchParams(params); next.set("store_id", event.target.value); setParams(next); }} className="ml-2 min-h-11 max-w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-sm">{journey.stores.map(store => <option key={store.id} value={store.id}>{store.shop_domain} — {store.state.replaceAll("_", " ")}</option>)}</select></div>}
  </section>;
}
