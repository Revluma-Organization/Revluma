import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import {
  type BusinessHealthContract,
  type BusinessIndicator,
  type BusinessStatus,
  BUSINESS_STATUS_LABEL,
  BUSINESS_STATUS_TONE,
  DATA_QUALITY_LABEL,
  DATA_QUALITY_TONE,
  CATEGORY_LABEL,
  isValidBusinessHealth,
} from "@/lib/businessHealth";
import { BrainCircuit, ChevronDown, ChevronRight, CircleHelp, Info } from "lucide-react";

const money = (value: number, currency = "USD") => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value); } catch { return String(value); }
};
const INTEGRATION_STATE_LABEL: Record<string, string> = {
  connected: "Connected",
  synchronizing: "Synchronizing",
  limited_access: "Limited access",
  needs_attention: "Needs attention",
  sync_partial: "Partially synced",
  sync_failed: "Sync failed",
  disconnected: "Disconnected",
  authorization_required: "Authorization required",
  authorization_expired: "Authorization expired",
  authorization_revoked: "Authorization revoked",
  unsupported: "Unsupported",
  unknown: "Not verified",
};

function indicatorValueText(ind: BusinessIndicator): string {
  const { value, category, currency } = ind;
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return INTEGRATION_STATE_LABEL[value] || value.replace(/_/g, " ");
  switch (category) {
    case "revenue": return money(value, currency || "USD");
    case "orders": return `${value.toLocaleString()} orders`;
    case "checkouts": return `${value.toLocaleString()} abandoned`;
    case "product_availability": return `${value.toLocaleString()} available`;
    default: return String(value);
  }
}

function changeLabel(pct: number | null): { text: string; up: boolean } | null {
  if (pct === null || pct === undefined) return null;
  if (pct > 0) return { text: `+${pct}% vs previous period`, up: true };
  if (pct < 0) return { text: `${pct}% vs previous period`, up: false };
  return { text: "steady vs previous period", up: true };
}

