// ZWIP: Push-Erinnerungen verschicken. Wird stündlich von pg_cron aufgerufen (siehe DEPLOYMENT.md).
// Welche Erinnerung fällig ist (Ruhezeit 22–8 Uhr, höchstens 2 am Tag, nur wenn die Daily noch fehlt), entscheidet
// die Datenbank-Funktion zwip_push_due(). Hier wird nur verschlüsselt und verschickt.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: secrets, error: se } = await db.from("zwip_secrets").select("key, value");
  if (se) return json({ error: "secrets", detail: se.message }, 500);
  const sec = Object.fromEntries((secrets ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));

  // Nur der Cron-Job (oder wer das Passwort kennt) darf verschicken
  if (!sec.cron || req.headers.get("x-zwip-cron") !== sec.cron) return json({ error: "forbidden" }, 403);
  if (!sec.vapid_public || !sec.vapid_private) return json({ error: "vapid_missing" }, 500);
  webpush.setVapidDetails(sec.vapid_subject || "mailto:luis.hausner@web.de", sec.vapid_public, sec.vapid_private);

  const body = await req.json().catch(() => ({}));
  // Testmodus: an eine übergebene Adresse schicken, ohne die Datenbank zu fragen
  type Due = { id: number; endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string };
  let due: Due[];
  if (body?.test?.endpoint) {
    due = [{ id: 0, endpoint: body.test.endpoint, p256dh: body.test.p256dh, auth: body.test.auth, title: "ZWIP Test", body: "Push funktioniert 🎉", url: "./", tag: "test" }];
  } else {
    const { data, error } = await db.rpc("zwip_push_due");
    if (error) return json({ error: "due", detail: error.message }, 500);
    due = (data ?? []) as Due[];
  }

  const gone: number[] = [];
  let sent = 0;
  const errors: string[] = [];
  await Promise.all(
    due.map(async (d) => {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          JSON.stringify({ title: d.title, body: d.body, url: d.url, tag: d.tag }),
          { TTL: 4 * 3600, urgency: "normal" },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(d.id);
        else errors.push(`${code ?? ""} ${(e as Error).message}`.trim().slice(0, 200));
      }
    }),
  );
  if (gone.length && gone.some((id) => id > 0)) await db.rpc("zwip_push_gone", { p_ids: gone.filter((id) => id > 0) });
  return json({ due: due.length, sent, gone: gone.length, errors: errors.slice(0, 5) });
});
