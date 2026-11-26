import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { MessageSquareQuote, Quote, Star } from "lucide-react";
import { REVIEWS } from "@/content";
import { useReveal } from "@/useReveal";

/**
 * Merchant feedback: three real quotes (REVIEWS in content.ts), shown verbatim
 * with each merchant's rating, in the light landing style shared with the
 * Founding Merchants and FAQ sections. No photos were supplied, so each card
 * shows the merchant's initials.
 *
 * Motion: when the cards scroll into view the stars pop in one by one and each
 * quote types itself out, character by character, staggered per card. The
 * full quote is always in the DOM (the untyped part is transparent), so the
 * card never changes size and screen readers read the whole quote. With
 * reduced motion, or without IntersectionObserver, quotes show in full.
 */

const TYPE_MS_PER_CHAR = 16;
const CARD_STAGGER_MS = 350;
const TYPE_START_MS = 450;

/** Starts once (true) when the element is a quarter on screen. */
function useInView(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

const prefersReducedMotion = () =>
  typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How many characters of `text` are shown: types from 0 to the full length once `start` is true. */
function useTypewriter(text: string, start: boolean, delayMs: number) {
  const [shown, setShown] = useState(() => (typeof IntersectionObserver === "undefined" || prefersReducedMotion() ? text.length : 0));
  useEffect(() => {
    if (!start || shown >= text.length) return;
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    let frame = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const n = Math.min(text.length, Math.floor((now - t0) / TYPE_MS_PER_CHAR));
      setShown(n);
      if (n < text.length) frame = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
    // Runs once per start; `shown` only seeds the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, text, delayMs]);
  return shown;
}

function TypedQuote({ text, start, delayMs }: { text: string; start: boolean; delayMs: number }) {
  const full = `“${text}”`;
  const shown = useTypewriter(full, start, delayMs);
  const typing = shown < full.length;
  return (
    <p className={typing ? "is-typing" : undefined}>
      <span>{full.slice(0, shown)}</span>
      {typing ? <span className="rv-caret" aria-hidden="true" /> : null}
      <span className="rv-untyped">{full.slice(shown)}</span>
    </p>
  );
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Stars({ rating }: { rating: number }) {
  return (
    <p className="rv-stars" aria-label={`Rated ${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={16}
          strokeWidth={0}
          fill="currentColor"
          className={i < rating ? "is-on" : undefined}
          style={vars({ "--s": i })}
          aria-hidden="true"
        />
      ))}
    </p>
  );
}

export function ReviewsSection({ id }: { id?: string }) {
  const head = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  useReveal(head);
  useReveal(grid);
  const typing = useInView(grid);

  return (
    <section id={id} aria-labelledby="rv-title" className="rv-section py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-page px-5 sm:px-8">
        <div ref={head} className="mx-auto flex max-w-[52rem] flex-col items-center text-center">
          <p className="fm-eyebrow fx-up" style={vars({ "--i": 0 })}>
            <span className="fm-eyebrow__icon" aria-hidden="true">
              <MessageSquareQuote size={13} strokeWidth={2.2} />
            </span>
            {REVIEWS.eyebrow}
          </p>
          <h2
            id="rv-title"
            className="fx-up mt-5 font-headline text-[clamp(1.75rem,6.4vw,2.3rem)] font-black leading-[1.08] tracking-[-0.03em] text-ink [font-synthesis:none] [text-wrap:balance] sm:text-[clamp(2.1rem,3.8vw,2.85rem)]"
            style={vars({ "--i": 1 })}
          >
            {REVIEWS.headline.lead} <span className="text-indigo-deep">{REVIEWS.headline.accent}</span>
          </h2>
          <p className="fx-up mt-4 text-[0.98rem] leading-relaxed text-ink-muted [text-wrap:pretty] sm:text-[1.04rem]" style={vars({ "--i": 2 })}>
            {REVIEWS.description}
          </p>
        </div>

        <ul ref={grid} className="rv-grid" aria-label="Merchant feedback">
          {REVIEWS.items.map((r, i) => (
            <li key={r.id} className="rv-card fx-up sx-rise" data-spot style={vars({ "--i": i + 1, "--sx-from": i === 1 ? "84px" : "36px" })}>
              <figure className="rv-figure">
                <div className="rv-top">
                  <Stars rating={r.rating} />
                  <Quote size={28} strokeWidth={0} fill="currentColor" className="rv-mark" aria-hidden="true" />
                </div>
                <blockquote className="rv-quote">
                  <TypedQuote text={r.quote} start={typing} delayMs={TYPE_START_MS + i * CARD_STAGGER_MS} />
                </blockquote>
                <figcaption className="rv-person">
                  <span className="rv-avatar" aria-hidden="true">
                    {initials(r.name)}
                  </span>
                  <span>
                    <span className="rv-name">{r.name}</span>
                    <span className="rv-role">{r.role}</span>
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
