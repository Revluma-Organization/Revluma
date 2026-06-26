import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

interface Props {
  data: number[];
  positive?: boolean;
  id: string;
}

export function TrendSparkline({ data, positive = true, id }: Props) {
  const series = data.map((v, i) => ({ i, v }));
  const stroke = positive ? "hsl(var(--accent))" : "hsl(var(--red))";
  const gid = `spark-${id}`;

  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={false}
            contentStyle={{
              background: "hsl(var(--bg-3))",
              border: "1px solid hsl(var(--border-soft) / 0.12)",
              borderRadius: 8,
              fontSize: 11,
              padding: "4px 8px",
              color: "hsl(var(--t1))",
            }}
            labelFormatter={() => ""}
            formatter={(v: number) => [v.toFixed(1), "Signal"]}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.75}
            fill={`url(#${gid})`}
            isAnimationActive
            animationDuration={650}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
