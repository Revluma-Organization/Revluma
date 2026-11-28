// Real-time WebGL renderer for the Rev Intelligence plasma orb on the
// full-screen voice call. A GPU port of scripts/rev-orb/orb.py (same palette,
// nested filament shells, core, fresnel rim, halo and specks), plus an amoeba
// mode for when Rev speaks:
//   plasma membrane   the fresnel rim, displaced into flowing pseudopodia
//   ectoplasm         a clearer glass band just inside the membrane
//   endoplasm         plasma filaments and granules, streaming with the flow
//   nucleus           the white core, drifting with the cytoplasm
//   vacuoles          two food vacuoles and a contractile vacuole that swells
//                     and collapses
//
// Why a shader instead of a video: zero network bytes, the first frame can be
// drawn as soon as the program links, and the shape can deform freely.
// One renderer (canvas + context + program) is shared by every call screen and
// can be prewarmed before the call opens, so opening a call does no GPU setup.

export interface OrbFrame {
  /** Plasma time in seconds (already speed-integrated). */
  phase: number;
  /** 0 = round orb, 1 = fully amoeboid. */
  amoeba: number;
  /** Rev's smoothed voice level, 0..1. */
  energy: number;
  /** 0..1 desaturation for a muted microphone. */
  muted: number;
  /** Halo strength (lighter on light surfaces). */
  glow: number;
  /** Nucleus drift in unit-sphere coordinates. */
  nucleus: [number, number];
}

export interface RevOrbRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Program linked and context alive: draw() will paint. */
  ready(): boolean;
  /** Context lost and not yet restored. */
  lost(): boolean;
  /** Size the backing store. cssPx = displayed size; scale = device pixels per CSS px. */
  resize(cssPx: number, scale: number): void;
  draw(frame: OrbFrame): boolean;
}

/** Sphere radius as a fraction of the canvas half-size. The rest is room for pseudopodia and halo. */
export const ORB_RADIUS = 0.69;
/** Backing-store cap in device pixels (per side). */
const MAX_BACKING = 768;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Simplex noise: Ian McEwan, Ashima Arts / Stefan Gustavson (MIT licence),
// https://github.com/ashima/webgl-noise
const NOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uPhase;
uniform float uAmoeba;
uniform float uEnergy;
uniform float uMuted;
uniform float uGlow;
uniform vec2 uNucleus;

const float R0 = ${ORB_RADIUS.toFixed(3)};
const float TAU = 6.28318530718;
// Simplex is louder than the Perlin noise orb.py was tuned with.
const float NS = 0.72;
// Simplex features read about twice as fine as Perlin at the same frequency.
const float FREQ = 0.66;
const vec3 CENTER = vec3(0.102, 0.310, 0.902);
const vec3 GLASS = vec3(0.310, 0.659, 1.0);
const vec3 RIM = vec3(0.573, 0.863, 1.0);
const vec3 PLASMA = vec3(0.435, 0.816, 1.0);
const vec3 ACCENT = vec3(1.0, 0.561, 0.784);
const vec3 WHITE = vec3(0.92, 0.97, 1.0);
const vec3 CYAN = vec3(0.25, 0.80, 1.0);

${NOISE}

vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }

float filaments(vec3 p, float phase, float scale, float seed) {
  vec3 x = p * scale;
  float ox = 1.3 * cos(phase), oy = 1.3 * sin(phase);
  vec3 w = vec3(
    snoise(vec3(x.x * 0.7 + ox + seed, x.y * 0.7 + oy, x.z * 0.7)),
    snoise(vec3(x.x * 0.7 + 17.1, x.y * 0.7 + ox + seed, x.z * 0.7 + oy)),
    snoise(vec3(x.x * 0.7 + oy, x.y * 0.7 + 31.7, x.z * 0.7 + ox + seed)));
  vec3 x2 = x + 1.6 * NS * w;
  float n = NS * (snoise(x2) + 0.5 * snoise(x2 * 2.1 + vec3(5.2, 0.0, 0.0)));
  float ridge = 1.0 - clamp(abs(n) * 2.6, 0.0, 1.0);
  float fine = 1.0 - clamp(abs(NS * snoise(x2 * 4.3 + vec3(0.0, 9.1, 0.0))) * 3.0, 0.0, 1.0);
  float r2 = ridge * ridge, r4 = r2 * r2, r8 = r4 * r4;
  float f2 = fine * fine, f6 = f2 * f2 * f2;
  return r8 * ridge + 0.35 * r4 * ridge * f6;
}

