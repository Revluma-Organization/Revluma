import type { CSSProperties, ReactNode } from "react";
import { Package, ReceiptText, ShoppingCart, Undo2, Users } from "lucide-react";
import icon from "@/assets/revluma-icon.png";
import { HERO } from "@/content";
import { at } from "@/motionTiming";

/**
 * Data hub under the hero CTAs (replaces the Shopify / Read-only / Evidence
 * facts row). Built from the approved reference: a bundle of fine curved lines
 * that pinches behind a glowing centre tile and flares out to both sides, with
 * white source tiles sitting on the lines (two inner, four staggered outer).
 *
 * Revluma's version: the centre is Revluma and the tiles are Shopify and the
 * Shopify data it actually reads. The lines are drawn once, and small pulses
 * travel along them into the centre (motion.css, reduced-motion safe).
 */

// SVG geometry. The box is sliced (cover) into whatever size the hub gets, so
// the lines always reach the edges; tiles are positioned in % of the box.
const W = 800;
const H = 240;
const CX = W / 2;
const CY = H / 2;
const LINES_PER_SIDE = 16;
const SPREAD = 300; // how far past the top/bottom the outermost lines end

type Line = { d: string; t: number; side: "left" | "right" };

function linePath(side: "left" | "right", offset: number, endY: number) {
  // Flat out of the bundle, then flaring: a horn shape like the reference.
  const sx = (x: number) => (side === "left" ? x : W - x);
  const y0 = CY + offset;
  const c2y = CY + (endY - CY) * 0.45;
  return `M ${sx(CX - 20)} ${y0} C ${sx(270)} ${y0}, ${sx(130)} ${c2y.toFixed(1)}, ${sx(-10)} ${endY.toFixed(1)}`;
}

const LINES: Line[] = (["left", "right"] as const).flatMap((side) =>
  Array.from({ length: LINES_PER_SIDE }, (_, i) => {
    const t = (i / (LINES_PER_SIDE - 1)) * 2 - 1; // -1 (top) .. 1 (bottom)
    return { side, t, d: linePath(side, t * 10, CY + t * SPREAD) };
  }),
);

// Lines that carry a travelling pulse into the centre (index into LINES).
const PULSES = [3, 7, 12, LINES_PER_SIDE + 4, LINES_PER_SIDE + 8, LINES_PER_SIDE + 11];

function ShopifyMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="#7AB55C">
      <path d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z" />
    </svg>
  );
}

type Tile = { name: string; x: number; y: number; ring: "inner" | "outer"; color: string; glyph: ReactNode; delay: number; float: "a" | "b" };

// Positions follow the reference: inner tiles on the centre line at about a
// third of the way out, outer tiles staggered above and below near the edges.
const [shopify, orders, products, customers, refunds, checkouts] = HERO.sources.items;
const TILES: Tile[] = [
  { name: shopify, x: 32.5, y: 50, ring: "inner", color: "#7AB55C", glyph: <ShopifyMark />, delay: 1150, float: "a" },
  { name: orders, x: 67, y: 50, ring: "inner", color: "#2B13CF", glyph: <ReceiptText />, delay: 1210, float: "b" },
  { name: products, x: 16.5, y: 16, ring: "outer", color: "#D97706", glyph: <Package />, delay: 1290, float: "b" },
  { name: customers, x: 15.5, y: 80, ring: "outer", color: "#0E9384", glyph: <Users />, delay: 1350, float: "a" },
  { name: refunds, x: 83.5, y: 14, ring: "outer", color: "#E11D48", glyph: <Undo2 />, delay: 1320, float: "a" },
  { name: checkouts, x: 84.5, y: 82, ring: "outer", color: "#7C3AED", glyph: <ShoppingCart />, delay: 1380, float: "b" },
];

export function SourceHub() {
  return (
    <div className="source-hub relative mt-10 w-full sm:max-w-[33rem] lg:mt-[clamp(0.9rem,3.6svh,2.5rem)]" role="img" aria-label={HERO.sources.label}>
      <svg className="source-hub__lines" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {LINES.map((line, i) => (
          <path
            key={i}
            className="source-hub__line"
            d={line.d}
            pathLength={1}
            strokeOpacity={(0.7 - 0.45 * Math.abs(line.t)).toFixed(2)}
            style={at(980 + Math.abs(line.t) * 220 + (line.side === "right" ? 40 : 0))}
          />
        ))}
        {PULSES.map((index, i) => (
          <path
            key={`pulse-${index}`}
            className="source-hub__pulse"
            d={LINES[index].d}
            pathLength={1}
            style={{ animationDelay: `${3.4 + i * 0.9}s`, animationDuration: `${3.2 + (i % 3) * 0.6}s` }}
          />
        ))}
      </svg>

      <span className="source-hub__core" style={at(1000)} aria-hidden="true">
        <img src={icon} alt="" width={204} height={204} />
      </span>

      {TILES.map((tile) => (
        <span
          key={tile.name}
          title={tile.name}
          aria-hidden="true"
          className={`source-hub__tile source-hub__tile--${tile.ring} source-hub__tile--float-${tile.float}`}
          style={{ left: `${tile.x}%`, top: `${tile.y}%`, color: tile.color, ...at(tile.delay) } as CSSProperties}
        >
          {tile.glyph}
        </span>
      ))}
    </div>
  );
}
