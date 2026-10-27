import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, X } from "lucide-react";

type Finding = {
  id: string; type: string; severity: string; status: string; title: string;
  description: string; evidence: Record<string, unknown>;
  action?: { label?: string; route?: string } | null;
  detected_at: string;
};
type Response = { success: boolean; data: { findings: Finding[]; diagnostics: { storeId: string; status: string }[] } };

export default function IntelligenceFindingsPanel() {
  const navigate = useNavigate();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [diagnostics, setDiagnostics] = useState<Response["data"]["diagnostics"]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: "merchant" | "rev"; text: string }[]>([]);
  const [chatError, setChatError] = useState("");
  function closeInvestigation() {
    setSelected(null);
    setQuestion("");
    setChatMessages([]);
    setConversationId(null);
    setChatError("");
  }
  async function askFinding() {
    if (!selected || chatBusy || !question.trim()) return;
    const text = question.trim();
    setQuestion("");
    setChatError("");
    setChatMessages(prev => [...prev, { role: "merchant", text }]);
    setChatBusy(true);
    try {
      const result = await api.post<{
        success: boolean; conversation_id?: string; text?: string | null;
        response?: { response_type?: string; text?: string; situation?: string; insight?: string;
          implication?: string; recommendation?: string; warnings?: string[] };
      }>("/rev/chat", { message: text, finding_id: selected.id, ...(conversationId ? { conversation_id: conversationId } : {}) });
      const data = result.data;
      if (!data.success) throw new Error("Rev Intell could not complete this investigation.");
      if (data.conversation_id) setConversationId(data.conversation_id);
      const response = data.response;
      const answer = [data.text || response?.text, response?.situation, response?.insight, response?.implication,
        response?.recommendation, ...(response?.warnings || [])].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n\n");
      setChatMessages(prev => [...prev, { role: "rev", text: answer || "Rev Intell returned no explanation for this question." }]);
    } catch {
      setChatError("Rev Intell is unavailable or the finding cannot be verified. Your question was not answered.");
    } finally { setChatBusy(false); }
  }
  const [investigationError, setInvestigationError] = useState(false);
  async function investigate(id: string) {
    closeInvestigation();
    setInvestigationLoading(true);
    setInvestigationError(false);
    try {
      const response = await api.get<{ success: boolean; data: { finding: Finding } }>(`/rev/findings/${encodeURIComponent(id)}`);
      if (response.data.data?.finding) setSelected(response.data.data.finding);
      else setInvestigationError(true);
    } catch { setInvestigationError(true); }
    finally { setInvestigationLoading(false); }
  }
  useEffect(() => {
    let mounted = true;
    api.get<Response>("/rev/findings").then(result => {
      if (!mounted) return;
      setFindings(result.data.data?.findings || []);
      setDiagnostics(result.data.data?.diagnostics || []);
    }).catch(() => { if (mounted) setError(true); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  async function refresh() {
    setRefreshing(true);
    setError(false);
    try {
      const evaluated = await api.post<{ success: boolean; data: { diagnostics: Response["data"]["diagnostics"] } }>("/rev/findings/refresh");
      setDiagnostics(evaluated.data.data?.diagnostics || []);
      const result = await api.get<Response>("/rev/findings");
      setFindings(result.data.data?.findings || []);
    } catch { setError(true); }
    finally { setRefreshing(false); }
  }
  async function transition(id: string, status: "acknowledged" | "resolved" | "dismissed") {
    try {
      await api.patch(`/rev/findings/${id}`, { status });
      setFindings(previous => previous.filter(item => item.id !== id));
      setSelected(null);
    } catch { setError(true); }
  }
  return (
    <section aria-label="Intelligence findings" className="rounded-2xl border border-[#e7ebf2] bg-white p-5 text-[#111827] dark:border-[#292929] dark:bg-[#111111] dark:text-white sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#0868ed]">Evidence-backed intelligence</p>
          <h2 className="mt-1 text-base font-extrabold">Priority findings</h2>
        </div>
        <button type="button" disabled={refreshing} onClick={refresh} className="rounded-lg border border-[#cddbf0] px-3 py-2 text-xs font-semibold text-[#0868ed] disabled:opacity-50 dark:border-[#444]">{refreshing ? "Checking…" : "Check now"}</button>
        <span className="rounded-full bg-[#f1f4f8] px-3 py-1 text-xs font-semibold text-[#69758b] dark:bg-[#242424] dark:text-[#b4b4b4]">
          {loading ? "Checking…" : `${findings.length} open`}
        </span>
      </div>
      {error && <p role="alert" className="mt-4 text-xs text-red-600 dark:text-red-300">Findings could not be loaded or updated. Please retry later.</p>}
      {loading ? <p className="mt-4 text-sm text-[#667085] dark:text-[#aaa]">Checking verified records…</p> :
        findings.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-[#d7e2f0] p-5 dark:border-[#333]">
          <p className="text-sm font-semibold">No verified priority findings available</p>
          <p className="mt-2 text-xs leading-5 text-[#667085] dark:text-[#aaa]">
            {diagnostics.length > 0 ? "Some intelligence checks are limited by unverified historical data or store synchronization. No conclusions have been inferred from incomplete records." : "Revluma has not detected a qualifying issue from the available verified evidence."}
          </p>
        </div> : <div className="mt-4 space-y-2">{findings.map(item =>
          <button key={item.id} onClick={() => void investigate(item.id)} className="flex w-full items-start gap-3 rounded-xl border border-[#e7ebf2] p-4 text-left transition hover:border-[#0868ed] dark:border-[#303030] dark:hover:border-[#4b83d8]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#d97706]" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{item.title}</span><span className="mt-1 block text-xs leading-5 text-[#667085] dark:text-[#aaa]">{item.description}</span></span>
            <span className="text-[10px] font-semibold uppercase text-[#667085] dark:text-[#aaa]">{item.severity}</span>
          </button>)}</div>}
      {investigationError && <p role="alert" className="mt-3 text-xs text-red-600">Unable to load verified finding details. Please retry.</p>}
      {investigationLoading && <p role="status" className="mt-3 text-xs text-[#667085]">Loading verified evidence…</p>}
      {selected && <div className="fixed inset-0 z-[110] flex justify-end bg-black/60" onClick={closeInvestigation}>
        <aside role="dialog" aria-modal="true" aria-label="Finding evidence" onClick={event => event.stopPropagation()}
          className="flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-white p-6 text-[#111827] shadow-2xl dark:bg-[#111111] dark:text-white sm:p-8">
          <button className="self-end rounded-lg border border-[#ddd] p-2 dark:border-[#444]" aria-label="Close finding" onClick={() => setSelected(null)}><X className="h-4 w-4" /></button>
          <p className="mt-5 text-xs font-bold uppercase tracking-wider text-[#0868ed]">{selected.type.replace(/_/g, " ")} · {selected.severity}</p>
          <h3 className="mt-3 text-xl font-extrabold">{selected.title}</h3>
          <p className="mt-3 text-sm leading-6 text-[#667085] dark:text-[#bbb]">{selected.description}</p>
          <div className="mt-7 space-y-6">
            <section><h4 className="text-sm font-bold">What happened?</h4><p className="mt-2 text-sm leading-6 text-[#667085] dark:text-[#bbb]">{selected.description}</p></section>
            <section><h4 className="text-sm font-bold">Why does it matter?</h4>
              <p className="mt-2 text-sm leading-6 text-[#667085] dark:text-[#bbb]">{selected.type === "revenue_change" && typeof selected.evidence?.delta_pct === "number" ? `Recorded revenue changed by ${Math.abs(selected.evidence.delta_pct).toFixed(2)}% compared with the prior verified period.` : selected.type === "returning_customer_change" && typeof selected.evidence?.change_percentage_points === "number" ? `Returning-customer purchase share changed by ${Math.abs(selected.evidence.change_percentage_points).toFixed(2)} percentage points.` : "The store connection or synchronization requires attention; some data may be delayed or incomplete."}</p>
            </section>
            <section><h4 className="text-sm font-bold">What evidence supports it?</h4>
              <dl className="mt-3 space-y-2 rounded-xl bg-[#f5f8fd] p-4 dark:bg-[#1b1b1b]">
                {Object.entries(selected.evidence || {}).filter(([key]) => !["source_data", "raw"].includes(key)).slice(0, 20).map(([key, value]) =>
                  <div key={key} className="flex justify-between gap-4 text-xs"><dt className="break-all text-[#667085] dark:text-[#aaa]">{key.replace(/_/g, " ")}</dt><dd className="max-w-[60%] break-words text-right font-semibold">{value === null ? "Not recorded" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}
                <div className="flex justify-between gap-4 text-xs"><dt className="text-[#667085] dark:text-[#aaa]">Detected at</dt><dd className="font-semibold">{new Date(selected.detected_at).toLocaleString()}</dd></div>
              </dl>
            </section>
            <section><h4 className="text-sm font-bold">What could explain it?</h4>
              <p className="mt-2 text-sm leading-6 text-[#667085] dark:text-[#bbb]">{selected.type === "integration_failure" ? "The recorded setup, connection or sync state indicates an integration problem. The exact underlying cause is not established by this finding." : "The verified records establish the change, not its cause. Pricing, traffic, promotions and customer behavior are possible factors, but this finding does not contain evidence sufficient to attribute the change to any of them."}</p>
            </section>
            <section><h4 className="text-sm font-bold">What can I do?</h4><p className="mt-2 text-sm leading-6 text-[#667085] dark:text-[#bbb]">Review the relevant records, then acknowledge, resolve or dismiss this finding when appropriate. No automatic corrective action will be taken.</p>
              {selected.action?.route?.startsWith("/dashboard/") && <button type="button" onClick={() => navigate(selected.action!.route!)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#b8d4ff] px-3 py-2 text-xs font-bold text-[#0868ed]">{selected.action.label || "Review records"} <ArrowRight className="h-3.5 w-3.5" /></button>}
            </section>
          </div>
          <section className="mt-8 border-t border-[#e7ebf2] pt-6 dark:border-[#333]">
            <h4 className="text-sm font-extrabold">Ask Rev Intell about this finding</h4>
            <p className="mt-2 text-xs leading-5 text-[#667085] dark:text-[#aaa]">Rev Intell receives the verified finding directly from Revluma. You can investigate here without leaving Command Center.</p>
            <div aria-live="polite" className="mt-4 max-h-72 space-y-3 overflow-y-auto">
              {chatMessages.map((item, index) => <div key={index} className={`rounded-xl p-3 text-xs leading-6 whitespace-pre-wrap ${item.role === "merchant" ? "ml-8 bg-[#eaf2ff] text-[#172b4d] dark:bg-[#20334e] dark:text-white" : "mr-5 bg-[#f5f8fd] text-[#344054] dark:bg-[#202020] dark:text-[#ddd]"}`}>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider">{item.role === "merchant" ? "You" : "Rev Intell"}</p>{item.text}
              </div>)}
              {chatBusy && <p role="status" className="text-xs text-[#667085]">Rev Intell is investigating…</p>}
            </div>
            {chatError && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{chatError}</p>}
            <form className="mt-4 flex gap-2" onSubmit={event => { event.preventDefault(); void askFinding(); }}>
              <input aria-label="Ask a question about this finding" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1500} placeholder="What explains this change?" className="min-w-0 flex-1 rounded-lg border border-[#d4dce9] bg-transparent px-3 py-2.5 text-sm dark:border-[#444]" />
              <button type="submit" disabled={chatBusy || !question.trim()} className="rounded-lg bg-[#0868ed] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Ask</button>
            </form>
            {conversationId && <button type="button" className="mt-3 text-xs font-semibold text-[#0868ed]" onClick={() => navigate(`/dashboard/rev-intell/${encodeURIComponent(conversationId)}`)}>Continue this conversation in full Rev Intell →</button>}
          </section>
          <div className="mt-8 flex flex-wrap gap-2">
            {selected.id && <button onClick={() => navigate(`/dashboard/rev-intell?finding=${encodeURIComponent(selected.id)}`)} className="inline-flex items-center gap-2 rounded-lg bg-[#0868ed] px-4 py-2.5 text-xs font-bold text-white">{"Open full Rev Intell chat"} <ArrowRight className="h-3.5 w-3.5" /></button>}
            <button onClick={() => transition(selected.id, "acknowledged")} className="rounded-lg border border-[#aaa] px-4 py-2.5 text-xs font-semibold dark:border-[#555]">Acknowledge</button>
            <button onClick={() => transition(selected.id, "resolved")} className="inline-flex items-center gap-1 rounded-lg border border-[#aaa] px-4 py-2.5 text-xs font-semibold dark:border-[#555]"><Check className="h-3.5 w-3.5" /> Resolve</button>
            <button onClick={() => transition(selected.id, "dismissed")} className="rounded-lg border border-[#aaa] px-4 py-2.5 text-xs font-semibold dark:border-[#555]">Dismiss</button>
          </div>
        </aside>
      </div>}
    </section>
  );
}
