-- ZWIP: Land im Konto + regionale Ranglisten (Trophäen und Minigames)
-- Voraussetzung: profiles.sql, trophies.sql, profile.sql, minigames.sql, social.sql und clans.sql. Mehrfaches Ausführen ist unschädlich.
--
-- Das Land wählt jeder selbst (kein Standort, keine Pflicht). Gespeichert wird nur der Ländercode (z. B. DE, NL).
-- Ändern geht einmal im Monat; direkt nach einer Wahl gibt es 15 Minuten Zeit, sich zu korrigieren.
-- Wer sein Land verbirgt, erscheint nur in den weltweiten Ranglisten.

alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists country_changed_at timestamptz;
alter table public.profiles add column if not exists country_hidden boolean not null default false;

do $$ begin
  alter table public.profiles add constraint profiles_country_code check (country is null or country ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

create index if not exists profiles_country_idx on public.profiles (country, trophies desc) where country is not null;

-- Land, das andere sehen dürfen (null, wenn keins gewählt oder verborgen)
create or replace function public.zwip_visible_country(p_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$ select case when country_hidden then null else country end from public.profiles where id = p_id $$;

-- Spieler-Daten für Listen und Profile – jetzt mit Land
create or replace function public.zwip_player_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'username', r.username, 'trophies', r.trophies, 'league', r.league,
    'world_rank', r.world_rank, 'best_streak', r.best_streak, 'trophy_rounds', r.trophy_rounds,
    'country', public.zwip_visible_country(r.id))
  from public.zwip_ranked() r where r.id = p_id
$$;

-- Eigenes Land + ab wann es wieder geändert werden kann
create or replace function public.get_my_country()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); p public.profiles;
begin
  select * into p from public.profiles where id = me;
  return jsonb_build_object(
    'country', p.country,
    'hidden', p.country_hidden,
    'changed_at', p.country_changed_at,
    'next_change_at', case when p.country_changed_at is null then null else p.country_changed_at + interval '1 month' end,
    'fix_until', case when p.country_changed_at is null then null else p.country_changed_at + interval '15 minutes' end,
    'can_change', p.country_changed_at is null
                  or now() >= p.country_changed_at + interval '1 month'
                  or now() < p.country_changed_at + interval '15 minutes');
end;
$$;

-- Land wählen ('' oder null = kein Land). Einmal im Monat, mit 15 Minuten Korrekturzeit nach einer Wahl.
create or replace function public.set_country(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); p public.profiles; code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
begin
  if code is not null and code !~ '^[A-Z]{2}$' then raise exception 'invalid_country' using errcode = 'P0001'; end if;
  select * into p from public.profiles where id = me for update;
  if code is not distinct from p.country then return public.get_my_country(); end if;
  if p.country_changed_at is not null
     and now() < p.country_changed_at + interval '1 month'
     and now() >= p.country_changed_at + interval '15 minutes' then
    raise exception 'country_locked' using errcode = 'P0001';
  end if;
  update public.profiles
    set country = code,
        -- Korrektur innerhalb der 15 Minuten verschiebt die Monatsfrist nicht
        country_changed_at = case when p.country_changed_at is not null and now() < p.country_changed_at + interval '15 minutes'
                                  then p.country_changed_at else now() end
    where id = me;
  return public.get_my_country();
end;
$$;

-- Land in Ranglisten verbergen oder zeigen (jederzeit)
create or replace function public.set_country_hidden(p_hidden boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  update public.profiles set country_hidden = coalesce(p_hidden, false) where id = me;
  return public.get_my_country();
end;
$$;

-- Trophäen-Rangliste eines Landes (null/'' = weltweit, gleiche Form wie get_trophy_board)
create or replace function public.get_trophy_region_board(p_country text, p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := public.zwip_me();
  code text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  my_pos bigint;
begin
  if code is null then
    return public.get_trophy_board(lim) || jsonb_build_object('country', null);
  end if;
  if code !~ '^[A-Z]{2}$' then raise exception 'invalid_country' using errcode = 'P0001'; end if;
  return (
    with reg as (
      select r.*, row_number() over (order by r.world_rank) as pos
      from public.zwip_ranked() r join public.profiles p on p.id = r.id
      where p.country = code and not p.country_hidden
    )
    select jsonb_build_object(
      'country', code,
      'top', coalesce((select jsonb_agg(jsonb_build_object(
                 'rank', g.pos, 'world_rank', g.world_rank, 'username', g.username, 'trophies', g.trophies, 'league', g.league,
                 'best_streak', g.best_streak, 'trophy_rounds', g.trophy_rounds, 'is_me', g.id = me, 'country', code)
               order by g.pos) from reg g where g.pos <= lim), '[]'::jsonb),
      'me', (select public.zwip_player_json(g.id) || jsonb_build_object('rank', g.pos) from reg g where g.id = me),
      'above', (select public.zwip_player_json(a.id) || jsonb_build_object('rank', a.pos)
                from reg g join reg a on a.pos = g.pos - 1 where g.id = me),
      'below', (select public.zwip_player_json(b.id) || jsonb_build_object('rank', b.pos)
                from reg g join reg b on b.pos = g.pos + 1 where g.id = me),
      'total', (select count(*) from reg)));
end;
$$;

revoke all on function public.zwip_visible_country(uuid) from public, anon, authenticated;
revoke all on function public.zwip_player_json(uuid) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.get_my_country()', 'public.set_country(text)', 'public.set_country_hidden(boolean)',
                           'public.get_trophy_region_board(text, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
