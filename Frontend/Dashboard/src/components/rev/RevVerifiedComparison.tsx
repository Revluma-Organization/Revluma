import { Database } from "lucide-react";
import { parseVerifiedComparison } from "@/lib/revComparison";

/**
 * Structured cards derived only from values explicitly present in Rev's
 * verified answer. Phase 5E moved this here verbatim from RevAnswerView so
 * the workspace renderer and the copilot renderer share one implementation:
 * recorded merchant data only, never verified net sales, never invented.
 */
export function RevVerifiedComparison({ text, dark, strong, muted, border }: {
  text: string; dark: boolean; strong: string; muted: string; border: string;
}) {
  const metrics = parseVerifiedComparison(text);
  if (!metrics) return null;
  return (
    <section aria-label="Verified store performance comparison">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Database size={15} color="#1F06AC" />
        <span style={{ color: strong, fontSize: 13, fontWeight: 750 }}>Verified performance evidence</span>
        <span style={{ color: muted, fontSize: 11 }}>Rolling 7-day periods · UTC</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        {metrics.map((period, index) => (
          <div key={index} style={{ border: `1px solid ${index === 0 ? "#1F06AC" : border}`, borderRadius: 12,
            padding: 14, background: index === 0 ? (dark ? "#1b1740" : "#f4f2ff") : "transparent" }}>
            <div style={{ color: strong, fontSize: 13, fontWeight: 750 }}>{period.title}</div>
            <div style={{ color: muted, fontSize: 11, marginTop: 4, marginBottom: 12 }}>{period.dates}</div
            >
            {([["Orders", period.orders], ["Abandoned carts", period.carts], ["New profiles", period.customers],
               ["First-time orders", period.firstTime], ["Returning orders", period.returning]] as Array<[string, string | null]>).map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0" }}>
                <span style={{ color: muted, fontSize: 12 }}>{label}</span>
                <strong style={{ color: strong, fontSize: 13 }}>{value ?? "—"}</strong>
              </div>
            ))}
            {period.cartValues.map((value, i) => <div key={`c${i}`} style={{ color: strong, fontSize: 12, marginTop: 6 }}>Recorded cart value: <strong>{value}</strong></div>)}
            {period.values.map((value, i) => <div key={`v${i}`} style={{ color: strong, fontSize: 12, marginTop: 9 }}>Recorded order value: <strong>{value}</strong></div>)}
            {period.discounts.map((value, i) => <div key={`d${i}`} style={{ color: muted, fontSize: 12, marginTop: 4 }}>Discounts: {value}</div>)}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: muted, marginTop: 10 }}>Recorded merchant data, not verified net sales. Review the evidence limitations below.</div>
    </section>
  );
}

export default RevVerifiedComparison;
