import { FC } from "react";
import { Lock } from "lucide-react";

interface Props {
  title: string;
}

const SettingsPlaceholder: FC<Props> = ({ title }) => {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-t1 display">{title}</h1>
        <p className="text-[0.85rem] text-t3 mt-1">
          This settings page is currently under construction.
        </p>
      </div>

      <div className="border border-border border-dashed rounded-xl h-64 flex flex-col items-center justify-center bg-bg-2 relative overflow-hidden group">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.015] to-transparent" />
        
        <div className="h-12 w-12 rounded-full bg-[hsl(var(--accent)/0.1)] border border-[hsl(var(--accent)/0.2)] flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-500">
          <Lock className="h-5 w-5 text-[hsl(var(--accent))]" />
        </div>
        
        <h3 className="text-t1 font-semibold text-sm">Coming Soon</h3>
        <p className="text-t3 text-xs mt-1 text-center max-w-sm">
          We are actively working on expanding the settings dashboard. This module will be available shortly.
        </p>
      </div>
    </div>
  );
};

export default SettingsPlaceholder;