function IndicatorCard({ ind, onInvestigate }: { ind: BusinessIndicator; onInvestigate?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const tone = BUSINESS_STATUS_TONE[ind.status];
  const dqTone = DATA_QUALITY_TONE[ind.data_quality];
  const change = changeLabel(ind.change_pct);
  const valueComponents = (ind.value_components || {}) as Record<string, unknown>;
  const showNextStep = Boolean(ind.next_step);

  return (
    <div className={`flex flex-col rounded-xl border ${tone.ring} bg-white p-4 dark:bg-[#161616]`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#69758b] dark:text-[#a5b7d1]">{CATEGORY_LABEL[ind.category]}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="break-words text-lg font-extrabold tracking-tight text-[#0b1426] dark:text-[#f3f7ff]">{indicatorValueText(ind)}</span>
            {change && <span className="whitespace-nowrap text-[11px] font-semibold text-[#8190a4] dark:text-[#a5b7d1]">{change.text}</span>}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${tone.badge}`}>{BUSINESS_STATUS_LABEL[ind.status]}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${dqTone}`}>{DATA_QUALITY_LABEL[ind.data_quality]}</span>
        {ind.currency && ind.category === "revenue" && <span className="text-[10px] text-[#8190a4] dark:text-[#a5b7d1]">{ind.currency}</span>}
      </div>

      <p className="mt-2 text-xs leading-5 text-[#5c6b81] dark:text-[#a5b7d1]">{ind.explanation}</p>

      {ind.category === "revenue" && valueComponents.net !== undefined && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[#8190a4] dark:text-[#a5b7d1]">
          {typeof valueComponents.gross === "number" && <div>Gross <span className="font-semibold text-[#5c6b81] dark:text-[#cbd7eb]">{money(valueComponents.gross, ind.currency || "USD")}</span></div>}
          {typeof valueComponents.refunds === "number" && <div>Refunded <span className="font-semibold text-[#5c6b81] dark:text-[#cbd7eb]">{money(valueComponents.refunds, ind.currency || "USD")}</span></div>}
          {typeof valueComponents.order_count === "number" && <div>Orders <span className="font-semibold text-[#5c6b81] dark:text-[#cbd7eb]">{valueComponents.order_count}</span></div>}
        </dl>
      )}
      {ind.category === "checkouts" && typeof ind.conversion_rate === "number" && (
        <p className="mt-2 text-[10px] text-[#8190a4] dark:text-[#a5b7d1]">Conversion <span className="font-semibold text-[#5c6b81] dark:text-[#cbd7eb]">{ind.conversion_rate}%</span> (only with a valid denominator)</p>
      )}

      <button type="button" onClick={() => setExpanded(e => !e)} className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[#0868ed] dark:text-[#86b5ff]">
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} {expanded ? "Hide details" : "Details"}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 rounded-lg bg-[#f8faff] p-3 text-[11px] leading-5 dark:bg-[#1b1b1b]">
          {ind.metric_definition && <p className="text-[#5c6b81] dark:text-[#a5b7d1]"><span className="font-bold text-[#3b4a63] dark:text-[#cbd7eb]">Definition.</span> {ind.metric_definition}</p>}
          <p className="text-[#5c6b81] dark:text-[#a5b7d1]"><span className="font-bold text-[#3b4a63] dark:text-[#cbd7eb]">Coverage.</span> {ind.coverage.reason}</p>
          {ind.limitations.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[#5c6b81] dark:text-[#a5b7d1]">
              {ind.limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
          {ind.source_evidence.length > 0 && <p className="text-[#8190a4] dark:text-[#8a97ab]">Sources: {ind.source_evidence.join(", ")}</p>}
          {showNextStep && <p className="text-[#3b4a63] dark:text-[#cbd7eb]"><span className="font-bold">Next step.</span> {ind.next_step}</p>}
        </div>
      )}
    </div>
  );
}

export default function BusinessHealthPanel({ storeId, storeDomain, canInvestigate }: { storeId: string; storeDomain?: string; canInvestigate?: boolean }) {
  const navigate = useNavigate();
  const [contract, setContract] = useState<BusinessHealthContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!storeId) { setContract(null); setLoading(false); return; }
    setLoading(true);
    setFailed(false);
    api.get<{ success?: boolean; data?: unknown }>(`/stores/${storeId}/business-health`)
      .then(res => {
        if (!active) return;
        // Fail-closed: only a response matching the closed contract is
        // rendered; anything else is an honest "unavailable" state.
        // api.get resolves to ApiResponse<T> = { data: T, status, ok }; the
        // contract body is one level down.
        const body: unknown = (res as { data?: unknown } | null)?.data;
        const ok = body && typeof body === "object" && (body as { success?: boolean }).success === true;
        const data = ok ? (body as { data?: unknown }).data : null;
        if (isValidBusinessHealth(data)) {
          setContract(data);
        } else {
          setContract(null);
          setFailed(true);
        }
      })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [storeId]);

  if (!storeId) return null;

  return (
    <section aria-label={storeDomain ? `Business health indicators for ${storeDomain}` : "Business health indicators"} className="rounded-2xl border border-[#e7ebf2] bg-white p-4 shadow-[0_3px_18px_rgba(15,23,42,0.035)] dark:border-[#292929] dark:bg-[#111111] dark:shadow-none sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold">Business health</h2>
            {contract && (
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${BUSINESS_STATUS_TONE[contract.business_status].badge}`}>
                {BUSINESS_STATUS_LABEL[contract.business_status]}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[#8190a4] dark:text-[#a5b7d1]">
            {contract ? `${contract.reporting_period.current.label} in ${contract.reporting_period.timezone}` : "Last 7 days"} · business performance, separate from data availability
          </p>
        </div>
        {canInvestigate && (
          <button type="button" onClick={() => navigate("/dashboard/rev-intell")} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0868ed] dark:text-[#86b5ff]">
            <BrainCircuit className="h-4 w-4" /> Investigate with Rev
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-[#f1f4f8] dark:bg-[#1b1b1b]" />)}
        </div>
      )}

      {!loading && failed && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#e7ebf2] bg-[#f8faff] p-4 text-xs text-[#5c6b81] dark:border-[#333] dark:bg-[#1b1b1b] dark:text-[#a5b7d1]">
          <CircleHelp className="h-4 w-4 shrink-0" /> Business health is unavailable right now. This does not change your store's connection status.
        </div>
      )}

      {!loading && !failed && contract && (
        <>
          <p className="mt-3 text-xs leading-5 text-[#5c6b81] dark:text-[#a5b7d1]">{contract.business_status_explanation}</p>
          {contract.affected_indicators_note && contract.affected_indicators_note.length > 0 && (
            <div className="mt-3 flex gap-2 rounded-xl bg-[#fff8ec] p-3 text-[11px] leading-5 text-[#7a5b13] dark:bg-[#241f12] dark:text-[#e8c877]">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{contract.affected_indicators_note.map((n, i) => <p key={i}>{n}</p>)}</div>
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {contract.indicators.map(ind => <IndicatorCard key={ind.id} ind={ind} />)}
          </div>
        </>
      )}
    </section>
  );
}
