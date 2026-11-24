"""
Renders the background video for the "What Revluma does" intro panel:
store signals drifting in depth, Revluma connecting the dots (links form
between nearby signals, pulses travel inward to a breathing core), and a few
signals flagged as anomalies (amber / red ping). Status colours only mark
status; everything else is the brand indigo.

Every motion is periodic over the clip length, so the video loops seamlessly.

Usage (needs numpy, pillow and an ffmpeg binary, e.g. from imageio-ffmpeg):
    python render-signals-video.py <ffmpeg> <out-dir>
Writes features-signals.mp4 (1920x1080), features-signals-sm.mp4 (960x540)
and features-signals-poster.jpg into <out-dir>.
"""

import math
import subprocess
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
FPS = 30
SECONDS = 12
FRAMES = FPS * SECONDS
CX, CY = W * 0.5, H * 0.53
TAU = math.tau

rng = np.random.default_rng(7)


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


# ---- static background: deep indigo radial + fixed dither (avoids banding) --
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
r = np.sqrt(((xx - CX) / (W * 0.62)) ** 2 + ((yy - CY) / (H * 0.78)) ** 2)
c_in, c_mid, c_out = hexrgb("#1c0f74"), hexrgb("#0d0838"), hexrgb("#05040f")
t1 = np.clip(r / 0.55, 0, 1)[..., None]
t2 = np.clip((r - 0.55) / 0.6, 0, 1)[..., None]
BG = c_in * (1 - t1) + c_mid * t1
BG = BG * (1 - t2) + c_out * t2
BG += rng.uniform(-1.6, 1.6, size=(H, W, 1)).astype(np.float32)


# ---- nodes -------------------------------------------------------------------
def make_layer(n, amp, keep_center):
    pts = []
    while len(pts) < n:
        x, y = rng.uniform(-60, W + 60), rng.uniform(-60, H + 60)
        e = math.hypot((x - CX) / (W * 0.36), (y - CY) / (H * 0.42))
        p = min(1.0, max(keep_center, (e - 0.45) / 0.55))
        if rng.random() < p:
            pts.append((x, y))
    pts = np.array(pts, dtype=np.float32)
    return {
        "base": pts,
        "amp": rng.uniform(amp * 0.4, amp, size=(n, 2)).astype(np.float32),
        "k": rng.choice([1, 1, 2], size=(n, 2)),
        "ph": rng.uniform(0, TAU, size=(n, 2)).astype(np.float32),
        "size": rng.uniform(1.6, 3.4, size=n).astype(np.float32),
        "tw": rng.uniform(0, TAU, size=n).astype(np.float32),
    }


NEAR = make_layer(96, 34, 0.12)
FAR = make_layer(150, 18, 0.35)
# Anomalies: a few near nodes away from the centre.
dist_c = np.hypot((NEAR["base"][:, 0] - CX) / W, (NEAR["base"][:, 1] - CY) / H)
cand = np.where((dist_c > 0.26) & (NEAR["base"][:, 0] > 80) & (NEAR["base"][:, 0] < W - 80) & (NEAR["base"][:, 1] > 80) & (NEAR["base"][:, 1] < H - 80))[0]
ANOM = list(rng.choice(cand, size=4, replace=False))
ANOM_COL = [hexrgb("#f04438"), hexrgb("#f79009"), hexrgb("#f79009"), hexrgb("#f04438")]
ANOM_PH = [0.0, 0.27, 0.52, 0.76]

# Pulses: travel from an outer node to the core. Integer laps per loop.
PULSES = []
outer = np.where(dist_c > 0.22)[0]
for i in range(22):
    PULSES.append({"node": int(rng.choice(outer)), "ph": float(rng.uniform(0, 1)), "laps": int(rng.choice([1, 2]))})


def positions(layer, t):
    a = TAU * t / SECONDS
    off = layer["amp"] * np.stack([np.cos(layer["k"][:, 0] * a + layer["ph"][:, 0]), np.sin(layer["k"][:, 1] * a + layer["ph"][:, 1])], axis=1)
    return layer["base"] + off


def add_rgb(acc, img, gain=1.0):
    acc += np.asarray(img, dtype=np.float32) * gain


