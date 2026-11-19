"""Procedural plasma orb renderer (our own implementation).

Renders a seamlessly looping glass plasma ball with a transparent background.
Look targets: glass #4fa8ff, centre #1a4fe6, rim #92dcff, plasma #6fd0ff,
accent #ff8fc8 (faint), energy 0.4, swirl 0, glow 0.55.
"""
import math
import numpy as np

rng = np.random.default_rng(7)
PERM = np.tile(rng.permutation(256), 2).astype(np.int64)
G3 = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
               [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1]],
              dtype=np.float32)


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def perlin(x, y, z):
    xi, yi, zi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64), np.floor(z).astype(np.int64)
    xf, yf, zf = x - xi, y - yi, z - zi
    xi &= 255; yi &= 255; zi &= 255
    fade = lambda t: t * t * t * (t * (t * 6 - 15) + 10)
    u, v, w = fade(xf), fade(yf), fade(zf)

    def grad(ix, iy, iz, dx, dy, dz):
        g = G3[PERM[PERM[PERM[ix] + iy] + iz] & 15]
        return g[..., 0] * dx + g[..., 1] * dy + g[..., 2] * dz

    x1, y1, z1 = (xi + 1) & 255, (yi + 1) & 255, (zi + 1) & 255
    n000 = grad(xi, yi, zi, xf, yf, zf); n100 = grad(x1, yi, zi, xf - 1, yf, zf)
    n010 = grad(xi, y1, zi, xf, yf - 1, zf); n110 = grad(x1, y1, zi, xf - 1, yf - 1, zf)
    n001 = grad(xi, yi, z1, xf, yf, zf - 1); n101 = grad(x1, yi, z1, xf - 1, yf, zf - 1)
    n011 = grad(xi, y1, z1, xf, yf - 1, zf - 1); n111 = grad(x1, y1, z1, xf - 1, yf - 1, zf - 1)
    lerp = lambda a, b, t: a + (b - a) * t
    return lerp(lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
                lerp(lerp(n001, n101, u), lerp(n011, n111, u), v), w)


def rot_y(p, a):
    c, s = math.cos(a), math.sin(a)
    x, y, z = p
    return (c * x + s * z, y, -s * x + c * z)


def rot_x(p, a):
    c, s = math.cos(a), math.sin(a)
    x, y, z = p
    return (x, c * y - s * z, s * y + c * z)


def filaments(p, phase, scale, seed):
    """Ridged, domain-warped noise -> thin bright vein-like filaments."""
    x, y, z = (c * scale for c in p)
    # Periodic warp drift: a circle in noise space loops seamlessly.
    ox, oy = 1.3 * math.cos(phase), 1.3 * math.sin(phase)
    wx = perlin(x * 0.7 + ox + seed, y * 0.7 + oy, z * 0.7)
    wy = perlin(x * 0.7 + 17.1, y * 0.7 + ox + seed, z * 0.7 + oy)
    wz = perlin(x * 0.7 + oy, y * 0.7 + 31.7, z * 0.7 + ox + seed)
    x2, y2, z2 = x + 1.6 * wx, y + 1.6 * wy, z + 1.6 * wz
    n = perlin(x2, y2, z2) + 0.5 * perlin(x2 * 2.1 + 5.2, y2 * 2.1, z2 * 2.1)
    ridge = 1.0 - np.clip(np.abs(n) * 2.6, 0, 1)
    fine = 1.0 - np.clip(np.abs(perlin(x2 * 4.3, y2 * 4.3 + 9.1, z2 * 4.3)) * 3.0, 0, 1)
    return ridge ** 9 + 0.35 * (ridge ** 5) * (fine ** 6)


