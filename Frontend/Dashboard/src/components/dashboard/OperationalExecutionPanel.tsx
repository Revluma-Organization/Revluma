import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useNavigate } from "react-router-dom";

type Workflow = { id: string; name: string; channel: string; status: string | null; updated_at: string | null; controls: { pause: boolean; resume: boolean; investigate: boolean; review_settings: boolean } };
type Execution = { id: string; channel: string; status: string; created_at: string; sent_at: string | null };
type Alert = { id: string; message: string; severity: string; status: string; created_at: string; action_url: string | null };
type Operations = {
  observed_at: string;
  scope: { stores: number; execution_window: string };
  workflows: Workflow[];
  executions: { recent: Execution[]; pending_count: number; completed_count: number; failed_count: number; counts_are_windowed: boolean };
  recovery: { status: string; count: number }[];
  alerts: Alert[];
  campaigns: { available_actions: unknown[]; reason: string };
  controls_verified: boolean;
};
const panel = "rounded-2xl border border-[#e7ebf2] bg-white p-5 dark:border-[#292929] dark:bg-[#111] sm:p-6";
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString() : "Not recorded";

export default function OperationalExecutionPanel() {
  const navigate = useNavigate();
  const [data, setData] = useState<Operations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    api.get<{ success: boolean; data: Operations }>("/dashboard/operations")
      .then(result => { if (active) setData(result.data.data); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <section aria-label="Automation and execution" className={panel}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#0868ed]">Execution intelligence</p><h2 className="mt-1 text-base font-extrabold">Automation & execution</h2><p className="mt-2 text-xs text-[#77849a]">Recorded workflow and message activity. Controls appear only after backend verification.</p></div>
      {data && <span className="text-[11px] text-[#77849a]">Observed {timestamp(data.observed_at)}</span>}
    </div>
    {loading && <p role="status" className="mt-5 text-sm text-[#77849a]">Loading recorded operations…</p>}
    {error && <p role="alert" className="mt-5 text-sm text-red-600">Operational records are unavailable. No execution status can be confirmed.</p>}
    {data && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active workflows", data.workflows.filter(w => w.status === "active").length],
          ["Pending executions", data.executions.pending_count],
          ["Completed actions", data.executions.completed_count],
          ["Failed actions", data.executions.failed_count],
        ].map(([label, count]) => <div key={label} className="rounded-xl bg-[#f5f8fd] p-4 dark:bg-[#202020]"><p className="text-xs text-[#77849a]">{label}</p><p className="mt-2 text-2xl font-extrabold">{count}</p></div>)}
      </div>
      <p className="mt-3 text-[11px] text-[#77849a]">Execution counts reflect the latest 60 records, not all-time totals. Workflows show the latest 30 records. “Completed” means a recorded send/delivery status, not confirmed recovery or purchase.</p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div><h3 className="text-sm font-bold">Workflows</h3><div className="mt-2 space-y-2">{data.workflows.length === 0 ? <p className="text-xs text-[#77849a]">No recorded workflows.</p> : data.workflows.slice(0, 5).map(w => <div key={w.id} className="rounded-lg border border-[#e7ebf2] p-3 dark:border-[#333]"><p className="text-xs font-bold">{w.name}</p><p className="mt-1 text-[11px] text-[#77849a]">{w.channel} · {w.status || "Unknown"} · {timestamp(w.updated_at)}</p><p className="mt-1 text-[11px] text-[#77849a]">Pause, resume and investigation controls not verified.</p>{w.controls.review_settings && <button type="button" onClick={() => navigate("/dashboard/settings/automation")} className="mt-2 text-[11px] font-bold text-[#0868ed]">Review automation settings →</button>}</div>)}</div></div>
        <div><h3 className="text-sm font-bold">Recent executions</h3><div className="mt-2 space-y-2">{data.executions.recent.length === 0 ? <p className="text-xs text-[#77849a]">No recorded executions.</p> : data.executions.recent.slice(0, 5).map(e => <div key={e.id} className="rounded-lg border border-[#e7ebf2] p-3 text-xs dark:border-[#333]"><span className="font-bold">{e.channel} · {e.status}</span><span className="ml-2 text-[#77849a]">{timestamp(e.sent_at || e.created_at)}</span></div>)}</div></div>
        <div><h3 className="text-sm font-bold">Recovery activity</h3><div className="mt-2 space-y-2">{data.recovery.length === 0 ? <p className="text-xs text-[#77849a]">No recorded recovery activity.</p> : data.recovery.map(r => <div key={r.status} className="flex justify-between rounded-lg border border-[#e7ebf2] p-3 text-xs dark:border-[#333]"><span>{r.status}</span><strong>{r.count}</strong></div>)}</div><button type="button" onClick={() => navigate("/dashboard/cart-recovery")} className="mt-3 text-xs font-bold text-[#0868ed]">Review checkout recovery →</button></div>
        <div><h3 className="text-sm font-bold">Operational alerts</h3><div className="mt-2 space-y-2">{data.alerts.length === 0 ? <p className="text-xs text-[#77849a]">No recorded operational alerts.</p> : data.alerts.slice(0, 5).map(a => <div key={a.id} className="rounded-lg border border-[#e7ebf2] p-3 text-xs dark:border-[#333]"><p className="font-semibold">{a.message}</p><p className="mt-1 text-[#77849a]">{a.severity} · {a.status} · {timestamp(a.created_at)}</p></div>)}</div></div>
      </div>
      <div className="mt-5 rounded-xl border border-dashed border-[#d4dce9] p-4 dark:border-[#444]"><h3 className="text-xs font-bold">Campaign actions</h3><p className="mt-1 text-xs text-[#77849a]">{data.campaigns.reason}</p></div>
    </>}
  </section>;
}