def render(fi):
    t = fi / FPS
    a = TAU * t / SECONDS
    acc = BG.copy()

    # Far layer: dim, soft, few links.
    far = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(far)
    pf = positions(FAR, t)
    col_far = hexrgb("#6a58ff")
    for (x, y), s, tw in zip(pf, FAR["size"], FAR["tw"]):
        b = 0.35 + 0.25 * math.sin(2 * a + tw)
        c = tuple(int(v) for v in col_far * b)
        rr = s * 0.8
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=c)
    add_rgb(acc, far.filter(ImageFilter.GaussianBlur(1.6)))

    # Near layer: links + nodes.
    sharp = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(sharp)
    pn = positions(NEAR, t)
    diff = pn[:, None, :] - pn[None, :, :]
    dist = np.sqrt((diff**2).sum(-1))
    LINK = 210.0
    ii, jj = np.where((dist < LINK) & (np.triu(np.ones_like(dist), 1) > 0))
    col_line = hexrgb("#8b78ff")
    for i, j in zip(ii, jj):
        k = 1 - dist[i, j] / LINK
        c = tuple(int(v) for v in col_line * (k**1.4) * 0.72)
        d.line([tuple(pn[i]), tuple(pn[j])], fill=c, width=1)

    glow = Image.new("RGB", (W // 2, H // 2))
    g = ImageDraw.Draw(glow)
    col_node = hexrgb("#c9c0ff")
    for idx, ((x, y), s, tw) in enumerate(zip(pn, NEAR["size"], NEAR["tw"])):
        if idx in ANOM:
            continue
        b = 0.65 + 0.35 * math.sin(2 * a + tw)
        c = tuple(int(v) for v in col_node * b)
        d.ellipse([x - s, y - s, x + s, y + s], fill=c)
        gr = s * 1.6
        gc = tuple(int(v) for v in col_node * b * 0.5)
        g.ellipse([x / 2 - gr, y / 2 - gr, x / 2 + gr, y / 2 + gr], fill=gc)

    # Pulses: comets from outer nodes toward the core, fading as they arrive.
    col_p = hexrgb("#e9e4ff")
    for p in PULSES:
        u = (t / SECONDS * p["laps"] + p["ph"]) % 1.0
        sx, sy = pn[p["node"]]
        ease = u * u * (3 - 2 * u)
        fade = math.sin(math.pi * u) ** 1.2
        # Faint path to the core while the pulse travels.
        pc = tuple(int(q) for q in col_line * fade * 0.16)
        d.line([(sx, sy), (CX, CY)], fill=pc, width=1)
        # Smooth comet tail: short segments, brightest at the head.
        hx, hy = sx + (CX - sx) * ease, sy + (CY - sy) * ease
        SEG = 10
        for sgi in range(SEG):
            v0 = max(0.0, ease - (sgi + 1) * 0.011)
            v1 = max(0.0, ease - sgi * 0.011)
            x0, y0 = sx + (CX - sx) * v0, sy + (CY - sy) * v0
            x1, y1 = sx + (CX - sx) * v1, sy + (CY - sy) * v1
            k = fade * (1 - sgi / SEG) ** 1.5
            d.line([(x0, y0), (x1, y1)], fill=tuple(int(q) for q in col_p * k), width=2)
        rr = 2.6
        d.ellipse([hx - rr, hy - rr, hx + rr, hy + rr], fill=tuple(int(q) for q in col_p * fade))
        gc = tuple(int(q) for q in col_p * fade * 0.8)
        g.ellipse([hx / 2 - 5, hy / 2 - 5, hx / 2 + 5, hy / 2 + 5], fill=gc)

    # Anomalies: node turns amber / red, with an expanding ping ring.
    for idx, colr, ph in zip(ANOM, ANOM_COL, ANOM_PH):
        x, y = pn[idx]
        u = (t / SECONDS * 2 + ph) % 1.0
        on = 0.55 + 0.45 * math.sin(TAU * u) ** 2
        c = tuple(int(v) for v in colr * on)
        d.ellipse([x - 3.6, y - 3.6, x + 3.6, y + 3.6], fill=c)
        g.ellipse([x / 2 - 7, y / 2 - 7, x / 2 + 7, y / 2 + 7], fill=tuple(int(v) for v in colr * 0.55 * on))
        for ring in (0.0, 0.5):
            w = (u + ring) % 1.0
            rad = 6 + w * 58
            k = (1 - w) ** 2 * 0.7
            d.ellipse([x - rad, y - rad, x + rad, y + rad], outline=tuple(int(v) for v in colr * k), width=2)

    # Core: breathing glow where everything converges.
    br = 0.82 + 0.18 * math.sin(2 * a)
    core_col = hexrgb("#5a44ff")
    for rad, k in ((150, 0.10), (95, 0.18), (55, 0.28), (26, 0.5)):
        rr = rad * br / 2
        g.ellipse([CX / 2 - rr, CY / 2 - rr, CX / 2 + rr, CY / 2 + rr], fill=tuple(int(v) for v in core_col * k + (hexrgb("#ffffff") * k * 0.25 if rad < 30 else 0)))

    add_rgb(acc, sharp.filter(ImageFilter.GaussianBlur(0.6)))
    glow = glow.filter(ImageFilter.GaussianBlur(9)).resize((W, H), Image.BILINEAR)
    add_rgb(acc, glow, 1.35)

    return np.clip(acc, 0, 255).astype(np.uint8).tobytes()


def encode(ffmpeg, out, size, crf):
    return subprocess.Popen(
        [ffmpeg, "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-vf", f"scale={size}:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
         "-profile:v", "high", "-movflags", "+faststart", "-an", out],
        stdin=subprocess.PIPE,
    )


if __name__ == "__main__":
    ffmpeg, out_dir = sys.argv[1], sys.argv[2]
    big = encode(ffmpeg, f"{out_dir}/features-signals.mp4", "1920:1080", 27)
    small = encode(ffmpeg, f"{out_dir}/features-signals-sm.mp4", "960:540", 29)
    with Pool(2) as pool:
        for fi, frame in enumerate(pool.imap(render, range(FRAMES), chunksize=4)):
            big.stdin.write(frame)
            small.stdin.write(frame)
            if fi == 0:
                Image.frombytes("RGB", (W, H), frame).resize((1280, 720), Image.LANCZOS).save(f"{out_dir}/features-signals-poster.jpg", quality=82, optimize=True, progressive=True)
            if fi % 60 == 0:
                print("frame", fi, flush=True)
    for p in (big, small):
        p.stdin.close()
        p.wait()
    print("done")
