import { Construction } from "lucide-react";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-20 text-center">
      <div
        className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border"
        style={{ background: "hsl(var(--accent) / 0.12)", borderColor: "hsl(var(--accent) / 0.25)" }}
      >
        <Construction className="h-6 w-6" style={{ color: "hsl(var(--accent))" }} />
      </div>
      <h1 className="display text-[1.6rem] font-extrabold tracking-tight text-t1">{title}</h1>
      <p className="mt-2 max-w-md text-[0.9rem] text-t2">{description}</p>
      <div className="mt-6 flex gap-2">
        <span className="pill">Coming next</span>
        <span className="pill" style={{ color: "hsl(var(--accent))", borderColor: "hsl(var(--accent) / 0.25)", background: "hsl(var(--accent) / 0.08)" }}>
          Production-ready scaffold
        </span>
      </div>
    </div>
  );
}

export default PlaceholderPage;
