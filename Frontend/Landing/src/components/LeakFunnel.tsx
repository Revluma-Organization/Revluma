/**
 * The hero's "losing revenue" metaphor: a glass funnel full of indigo balls
 * (the store's revenue) flowing down the spout, with a crack on one side that
 * lets a few slip out and fall onto the plinth. It replaces the decorative
 * plant from the original reference and tells the headline's story.
 *
 * Drawn in SVG (user units, viewBox 300 x 600) so it stays crisp and scales
 * with the scene. Motion lives in motion.css: balls flow down the spout and
 * every few seconds one escapes the crack and drops. With reduced motion the
 * escaping balls are shown frozen mid-fall instead.
 */

const CX = 150;
const RIM_Y = 40;
const SPOUT_Y = 330;
const R = 12.5;

/** Half-width of the cone (inner wall) at height y, for packing the balls. */
const halfWidth = (y: number) =>
  124 - (124 - 18) * ((y - RIM_Y) / (SPOUT_Y - RIM_Y)) ** 0.92;

type Ball = { x: number; y: number; light: boolean; k: number };

/** Hex-pack balls into the cone from the spout up to a gently domed surface. */
function packBalls(): Ball[] {
  const balls: Ball[] = [];
  const step = R * 2.04;
  const rowGap = R * 1.78;
  let row = 0;
  for (let y = SPOUT_Y - R; y > 96; y -= rowGap, row++) {
    const w = halfWidth(y) - R - 1;
    if (w < 0) continue;
    const offset = row % 2 ? step / 2 : 0;
    const count = Math.floor((2 * w) / step);
    const start = CX - (count * step) / 2 + offset / 2;
    for (let i = 0; i <= count; i++) {
      const x = start + i * step;
      if (Math.abs(x - CX) > w) continue;
      // Domed surface: the pile is higher in the middle than at the walls.
      const surface = 118 + ((x - CX) / 120) ** 2 * 34;
      if (y < surface) continue;
      const k = balls.length;
      balls.push({ x, y, light: (k * 7) % 5 === 0, k });
    }
  }
  return balls;
}

const BALLS = packBalls();
const SPOUT_BALLS = [318, 344, 370, 396, 422];

/** Where the crack sits on the right wall, and the floor (plinth top). */
const CRACK = { x: 214, y: 214 };

function Sphere({
  x,
  y,
  r = R,
  light = false,
  className,
}: {
  x: number;
  y: number;
  r?: number;
  light?: boolean;
  className?: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={className}>
        <circle r={r} fill={light ? "url(#lf-ball-light)" : "url(#lf-ball)"} />
        <ellipse
          cx={-r * 0.35}
          cy={-r * 0.42}
          rx={r * 0.34}
          ry={r * 0.22}
          fill="#fff"
          opacity="0.75"
          transform="rotate(-30)"
        />
      </g>
    </g>
  );
}

