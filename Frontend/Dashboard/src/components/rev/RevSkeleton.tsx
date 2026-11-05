/**
 * Rev skeleton loaders (merchant directive 2026-11-05: "anything loading
 * inside Rev Intell uses skeleton loading, not spinners — like YouTube").
 *
 * Every surface is a static block in the surface colour plus a sheen sweep
 * (the repo's existing `sheen-sweep` keyframe), and every surface is
 * `aria-hidden`: the surrounding `role="status"` + aria-label at the call
 * site carries the honest meaning for screen readers, so skeletons never
 * read as content. Reduced motion freezes the sweep via the global
 * `prefers-reduced-motion` rule in index.css.
 */

function Sweep({ isDark }: { isDark: boolean }) {
  return <span aria-hidden="true" className={isDark ? "rev-skeleton-sweep rev-skeleton-sweep-dark" : "rev-skeleton-sweep"} />;
}

/** One shimmering block. `width`/`height` in px or any CSS length. */
export function SkeletonBar({ width, height = 10, radius = 999, isDark }: {
  width: number | string; height?: number; radius?: number; isDark: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      data-rev-skeleton
      style={{
        display: "block", width, height, borderRadius: radius,
        background: isDark ? "#1f2937" : "#e5e7eb",
        position: "relative", overflow: "hidden",
      }}
    >
      <Sweep isDark={isDark} />
    </span>
  );
}

/** A whole answer bubble loading: avatar dot plus paragraph lines. */
export function RevSkeletonThread({ isDark }: { isDark: boolean }) {
  return (
    <div aria-hidden="true" data-rev-skeleton-thread className="flex flex-col gap-7 py-2">
      {[0, 1].map(block => (
        <div key={block} className="flex gap-3">
          <span style={{
            width: 34, height: 34, borderRadius: 999, flex: "none",
            background: isDark ? "#1f2937" : "#e5e7eb",
            position: "relative", overflow: "hidden",
          }}>
            <Sweep isDark={isDark} />
          </span>
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <SkeletonBar width="34%" height={9} isDark={isDark} />
            <SkeletonBar width="94%" isDark={isDark} />
            <SkeletonBar width="82%" isDark={isDark} />
            {block === 0 ? <SkeletonBar width="57%" isDark={isDark} /> : <SkeletonBar width="41%" isDark={isDark} />}
          </div>
        </div>
      ))}
    </div>
  );
}

/** History-drawer list loading: title + meta rows. */
export function RevSkeletonRows({ rows = 4, isDark }: { rows?: number; isDark: boolean }) {
  return (
    <div aria-hidden="true" data-rev-skeleton-rows className="flex flex-col gap-4 px-3 py-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <SkeletonBar width={index % 2 ? "62%" : "74%"} height={11} radius={7} isDark={isDark} />
          <SkeletonBar width="38%" height={8} radius={7} isDark={isDark} />
        </div>
      ))}
    </div>
  );
}

/** Finding-context card loading. */
export function RevSkeletonCard({ isDark }: { isDark: boolean }) {
  return (
    <div aria-hidden="true" data-rev-skeleton-card className="flex flex-col gap-2 rounded-xl border p-4"
      style={{ borderColor: isDark ? "#1f2937" : "#e5e7eb" }}>
      <SkeletonBar width="46%" height={12} radius={7} isDark={isDark} />
      <SkeletonBar width="88%" height={9} radius={7} isDark={isDark} />
      <SkeletonBar width="70%" height={9} radius={7} isDark={isDark} />
    </div>
  );
}

/** Small circular shimmer for live activity indicators (spinner replacement). */
export function SkeletonDot({ size = 13, isDark }: { size?: number; isDark: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-rev-skeleton
      style={{
        display: "inline-block", width: size, height: size, borderRadius: 999,
        background: isDark ? "#1f2937" : "#e5e7eb",
        position: "relative", overflow: "hidden", flex: "none",
      }}
    >
      <Sweep isDark={isDark} />
    </span>
  );
}
