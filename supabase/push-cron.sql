-- ZWIP: Stündlicher Job, der die Push-Erinnerungen anstößt (Minute 5 jeder Stunde).
-- Vorher: push.sql ausführen, Edge Function push-send anlegen („Verify JWT“ AUS – sie prüft selbst ein Passwort)
-- und die Schlüssel eintragen (siehe DEPLOYMENT.md, Schritt 13). DEIN-PROJEKT durch die Projekt-ID ersetzen.
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('zwip-push-hourly', '5 * * * *', $job$
  select net.http_post(
    url := 'https://DEIN-PROJEKT.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-zwip-cron', (select value from public.zwip_secrets where key = 'cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$job$);