export function LeakFunnel() {
  return (
    <svg
      className="hv-funnel"
      viewBox="0 0 300 600"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="lf-ball" cx="0.34" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#8f7dff" />
          <stop offset="0.38" stopColor="#3a22e0" />
          <stop offset="0.8" stopColor="#1f06ac" />
          <stop offset="1" stopColor="#14066f" />
        </radialGradient>
        <radialGradient id="lf-ball-light" cx="0.34" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#c4b9ff" />
          <stop offset="0.4" stopColor="#7460ff" />
          <stop offset="1" stopColor="#3a22c8" />
        </radialGradient>
        {/* Frosted glass: clearer in the middle, milkier at the edges. */}
        <linearGradient id="lf-glass" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.78" />
          <stop offset="0.16" stopColor="#fff" stopOpacity="0.34" />
          <stop offset="0.5" stopColor="#f4f2ff" stopOpacity="0.16" />
          <stop offset="0.82" stopColor="#e9e5ff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#d9d3ff" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="lf-rim" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#4b33ef" />
          <stop offset="0.35" stopColor="#2b13cf" />
          <stop offset="0.7" stopColor="#1f06ac" />
          <stop offset="1" stopColor="#3b22dc" />
        </linearGradient>
        <linearGradient id="lf-tip" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#5a44f2" />
          <stop offset="0.45" stopColor="#2b13cf" />
          <stop offset="1" stopColor="#170780" />
        </linearGradient>
        <clipPath id="lf-cone-clip">
          <path d={CONE} />
        </clipPath>
        <clipPath id="lf-spout-clip">
          <path d={SPOUT} />
        </clipPath>
      </defs>

      {/* Soft contact shadow on the plinth where the leaked balls land. */}
      <ellipse cx="236" cy="575" rx="54" ry="6" fill="#0c0a1d" opacity="0.08" />

      <g className="hv-funnel__body">
        {/* Far half of the rim and the opening, seen from slightly above. */}
        <ellipse
          cx={CX}
          cy={RIM_Y}
          rx="136"
          ry="24"
          fill="#eeebff"
          fillOpacity="0.55"
        />
        <path
          d={RIM_BACK}
          stroke="#1a078f"
          strokeWidth="11"
          strokeLinecap="round"
        />

        {/* The revenue: balls packed in the cone, and a stream in the spout. */}
        <g clipPath="url(#lf-cone-clip)">
          {BALLS.map((b) => (
            <Sphere
              key={b.k}
              x={b.x}
              y={b.y}
              light={b.light}
              className={`hv-funnel__ball hv-funnel__ball--${b.k % 4}`}
            />
          ))}
        </g>
        <g clipPath="url(#lf-spout-clip)">
          <g className="hv-funnel__stream">
            {SPOUT_BALLS.map((y, i) => (
              <Sphere key={y} x={CX} y={y} r={10} light={i === 2} />
            ))}
          </g>
        </g>

        {/* Glass walls over the balls. */}
        <path
          d={CONE}
          fill="url(#lf-glass)"
          stroke="#a99ff0"
          strokeOpacity="0.8"
          strokeWidth="1.8"
        />
        <path
          d={SPOUT}
          fill="url(#lf-glass)"
          stroke="#b9b0f5"
          strokeOpacity="0.55"
          strokeWidth="1.5"
        />
        {/* Light streaks along the left wall and spout, a shadowed right edge. */}
        <path
          d="M30 62 C 48 150, 104 252, 128 326"
          stroke="#fff"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M44 66 C 58 130, 84 186, 100 222"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.6"
        />
        <path
          d="M138 346 L 140 404"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.8"
        />
        <path
          d="M270 62 C 252 150, 196 252, 172 326"
          stroke="#7460ff"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.35"
        />

        {/* The crack the revenue escapes through. */}
        <g
          className="hv-funnel__crack"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* A chipped hole where the wall gave way, then hairlines running from it. */}
          <path
            d="M222 206 L 212 210 L 210 220 L 218 226 L 224 222 Z"
            fill="#fff"
            fillOpacity="0.85"
            stroke="#8d7bff"
            strokeWidth="1"
          />
          <g stroke="#fff">
            <path
              d="M212 210 L 198 196 L 203 180 L 188 162"
              strokeWidth="2.4"
            />
            <path d="M198 196 L 180 203 L 170 192" strokeWidth="1.8" />
            <path d="M203 180 L 216 172" strokeWidth="1.5" />
            <path
              d="M210 220 L 196 234 L 202 250 L 188 268"
              strokeWidth="2.2"
            />
            <path d="M196 234 L 178 238 L 170 250" strokeWidth="1.6" />
            <path d="M202 250 L 214 258" strokeWidth="1.4" />
          </g>
          <g
            stroke="#4a33e8"
            strokeOpacity="0.55"
            strokeWidth="0.9"
            transform="translate(1.4 1.2)"
          >
            <path d="M212 210 L 198 196 L 203 180 L 188 162 M 210 220 L 196 234 L 202 250 L 188 268" />
          </g>
        </g>

        {/* Spout tip and the near half of the rim, glossy indigo. */}
        <path
          d="M134 410 L 166 410 L 165 428 Q 150 434 135 428 Z"
          fill="url(#lf-tip)"
        />
        <path
          d="M137 412 L 139 425"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.6"
        />
        <path
          d={RIM_FRONT}
          stroke="url(#lf-rim)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M26 46 C 60 66, 110 70, 150 70"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity="0.7"
        />
      </g>

      {/* Revenue that has already leaked out and come to rest. */}
      <Sphere x={218} y={561} />
      <Sphere x={246} y={562} r={11.5} light />

      {/* Escaping balls. Frozen mid-fall without motion, animated otherwise. */}
      <g className="hv-funnel__leak-still">
        <Sphere x={CRACK.x + 12} y={CRACK.y + 10} r={11} />
        <Sphere x={CRACK.x + 30} y={CRACK.y + 118} r={11.5} />
      </g>
      <g className="hv-funnel__leak">
        {[0, 1, 2].map((i) => (
          <g key={i} className={`hv-funnel__drop hv-funnel__drop--${i}`}>
            <Sphere x={CRACK.x + 4} y={CRACK.y + 4} r={11} light={i === 1} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/* Shapes (viewBox units). The cone's walls bow in slightly, like real glass. */
const CONE = `M14 ${RIM_Y} C 34 140, 104 252, 128 ${SPOUT_Y} L 172 ${SPOUT_Y} C 196 252, 266 140, 286 ${RIM_Y} Z`;
const SPOUT = `M128 ${SPOUT_Y - 2} L 134 412 L 166 412 L 172 ${SPOUT_Y - 2} Z`;
const RIM_BACK = `M14 ${RIM_Y} C 30 22, 90 16, 150 16 C 210 16, 270 22, 286 ${RIM_Y}`;
const RIM_FRONT = `M14 ${RIM_Y} C 30 58, 90 64, 150 64 C 210 64, 270 58, 286 ${RIM_Y}`;
