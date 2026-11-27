import { type MouseEvent, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { cc, palette, roleColor } from "./tokens";

export type SeverityFilterTier = "all" | "critical_high" | "medium" | "low";

export interface SeveritySummaryDeckProps {
  counts: {
    criticalHigh: number;
    medium: number;
    low: number;
  };
  totalCount: number;
  activeTier: SeverityFilterTier;
  onToggleTier: (tier: Exclude<SeverityFilterTier, "all">) => void;
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface TierConfig {
  id: Exclude<SeverityFilterTier, "all">;
  indexLabel: string;
  label: string;
  note: string;
  count: number;
  dotColor: string;
  pulseColor: string;
  meterColor: string;
  spotlightRgba: string;
  activeBorderClass: string;
  activeSurfaceClass: string;
  glyphColor: string;
  mutedGlyphColor: string;
}

function TelemetryGlyph({
  tier,
  active,
  hovered,
  reducedMotion,
}: {
  tier: TierConfig;
  active: boolean;
  hovered: boolean;
  reducedMotion: boolean;
}) {
  const color = active ? tier.glyphColor : tier.mutedGlyphColor;

  if (tier.id === "critical_high") {
    const heights = [6, 10, 14];
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="overflow-visible"
      >
        {heights.map((h, i) => (
          <motion.rect
            key={i}
            x={2 + i * 5}
            y={14 - h}
            width="2.5"
            height={h}
            rx="1.25"
            fill={color}
            initial={false}
            animate={
              reducedMotion
                ? { scaleY: 1 }
                : hovered
                  ? { scaleY: [1, 1.18 - i * 0.04, 1] }
                  : active
                    ? { scaleY: [1, 0.72 + i * 0.12, 1] }
                    : { scaleY: 1 }
            }
            style={{ transformOrigin: `${3.25 + i * 5}px 14px` }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : hovered
                  ? { duration: 0.48, delay: i * 0.06, ease: EASE_OUT_EXPO }
                  : active
                    ? {
                        duration: 2.4,
                        delay: i * 0.22,
                        repeat: Infinity,
                        repeatDelay: 1.6,
                        ease: "easeInOut",
                      }
                    : { duration: 0.2 }
            }
          />
        ))}
      </svg>
    );
  }

  if (tier.id === "medium") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="overflow-visible"
      >
        <motion.path
          d="M2.5 10.5C4.5 10.5 5.2 6.5 8 6.5C10.8 6.5 11.5 10.5 13.5 10.5"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
          initial={false}
          animate={
            reducedMotion
              ? { pathLength: 1, opacity: 1 }
              : hovered
                ? { y: [0, -1.5, 0] }
                : { y: 0 }
          }
          transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
        />
        <motion.circle
          cx="8"
          cy="6.5"
          r="1.75"
          fill={color}
          initial={false}
          animate={
            reducedMotion
              ? { scale: 1 }
              : hovered
                ? { scale: [1, 1.3, 1] }
                : active
                  ? { scale: [1, 1.15, 1] }
                  : { scale: 1 }
          }
          style={{ transformOrigin: "8px 6.5px" }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : {
                  duration: hovered ? 0.45 : 3.2,
                  repeat: hovered || !active ? 0 : Infinity,
                  repeatDelay: 1.4,
                  ease: "easeInOut",
                }
          }
        />
      </svg>
    );
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="overflow-visible"
    >
      <circle
        cx="8"
        cy="8"
        r="5.5"
        stroke={color}
        strokeWidth="1.4"
        strokeOpacity="0.32"
      />
      <motion.path
        d="M8 2.5A5.5 5.5 0 0 1 13.5 8"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        initial={false}
        animate={
          reducedMotion
            ? { rotate: 0 }
            : hovered
              ? { rotate: 90 }
              : active
                ? { rotate: 360 }
                : { rotate: 0 }
        }
        style={{ transformOrigin: "8px 8px" }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : hovered
              ? { duration: 0.6, ease: EASE_OUT_EXPO }
              : active
                ? { duration: 8, repeat: Infinity, ease: "linear" }
                : { duration: 0.35, ease: EASE_OUT_EXPO }
        }
      />
      <circle cx="8" cy="8" r="1.75" fill={color} />
    </svg>
  );
}

interface TierCardProps {
  tier: TierConfig;
  index: number;
  totalCount: number;
  canFilter: boolean;
  isSelected: boolean;
  onSelect: () => void;
  reducedMotion: boolean;
}

