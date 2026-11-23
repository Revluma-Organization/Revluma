import icon from "@/assets/revluma-icon.png";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <img src={icon} alt="" width={28} height={28} className="h-7 w-7" />
      <span className="text-[1.05rem] font-bold uppercase tracking-[0.14em] text-ink">Revluma</span>
    </span>
  );
}
