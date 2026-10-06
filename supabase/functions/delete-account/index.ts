// ZWIP: Konto löschen. Läuft mit Server-Rechten (Service-Rolle), weil nur so das Anmelde-Konto selbst gelöscht werden kann.
// Ablauf: Token prüfen → aus dem Clan austreten (zwip_prepare_delete) → Konto löschen. Alle persönlichen Daten hängen
// per "on delete cascade" am Konto und verschwinden mit.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "not_authenticated" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return json({ error: "not_authenticated" }, 401);
  const uid = data.user.id;

  const prep = await admin.rpc("zwip_prepare_delete", { p_user: uid });
  if (prep.error) return json({ error: "prepare_failed", detail: prep.error.message }, 500);

  const del = await admin.auth.admin.deleteUser(uid);
  if (del.error) return json({ error: "delete_failed", detail: del.error.message }, 500);

  return json({ deleted: true });
});