function SeverityTierCard({
  tier,
  index,
  totalCount,
  canFilter,
  isSelected,
  onSelect,
  reducedMotion,
}: TierCardProps) {
  const [hovered, setHovered] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number; active: boolean }>({
    x: 50,
    y: 50,
    active: false,
  });

  const hasItems = tier.count > 0;
  const shareRatio = totalCount > 0 ? Math.min(1, tier.count / totalCount) : 0;

  const handleMouseMove = (event: MouseEvent<HTMLElement>) => {
    if (reducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setPointer({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
      active: true,
    });
  };

  const handleMouseLeave = () => {
    setHovered(false);
    setPointer((prev) => ({ ...prev, active: false }));
  };

  const innerContent = (
    <>
      {/* Interactive radial studio sheen (landing page pointer lighting) */}
      {!reducedMotion && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
          style={{
            opacity: pointer.active ? 1 : 0,
            background: `radial-gradient(240px circle at ${pointer.x}% ${pointer.y}%, ${tier.spotlightRgba}, transparent 72%)`,
          }}
        />
      )}

      {/* Subtle top-edge specular highlight */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-90"
      />

      {/* Shared-layout spring outline when a severity filter is active */}
      {isSelected && (
        <motion.span
          layoutId={reducedMotion ? undefined : "severity-summary-active-ring"}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit] border-[1.5px]",
            tier.activeBorderClass,
          )}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 420, damping: 32 }
          }
        />
      )}

      <div className="relative z-10 flex h-full flex-col justify-between gap-4">
        {/* Top row: editorial label + sculpted raised telemetry disc */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                {hasItems && !reducedMotion && tier.id === "critical_high" && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inline-flex h-full w-full rounded-full"
                    style={{ backgroundColor: tier.pulseColor }}
                    animate={{ scale: [1, 2.35], opacity: [0.55, 0] }}
                    transition={{
                      duration: 2.2,
                      repeat: Infinity,
                      repeatDelay: 0.9,
                      ease: EASE_OUT_EXPO,
                    }}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: hasItems ? tier.dotColor : roleColor("deck", "dotEmpty"),
                  }}
                />
              </span>
              <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">
                {tier.label}
              </span>
            </div>
          </div>

          {/* Raised landing-page disc housing bespoke animated telemetry glyph */}
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-line transition-transform duration-300 group-hover:scale-[1.04]"
            style={{
              background: "var(--rv-gradient-orb)",
              boxShadow: `0 4px 10px -4px rgba(12, 10, 29, 0.14), inset 0 1px 0 ${roleColor("surface", "panel")}`,
            }}
          >
            <TelemetryGlyph
              tier={tier}
              active={hasItems}
              hovered={hovered}
              reducedMotion={reducedMotion}
            />
          </span>
        </div>

        {/* Center: editorial display numeral + live filter/share cue */}
        <div className="flex items-end justify-between gap-3">
          <motion.p
            key={tier.count}
            initial={reducedMotion ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              duration: reducedMotion ? 0 : 0.45,
              delay: reducedMotion ? 0 : index * 0.06,
              ease: EASE_OUT_EXPO,
            }}
            className={cn(
              "text-[2rem] font-semibold leading-none tracking-[-0.04em] tabular-nums",
              hasItems ? "text-ink" : "text-ink-muted",
            )}
          >
            {tier.count}
          </motion.p>

          <div className="flex items-center gap-1.5 pb-0.5">
            {isSelected ? (
              <span className="inline-flex items-center rounded-full bg-brand-mist px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.01em] text-brand-band">
                Filtered
              </span>
            ) : canFilter && hasItems ? (
              <span
                className={cn(
                  "text-[11px] font-medium text-ink-muted transition-all duration-200",
                  hovered ? "translate-x-0 text-brand-band opacity-100" : "opacity-75",
                )}
              >
                {totalCount > 0 ? `${tier.count} of ${totalCount}` : ""}
              </span>
            ) : (
              <span aria-hidden="true" className="font-mono text-[10.5px] tabular-nums text-deck-ghost">
                {tier.indexLabel}
              </span>
            )}
          </div>
        </div>

        {/* Bottom: calm editorial caption + animated proportional hairline track */}
        <div className="space-y-2.5">
          <p className="text-[11.5px] leading-4 text-ink-muted">{tier.note}</p>

          <div
            aria-hidden="true"
            className="h-[2px] w-full overflow-hidden rounded-full bg-wash"
          >
            <motion.div
              className="h-full origin-left rounded-full"
              style={{ backgroundColor: tier.meterColor }}
              initial={reducedMotion ? { scaleX: shareRatio } : { scaleX: 0 }}
              animate={{ scaleX: shareRatio }}
              transition={{
                duration: reducedMotion ? 0 : 0.72,
                delay: reducedMotion ? 0 : 0.14 + index * 0.07,
                ease: EASE_OUT_EXPO,
              }}
            />
          </div>
        </div>
      </div>
    </>
  );

  const sharedClasses = cn(
    "group relative min-w-0 overflow-hidden rounded-2xl border px-4 py-4 text-left transition-[border-color,box-shadow,background-color] duration-200",
    isSelected
      ? tier.activeSurfaceClass
      : "border-line-soft bg-white hover:border-brand-line",
    canFilter && cc.focus,
  );

  const sharedStyle = {
    boxShadow: isSelected
      ? "0 1px 2px rgba(12, 10, 29, 0.05), 0 12px 26px -16px rgba(43, 19, 207, 0.24), inset 0 1px 0 rgb(var(--rv-surface-panel) / 0.95)"
      : "0 1px 2px rgba(12, 10, 29, 0.03), 0 10px 24px -18px rgba(12, 10, 29, 0.14), inset 0 1px 0 rgb(var(--rv-surface-panel) / 0.95)",
  };

  const motionProps = {
    initial: reducedMotion ? false : { opacity: 0, y: 10, filter: "blur(3px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    whileHover: reducedMotion || !canFilter ? undefined : { y: -2 },
    whileTap: reducedMotion || !canFilter ? undefined : { scale: 0.99 },
    transition: {
      duration: reducedMotion ? 0 : 0.52,
      delay: reducedMotion ? 0 : index * 0.07,
      ease: EASE_OUT_EXPO,
    },
    onMouseEnter: () => setHovered(true),
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
  };

  if (canFilter) {
    return (
      <motion.button
        type="button"
        aria-pressed={isSelected}
        onClick={onSelect}
        className={cn(sharedClasses, "cursor-pointer")}
        style={sharedStyle}
        {...motionProps}
      >
        {innerContent}
      </motion.button>
    );
  }

  return (
    <motion.div
      className={sharedClasses}
      style={sharedStyle}
      {...motionProps}
    >
      {innerContent}
    </motion.div>
  );
}

