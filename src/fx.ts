// Kleine Effekte: Konfetti, fliegende Punkte, Wackeln.

import { PALETTE } from "./games";

export function confetti(amount = 90) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.className = "confetti";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  document.body.append(c);
  const g = c.getContext("2d");
  if (!g) return c.remove();
  g.scale(dpr, dpr);
  const parts = Array.from({ length: amount }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    s: 6 + Math.random() * 8,
    c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  }));
  const t0 = performance.now();
  const frame = (t: number) => {
    g.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach((p) => {
      p.vy += 0.42;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.c;
      g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    });
    if (t - t0 < 2600) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

export function floatText(parent: HTMLElement, text: string, cls = "") {
  const e = document.createElement("div");
  e.className = `float-text ${cls}`;
  e.textContent = text;
  parent.append(e);
  setTimeout(() => e.remove(), 900);
}

export function shake(el: HTMLElement) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

export function countUp(el: HTMLElement, to: number, ms = 900, onTick?: () => void) {
  const t0 = performance.now();
  let last = -1;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
    el.textContent = String(v);
    if (onTick && Math.floor(v / 60) !== last) {
      last = Math.floor(v / 60);
      onTick();
    }
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
