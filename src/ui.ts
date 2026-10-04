// Kleine, überall genutzte UI-Helfer.

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toast(msg: string) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

export function modal(inner: string, onMount?: (el: HTMLElement, close: () => void) => void) {
  const wrap = document.createElement("div");
  wrap.className = "modal-bg";
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${inner}</div>`;
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || (e.target as HTMLElement).closest("[data-close]")) close();
  });
  document.body.append(wrap);
  onMount?.(wrap.querySelector(".modal")!, close);
}
