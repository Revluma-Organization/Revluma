import { useRef, type CSSProperties } from "react";
import { MessageSquareQuote, Quote, Star } from "lucide-react";
import { REVIEWS } from "@/content";
import { useReveal } from "@/useReveal";

/**
 * Merchant feedback: three real quotes (REVIEWS in content.ts), shown verbatim
 * with each merchant's rating, in the light landing style shared with the
 * Founding Merchants and FAQ sections. No photos were supplied, so each card
 * shows the merchant's initials.
 */

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
        <Star key={i} size={15} strokeWidth={0} fill="currentColor" className={i < rating ? "is-on" : undefined} aria-hidden="true" />
      ))}
    </p>
  );
}

export function ReviewsSection({ id }: { id?: string }) {
  const head = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  useReveal(head);
  useReveal(grid);

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
            <li key={r.id} className="rv-card fx-up" style={vars({ "--i": i + 1 })}>
              <figure className="rv-figure">
                <div className="rv-top">
                  <Stars rating={r.rating} />
                  <Quote size={28} strokeWidth={0} fill="currentColor" className="rv-mark" aria-hidden="true" />
                </div>
                <blockquote className="rv-quote">
                  <p>&ldquo;{r.quote}&rdquo;</p>
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
