import { useId, useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { revTokens, type RevTone } from "@/lib/revTokens";
import { describeTableChart, type TableChartSpec } from "@/lib/revVisuals";

/**
 * Chart view of a table Rev already printed (ChatGPT-UI study §9). The data
 * is the table's own cells: no value is fetched, estimated or rounded beyond
 * display formatting. Categories become a horizontal bar chart sorted
 * descending with direct value labels; periods become an area chart in the
 * order the table gave them. A one-sentence text summary is always visible,
 * and the table itself is one click away.
 *
 * Loaded lazily (recharts stays out of the first conversation paint).
 */
export default function RevTableChart({ spec, tone = "light" }: { spec: TableChartSpec; tone?: RevTone }) {
  const t = revTokens(tone);
  const dark = tone === "dark";
  const gradientId = useId().replace(/:/g, "");
  const [seriesIndex, setSeriesIndex] = useState(0);
  const series = spec.series[seriesIndex] ?? spec.series[0];

  const data = useMemo(() => {
    const points = spec.rows
      .map(row => ({ label: row.label, value: row.values[seriesIndex] }))
      .filter((point): point is { label: string; value: number } => point.value !== null);
    return spec.kind === "bar" ? [...points].sort((a, b) => b.value - a.value) : points;
  }, [spec, seriesIndex]);

  const summary = describeTableChart(spec, seriesIndex);
  const grid = dark ? "rgba(255,255,255,0.06)" : "#F2F4F7";
  const axis = { fontSize: 11, fill: t.muted };
  const tooltip = {
    contentStyle: {
      background: t.overlay, border: `1px solid ${t.border}`, borderRadius: 10,
      boxShadow: t.shadow, fontSize: 12, color: t.strong, padding: "6px 10px",
    },
    labelStyle: { color: t.muted, fontSize: 11, marginBottom: 2 },
    itemStyle: { color: t.strong },
    cursor: { fill: dark ? "rgba(255,255,255,0.04)" : "rgba(31,6,172,0.04)" },
  };
  const height = spec.kind === "bar" ? Math.max(120, data.length * 34 + 16) : 220;

  return (
    <figure data-rev-table-chart style={{ margin: 0, border: `1px solid ${t.border}`, borderRadius: 14, padding: "12px 12px 10px", background: dark ? "rgba(255,255,255,0.02)" : "#FFFFFF" }}>
      {spec.series.length > 1 && (
        <div role="group" aria-label="Chart column" className="mb-2 flex flex-wrap gap-1">
          {spec.series.map((entry, index) => (
            <button
              key={entry.column}
              type="button"
              aria-pressed={index === seriesIndex}
              onClick={() => setSeriesIndex(index)}
              className="min-h-8 rounded-full px-3 text-[0.7rem] font-semibold transition-colors"
              style={{
                border: `1px solid ${index === seriesIndex ? t.accentBorder : t.border}`,
                background: index === seriesIndex ? t.accentSoft : "transparent",
                color: index === seriesIndex ? t.accentFg : t.muted,
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      <div aria-hidden="true" style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          {spec.kind === "bar" ? (
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke={grid} />
              <XAxis type="number" hide domain={[0, "dataMax"]} />
              <YAxis type="category" dataKey="label" width={112} tickLine={false} axisLine={false} tick={axis}
                tickFormatter={(value: string) => (value.length > 16 ? `${value.slice(0, 15)}…` : value)} />
              <Tooltip {...tooltip} formatter={(value) => [Number(value).toLocaleString(), series?.label ?? ""]} />
              <Bar dataKey="value" fill={dark ? "#7C6CFF" : "#1F06AC"} radius={[0, 6, 6, 0]} maxBarSize={22} isAnimationActive animationDuration={420}>
                <LabelList dataKey="value" position="right" formatter={(value: unknown) => Number(value).toLocaleString()}
                  style={{ fontSize: 11, fill: t.strong, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1F06AC" stopOpacity={dark ? 0.45 : 0.22} />
                  <stop offset="100%" stopColor="#1F06AC" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axis} minTickGap={12} />
              <YAxis tickLine={false} axisLine={false} tick={axis} width={48}
                tickFormatter={(value: number) => Intl.NumberFormat(undefined, { notation: "compact" }).format(value)} />
              <Tooltip {...tooltip} cursor={{ stroke: t.border }} formatter={(value) => [Number(value).toLocaleString(), series?.label ?? ""]} />
              <Area type="monotone" dataKey="value" stroke={dark ? "#7C6CFF" : "#1F06AC"} strokeWidth={2}
                fill={`url(#${gradientId})`} dot={{ r: 2.5, strokeWidth: 0, fill: dark ? "#7C6CFF" : "#1F06AC" }}
                activeDot={{ r: 4 }} isAnimationActive animationDuration={480} />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      {summary && (
        <figcaption style={{ marginTop: 6, fontSize: "0.7rem", lineHeight: 1.5, color: t.muted }}>{summary}</figcaption>
      )}
    </figure>
  );
}
