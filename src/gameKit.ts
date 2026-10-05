// Kleine Bausteine, die alle Minispiele teilen.

import type { Rng } from "./rng";

export const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
/** Stufe sicher als ganze Zahl ≥ 1 */
export const st = (n: number) => Math.max(1, Math.floor(n) || 1);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function onPress(el: HTMLElement, fn: (e: PointerEvent) => void) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn(e);
  });
}

/** Zufällige, sich kaum überlappende Positionen in einem Raster (in %). */
export function scatter(rng: Rng, count: number, cols: number, rows: number, pad = 8) {
  const cells: [number, number][] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cells.push([c, r]);
  return rng
    .shuffle(cells)
    .slice(0, count)
    .map(([c, r]) => {
      const w = (100 - pad * 2) / cols;
      const hh = (100 - pad * 2) / rows;
      return {
        x: pad + c * w + w * (0.25 + rng.next() * 0.5),
        y: pad + r * hh + hh * (0.25 + rng.next() * 0.5),
      };
    });
}

