// Rev Intelligence identity orb.
//
// One visual identity everywhere Rev appears: a glass plasma orb rendered by
// our own procedural renderer (scripts/rev-orb/). Two delivery forms:
//
//   <RevOrb>       Animated WebP with real transparency. Works on light and
//                  dark surfaces, costs one decoded image no matter how many
//                  times it is shown (e.g. one per Rev message).
//   <RevOrbVideo>  Looping muted H.264 video for the always-dark sidebar.
//                  It is rendered on black and blended with `screen`, so the
//                  black is invisible on the dark surface (including hover and
//                  active rows). H.264 plays in every browser; the repo does
//                  not track WebM files (.gitignore).
//
// Reduced motion: both forms fall back to the still PNG.
import { useEffect, useState, type CSSProperties } from "react";
import orbAnimated from "@/assets/rev-orb/rev-orb.webp";
import orbStill from "@/assets/rev-orb/rev-orb.png";
import orbMp4 from "@/assets/rev-orb/rev-orb.mp4";

export const REV_ORB_STILL = orbStill;
export const REV_ORB_ANIMATED = orbAnimated;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION) : null;
  const [reduced, setReduced] = useState(() => Boolean(query?.matches));
  useEffect(() => {
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    return undefined;
  }, [query]);
  return reduced;
}

type OrbProps = {
  size: number;
  /** Accessible name. Empty (default) marks the orb as decorative. */
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

/** Animated, transparent orb image. Still PNG when motion is reduced. */
export function RevOrb({ size, alt = "", className, style }: OrbProps) {
  return (
    <picture style={{ display: "inline-flex", flexShrink: 0, width: size, height: size }} className={className}>
      <source media={REDUCED_MOTION} srcSet={orbStill} />
      <img
        src={orbAnimated}
        alt={alt}
        aria-hidden={alt ? undefined : true}
        width={size}
        height={size}
        decoding="async"
        draggable={false}
        data-rev-orb="animated"
        style={{ width: size, height: size, objectFit: "contain", ...style }}
      />
    </picture>
  );
}

/** Looping orb video for dark surfaces (the sidebar). */
export function RevOrbVideo({ size, className, style }: Omit<OrbProps, "alt">) {
  const reduced = usePrefersReducedMotion();
  if (reduced) {
    return (
      <img src={orbStill} alt="" aria-hidden="true" width={size} height={size} draggable={false}
        data-rev-orb="still" className={className} style={{ width: size, height: size, objectFit: "contain", ...style }} />
    );
  }
  return (
    <video
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      poster={orbStill}
      aria-hidden="true"
      tabIndex={-1}
      disablePictureInPicture
      data-rev-orb="video"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain", mixBlendMode: "screen", pointerEvents: "none", ...style }}
    >
      <source src={orbMp4} type="video/mp4" />
    </video>
  );
}

export default RevOrb;
