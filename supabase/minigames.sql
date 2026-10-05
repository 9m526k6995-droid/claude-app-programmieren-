-- ZWIP: Minigames als Einzelspiele – Stufen-Läufe und eine Rangliste pro Spiel
-- Voraussetzung: profiles.sql und trophies.sql wurden bereits ausgeführt.
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen. Mehrfaches Ausführen ist unschädlich.
--
-- Sicherheitsprinzip wie bei den Trophäen:
--   * Die App schreibt nie direkt in Tabellen, nur über die Funktionen unten.
--   * Der Server vergibt Lauf-ID und Seed und prüft beim Beenden, ob das Ergebnis realistisch ist.
--   * Nach außen gehen nur Spielername, Stufe, Zeit und Liga – nie E-Mail, IDs oder Profilbilder.

-- =====================================================================
-- 1. Tabellen
-- =====================================================================

create table if not exists public.minigame_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  game_id      text not null,
  seed         integer not null,
  status       text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stage        integer,
  total_ms     integer,
  steps        jsonb
);

create index if not exists minigame_runs_user_idx on public.minigame_runs (user_id, status, started_at desc);

alter table public.minigame_runs enable row level security;
drop policy if exists "own minigame runs: read" on public.minigame_runs;
create policy "own minigame runs: read" on public.minigame_runs for select using (user_id = (select auth.uid()));
revoke all on public.minigame_runs from anon, authenticated;
grant select on public.minigame_runs to authenticated;

