import type { CSSProperties } from "react";
import { ArrowUpRight, UserPlus } from "lucide-react";
import { CTA, HERO } from "@/content";
import { useLandingConfig } from "@/config";
import { HeroVisual } from "./HeroVisual";

const delay = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;

export function Hero() {
  const { joinHref, signUpHref, onJoin } = useLandingConfig();
  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip lg:flex lg:h-[calc(100svh_-_clamp(4rem,9svh,5rem))] lg:min-h-[32rem] lg:items-center">
      <div className="mx-auto grid max-w-page items-center gap-12 px-5 pb-16 pt-8 sm:px-8 sm:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:w-full lg:py-[clamp(0.75rem,3svh,2.5rem)]">
        <div className="max-w-[38rem]">
          <h1
            id="hero-title"
            className="rise text-[clamp(2.4rem,9.6vw,4.6rem)] sm:text-[clamp(2.6rem,7.4vw,4.6rem)] lg:text-[clamp(2.5rem,min(5.1vw,8.4svh),4.6rem)] font-semibold leading-[1.02] tracking-display text-ink"
            style={delay(0)}
          >
            {HERO.headline.lead.map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
            <span className="block text-indigo-deep">{HERO.headline.accent}</span>
          </h1>

          <p className="rise mt-6 text-[clamp(1.05rem,1.6vw,1.2rem)] lg:mt-[clamp(0.85rem,2.8svh,1.5rem)] font-semibold tracking-[-0.01em] text-ink" style={delay(160)}>
            {HERO.subline}
          </p>
          <p className="rise mt-3 max-w-[33rem] text-[1rem] leading-relaxed text-ink-muted sm:text-[1.04rem]" style={delay(200)}>
            {HERO.body}
          </p>

          <div className="rise mt-9 lg:mt-[clamp(1.1rem,4svh,2.25rem)] flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3.5" style={delay(260)}>
            <a
              href={joinHref}
              onClick={onJoin}
              className="group inline-flex min-h-[2.275rem] items-center gap-[0.7rem] self-start whitespace-nowrap rounded-full text-left bg-ink py-[0.2625rem] pl-[1.05rem] pr-[0.2625rem] text-[0.665rem] font-semibold text-white transition-colors hover:bg-indigo-deep"
            >
              {CTA.primary.label}
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/15 transition-transform group-hover:-translate-y-px group-hover:translate-x-px">
                <ArrowUpRight size={13} aria-hidden="true" />
              </span>
            </a>
            <a href={signUpHref} className="group inline-flex min-h-12 items-center gap-3 self-start whitespace-nowrap text-[0.95rem] font-semibold text-ink sm:self-auto">
              <span className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white shadow-[0_6px_18px_-8px_rgba(12,10,29,0.25)] transition-transform group-hover:scale-105">
                <UserPlus size={18} aria-hidden="true" />
              </span>
              {CTA.secondary.label}
            </a>
          </div>

          <dl className="rise mt-12 grid grid-cols-3 border-t border-line pt-6 sm:max-w-[33rem] lg:mt-[clamp(1.1rem,4.4svh,3rem)] lg:pt-[clamp(0.85rem,2.6svh,1.5rem)]" style={delay(320)}>
            {HERO.facts.map((fact, index) => (
              <div key={fact.title} className={`flex flex-col-reverse justify-end gap-1 ${index > 0 ? "border-l border-line pl-4 sm:pl-6" : "pr-4"}`}>
                <dt className="text-[0.78rem] leading-snug text-ink-muted">{fact.label}</dt>
                <dd className="text-[1.15rem] font-semibold tracking-[-0.02em] text-ink sm:text-[1.3rem]">{fact.title}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rise mx-auto w-full max-w-[40rem] lg:max-w-[calc((100svh_-_clamp(4rem,9svh,5rem))_*_0.9)]" style={delay(180)}>
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}
