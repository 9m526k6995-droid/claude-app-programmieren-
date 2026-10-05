// Bausteine fürs Profil: Profilbild (Anzeige + Verkleinern), Profil-Link, Teilen.

import { esc, modal, toast } from "./ui";
import { publicBase } from "./config";

/** Rundes Profilbild – oder der Anfangsbuchstabe auf Liga-Farbe, wenn es (noch) keins gibt. */
export function avatarHtml(name: string | null | undefined, avatar: string | null | undefined, cls = "pm-avatar"): string {
  const letter = esc((name || "?").slice(0, 1).toUpperCase());
  // Nur echte Bild-Daten zulassen (die Datenbank prüft das ebenfalls)
  const safe = avatar && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar) ? avatar : "";
  return safe
    ? `<span class="${cls} has-img" aria-hidden="true"><img src="${safe}" alt="" draggable="false"></span>`
    : `<span class="${cls}" aria-hidden="true">${letter}</span>`;
}

/** Direktlink zu einem Profil, z. B. https://zwip.app/?p=Lena */
export function profileLink(username: string): string {
  let u: URL;
  try {
    u = new URL(publicBase());
  } catch {
    u = new URL("https://zwip.app/");
  }
  u.search = "";
  u.hash = "";
  u.searchParams.set("p", username);
  return u.toString();
}

/** Teilen-Menü des Handys öffnen, sonst in die Zwischenablage kopieren, sonst zum Abschreiben zeigen. */
export async function shareLink(url: string, text: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title: "ZWIP", text, url });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  await copyLink(url);
}

export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast("Link kopiert ✌️");
    return;
  } catch {
    /* Fallback unten */
  }
  modal(
    `<h3>Dein Profil-Link</h3><textarea class="copy-area" readonly>${esc(url)}</textarea><button class="btn primary" data-close>Fertig</button>`,
    (el) => {
      const ta = el.querySelector("textarea")!;
      ta.focus();
      ta.select();
    },
  );
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function memberSince(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `Dabei seit ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ---------- Profilbild aus der Foto-Mediathek ----------

export class AvatarError extends Error {}

const MAX_CHARS = 140_000; // Datenbank erlaubt 150.000 Zeichen

async function decode(file: File): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    } catch {
      /* z. B. älteres Safari → Fallback über <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("decode"));
      img.src = url;
    });
    return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new AvatarError("Dieses Bildformat kann dein Browser nicht öffnen. Probier ein anderes Foto (JPG oder PNG).");
  }
}

/**
 * Schneidet ein Foto quadratisch aus der Mitte zu, verkleinert es auf 256×256 und
 * macht daraus ein kleines JPEG (als Data-URL), das direkt im Profil gespeichert wird.
 */
export async function fileToAvatar(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name)) {
    throw new AvatarError("Bitte wähle ein Foto aus.");
  }
  if (file.size > 30 * 1024 * 1024) throw new AvatarError("Das Foto ist zu groß (max. 30 MB).");
  const { img, w, h, done } = await decode(file);
  try {
    if (!w || !h) throw new AvatarError("Das Foto ist leer oder beschädigt.");
    const side = Math.min(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AvatarError("Dein Browser kann das Bild nicht bearbeiten.");
    ctx.fillStyle = "#16101f"; // transparente PNGs bekommen den App-Hintergrund
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    for (const q of [0.86, 0.75, 0.62, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.startsWith("data:image/jpeg") && url.length <= MAX_CHARS) return url;
    }
    throw new AvatarError("Das Bild ist zu detailreich. Probier ein anderes Foto.");
  } finally {
    done();
  }
}