float shell(vec2 q, float rr, float radius, float rate, float scale, float seed, float weight, float ang) {
  if (rr >= radius) return 0.0;
  vec2 s = q / radius;
  float sz = sqrt(max(1.0 - dot(s, s), 0.0));
  vec3 pp = rotX(rotY(vec3(s, sz), ang * rate), 0.35);
  float f = filaments(pp, ang * sign(rate), scale * FREQ, seed);
  float rs = rr / radius;
  float g = (rr - 0.38) / 0.28;
  float env = clamp((rr - 0.06) / 0.18, 0.0, 1.0) * (1.0 - rs * rs * rs * rs) * (0.55 + 0.45 * sz)
    * (0.45 + 0.9 * exp(-g * g));
  return weight * f * env;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void vacuole(inout vec3 col, vec2 q, vec2 c, float rad, vec3 tint, float amount) {
  float dv = length(q - c);
  float inside = 1.0 - smoothstep(rad - 0.018, rad, dv);
  float e = (dv - rad) / 0.014;
  float ring = exp(-e * e);
  col = mix(col, col * 0.45 + tint * 0.2, inside * 0.8 * amount);
  col += tint * ring * 0.85 * amount;
}

void main() {
  vec2 p = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float px = 2.0 / uRes.y;
  float r = length(p);
  float t = uPhase;
  float ang = TAU * t / 12.0;

  // Plasma membrane: a star-shaped outline from noise sampled around a circle,
  // so it is seamless. n2's positive lobes become pseudopodia (false feet).
  float R = R0;
  if (uAmoeba > 0.001) {
    vec2 cs = p / max(r, 1e-4);
    // n1: broad, lopsided body. n2: two to four pseudopodia pushing out and
    // retracting. n3: a faint membrane tremor that follows Rev's voice.
    float n1 = snoise(vec3(cs * 0.75, t * 0.28));
    float n2 = snoise(vec3(cs * 1.25 + 7.0, t * 0.42 + 3.0));
    float n3 = snoise(vec3(cs * 3.2 + 3.0, t * 1.4));
    // Broad, rounded lobes (smoothstep shoulders), not spikes.
    float pseudo = smoothstep(0.0, 0.72, n2) * 1.55;
    // The body stretches along a slowly wandering axis, like a crawling cell.
    float axis = t * 0.13 + 0.8 * sin(t * 0.21);
    float c2 = cs.x * cs.x - cs.y * cs.y, s2 = 2.0 * cs.x * cs.y;
    float stretch = c2 * cos(2.0 * axis) + s2 * sin(2.0 * axis);
    float shape = 0.42 * n1 + 0.62 * pseudo + 0.32 * stretch + (0.025 + 0.05 * uEnergy) * n3 - 0.18;
    R = R0 * (1.0 + uAmoeba * 0.3 * shape);
    // Soft limit: long pseudopodia ease into the canvas edge instead of clipping.
    if (R > 0.84) R = 0.84 + 0.1 * (1.0 - exp(-(R - 0.84) / 0.1));
  }
  float d = r - R;
  float edge = clamp(0.5 - d / px, 0.0, 1.0);

  vec3 light = vec3(0.0);
  float alpha = 0.0;
  if (d < px) {
    vec2 q0 = p / R;
    float rr = min(length(q0), 1.0);
    vec2 q = q0;
    // Cytoplasmic streaming: the endoplasm flows inside the moving membrane.
    if (uAmoeba > 0.001) {
      q += uAmoeba * 0.10 * vec2(snoise(vec3(q0 * 1.4, t * 0.35 + 11.0)), snoise(vec3(q0 * 1.4 + 5.0, t * 0.35 + 19.0)));
    }
    float rq = min(length(q), 1.0);
    float zs = sqrt(max(1.0 - rr * rr, 0.0));

    vec3 body = mix(CENTER, GLASS, clamp(pow(rr, 1.4), 0.0, 1.0));
    float bodyA = 0.90 + 0.08 * rr * rr;
    vec3 col = body * (0.10 + 0.34 * pow(rr, 2.5)) * bodyA;
    float a = bodyA;

    float plasma = shell(q, rq, 0.55, 1.0, 2.2, 0.0, 1.0, ang)
      + shell(q, rq, 0.80, -1.0, 1.8, 11.0, 0.85, ang)
      + shell(q, rq, 0.97, 2.0, 1.5, 23.0, 0.28, ang);
    plasma *= 1.46 + 0.7 * uEnergy;

    vec2 nq = q - uNucleus;
    float rn2 = dot(nq, nq);
    float core = exp(-rn2 / 0.0576);
    float coreWide = exp(-rn2 / 0.3025);
    float pulse = 1.0 + 0.06 * sin(ang * 2.0) + 0.28 * uEnergy;
    col += (CYAN * 0.75 + PLASMA * 0.25) * plasma * (1.0 + 1.2 * coreWide);
    col += WHITE * max(plasma - 0.8, 0.0) * 0.35;
    col += (GLASS * 0.6 + CYAN * 0.4) * coreWide * 0.60 * pulse;
    col += WHITE * core * 1.6 * pulse;
    col += ACCENT * max(plasma - 0.9, 0.0) * 0.032;

    if (uAmoeba > 0.001) {
      // Nucleus: the core gains a defined envelope as the cell comes alive.
      float rn = sqrt(rn2);
      float ne = (rn - 0.17) / 0.016;
      col += RIM * exp(-ne * ne) * 0.45 * uAmoeba;
      col += WHITE * (1.0 - smoothstep(0.12, 0.17, rn)) * 0.18 * uAmoeba;

      // Endoplasm granules drifting with the flow.
      vec2 g = q * 13.0 + vec2(t * 0.35, -t * 0.22);
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float hv = hash(cell);
      vec2 pt = 0.25 + 0.5 * vec2(hash(cell + 7.3), hash(cell + 3.1))
        + 0.12 * vec2(sin(t * 1.3 + hv * TAU), cos(t * 1.1 + hv * TAU));
      float gran = (1.0 - smoothstep(0.04, 0.11, length(f - pt))) * step(0.5, hv) * (1.0 - rr * rr * rr * rr);
      col += RIM * gran * 0.38 * uAmoeba;

      // Contractile vacuole: swells, then collapses to expel water.
      float cyc = fract(t * 0.16);
      float swell = smoothstep(0.0, 0.82, cyc) * (1.0 - smoothstep(0.86, 1.0, cyc));
      vacuole(col, q, vec2(-0.38 + 0.05 * sin(t * 0.4), -0.30 + 0.04 * cos(t * 0.5)), 0.03 + 0.085 * swell, RIM, uAmoeba);
      // Food vacuoles riding the stream.
      vacuole(col, q, 0.46 * vec2(cos(t * 0.21 + 0.6), sin(t * 0.21 + 0.6)), 0.085, ACCENT * 0.9 + PLASMA * 0.1, uAmoeba * 0.8);
      vacuole(col, q, 0.34 * vec2(cos(-t * 0.27 + 3.4), sin(-t * 0.27 + 3.4)), 0.055, PLASMA, uAmoeba * 0.9);

      // Ectoplasm: a clearer, stiffer layer just under the membrane.
      float ecto = smoothstep(0.80, 0.95, rr) * uAmoeba;
      col = mix(col, col * 0.6 + GLASS * 0.10, ecto * 0.55);
      // The membrane itself: a thin bright boundary.
      float me = (rr - 0.975) / 0.02;
      col += RIM * exp(-me * me) * 0.5 * uAmoeba;
    }

    float fz = 1.0 - zs;
    float fres = pow(fz, 2.2);
    col += (RIM * 0.45 + GLASS * 0.55) * pow(fres, 1.3) * 0.95;
    col *= 1.0 - 0.25 * pow(fz, 8.0);
    vec2 hq = vec2((q0.x + 0.38) / 0.42, (q0.y - 0.45) / 0.22);
    col += vec3(0.85, 0.93, 1.0) * exp(-dot(hq, hq)) * 0.12;

    a = clamp(max(a, max(col.r, max(col.g, col.b))), 0.0, 1.0);
    light = col * edge;
    alpha = a * edge;
  }

  // Halo hugging the (possibly amoeboid) membrane.
  float halo = exp(-max(d, 0.0) / 0.057) * step(-0.002, d) * uGlow * 0.75;
  light += (GLASS * 0.6 + RIM * 0.4) * halo * (1.0 - edge);
  alpha += halo * (1.0 - edge);

  // Sparse drifting specks.
  float sig = 2.0 * (1.2 * px) * (1.2 * px);
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float a0 = hash(vec2(fi, 1.7)) * TAU;
    float rad = (0.25 + 0.7 * hash(vec2(fi, 9.2))) * R0;
    float spin = hash(vec2(fi, 4.4)) > 0.5 ? 1.0 : -1.0;
    float an = a0 + spin * ang;
    vec2 sp = rad * vec2(cos(an), sin(an) * 0.9);
    vec2 dd = p - sp;
    float tw = 0.5 + 0.5 * sin(ang * (1.0 + floor(hash(vec2(fi, 2.3)) * 3.0)) + a0);
    float s = exp(-dot(dd, dd) / sig) * 0.8 * tw;
    light += RIM * s;
    alpha = max(alpha, s);
  }

  light = 1.0 - exp(-light * 1.15);
  alpha = clamp(max(alpha, max(light.r, max(light.g, light.b))), 0.0, 1.0);
  float lum = dot(light, vec3(0.299, 0.587, 0.114));
  light = mix(light, vec3(lum), uMuted * 0.85) * (1.0 - 0.25 * uMuted);
  gl_FragColor = vec4(light, alpha);
}
`;

type Uniforms = Record<"uRes" | "uPhase" | "uAmoeba" | "uEnergy" | "uMuted" | "uGlow" | "uNucleus", WebGLUniformLocation | null>;

// KHR_parallel_shader_compile: lets the driver link off the main thread.
const COMPLETION_STATUS_KHR = 0x91b1;

function createRenderer(): RevOrbRenderer | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.revOrb = "gl";
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none";

  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: "low-power",
    }) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  if (!highp || highp.precision === 0) return null;

  let program: WebGLProgram | null = null;
  let uniforms: Uniforms | null = null;
  let parallel = false;
  let linked = false;
  let isLost = false;

  const init = () => {
    const ctx = gl!;
    linked = false;
    parallel = Boolean(ctx.getExtension("KHR_parallel_shader_compile"));
    const compile = (type: number, source: string) => {
      const shader = ctx.createShader(type)!;
      ctx.shaderSource(shader, source);
      ctx.compileShader(shader);
      return shader;
    };
    const vs = compile(ctx.VERTEX_SHADER, VERTEX);
    const fs = compile(ctx.FRAGMENT_SHADER, FRAGMENT);
    program = ctx.createProgram();
    if (!program) return;
    ctx.attachShader(program, vs);
    ctx.attachShader(program, fs);
    ctx.bindAttribLocation(program, 0, "aPos");
    ctx.linkProgram(program);
    const buffer = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
    ctx.enableVertexAttribArray(0);
    ctx.vertexAttribPointer(0, 2, ctx.FLOAT, false, 0, 0);
  };

  const checkLinked = (): boolean => {
    if (linked) return true;
    const ctx = gl!;
    if (!program || isLost) return false;
    if (parallel && !ctx.getProgramParameter(program, COMPLETION_STATUS_KHR)) return false;
    if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
      // Unsupported GPU or driver bug: give up and let callers show the still.
      if (import.meta.env.DEV) console.warn("Rev orb shader failed to link", ctx.getProgramInfoLog(program));
      program = null;
      return false;
    }
    ctx.useProgram(program);
    const at = (name: string) => ctx.getUniformLocation(program!, name);
    uniforms = {
      uRes: at("uRes"), uPhase: at("uPhase"), uAmoeba: at("uAmoeba"), uEnergy: at("uEnergy"),
      uMuted: at("uMuted"), uGlow: at("uGlow"), uNucleus: at("uNucleus"),
    };
    linked = true;
    return true;
  };

  canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); isLost = true; linked = false; }, false);
  canvas.addEventListener("webglcontextrestored", () => { isLost = false; init(); }, false);
  init();
  if (!program) return null;

  return {
    canvas,
    ready: () => !isLost && program !== null && checkLinked(),
    lost: () => isLost || program === null,
    resize(cssPx, scale) {
      const side = Math.max(1, Math.min(MAX_BACKING, Math.round(cssPx * scale)));
      if (canvas.width !== side || canvas.height !== side) {
        canvas.width = side;
        canvas.height = side;
      }
    },
    draw(frame) {
      if (!checkLinked() || !uniforms) return false;
      const ctx = gl!;
      ctx.viewport(0, 0, canvas.width, canvas.height);
      ctx.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      ctx.uniform1f(uniforms.uPhase, frame.phase);
      ctx.uniform1f(uniforms.uAmoeba, frame.amoeba);
      ctx.uniform1f(uniforms.uEnergy, frame.energy);
      ctx.uniform1f(uniforms.uMuted, frame.muted);
      ctx.uniform1f(uniforms.uGlow, frame.glow);
      ctx.uniform2f(uniforms.uNucleus, frame.nucleus[0], frame.nucleus[1]);
      ctx.drawArrays(ctx.TRIANGLES, 0, 3);
      return true;
    },
  };
}

let shared: RevOrbRenderer | null | undefined;

/** The shared renderer, created on first use. null when WebGL (or highp) is unavailable. */
export function getRevOrbRenderer(): RevOrbRenderer | null {
  // Created once. A lost context restores itself (callers show the still meanwhile).
  if (shared === undefined) shared = createRenderer();
  return shared;
}

let warming = false;

/**
 * Create the renderer and finish compiling its shader ahead of the call screen.
 * Safe to call often (hover, focus, idle): only the first call does work.
 */
export function prewarmRevOrb(): void {
  if (warming || typeof window === "undefined") return;
  warming = true;
  const renderer = getRevOrbRenderer();
  if (!renderer) return;
  const poll = () => {
    if (renderer.lost()) return;
    if (!renderer.ready()) { window.setTimeout(poll, 16); return; }
    // One tiny draw forces drivers that defer work until first use.
    renderer.resize(8, 1);
    renderer.draw({ phase: 0, amoeba: 0, energy: 0, muted: 0, glow: 0.55, nucleus: [0, 0] });
  };
  poll();
}

/** Prewarm when the browser is idle (falls back to a short timeout). */
export function prewarmRevOrbWhenIdle(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(() => prewarmRevOrb(), { timeout: 3000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(prewarmRevOrb, 1200);
  return () => window.clearTimeout(id);
}

/** Test hook: forget the shared renderer. */
export function resetRevOrbRendererForTests(): void {
  shared = undefined;
  warming = false;
}
