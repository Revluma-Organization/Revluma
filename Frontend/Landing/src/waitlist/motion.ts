import { useEffect, type RefObject } from "react";

/** True when the visitor asked for less motion; every animation here checks it or is CSS-gated. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? "auto" : "smooth";
}

/** A mouse or trackpad that can hover. Touch screens get the idle float instead of tilt. */
export function finePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * Spring-driven 3D tilt. Pointer position over `stage` sets a target angle;
 * a damped spring eases `target` toward it every frame, writing CSS custom
 * properties (--rx, --ry for rotation, --gx, --gy for the glare position) so
 * the browser only composites transforms. The loop stops when it settles, and
 * nothing runs for reduced motion or touch input.
 */
export function useTilt(stage: RefObject<HTMLElement>, target: RefObject<HTMLElement>, max = 11) {
  useEffect(() => {
    const area = stage.current;
    const el = target.current;
    if (!area || !el || reducedMotion() || !finePointer()) return;

    const now = { x: 0, y: 0, gx: 50, gy: 50 };
    const goal = { x: 0, y: 0, gx: 50, gy: 50 };
    const speed = { x: 0, y: 0 };
    let frame = 0;

    const write = () => {
      el.style.setProperty("--rx", `${now.y.toFixed(2)}deg`);
      el.style.setProperty("--ry", `${now.x.toFixed(2)}deg`);
      el.style.setProperty("--gx", `${now.gx.toFixed(1)}%`);
      el.style.setProperty("--gy", `${now.gy.toFixed(1)}%`);
    };

    const tick = () => {
      // Stiffness and damping tuned for a quick, slightly bouncy settle.
      speed.x = (speed.x + (goal.x - now.x) * 0.11) * 0.74;
      speed.y = (speed.y + (goal.y - now.y) * 0.11) * 0.74;
      now.x += speed.x;
      now.y += speed.y;
      now.gx += (goal.gx - now.gx) * 0.2;
      now.gy += (goal.gy - now.gy) * 0.2;
      write();
      const moving =
        Math.abs(goal.x - now.x) > 0.02 || Math.abs(goal.y - now.y) > 0.02 || Math.abs(speed.x) > 0.02 || Math.abs(speed.y) > 0.02 || Math.abs(goal.gx - now.gx) > 0.2;
      frame = moving ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const onMove = (event: PointerEvent) => {
      const box = area.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const py = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
      goal.x = (px - 0.5) * 2 * max;
      goal.y = -(py - 0.5) * 2 * max * 0.8;
      goal.gx = px * 100;
      goal.gy = py * 100;
      kick();
    };
    const onEnter = () => area.classList.add("is-hovered");
    const onLeave = () => {
      area.classList.remove("is-hovered");
      goal.x = 0;
      goal.y = 0;
      goal.gx = 50;
      goal.gy = 50;
      kick();
    };

    area.addEventListener("pointerenter", onEnter);
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener("pointerenter", onEnter);
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerleave", onLeave);
      area.classList.remove("is-hovered");
      ["--rx", "--ry", "--gx", "--gy"].forEach((name) => el.style.removeProperty(name));
    };
  }, [stage, target, max]);
}
