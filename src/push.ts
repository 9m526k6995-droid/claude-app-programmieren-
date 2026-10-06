// Push-Erinnerungen: höchstens 1–2 am Tag, nie zwischen 22 und 8 Uhr. Alles freiwillig und jederzeit abschaltbar.

import { esc, toast } from "./ui";
import { getPushSettings, savePushSub, removePushSub, SocialError, type PushSettings } from "./social";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iPhone/iPad: Push nur, wenn ZWIP auf dem Home-Bildschirm liegt */
function iosNeedsInstall(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

function b64ToBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register("sw.js");
  return navigator.serviceWorker.ready;
}

async function currentSub(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

async function enable(hour: number, publicKey: string): Promise<PushSettings> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Benachrichtigungen sind im Browser blockiert. Erlaube sie in den Website-Einstellungen." : "Ohne Erlaubnis keine Erinnerungen.");
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) as BufferSource }));
  const j = sub.toJSON();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  return savePushSub(j.endpoint!, j.keys!.p256dh, j.keys!.auth, tz, hour);
}

async function disable(): Promise<PushSettings> {
  const sub = await currentSub();
  const endpoint = sub?.endpoint ?? null;
  await sub?.unsubscribe().catch(() => false);
  return removePushSub(endpoint);
}

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8–21 Uhr

export function pushSettingsHtml(): string {
  return `<section class="card-sec push-sec" id="push-sec">
    <h2 class="sec-title">Erinnerungen</h2>
    <div id="push-body"><p class="muted small">Lädt…</p></div>
  </section>`;
}

export async function mountPushSettings(root: HTMLElement) {
  const body = root.querySelector<HTMLElement>("#push-body");
  if (!body) return;
  if (!pushSupported() || iosNeedsInstall()) {
    body.innerHTML = iosNeedsInstall()
      ? `<p class="muted small">Auf dem iPhone gehen Erinnerungen nur, wenn ZWIP auf dem Home-Bildschirm liegt: unten auf <b>Teilen</b> tippen → <b>Zum Home-Bildschirm</b>. Dann ZWIP von dort öffnen.</p>`
      : `<p class="muted small">Dieser Browser kann keine Erinnerungen anzeigen.</p>`;
    return;
  }
  let st: PushSettings;
  try {
    st = await getPushSettings();
  } catch (e) {
    body.innerHTML = `<p class="muted small">${esc(e instanceof SocialError ? e.message : "Gerade nicht erreichbar.")}</p>`;
    return;
  }
  if (!body.isConnected) return;
  if (!st.public_key) {
    body.innerHTML = `<p class="muted small">Erinnerungen sind noch nicht eingerichtet.</p>`;
    return;
  }
  const sub = await currentSub();
  const on = Boolean(sub) && st.devices > 0 && Notification.permission === "granted";
  body.innerHTML = `
    <label class="toggle"><input type="checkbox" id="push-on" ${on ? "checked" : ""}> Erinnerung an die Daily</label>
    <label class="lbl" for="push-hour">Uhrzeit</label>
    <select id="push-hour" ${on ? "" : "disabled"}>${HOURS.map((h) => `<option value="${h}" ${h === st.remind_hour ? "selected" : ""}>${h}:00 Uhr</option>`).join("")}</select>
    <p class="muted small">Höchstens 1–2 am Tag und nur, wenn du die Daily noch nicht gespielt hast. Zwischen 22 und 8 Uhr kommt nie etwas.</p>`;
  const box = body.querySelector<HTMLInputElement>("#push-on")!;
  const hourSel = body.querySelector<HTMLSelectElement>("#push-hour")!;
  box.addEventListener("change", async () => {
    box.disabled = true;
    try {
      if (box.checked) {
        await enable(Number(hourSel.value), st.public_key!);
        hourSel.disabled = false;
        toast(`Erinnerung um ${hourSel.value}:00 Uhr ist an 🔔`);
      } else {
        await disable();
        hourSel.disabled = true;
        toast("Erinnerungen aus 🔕");
      }
    } catch (e) {
      box.checked = !box.checked;
      toast(e instanceof Error && e.message ? e.message : "Hat nicht geklappt.");
    } finally {
      box.disabled = false;
    }
  });
  hourSel.addEventListener("change", async () => {
    try {
      await enable(Number(hourSel.value), st.public_key!);
      toast(`Erinnerung jetzt um ${hourSel.value}:00 Uhr 🔔`);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Hat nicht geklappt.");
    }
  });
}

/** Beim Abmelden: Abo auf diesem Gerät beenden, damit keine fremden Erinnerungen kommen */
export async function dropPushOnLogout() {
  const sub = await currentSub();
  await sub?.unsubscribe().catch(() => false);
}
