/**
 * Semantic design tokens for Rev surfaces (ChatGPT-UI study §4/§9: a token
 * layer instead of scattered literals). Values mirror the palette the Rev
 * components already shipped with, so adopting tokens is a refactor with no
 * visual change — but every new surface (code blocks, citation previews,
 * table toolbars, the jump-to-latest pill) now draws from one source of
 * truth per tone instead of inventing hex codes.
 *
 * Deliberately a TS module rather than CSS variables: Rev components receive
 * `tone`/`dark` as props (they render inside hosts that may not carry the
 * dashboard theme class), so tokens must resolve from the prop, not the
 * cascade.
 */

export type RevTone = "light" | "dark";

export interface RevTokens {
  /** Primary text. */
  strong: string;
  /** Body/prose text. */
  body: string;
  /** Secondary text: labels, metadata, disclaimers. */
  muted: string;
  /** Hairline borders and table rules. */
  border: string;
  /** Raised surface (cards, disclosures, headers). */
  surface: string;
  /** Floating surface (hover previews, pills) — opaque, above content. */
  overlay: string;
  /** Brand accent (used sparingly — state confirmation and primary actions). */
  accent: string;
  /** Accent-toned foreground for chips/links on `accentSoft`. */
  accentFg: string;
  /** Soft accent background for chips and markers. */
  accentSoft: string;
  /** Chip border. */
  accentBorder: string;
  /** Inline code background. */
  inlineCodeBg: string;
  /** Code block background. */
  codeBg: string;
  /** Code block header bar background. */
  codeHeaderBg: string;
  /** Code block foreground. */
  codeFg: string;
  /** Table head background. */
  tableHeadBg: string;
  /** Elevation shadow for floating surfaces. */
  shadow: string;
}

const DARK: RevTokens = {
  strong: "#F2F4F7",
  body: "#E7EAF3",
  muted: "#98A2B3",
  border: "rgba(255,255,255,0.09)",
  surface: "rgba(255,255,255,0.03)",
  overlay: "#1B1B21",
  accent: "#1F06AC",
  accentFg: "#A5B4FC",
  accentSoft: "rgba(31,6,172,0.22)",
  accentBorder: "rgba(31,6,172,0.4)",
  inlineCodeBg: "rgba(165,180,252,0.12)",
  codeBg: "#101014",
  codeHeaderBg: "rgba(255,255,255,0.04)",
  codeFg: "#E7EAF3",
  tableHeadBg: "rgba(255,255,255,0.04)",
  shadow: "0 8px 24px rgba(0,0,0,0.5)",
};

const LIGHT: RevTokens = {
  strong: "#101828",
  body: "#101828",
  muted: "#667085",
  border: "#EAECF0",
  surface: "#FAFAFB",
  overlay: "#FFFFFF",
  accent: "#1F06AC",
  accentFg: "#1F06AC",
  accentSoft: "rgba(31,6,172,0.07)",
  accentBorder: "rgba(31,6,172,0.18)",
  inlineCodeBg: "rgba(31,6,172,0.08)",
  codeBg: "#F7F7FA",
  codeHeaderBg: "#F2F4F7",
  codeFg: "#101828",
  tableHeadBg: "#F9FAFB",
  shadow: "0 8px 24px rgba(16,24,40,0.14)",
};

export function revTokens(tone: RevTone): RevTokens {
  return tone === "dark" ? DARK : LIGHT;
}

export default revTokens;
