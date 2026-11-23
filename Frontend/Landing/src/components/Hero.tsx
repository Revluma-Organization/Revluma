import type { CSSProperties } from "react";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { CTA, HERO } from "@/content";
import { useLandingConfig } from "@/config";
import { HeroVisual } from "./HeroVisual";

const delay = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;

export function Hero() {
  const { joinHref, exploreHref, onJoin } = useLandingConfig();
  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip">
      <div className="mx-auto grid max-w-page items-center gap-12 px-5 pb-16 pt-6 sm:px-8 sm:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:pb-24 lg:pt-10">
        <div className="max-w-[38rem]">
          <div className="rise flex flex-wrap items-center gap-x-4 gap-y-2" style={delay(0)}>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-1.5 text-[0.8rem] font-medium text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-brand" aria-hidden="true" />
              {HERO.eyebrow}
            </span>
            <span className="hidden h-px w-10 bg-line sm:block lg:hidden xl:block" aria-hidden="true" />
            <span className="text-[0.8rem] text-ink-faint">{HERO.tagline}</span>
          </div>

          <h1
            id="hero-title"
            className="rise mt-7 text-[clamp(2.4rem,9.6vw,4.6rem)] sm:text-[clamp(2.6rem,7.4vw,4.6rem)] lg:text-[clamp(2.6rem,5.1vw,4.6rem)] font-semibold leading-[1.02] tracking-display text-ink"
            style={delay(80)}
          >
            {HERO.headline.lead.map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
            <span className="block text-indigo-deep">{HERO.headline.accent}</span>
          </h1>

          <p className="rise mt-6 text-[clamp(1.05rem,1.6vw,1.2rem)] font-semibold tracking-[-0.01em] text-ink" style={delay(160)}>
            {HERO.subline}
          </p>
          <p className="rise mt-3 max-w-[33rem] text-[1rem] leading-relaxed text-ink-muted sm:text-[1.04rem]" style={delay(200)}>
            {HERO.body}
          </p>

          <div className="rise mt-9 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5" style={delay(260)}>
            <a
              href={joinHref}
              onClick={onJoin}
              className="group inline-flex min-h-[3.25rem] items-center justify-between gap-4 rounded-full text-left sm:whitespace-nowrap bg-ink py-1.5 pl-6 pr-1.5 text-[0.95rem] font-semibold text-white transition-colors hover:bg-indigo-deep sm:justify-start"
            >
              {CTA.primary.label}
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
                <ArrowUpRight size={18} aria-hidden="true" />
              </span>
            </a>
            <a href={exploreHref} className="group inline-flex min-h-12 items-center gap-3 self-start whitespace-nowrap text-[0.95rem] font-semibold text-ink sm:self-auto">
              <span className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white shadow-[0_6px_18px_-8px_rgba(12,10,29,0.25)] transition-transform group-hover:translate-y-0.5">
                <ArrowDown size={18} aria-hidden="true" />
              </span>
              {CTA.secondary.label}
            </a>
          </div>

          <dl className="rise mt-12 grid grid-cols-3 border-t border-line pt-6 sm:max-w-[33rem]" style={delay(320)}>
            {HERO.facts.map((fact, index) => (
              <div key={fact.title} className={`flex flex-col-reverse justify-end gap-1 ${index > 0 ? "border-l border-line pl-4 sm:pl-6" : "pr-4"}`}>
                <dt className="text-[0.78rem] leading-snug text-ink-muted">{fact.label}</dt>
                <dd className="text-[1.15rem] font-semibold tracking-[-0.02em] text-ink sm:text-[1.3rem]">{fact.title}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rise mx-auto w-full max-w-[40rem] lg:max-w-none" style={delay(180)}>
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}
