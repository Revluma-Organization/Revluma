/**
 * The hero's "losing revenue" metaphor: a glass funnel full of indigo balls
 * (the store's revenue) flowing down the spout, with a hole broken in one side
 * that lets balls slip out, two at a time, and fall onto the plinth. It
 * replaces the decorative plant from the original reference and tells the
 * headline's story.
 *
 * Drawn in SVG so it stays crisp and scales with the scene. The funnel body is
 * modelled at y 0-430 and lifted by LIFT so it hovers clear of the laptop,
 * while the floor (plinth top) stays at FLOOR_Y; the viewBox covers both.
 * Motion lives in motion.css. With reduced motion the escaping balls are shown
 * frozen mid-fall instead.
 */

const CX = 150;
const RIM_Y = 40;
const SPOUT_Y = 330;
const R = 12.5;

/** How far the body is lifted above its modelled position (viewBox units). */
const LIFT = 110;
/** Plinth top, where the leaked balls come to rest (viewBox units). */
const FLOOR_Y = 572;
const VIEW_TOP = -120;
const VIEW_HEIGHT = 720;

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

/**
 * The broken hole in the right wall (body coordinates). It reaches past the
 * wall's edge, so the glass outline is visibly broken there.
 */
const HOLE =
  "M197 192 L 212 181 L 222 191 L 236 181 L 247 197 L 240 209 L 252 222 L 243 239 L 227 236 L 217 249 L 201 236 L 205 220 L 192 207 Z";
/** Where escaping balls leave the hole, in viewBox coordinates. */
const EXIT = { x: 238, y: 214 - LIFT };

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
      viewBox={`0 ${VIEW_TOP} 300 ${VIEW_HEIGHT}`}
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
        {/* Knocks the hole out of the glass, so the balls show through it. */}
        <mask
          id="lf-hole-mask"
          maskUnits="userSpaceOnUse"
          x="-20"
          y="-20"
          width="340"
          height="480"
        >
          <rect x="-20" y="-20" width="340" height="480" fill="#fff" />
          <path d={HOLE} fill="#000" />
        </mask>
      </defs>

      {/* Soft contact shadow on the plinth where the leaked balls land. */}
      <ellipse
        cx="236"
        cy={FLOOR_Y + 3}
        rx="50"
        ry="6"
        fill="#0c0a1d"
        opacity="0.08"
      />

      <g transform={`translate(0 ${-LIFT})`}>
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

          {/* Glass walls over the balls, with the hole knocked out. */}
          <g mask="url(#lf-hole-mask)">
            <path
              d={CONE}
              fill="url(#lf-glass)"
              stroke="#a99ff0"
              strokeOpacity="0.8"
              strokeWidth="1.8"
            />
            <path
              d="M270 62 C 252 150, 196 252, 172 326"
              stroke="#7460ff"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.35"
            />
          </g>
          <path
            d={SPOUT}
            fill="url(#lf-glass)"
            stroke="#b9b0f5"
            strokeOpacity="0.55"
            strokeWidth="1.5"
          />
          {/* Light streaks along the left wall and spout. */}
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

          {/* The hole's broken edge, and the cracks running out from it. */}
          <g
            className="hv-funnel__crack"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={HOLE} stroke="#fff" strokeOpacity="0.45" strokeWidth="8" />
            <path
              d={HOLE}
              stroke="#3a22e0"
              strokeOpacity="0.6"
              strokeWidth="1.4"
              transform="translate(1.6 1.8)"
            />
            <path d={HOLE} stroke="#fff" strokeWidth="3.2" />
            <g stroke="#fff">
              <path
                d="M212 181 L 203 166 L 209 152 L 195 132"
                strokeWidth="2.4"
              />
              <path d="M203 166 L 185 170 L 175 158" strokeWidth="1.8" />
              <path d="M209 152 L 221 142" strokeWidth="1.5" />
              <path d="M192 207 L 176 202 L 163 210" strokeWidth="2" />
              <path
                d="M217 249 L 205 264 L 211 280 L 197 298"
                strokeWidth="2.2"
              />
              <path d="M205 264 L 187 268 L 179 282" strokeWidth="1.6" />
              <path d="M211 280 L 221 290" strokeWidth="1.4" />
            </g>
            <g
              stroke="#4a33e8"
              strokeOpacity="0.5"
              strokeWidth="0.9"
              transform="translate(1.4 1.2)"
            >
              <path d="M212 181 L 203 166 L 209 152 L 195 132 M 217 249 L 205 264 L 211 280 L 197 298 M 192 207 L 176 202 L 163 210" />
            </g>
          </g>

          {/* Shards of the broken glass, caught just outside the hole. */}
          <g
            fill="#fff"
            stroke="#a99ff0"
            strokeWidth="0.8"
            strokeLinejoin="round"
          >
            <path d="M256 196 L 266 190 L 262 203 Z" opacity="0.9" />
            <path d="M259 236 L 270 241 L 260 248 Z" opacity="0.8" />
            <path d="M250 182 L 256 174 L 258 184 Z" opacity="0.75" />
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
      </g>

      {/* Revenue that has already leaked out and come to rest. */}
      <Sphere x={204} y={FLOOR_Y - 11} />
      <Sphere x={229} y={FLOOR_Y - 10} r={11.5} light />

      {/* Escaping balls. Frozen mid-fall without motion, animated otherwise. */}
      <g className="hv-funnel__leak-still">
        <Sphere x={EXIT.x + 2} y={EXIT.y + 2} r={11.5} />
        <Sphere x={EXIT.x + 22} y={EXIT.y + 150} r={11.5} light />
        <Sphere x={EXIT.x + 12} y={EXIT.y + 176} r={11} />
      </g>
      <g className="hv-funnel__leak">
        {[0, 1, 2, 3].map((i) => (
          <g key={i} className={`hv-funnel__drop hv-funnel__drop--${i}`}>
            <Sphere
              x={EXIT.x}
              y={EXIT.y}
              r={i % 2 ? 11 : 11.5}
              light={i === 1 || i === 2}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

/* Shapes (body coordinates). The cone's walls bow in slightly, like real glass. */
const CONE = `M14 ${RIM_Y} C 34 140, 104 252, 128 ${SPOUT_Y} L 172 ${SPOUT_Y} C 196 252, 266 140, 286 ${RIM_Y} Z`;
const SPOUT = `M128 ${SPOUT_Y - 2} L 134 412 L 166 412 L 172 ${SPOUT_Y - 2} Z`;
const RIM_BACK = `M14 ${RIM_Y} C 30 22, 90 16, 150 16 C 210 16, 270 22, 286 ${RIM_Y}`;
const RIM_FRONT = `M14 ${RIM_Y} C 30 58, 90 64, 150 64 C 210 64, 270 58, 286 ${RIM_Y}`;
