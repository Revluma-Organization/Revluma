import { Sparkles, BellRing, ArrowRight, Clock, Rocket, FlaskConical } from "lucide-react";
import { DESIGN_TOKENS } from "@/lib/DesignConstants";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  let Icon = Sparkles;
  const t = title.toLowerCase();
  if (t.includes("beta") || t.includes("experiment")) {
    Icon = FlaskConical;
  } else if (t.includes("campaign") || t.includes("analytic")) {
    Icon = Rocket;
  }

  return (
    <div className={DESIGN_TOKENS.emptyState.container}>
      <div className={DESIGN_TOKENS.emptyState.iconWrapper}>
        <Icon className={DESIGN_TOKENS.emptyState.icon} strokeWidth={1.5} />
      </div>
      
      <h1 className={DESIGN_TOKENS.emptyState.title}>
        {title} is coming soon
      </h1>
      
      <p className={DESIGN_TOKENS.emptyState.description}>
        {description} We're working hard to bring this feature to life. Join the waitlist to get early access and exclusive updates before the public release.
      </p>
      
      <div className={`flex w-full max-w-md items-center gap-2 p-2 ${DESIGN_TOKENS.card}`}>
        <div className="flex items-center pl-3">
          <BellRing className="h-4 w-4 text-slate-400" />
        </div>
        <input 
          type="email" 
          placeholder="Enter your email address" 
          className="flex-1 bg-transparent px-2 py-2 text-[0.85rem] text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-none"
        />
        <button 
          onClick={(e) => {
            const input = e.currentTarget.previousElementSibling as HTMLInputElement;
            if(input.value) {
              input.value = "";
              alert("You're on the list! We'll notify you when " + title + " is ready.");
            }
          }}
          className={DESIGN_TOKENS.buttonPrimary + " flex items-center gap-2 rounded-md px-4 py-2 text-[0.8rem] transition-transform active:scale-95"}
        >
          Notify me
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-16 flex gap-3 opacity-60">
        <span className="inline-flex items-center rounded-full border border-slate-300 dark:border-slate-700 px-3 py-1 text-[0.65rem] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          In Development
        </span>
      </div>
    </div>
  );
}

export default PlaceholderPage;
