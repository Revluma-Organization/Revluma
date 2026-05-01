import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useUI } from "@/store/ui";
import { TOUR_STEPS } from "@/data/tourSteps";
import { cn } from "@/lib/utils";

const PADDING = 8;
const CARD_W = 340;
const CARD_GAP = 14;

type Rect = { top: number; left: number; width: number; height: number };

function getRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function placeCard(target: Rect, placement: "auto" | "top" | "bottom" | "left" | "right") {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardH = 200; // approx; card auto-sizes but we need a placement guess

  let top = 0;
  let left = 0;
  let arrow: "top" | "bottom" | "left" | "right" = "top";

  const tryBottom = target.top + target.height + CARD_GAP + cardH < vh - 16;
  const tryTop = target.top - CARD_GAP - cardH > 16;
  const tryRight = target.left + target.width + CARD_GAP + CARD_W < vw - 16;

  let p = placement;
  if (p === "auto") p = tryBottom ? "bottom" : tryTop ? "top" : tryRight ? "right" : "left";

  if (p === "bottom") {
    top = target.top + target.height + CARD_GAP;
    left = target.left + target.width / 2 - CARD_W / 2;
    arrow = "top";
  } else if (p === "top") {
    top = target.top - CARD_GAP - cardH;
    left = target.left + target.width / 2 - CARD_W / 2;
    arrow = "bottom";
  } else if (p === "right") {
    top = target.top + target.height / 2 - cardH / 2;
    left = target.left + target.width + CARD_GAP;
    arrow = "left";
  } else {
    top = target.top + target.height / 2 - cardH / 2;
    left = target.left - CARD_GAP - CARD_W;
    arrow = "right";
  }

  // clamp into viewport
  left = Math.max(12, Math.min(left, vw - CARD_W - 12));
  top = Math.max(12, Math.min(top, vh - cardH - 12));

  return { top, left, arrow };
}

export function ProductTour() {
  const { tourOpen, tourStep, setTourStep, endTour } = useUI();
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; arrow: string } | null>(null);
  const [missing, setMissing] = useState(false);

  const total = TOUR_STEPS.length;
  const step = TOUR_STEPS[tourStep];

  const compute = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) {
      setMissing(true);
      setRect(null);
      // center the card
      setPos({
        top: window.innerHeight / 2 - 100,
        left: window.innerWidth / 2 - CARD_W / 2,
        arrow: "none",
      });
      return;
    }
    setMissing(false);
    // scroll into view
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    // small delay so layout settles after scroll
    requestAnimationFrame(() => {
      const r = getRect(el);
      setRect(r);
      setPos(placeCard(r, step.placement ?? "auto"));
    });
  }, [step]);

  useLayoutEffect(() => {
    if (!tourOpen) return;
    compute();
  }, [tourOpen, tourStep, compute]);

  useEffect(() => {
    if (!tourOpen) return;
    const onResize = () => compute();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [tourOpen, compute]);

  // keyboard nav
  useEffect(() => {
    if (!tourOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOpen, tourStep]);

  const next = () => {
    if (tourStep >= total - 1) endTour();
    else setTourStep(tourStep + 1);
  };
  const prev = () => {
    if (tourStep > 0) setTourStep(tourStep - 1);
  };

  if (!tourOpen || !step || !pos) return null;

  const isLast = tourStep === total - 1;

  return createPortal(
    <div className="fixed inset-0 z-[300]" aria-live="polite">
      {/* Spotlight backdrop */}
      <AnimatePresence>
        {rect && !missing && (
          <motion.div
            key="spot"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none absolute"
            style={{
              top: rect.top - PADDING,
              left: rect.left - PADDING,
              width: rect.width + PADDING * 2,
              height: rect.height + PADDING * 2,
              borderRadius: 12,
              boxShadow:
                "0 0 0 9999px hsl(0 0% 0% / 0.78), 0 0 0 1px hsl(0 0% 100% / 0.45), 0 0 24px 2px hsl(0 0% 100% / 0.18)",
              transition: "all 220ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        )}
        {(missing || !rect) && (
          <motion.div
            key="dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70"
          />
        )}
      </AnimatePresence>

      {/* Click-outside to skip (clicks on the dim layer) */}
      <button
        aria-label="Skip tour"
        onClick={endTour}
        className="absolute inset-0 cursor-default"
        tabIndex={-1}
      />

      {/* Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tourStep}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          className="absolute"
          style={{ top: pos.top, left: pos.left, width: CARD_W }}
        >
          <div className="relative overflow-hidden rounded-xl border border-border-md bg-bg-notif shadow-elegant">
            {/* Top hairline */}
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: "hsl(0 0% 100% / 0.12)" }}
            />

            <div className="flex items-start gap-3 px-4 pb-2 pt-4">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-md"
                style={{ background: "hsl(0 0% 100% / 0.05)" }}
              >
                <Sparkles className="h-4 w-4 text-t1" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-t3">
                    Step {tourStep + 1} / {total}
                  </span>
                  <button
                    onClick={endTour}
                    className="rounded p-1 text-t3 transition-colors hover:bg-white/[0.06] hover:text-t1"
                    aria-label="Close tour"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <h4 id="tour-title" className="mt-1 text-[0.95rem] font-semibold text-t1">
                  {step.title}
                </h4>
              </div>
            </div>

            <p className="px-4 pb-3 text-[0.81rem] leading-relaxed text-t2">{step.body}</p>

            {/* Progress bar */}
            <div className="px-4">
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "hsl(0 0% 100% / 0.85)" }}
                  initial={false}
                  animate={{ width: `${((tourStep + 1) / total) * 100}%` }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <button
                onClick={endTour}
                className="text-[0.74rem] font-medium text-t3 transition-colors hover:text-t1"
              >
                Skip tour
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={prev}
                  disabled={tourStep === 0}
                  className={cn(
                    "flex h-8 items-center gap-1 rounded-md border border-border bg-white/[0.04] px-2.5 text-[0.74rem] font-medium text-t1 transition-colors hover:border-border-md",
                    tourStep === 0 && "cursor-not-allowed opacity-40",
                  )}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <button
                  onClick={next}
                  className="flex h-8 items-center gap-1 rounded-md bg-white px-3 text-[0.74rem] font-semibold text-black transition-colors hover:bg-white/90"
                >
                  {isLast ? "Finish" : "Next"}
                  {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}