create table if not exists public.minigame_bests (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  game_id      text not null,
  best_stage   integer not null default 0 check (best_stage between 0 and 200),
  best_ms      integer not null default 0 check (best_ms >= 0),
  plays        integer not null default 0,
  achieved_at  timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- Passend zur Ranglisten-Sortierung
create index if not exists minigame_bests_rank_idx
  on public.minigame_bests (game_id, best_stage desc, best_ms asc, achieved_at asc, user_id);

alter table public.minigame_bests enable row level security;
drop policy if exists "own minigame bests: read" on public.minigame_bests;
create policy "own minigame bests: read" on public.minigame_bests for select using (user_id = (select auth.uid()));
revoke all on public.minigame_bests from anon, authenticated;
grant select on public.minigame_bests to authenticated;

-- =====================================================================
-- 2. Hilfsfunktionen (nicht von der App aufrufbar)
-- =====================================================================

-- Gültige Spiele und die Mindestdauer pro geschaffter Stufe (ms) für die Plausibilitätsprüfung
create or replace function public.zwip_minigame_min_ms(p_game text)
returns integer
language sql immutable set search_path = ''
as $$
  select case p_game
    when 'memory' then 1500
    when 'beat'   then 1000
    when 'wait'   then 900
    when 'odd'    then 400
    when 'stop'   then 400
    when 'more'   then 400
    when 'pop'    then 400
    when 'sum'    then 400
    when 'ink'    then 400
    when 'swipe'  then 400
    when 'find'   then 400
    when 'pattern' then 400
    -- Dritte Welle
    when 'count'  then 900
    when 'mole'   then 1200
    when 'spell'  then 400
    when 'clock'  then 1500
    when 'big'    then 400
    when 'shape'  then 400
    when 'order'  then 600
    when 'newone' then 1500
    when 'cups'   then 1500
    when 'pair'   then 400
    -- Vierte Welle
    when 'blocks' then 400
    when 'dodge'  then 1500
    when 'stack'  then 900
    when 'slice'  then 1500
    when 'ampel'  then 2000
    else null
  end
$$;

-- Rangliste eines Spiels: höhere Stufe zuerst, bei Gleichstand kürzere Zeit, dann wer es früher geschafft hat.
create or replace function public.zwip_minigame_ranked(p_game text)
returns table (user_id uuid, username text, league text, best_stage integer, best_ms integer, world_rank bigint)
language sql stable security definer set search_path = ''
as $$
  select b.user_id, p.username, p.league, b.best_stage, b.best_ms,
         row_number() over (order by b.best_stage desc, b.best_ms asc, b.achieved_at asc, b.user_id asc)
  from public.minigame_bests b
  join public.profiles p on p.id = b.user_id
  where b.game_id = p_game and b.best_stage > 0 and p.username is not null
$$;

create or replace function public.zwip_minigame_entry(p_game text, p_user uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('rank', r.world_rank, 'username', r.username, 'league', r.league,
                            'stage', r.best_stage, 'ms', r.best_ms)
  from public.zwip_minigame_ranked(p_game) r where r.user_id = p_user
$$;

-- =====================================================================
-- 3. Funktionen für die App
-- =====================================================================

-- Lauf starten: Server vergibt Lauf-ID und Seed
create or replace function public.start_minigame_run(p_game text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); rid uuid; s integer;
begin
  if public.zwip_minigame_min_ms(p_game) is null then
    raise exception 'unknown_game' using errcode = 'P0001';
  end if;
  update public.minigame_runs set status = 'abandoned', finished_at = now()
    where user_id = me and status = 'active';
  s := floor(random() * 2147483646)::integer + 1;
  insert into public.minigame_runs (user_id, game_id, seed) values (me, p_game, s) returning id into rid;
  return jsonb_build_object('run_id', rid, 'seed', s);
end;
$$;

-- Lauf beenden. p_stage = geschaffte Stufen, p_total_ms = Summe der Antwortzeiten der geschafften Stufen,
-- p_steps = je versuchter Stufe {ok, ms} (Länge = Stufe, +1 wenn am Ende eine Stufe verloren ging).
create or replace function public.finish_minigame_run(p_run uuid, p_stage integer, p_total_ms integer, p_steps jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := public.zwip_me();
  run public.minigame_runs;
  b public.minigame_bests;
  min_ms integer;
  n integer;
  elapsed_ms bigint;
  record boolean := false;
  my_rank bigint;
begin
  select * into run from public.minigame_runs where id = p_run and user_id = me for update;
  if run.id is null or run.status <> 'active' then
    raise exception 'run_not_active' using errcode = 'P0001';
  end if;
  elapsed_ms := floor(extract(epoch from (now() - run.started_at)) * 1000);
  if elapsed_ms > 60 * 60 * 1000 then
    update public.minigame_runs set status = 'abandoned', finished_at = now() where id = run.id;
    raise exception 'run_expired' using errcode = 'P0001';
  end if;
  if p_stage is null or p_stage < 0 or p_stage > 200 then
    raise exception 'invalid_stage' using errcode = 'P0001';
  end if;
  min_ms := public.zwip_minigame_min_ms(run.game_id);
  if elapsed_ms < p_stage::bigint * min_ms then
    raise exception 'run_too_fast' using errcode = 'P0001';
  end if;
  if p_total_ms is null or p_total_ms < 0 or p_total_ms > elapsed_ms then
    raise exception 'invalid_time' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_steps) <> 'array' then
    raise exception 'invalid_steps' using errcode = 'P0001';
  end if;
  n := jsonb_array_length(p_steps);
  if n not in (p_stage, p_stage + 1) then
    raise exception 'invalid_steps' using errcode = 'P0001';
  end if;
  -- Die ersten p_stage Einträge müssen geschafft sein, ein möglicher letzter nicht
  if exists (select 1 from jsonb_array_elements(p_steps) with ordinality e(v, i)
             where (i <= p_stage and coalesce((v ->> 'ok')::boolean, false) is not true)
                or (i > p_stage and coalesce((v ->> 'ok')::boolean, false))) then
    raise exception 'invalid_steps' using errcode = 'P0001';
  end if;

  update public.minigame_runs set status = 'finished', finished_at = now(), stage = p_stage,
      total_ms = p_total_ms, steps = p_steps
    where id = run.id;

  insert into public.minigame_bests (user_id, game_id) values (me, run.game_id)
    on conflict (user_id, game_id) do nothing;
  select * into b from public.minigame_bests where user_id = me and game_id = run.game_id for update;

  record := p_stage > 0 and (p_stage > b.best_stage or (p_stage = b.best_stage and p_total_ms < b.best_ms));
  update public.minigame_bests set
      plays = plays + 1,
      best_stage = case when record then p_stage else best_stage end,
      best_ms = case when record then p_total_ms else best_ms end,
      achieved_at = case when record then now() else achieved_at end
    where user_id = me and game_id = run.game_id
    returning * into b;

  select r.world_rank into my_rank from public.zwip_minigame_ranked(run.game_id) r where r.user_id = me;
  return jsonb_build_object(
    'stage', p_stage, 'total_ms', p_total_ms,
    'best_stage', b.best_stage, 'best_ms', b.best_ms, 'plays', b.plays,
    'is_record', record, 'rank', my_rank,
    'total_players', (select count(*) from public.zwip_minigame_ranked(run.game_id)));
end;
$$;

-- Rangliste eines Spiels: Top-Liste + eigener Eintrag + direkte Nachbarn
create or replace function public.get_minigame_board(p_game text, p_limit integer default 50)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); my_rank bigint; lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if public.zwip_minigame_min_ms(p_game) is null then
    raise exception 'unknown_game' using errcode = 'P0001';
  end if;
  select world_rank into my_rank from public.zwip_minigame_ranked(p_game) where user_id = me;
  return jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', r.world_rank, 'username', r.username, 'league', r.league,
               'stage', r.best_stage, 'ms', r.best_ms, 'is_me', r.user_id = me)
             order by r.world_rank)
      from public.zwip_minigame_ranked(p_game) r where r.world_rank <= lim), '[]'::jsonb),
    'me', case when my_rank is null then null else public.zwip_minigame_entry(p_game, me) end,
    'above', (select public.zwip_minigame_entry(p_game, r.user_id) from public.zwip_minigame_ranked(p_game) r where r.world_rank = my_rank - 1),
    'below', (select public.zwip_minigame_entry(p_game, r.user_id) from public.zwip_minigame_ranked(p_game) r where r.world_rank = my_rank + 1),
    'total', (select count(*) from public.zwip_minigame_ranked(p_game)));
end;
$$;

-- Eigene Bestwerte in allen Spielen (für die Übersicht)
create or replace function public.get_my_minigame_bests()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'game', b.game_id, 'best_stage', b.best_stage, 'best_ms', b.best_ms, 'plays', b.plays,
             'rank', (select r.world_rank from public.zwip_minigame_ranked(b.game_id) r where r.user_id = me))
           order by b.game_id)
    from public.minigame_bests b where b.user_id = me), '[]'::jsonb);
end;
$$;

-- =====================================================================
-- 4. Rechte: Hilfsfunktionen gesperrt, App-Funktionen nur für Angemeldete
-- =====================================================================

revoke all on function public.zwip_minigame_min_ms(text) from public, anon, authenticated;
revoke all on function public.zwip_minigame_ranked(text) from public, anon, authenticated;
revoke all on function public.zwip_minigame_entry(text, uuid) from public, anon, authenticated;

revoke all on function public.start_minigame_run(text) from public, anon;
revoke all on function public.finish_minigame_run(uuid, integer, integer, jsonb) from public, anon;
revoke all on function public.get_minigame_board(text, integer) from public, anon;
revoke all on function public.get_my_minigame_bests() from public, anon;

grant execute on function public.start_minigame_run(text) to authenticated;
grant execute on function public.finish_minigame_run(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.get_minigame_board(text, integer) to authenticated;
grant execute on function public.get_my_minigame_bests() to authenticated;