export function SeveritySummaryDeck({
  counts,
  totalCount,
  activeTier,
  onToggleTier,
}: SeveritySummaryDeckProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const canFilter = totalCount > 0;

  const tiers: TierConfig[] = [
    {
      id: "critical_high",
      indexLabel: "01",
      label: "Critical & High",
      note: "Requires immediate attention",
      count: counts.criticalHigh,
      dotColor: palette.severity.critical.base,
      pulseColor: "rgba(229, 72, 77, 0.45)",
      meterColor: palette.severity.critical.base,
      spotlightRgba: "rgba(229, 72, 77, 0.065)",
      activeBorderClass: "border-severity-critical",
      activeSurfaceClass: "border-transparent bg-danger-soft",
      glyphColor: palette.deck.criticalGlyph,
      mutedGlyphColor: palette.deck.glyphMuted,
    },
    {
      id: "medium",
      indexLabel: "02",
      label: "Medium",
      note: "Should be reviewed soon",
      count: counts.medium,
      dotColor: palette.warning.strong,
      pulseColor: "rgba(217, 145, 22, 0.4)",
      meterColor: palette.severity.medium.base,
      spotlightRgba: "rgba(229, 161, 38, 0.07)",
      activeBorderClass: "border-warning-strong",
      activeSurfaceClass: "border-transparent bg-warning-soft",
      glyphColor: palette.deck.mediumGlyph,
      mutedGlyphColor: palette.deck.glyphMuted,
    },
    {
      id: "low",
      indexLabel: "03",
      label: "Low & Watch",
      note: "Early signal to monitor",
      count: counts.low,
      dotColor: palette.brand.band,
      pulseColor: "rgba(43, 19, 207, 0.35)",
      meterColor: palette.brand.DEFAULT,
      spotlightRgba: "rgba(68, 56, 232, 0.075)",
      activeBorderClass: "border-brand-band",
      activeSurfaceClass: "border-transparent bg-veil",
      glyphColor: palette.brand.band,
      mutedGlyphColor: palette.deck.glyphMuted,
    },
  ];

  return (
    <div
      className="grid gap-3.5 sm:grid-cols-3"
      role="group"
      aria-label="Priority counts by severity"
    >
      {tiers.map((tier, idx) => (
        <SeverityTierCard
          key={tier.id}
          tier={tier}
          index={idx}
          totalCount={totalCount}
          canFilter={canFilter}
          isSelected={activeTier === tier.id}
          onSelect={() => onToggleTier(tier.id)}
          reducedMotion={reducedMotion}
        />
      ))}
    </div>
  );
}

export default SeveritySummaryDeck;
