import { motion } from "framer-motion";
import { Store, ArrowRight, Zap, TrendingUp, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function GlobalOnboarding() {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mt-10 max-w-3xl text-center"
    >
      <div className="glass-card overflow-hidden rounded-3xl border border-border bg-bg-2 p-10 shadow-2xl">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl" style={{ background: "hsl(var(--accent) / 0.1)", border: "1px solid hsl(var(--accent) / 0.2)" }}>
          <Store className="h-10 w-10" style={{ color: "hsl(var(--accent))" }} />
        </div>
        
        <h2 className="mb-4 text-[2rem] font-extrabold tracking-tight text-t1">
          Welcome to Revluma
        </h2>
        
        <p className="mx-auto mb-10 max-w-lg text-[0.95rem] leading-relaxed text-t2">
          Your dashboard is empty because you haven't connected a store yet. Connect your Shopify or custom store to unlock powerful intelligence, automated cart recovery, and customer segmentation.
        </p>

        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3 text-left">
          {[
            { title: "Recover Revenue", desc: "Automated sequences for abandoned carts", icon: Zap },
            { title: "Deep Analytics", desc: "Real-time metrics & KPI tracking", icon: TrendingUp },
            { title: "Customer Intelligence", desc: "RFM segmentation & LTV tracking", icon: Users },
          ].map((item, i) => (
            <div key={i} className="rounded-xl border border-border-soft bg-bg-3 p-4">
              <item.icon className="mb-3 h-5 w-5" style={{ color: "hsl(var(--accent))" }} />
              <h4 className="mb-1 text-sm font-bold text-t1">{item.title}</h4>
              <p className="text-[0.75rem] text-slate-500 dark:text-slate-400 leading-tight">{item.desc}</p>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate("/dashboard/integrations")}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-sm font-bold shadow-xl transition-transform hover:-translate-y-0.5 active:scale-95"
          style={{ background: "hsl(var(--accent))", color: "#000", boxShadow: "0 10px 25px -5px hsl(var(--accent)/0.3)" }}
        >
          Connect Your First Store
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}
