-- ZWIP: Push-Erinnerungen (Web Push). Höchstens 2 am Tag, nie zwischen 22 und 8 Uhr (Ortszeit des Geräts).
-- Muss nach moderation.sql laufen. Kann gefahrlos mehrfach ausgeführt werden.
-- Die Schlüssel (VAPID) und das Cron-Passwort liegen in public.zwip_secrets – nur für den Server lesbar, nie im Repo.

create table if not exists public.zwip_secrets (
  key   text primary key,
  value text not null
);
alter table public.zwip_secrets enable row level security;
revoke all on public.zwip_secrets from anon, authenticated;
grant select on public.zwip_secrets to service_role;

alter table public.profiles add column if not exists last_daily_day integer;
alter table public.profiles add column if not exists daily_streak integer not null default 0;

create table if not exists public.push_subs (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  tz           text not null default 'Europe/Berlin',
  remind_hour  integer not null default 18 check (remind_hour between 8 and 21),
  active       boolean not null default true,
  sent_day     date,
  sent_count   integer not null default 0,
  last_sent_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs (user_id) where active;
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;

-- Zeitzone prüfen (unbekannte → Berlin)
create or replace function public.zwip_safe_tz(p_tz text)
returns text
language plpgsql stable set search_path = ''
as $$
begin
  if p_tz is null or char_length(p_tz) > 64 then return 'Europe/Berlin'; end if;
  perform now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'Europe/Berlin';
end;
$$;

-- ---------- Für die App ----------

create or replace function public.get_push_settings()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  return jsonb_build_object(
    'public_key', (select value from public.zwip_secrets where key = 'vapid_public'),
    'devices', (select count(*) from public.push_subs where user_id = me and active),
    'remind_hour', coalesce((select remind_hour from public.push_subs where user_id = me and active order by created_at desc limit 1), 18));
end;
$$;

create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_tz text, p_hour integer default 18)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  if coalesce(p_endpoint, '') !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or char_length(p_p256dh) > 200 or coalesce(p_auth, '') = '' or char_length(p_auth) > 100 then
    raise exception 'invalid_push' using errcode = 'P0001';
  end if;
  if (select count(*) from public.push_subs where user_id = me and active and endpoint <> p_endpoint) >= 5 then
    update public.push_subs set active = false
      where id = (select id from public.push_subs where user_id = me and active order by created_at limit 1);
  end if;
  insert into public.push_subs (user_id, endpoint, p256dh, auth, tz, remind_hour)
    values (me, p_endpoint, p_p256dh, p_auth, public.zwip_safe_tz(p_tz), least(21, greatest(8, coalesce(p_hour, 18))))
    on conflict (endpoint) do update set
      user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz,
      remind_hour = excluded.remind_hour, active = true;
  update public.push_subs set remind_hour = least(21, greatest(8, coalesce(p_hour, 18))) where user_id = me and active;
  return public.get_push_settings();
end;
$$;

create or replace function public.remove_push_sub(p_endpoint text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  update public.push_subs set active = false where user_id = me and (p_endpoint is null or endpoint = p_endpoint);
  return public.get_push_settings();
end;
$$;

-- Die App meldet, wenn die Daily gespielt wurde (damit niemand unnötig erinnert wird)
create or replace function public.mark_daily_played(p_day integer, p_streak integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  if p_day is null or p_day < 0 or p_day > 100000 then return; end if;
  update public.profiles set
      last_daily_day = greatest(coalesce(last_daily_day, 0), p_day),
      daily_streak = least(10000, greatest(0, coalesce(p_streak, 0)))
    where id = me;
end;
$$;

-- ---------- Für den Server (Edge Function push-send) ----------
-- Liefert die jetzt fälligen Erinnerungen und merkt sie sofort als verschickt.
--  1. Erinnerung zur Wunschzeit (Standard 18 Uhr), wenn die heutige Daily noch nicht gespielt ist.
--  2. Höchstens eine zweite um 20 bzw. 21 Uhr, nur wenn eine Streak (≥ 2 Tage) heute verloren ginge.
create or replace function public.zwip_push_due()
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with cand as (
    select s.id, s.endpoint, s.p256dh, s.auth, s.remind_hour,
           (now() at time zone s.tz) as lt,
           ((now() at time zone s.tz)::date - date '2026-09-30') as today_n,
           case when s.sent_day = (now() at time zone s.tz)::date then s.sent_count else 0 end as sent_today,
           p.last_daily_day, p.daily_streak, p.banned_until
    from public.push_subs s join public.profiles p on p.id = s.user_id
    where s.active
  ),
  due as (
    select c.*,
           case
             when c.sent_today = 0 and extract(hour from c.lt)::integer = c.remind_hour then 1
             when c.sent_today = 1 and c.daily_streak >= 2 and c.last_daily_day = c.today_n - 1
                  and extract(hour from c.lt)::integer = case when c.remind_hour >= 20 then 21 else 20 end then 2
           end as kind
    from cand c
    where extract(hour from c.lt)::integer between 8 and 21          -- Ruhezeit 22–8 Uhr
      and c.sent_today < 2                                           -- höchstens 2 am Tag
      and coalesce(c.last_daily_day, -1) < c.today_n                 -- heute noch nicht gespielt
      and (c.banned_until is null or c.banned_until < now())
  ),
  upd as (
    update public.push_subs s set
        sent_count = case when s.sent_day = (d.lt)::date then s.sent_count + 1 else 1 end,
        sent_day = (d.lt)::date,
        last_sent_at = now()
      from due d
      where s.id = d.id and d.kind is not null
      returning s.id
  )
  select d.id, d.endpoint, d.p256dh, d.auth,
         case when d.kind = 2 or (d.daily_streak >= 2 and d.last_daily_day = d.today_n - 1)
              then '🔥 Deine ' || d.daily_streak || '-Tage-Streak!'
              else '⚡ Die neue Daily ist da' end,
         case when d.kind = 2 then 'Nur noch heute – spiel die Daily, sonst ist die Streak weg.'
              when d.daily_streak >= 2 and d.last_daily_day = d.today_n - 1 then 'Die Daily von heute wartet. 10 Blitz-Aufgaben, 2 Minuten – halt die Streak am Leben!'
              else '10 Blitz-Aufgaben, für alle gleich. Schaffst du heute mehr als deine Freunde?' end,
         './#/start',
         'daily-' || d.today_n
  from due d
  where d.kind is not null and d.id in (select upd.id from upd);
end;
$$;

-- Abgelaufene Abos (404/410 vom Push-Dienst) abschalten
create or replace function public.zwip_push_gone(p_ids bigint[])
returns void
language sql security definer set search_path = ''
as $$ update public.push_subs set active = false where id = any (p_ids) $$;

-- ---------- Rechte ----------
revoke all on function public.zwip_push_due() from public, anon, authenticated;
revoke all on function public.zwip_push_gone(bigint[]) from public, anon, authenticated;
grant execute on function public.zwip_push_due() to service_role;
grant execute on function public.zwip_push_gone(bigint[]) to service_role;
do $$
declare f text;
begin
  foreach f in array array['public.get_push_settings()', 'public.save_push_sub(text, text, text, text, integer)',
                           'public.remove_push_sub(text)', 'public.mark_daily_played(integer, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
