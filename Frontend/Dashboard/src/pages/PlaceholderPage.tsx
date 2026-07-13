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
      
      <div className="flex flex-row w-full max-w-md items-center p-1 border border-slate-800 bg-slate-950 rounded-lg">
        <input 
          type="email" 
          placeholder="Enter your email address" 
          className="bg-transparent outline-none flex-1 px-3 text-sm text-white placeholder:text-slate-500"
        />
        <button 
          onClick={(e) => {
            const input = e.currentTarget.previousElementSibling as HTMLInputElement;
            if(input.value) {
              input.value = "";
              alert("You're on the list! We'll notify you when " + title + " is ready.");
            }
          }}
          className="bg-white text-slate-900 px-4 py-1.5 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Notify Me
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
