import sys, subprocess, numpy as np, multiprocessing as mp
from PIL import Image
import imageio_ffmpeg, orb
FF = imageio_ffmpeg.get_ffmpeg_exe()
LOOP_S = 12

def frame(args):
    size, t, R, out = args
    return orb.render(size, t, R=R)

def frames(size, fps, R, out_size=None):
    n = LOOP_S * fps
    with mp.Pool(2) as pool:
        for f in pool.imap(frame, [(size, i / n, R, out_size) for i in range(n)], chunksize=4):
            if out_size and out_size != size:
                im = Image.fromarray(orb.to_rgba8(f), "RGBA").resize((out_size, out_size), Image.LANCZOS)
                yield np.asarray(im)
            else:
                yield orb.to_rgba8(f)

def encode(cmd, gen, size):
    p = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba",
                          "-s", f"{size}x{size}", "-r", str(cmd.pop(0)), "-i", "-"] + cmd, stdin=subprocess.PIPE)
    for f in gen:
        p.stdin.write(np.ascontiguousarray(f).tobytes())
    p.stdin.close(); assert p.wait() == 0

def on_black(gen):
    for f in gen:
        a = f[..., 3:4].astype(np.float32) / 255
        yield np.concatenate([(f[..., :3] * a + 0.5).astype(np.uint8), np.full_like(f[..., :1], 255)], axis=2)

job = sys.argv[1]
if job == "showcase":
    encode([30, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            "out/rev-intell-orb-1080.mp4"], on_black(frames(1080, 30, 0.62)), 1080)
elif job == "sidebar":
    small = list(frames(288, 24, 0.84, 96))
    encode([24, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            "-an", "out/rev-orb.mp4"], on_black(iter(small)), 96)
elif job == "images":
    imgs = [Image.fromarray(f, "RGBA") for f in frames(384, 12, 0.80, 128)]
    imgs[0].save("out/rev-orb.webp", save_all=True, append_images=imgs[1:], duration=83, loop=0,
                 lossless=False, quality=60, alpha_quality=70, method=6, exact=False)
    still = Image.fromarray(orb.to_rgba8(orb.render(768, 0.0, R=0.80)), "RGBA").resize((256, 256), Image.LANCZOS)
    still.save("out/rev-orb.png", optimize=True)
print(job, "done")
