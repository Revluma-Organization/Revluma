import { useRef, type CSSProperties } from "react";
import { ArrowUpRight, UserPlus } from "lucide-react";
import { CTA, HERO } from "@/content";
import { useLandingConfig } from "@/config";
import { usePointerParallax, useScrollProgress } from "@/useHeroMotion";
import { HeroVisual } from "./HeroVisual";

/**
 * Entrance pace. The delays below are the original (PR #436) timings; TEMPO
 * stretches them to match the slower durations in motion.css.
 */
const TEMPO = 1.6;

/** Entrance delay for one element (see motion.css). */
const at = (ms: number) => ({ "--d": `${Math.round(ms * TEMPO)}ms` }) as CSSProperties;

// Headline words enter one after another, 60ms apart (before TEMPO).
const WORD_START = 150;
const WORD_STEP = 60;
const HEADLINE = [
  ...HERO.headline.lead.map((line) => ({ words: line.split(" "), accent: false })),
  { words: HERO.headline.accent.split(" "), accent: true },
];

export function Hero() {
  const { joinHref, signUpHref, onJoin } = useLandingConfig();
  const sectionRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  usePointerParallax(sectionRef);
  useScrollProgress(copyRef);
  let wordIndex = 0;

  return (
    <section ref={sectionRef} aria-labelledby="hero-title" className="relative overflow-x-clip lg:flex lg:h-[calc(100svh_-_clamp(4rem,9svh,5rem))] lg:min-h-[32rem] lg:items-center">
      <div className="mx-auto grid max-w-page items-center gap-12 px-5 pb-16 pt-8 sm:px-8 sm:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:w-full lg:py-[clamp(0.75rem,3svh,2.5rem)]">
        <div ref={copyRef} className="m-scroll-copy max-w-[38rem]">
          <h1
            id="hero-title"
            className="text-[clamp(2.4rem,9.6vw,4.6rem)] sm:text-[clamp(2.6rem,7.4vw,4.6rem)] lg:text-[clamp(2.5rem,min(5.1vw,8.4svh),4.6rem)] font-semibold leading-[1.02] tracking-display text-ink"
          >
            {HEADLINE.map((line) => (
              <span key={line.words.join(" ")} className={`block ${line.accent ? "text-indigo-deep" : ""}`}>
                {line.words.map((word, i) => (
                  <span key={word}>
                    {i > 0 && " "}
                    <span className={line.accent ? "m-word m-sheen" : "m-word"} style={at(WORD_START + WORD_STEP * wordIndex++)}>
                      {word}
                    </span>
                  </span>
                ))}
              </span>
            ))}
          </h1>

          <p className="m-fade mt-6 text-[clamp(1.05rem,1.6vw,1.2rem)] lg:mt-[clamp(0.85rem,2.8svh,1.5rem)] font-semibold tracking-[-0.01em] text-ink" style={at(640)}>
            {HERO.subline}
          </p>
          <p className="m-fade mt-3 max-w-[33rem] text-[1rem] leading-relaxed text-ink-muted sm:text-[1.04rem]" style={at(720)}>
            {HERO.body}
          </p>

          <div className="mt-9 lg:mt-[clamp(1.1rem,4svh,2.25rem)] flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3.5">
            <a
              href={joinHref}
              onClick={onJoin}
              style={at(820)}
              className="m-pop m-shine group relative isolate overflow-hidden inline-flex min-h-[2.275rem] items-center gap-[0.7rem] self-start whitespace-nowrap rounded-full text-left bg-ink py-[0.2625rem] pl-[1.05rem] pr-[0.2625rem] text-[0.665rem] font-semibold text-white transition-colors hover:bg-indigo-deep"
            >
              {CTA.primary.label}
              {/* Arrow swap on hover: one arrow leaves top-right as the next arrives. */}
              <span className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-white/15 transition-colors duration-300 group-hover:bg-white/25">
                <ArrowUpRight size={13} aria-hidden="true" className="transition-transform duration-300 ease-out group-hover:-translate-y-[180%] group-hover:translate-x-[180%]" />
                <ArrowUpRight size={13} aria-hidden="true" className="absolute -translate-x-[180%] translate-y-[180%] transition-transform duration-300 ease-out group-hover:translate-x-0 group-hover:translate-y-0" />
              </span>
            </a>
            <a href={signUpHref} style={at(900)} className="m-pop group inline-flex min-h-12 items-center gap-3 self-start whitespace-nowrap text-[0.95rem] font-semibold text-ink sm:self-auto">
              <span className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white shadow-[0_6px_18px_-8px_rgba(12,10,29,0.25)] transition-[transform,background-color,color,border-color,box-shadow] duration-300 ease-out group-hover:-translate-y-0.5 group-hover:border-ink group-hover:bg-ink group-hover:text-white group-hover:shadow-[0_10px_22px_-10px_rgba(12,10,29,0.55)]">
                <UserPlus size={18} aria-hidden="true" />
              </span>
              {CTA.secondary.label}
            </a>
          </div>

          <dl className="relative mt-12 grid grid-cols-3 pt-6 sm:max-w-[33rem] lg:mt-[clamp(1.1rem,4.4svh,3rem)] lg:pt-[clamp(0.85rem,2.6svh,1.5rem)]">
            <span className="m-rule absolute inset-x-0 top-0 h-px bg-line" style={at(980)} aria-hidden="true" />
            {HERO.facts.map((fact, index) => (
              <div key={fact.title} style={at(1060 + index * 80)} className={`m-fade flex flex-col-reverse justify-end gap-1 ${index > 0 ? "border-l border-line pl-4 sm:pl-6" : "pr-4"}`}>
                <dt className="text-[0.78rem] leading-snug text-ink-muted">{fact.label}</dt>
                <dd className="text-[1.15rem] font-semibold tracking-[-0.02em] text-ink sm:text-[1.3rem]">{fact.title}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mx-auto w-full max-w-[40rem] lg:max-w-[calc((100svh_-_clamp(4rem,9svh,5rem))_*_0.9)]">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}
