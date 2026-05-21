import React from 'react';
import { Award, Lock, Signal, RefreshCw, Layers, ShieldCheck } from 'lucide-react';

interface LeaderboardComingSoonProps {
  currentApprovedCount: number;
}

export default function LeaderboardComingSoon({ currentApprovedCount }: LeaderboardComingSoonProps) {
  const requiredCount = 10;
  const progressPercent = Math.min(100, Math.round((currentApprovedCount / requiredCount) * 100));

  return (
    <div id="leaderboard-coming-soon" className="space-y-8 animate-fade-in">
      {/* Premium Dark Retro Header */}
      <div className="text-center py-6 space-y-2 relative overflow-hidden rounded-3xl bg-[#0b0d13] border border-zinc-800 p-8 shadow-[0_10px_40px_rgba(0,0,0,0.6)]">
        <div className="absolute inset-0 bg-[#00ff22]/[0.01] bg-[radial-gradient(#00ff22_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none opacity-30"></div>
        
        <div className="absolute top-4 right-4 flex items-center space-x-1.5 text-[9px] font-mono text-zinc-500 bg-zinc-950/80 px-2.5 py-1 rounded-full border border-zinc-850">
          <Signal className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span>REALTIME DEPLOYMENT MONITORS</span>
        </div>

        <h2 className="text-2xl sm:text-4xl font-extrabold tracking-widest text-zinc-200 font-mono uppercase select-none">
          🏆 LEADERBOARD CONSOLE 🏆
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400 font-mono max-w-2xl mx-auto leading-relaxed">
          Monitor performance allocations and yield levels of our verified distribution nodes.
        </p>
      </div>

      {/* Main Encrypted Screen / Coming Soon Block */}
      <div className="max-w-3xl mx-auto rounded-2xl bg-zinc-950/80 border border-zinc-850/60 p-8 relative overflow-hidden flex flex-col items-center justify-center space-y-6 text-center select-none min-h-[420px]">
        {/* Glow ambient background elements */}
        <div className="absolute w-[250px] h-[250px] bg-emerald-500/5 rounded-full blur-[80px] -top-10 -left-10 pointer-events-none"></div>
        <div className="absolute w-[250px] h-[250px] bg-orange-500/5 rounded-full blur-[80px] -bottom-10 -right-10 pointer-events-none"></div>

        {/* Lock Shield Icon Container */}
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-zinc-904/50 border border-zinc-800 flex items-center justify-center shadow-lg relative z-10">
            <Lock className="w-7 h-7 text-orange-500 animate-pulse" />
          </div>
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-orange-500/20 to-amber-500/20 blur-sm pointer-events-none"></div>
        </div>

        <div className="space-y-2.5 max-w-lg relative z-10">
          <span className="text-[10px] font-mono tracking-widest text-orange-400 uppercase font-black bg-orange-500/10 px-3 py-1 rounded-full border border-orange-500/20">
            CONSOLE ENCRYPTED
          </span>
          <h3 className="text-xl font-display font-bold text-white tracking-tight pt-2">System Onboarding Synchronization Required</h3>
          <p className="text-xs text-zinc-400 leading-relaxed font-sans font-medium">
            To ensure statistical significance and respect structural integrity guidelines, the public rankings console remains locked until a threshold of at least <strong className="text-white font-mono">10 real, verified and approved growth partners</strong> have successfully synchronized active conversion streams.
          </p>
        </div>

        {/* Real Dynamic Onboarding Progress Bar */}
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3 relative z-10 shadow-md">
          <div className="flex justify-between text-[10px] font-mono font-bold tracking-wider text-zinc-400 uppercase">
            <span className="flex items-center gap-1.5 grayscale opacity-80">
              <Layers className="w-3.5 h-3.5 text-zinc-400" />
              Node Sync progress
            </span>
            <span className="text-emerald-400 font-extrabold">{currentApprovedCount} / {requiredCount} NODES ACTIVE</span>
          </div>

          <div className="h-4 w-full bg-zinc-950 border border-zinc-850 rounded-lg p-0.5 overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-md transition-all duration-1000 shadow-[0_0_10px_rgba(16,185,129,0.3)] flex items-center justify-end pr-2"
              style={{ width: `${progressPercent}%` }}
            >
              {progressPercent > 10 && (
                <span className="text-[8px] font-mono font-black text-zinc-950">{progressPercent}%</span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-[9px] font-mono text-zinc-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              Zero fake telemetry logs generated.
            </span>
            <span className="italic flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin text-zinc-600" />
              Polling network...
            </span>
          </div>
        </div>

        {/* Informational Guidelines list */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 max-w-xl w-full text-left relative z-10">
          <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-850/60 font-mono text-[10px] space-y-1.5">
            <span className="text-zinc-400 font-extrabold uppercase tracking-wider block">🛡️ SYSTEM INTEGRITY RULES</span>
            <p className="text-zinc-500 leading-relaxed font-medium">To protect campaign privacy, individual conversion tracking segments are encrypted and mapped only to authorized distributor accounts.</p>
          </div>
          <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-850/60 font-mono text-[10px] space-y-1.5">
            <span className="text-zinc-400 font-extrabold uppercase tracking-wider block">⚡ COMMISSION BONUS SCHEDULER</span>
            <p className="text-zinc-550 leading-relaxed font-medium">Once the system synchronizes 10 nodes, the leader pool unlocks and grants automated high-volume multipliers up to 40%.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
