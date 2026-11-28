# Rev Intelligence orb assets

The Rev orb is rendered by our own procedural renderer (`orb.py`, numpy only).
No third-party shader or exported component is used. Every loop is seamless,
because rotation rates and noise drift are integer multiples of one 12 s cycle.

Palette: glass `#4fa8ff`, centre `#1a4fe6`, rim `#92dcff`, plasma `#6fd0ff`,
faint accent `#ff8fc8`. Settings: energy 0.4, glow 0.55.

## Regenerate

```bash
python3 -m venv /tmp/orb && /tmp/orb/bin/pip install numpy pillow imageio-ffmpeg
cd Frontend/Dashboard/scripts/rev-orb && mkdir -p out
/tmp/orb/bin/python render_all.py images     # rev-orb.webp (animated, alpha) + rev-orb.png (still)
/tmp/orb/bin/python render_all.py sidebar    # rev-orb.mp4 (H.264 on black, screen-blended in the sidebar)
/tmp/orb/bin/python render_all.py loader     # rev-orb-loader.mp4 + .png (sphere fills frame; circle-clipped chat loader)
/tmp/orb/bin/python render_all.py call       # rev-orb-call.webp (512 px still for the voice call fallback)
/tmp/orb/bin/python render_all.py showcase   # rev-intell-orb-1080.mp4 (1080x1080, 12 s, on black)
```

Copy the `out/` files to these locations:

| File | Destination | Used by |
|---|---|---|
| `rev-orb.webp`, `rev-orb.png` | `src/assets/rev-orb/` | `<RevOrb>`: topbar, Rev hero, message avatars, history header |
| `rev-orb.mp4` | `src/assets/rev-orb/` | `<RevOrbVideo>`: sidebar nav item |
| `rev-orb-loader.mp4`, `rev-orb-loader.png` | `src/assets/rev-orb/` | `<RevOrbLoader>`: Rev Intell "thinking" indicator while a reply streams |
| `rev-orb-call.webp` | `src/assets/rev-orb/` | `<RevLiveOrb>` still: reduced motion and no-WebGL fallback |
| `rev-intell-orb-1080.mp4` | `Frontend/assets/videos/` | showcase / marketing |

`out/` is scratch output; do not commit it.

## Live GPU port (voice call)

The full-screen voice call does not use a video. `src/components/rev/revOrbGL.ts`
is a WebGL port of `orb.py` (same palette, shells, core, rim, halo and specks)
that renders in real time, adds the amoeba mode used while Rev speaks, and
downloads nothing. If you change the look here, mirror it in the shader
(`NS` and `FREQ` there compensate for simplex vs Perlin noise).