def render(size, t, *, energy=0.4, glow=0.55, detail=1.0, R=0.70):
    """Return float32 RGBA premultiplied frame for loop position t in [0,1)."""
    pal = dict(center=hexc("#1a4fe6"), glass=hexc("#4fa8ff"), rim=hexc("#92dcff"),
               plasma=hexc("#6fd0ff"), accent=hexc("#ff8fc8"))
    lin = (np.arange(size, dtype=np.float32) + 0.5) / size * 2 - 1
    X, Y = np.meshgrid(lin, -lin)
    pass
    r = np.sqrt(X * X + Y * Y)
    inside = r < R
    light = np.zeros((size, size, 3), np.float32)
    alpha = np.zeros((size, size), np.float32)

    xs, ys = X[inside] / R, Y[inside] / R
    rr = np.sqrt(xs * xs + ys * ys)
    zs = np.sqrt(np.clip(1 - rr * rr, 0, 1))
    phase = 2 * math.pi * t

    # Glass body: deep blue core fading to glass tint, semi-transparent.
    body_mix = np.clip(rr ** 1.4, 0, 1)[:, None]
    body = pal["center"] * (1 - body_mix) + pal["glass"] * body_mix
    body_a = 0.90 + 0.08 * rr ** 2
    col = body * (0.10 + 0.34 * rr ** 2.5)[:, None] * body_a[:, None]
    a = body_a.copy()

    # Plasma filaments on nested shells (parallax), rotating at integer rates -> seamless loop.
    plasma_acc = np.zeros_like(rr)
    shells = [(0.55, 1, 2.2, 0.0, 1.0), (0.80, -1, 1.8, 11.0, 0.85), (0.97, 2, 1.5, 23.0, 0.28)]
    for radius, rate, scale, seed, weight in shells:
        inner = rr < radius
        sx, sy = xs[inner] / radius, ys[inner] / radius
        sz = np.sqrt(np.clip(1 - sx * sx - sy * sy, 0, 1))
        p = rot_x(rot_y((sx, sy, sz), phase * rate), 0.35)
        f = filaments(p, phase * (1 if rate > 0 else -1), scale * (1 + 0.25 * detail), seed)
        # Loose rings: suppress the very centre (core glow owns it) and fade at the shell edge.
        rs = rr[inner] / radius
        env = (np.clip((rr[inner] - 0.06) / 0.18, 0, 1) * (1 - rs ** 4) * (0.55 + 0.45 * sz)
               * (0.45 + 0.9 * np.exp(-((rr[inner] - 0.38) / 0.28) ** 2)))
        plasma_acc[inner] += weight * f * env
    plasma_acc *= 0.9 + 1.4 * energy

    core = np.exp(-(rr / 0.24) ** 2)
    core_wide = np.exp(-(rr / 0.55) ** 2)
    pulse = 1.0 + 0.06 * math.sin(phase * 2)
    white = np.array([0.92, 0.97, 1.0], np.float32)
    cyan = np.array([0.25, 0.80, 1.0], np.float32)
    col += (cyan * 0.75 + pal["plasma"] * 0.25) * (plasma_acc * (1.0 + 1.2 * core_wide))[:, None]
    col += white * (np.clip(plasma_acc - 0.8, 0, None) * 0.35)[:, None]
    col += (pal["glass"] * 0.6 + cyan * 0.4) * (core_wide * 0.60 * pulse)[:, None]
    col += white * (core * 1.6 * pulse)[:, None]
    # Faint accent tint deep in the filaments (energy 0.4 keeps it subtle).
    col += pal["accent"] * (np.clip(plasma_acc - 0.9, 0, None) * 0.08 * energy)[:, None]

    # Fresnel rim + inner edge darkening + soft specular.
    fres = (1 - zs) ** 2.2
    col += (pal["rim"] * 0.45 + pal["glass"] * 0.55) * (fres ** 1.3 * 0.95)[:, None]
    col *= (1 - 0.25 * (1 - zs) ** 8)[:, None]
    hx, hy = xs + 0.38, ys - 0.45
    spec = np.exp(-((hx / 0.42) ** 2 + (hy / 0.22) ** 2)) * 0.12
    col += np.array([0.85, 0.93, 1.0], np.float32) * spec[:, None]

    a = np.clip(np.maximum(a, col.max(axis=1)), 0, 1)
    light[inside] = col
    alpha[inside] = a

    # Outer halo (glow) with antialiased sphere edge.
    d = r - R
    edge_aa = np.clip(0.5 - d * size / 2, 0, 1)
    halo = np.exp(-np.clip(d, 0, None) / (0.055 * (1 - R) / 0.30)) * (d > -0.002) * glow * 0.75
    halo_col = pal["glass"] * 0.6 + pal["rim"] * 0.4
    light = light * edge_aa[..., None] + halo_col * halo[..., None] * (1 - edge_aa[..., None])
    alpha = alpha * edge_aa + halo * (1 - edge_aa)

    # Sparse drifting specks near the sphere.
    srng = np.random.default_rng(3)
    for _ in range(int(26 * (0.5 + energy))):
        ang0, rad = srng.uniform(0, 2 * math.pi), srng.uniform(0.25, 0.95) * R
        spin = srng.choice([-1, 1])
        ang = ang0 + spin * phase
        px, py = rad * math.cos(ang), rad * math.sin(ang) * 0.9
        tw = 0.5 + 0.5 * math.sin(phase * srng.integers(1, 4) + ang0)
        s = np.exp(-(((X - px) ** 2 + (Y - py) ** 2) / (2 * (1.1 / size) ** 2))) * 0.8 * tw
        light += pal["rim"] * s[..., None]
        alpha = np.maximum(alpha, s)

    light = 1 - np.exp(-light * 1.15)  # soft tone map keeps highlights from clipping
    alpha = np.clip(np.maximum(alpha, light.max(axis=2)), 0, 1)
    return np.concatenate([light, alpha[..., None]], axis=2)


def to_rgba8(frame):
    """Premultiplied float -> straight-alpha uint8 RGBA."""
    a = frame[..., 3:4]
    rgb = np.where(a > 1e-4, frame[..., :3] / np.maximum(a, 1e-4), 0)
    out = np.concatenate([np.clip(rgb, 0, 1), a], axis=2)
    return (out * 255 + 0.5).astype(np.uint8)


def over(frame, bg):
    bg = hexc(bg)
    return (np.clip(frame[..., :3] + bg * (1 - frame[..., 3:4]), 0, 1) * 255 + 0.5).astype(np.uint8)
