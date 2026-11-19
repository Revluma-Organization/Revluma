// Rev Intelligence identity orb.
//
// One visual identity everywhere Rev appears: a glass plasma orb rendered by
// our own procedural renderer (scripts/rev-orb/). Two delivery forms:
//
//   <RevOrb>       Animated WebP with real transparency. Works on light and
//                  dark surfaces, costs one decoded image no matter how many
//                  times it is shown (e.g. one per Rev message).
//   <RevOrbLoader> Loading indicator while Rev prepares an answer: a looping
//                  video whose sphere fills the frame, clipped to a circle so
//                  it works on light and dark themes, with a soft CSS glow.
//   <RevOrbVideo>  Looping muted H.264 video for the always-dark sidebar.
//                  It is rendered on black and blended with `screen`, so the
//                  black is invisible on the dark surface (including hover and
//                  active rows). H.264 plays in every browser; the repo does
//                  not track WebM files (.gitignore).
//
// Reduced motion: both forms fall back to the still PNG.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import orbAnimated from "@/assets/rev-orb/rev-orb.webp";
import orbStill from "@/assets/rev-orb/rev-orb.png";
import orbMp4 from "@/assets/rev-orb/rev-orb.mp4";
import loaderMp4 from "@/assets/rev-orb/rev-orb-loader.mp4";
import loaderStill from "@/assets/rev-orb/rev-orb-loader.png";

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

/**
 * React sets `muted` as a property only; mobile Safari decides autoplay
 * eligibility from the muted state, so make it explicit before playing.
 * Autoplay can still be refused (e.g. low-power mode): the poster remains.
 */
function useMutedAutoplay(reduced: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute("muted", "");
    try {
      const playing = video.play();
      if (playing && typeof playing.catch === "function") playing.catch(() => undefined);
    } catch {
      /* media playback unavailable: the poster remains */
    }
  }, [reduced]);
  return videoRef;
}

// The loader sphere spans 97% of the frame; clipping just inside it removes
// the encoded black background and its antialiased edge.
const LOADER_CLIP = "circle(47.5% at 50% 50%)";

/** Loading indicator shown while Rev prepares an answer. */
export function RevOrbLoader({ size = 48, label = "Rev is thinking…", color, accessibleLabel }: {
  size?: number;
  /** Visible caption next to the orb. Pass an empty string to hide it. */
  label?: string;
  color?: string;
  /** Screen-reader status text. Defaults to the visible label. */
  accessibleLabel?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const videoRef = useMutedAutoplay(reduced);
  const inset = Math.round(size * 0.025);
  const media: CSSProperties = {
    position: "relative", display: "block", width: size, height: size,
    objectFit: "cover", clipPath: LOADER_CLIP, WebkitClipPath: LOADER_CLIP, pointerEvents: "none",
  };
  return (
    <div role="status" aria-live="polite" aria-label={accessibleLabel || label || "Rev is thinking"}
      data-rev-orb-loader="" style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 2, paddingBottom: 2 }}>
      <span aria-hidden="true" style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <span style={{ position: "absolute", inset, borderRadius: "50%",
          boxShadow: "0 0 14px 2px rgba(79,168,255,0.45), 0 0 4px rgba(146,220,255,0.6)" }} />
        {reduced ? (
          <img src={loaderStill} alt="" width={size} height={size} draggable={false} data-rev-orb="still" style={media} />
        ) : (
          <video ref={videoRef} autoPlay muted loop playsInline preload="auto" poster={loaderStill}
            tabIndex={-1} disablePictureInPicture data-rev-orb="loader-video" width={size} height={size} style={media}>
            <source src={loaderMp4} type="video/mp4" />
          </video>
        )}
      </span>
      {label && <span style={{ fontSize: "0.8rem", fontWeight: 600, color }}>{label}</span>}
    </div>
  );
}

/** Looping orb video for dark surfaces (the sidebar). */
export function RevOrbVideo({ size, className, style }: Omit<OrbProps, "alt">) {
  const reduced = usePrefersReducedMotion();
  const videoRef = useMutedAutoplay(reduced);
  if (reduced) {
    return (
      <img src={orbStill} alt="" aria-hidden="true" width={size} height={size} draggable={false}
        data-rev-orb="still" className={className} style={{ width: size, height: size, objectFit: "contain", ...style }} />
    );
  }
  return (
    <video
      ref={videoRef}
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
