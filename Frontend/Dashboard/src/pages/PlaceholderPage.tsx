import { Sparkles, BellRing, ArrowRight } from "lucide-react";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center justify-center py-16 text-center">
      <div
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border shadow-2xl"
        style={{ 
          background: "linear-gradient(135deg, hsl(var(--accent) / 0.15) 0%, hsl(var(--accent) / 0.05) 100%)", 
          borderColor: "hsl(var(--accent) / 0.25)" 
        }}
      >
        <Sparkles className="h-9 w-9" style={{ color: "hsl(var(--accent))" }} />
      </div>
      
      <h1 className="display text-[2.2rem] font-extrabold tracking-tight text-t1 mb-3">
        {title} is coming soon
      </h1>
      
      <p className="max-w-xl text-[0.95rem] text-t2 mb-10 leading-relaxed">
        {description} We're working hard to bring this feature to life. Join the waitlist to get early access and exclusive updates before the public release.
      </p>
      
      <div className="glass-card flex w-full max-w-md items-center gap-2 p-2" style={{ background: "hsl(var(--bg-3))" }}>
        <div className="flex items-center pl-3">
          <BellRing className="h-4 w-4 text-t3" />
        </div>
        <input 
          type="email" 
          placeholder="Enter your email address" 
          className="flex-1 bg-transparent px-2 py-2 text-[0.85rem] text-t1 placeholder:text-t4 focus:outline-none"
        />
        <button 
          onClick={(e) => {
            const input = e.currentTarget.previousElementSibling as HTMLInputElement;
            if(input.value) {
              input.value = "";
              alert("You're on the list! We'll notify you when " + title + " is ready.");
            }
          }}
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[0.8rem] font-bold transition-transform hover:-translate-y-0.5 active:scale-95" 
          style={{ background: "hsl(var(--t1))", color: "hsl(var(--bg))" }}
        >
          Notify me
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-16 flex gap-3 opacity-60">
        <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-[0.65rem] font-bold uppercase tracking-widest text-t3">
          In Development
        </span>
      </div>
    </div>
  );
}

export default PlaceholderPage;
