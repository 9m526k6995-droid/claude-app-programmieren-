-- ZWIP: Trophäen, Trophäen-Weltrangliste und Freunde
-- Voraussetzung: profiles.sql wurde bereits ausgeführt.
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen. Mehrfaches Ausführen ist unschädlich.
--
-- Sicherheitsprinzip:
--   * Die App darf Trophäen, Freundschaften und Runden NIE direkt schreiben.
--   * Alles läuft über die Funktionen (RPCs) unten. Die rechnen die Trophäen auf dem Server aus,
--     prüfen Plausibilität und halten die Grenzen 0–20.000 ein.
--   * Öffentlich sichtbar sind nur Spielername, Trophäen, Liga, Weltrang, beste Serie und Rundenzahl.
--     Die E-Mail-Adresse liegt in auth.users und wird nirgends herausgegeben.

-- =====================================================================
-- 1. Profile erweitern
-- =====================================================================

alter table public.profiles
  add column if not exists username            text,
  add column if not exists trophies            integer     not null default 0,
  add column if not exists best_trophies       integer     not null default 0,
  add column if not exists trophy_rounds       integer     not null default 0,
  add column if not exists best_streak         integer     not null default 0,
  add column if not exists trophies_updated_at timestamptz not null default now();

alter table public.profiles
  add column if not exists league text generated always as (
    case
      when trophies >= 20000 then 'legende'
      when trophies >= 16000 then 'meister'
      when trophies >= 12000 then 'diamant'
      when trophies >= 8000  then 'platin'
      when trophies >= 5000  then 'gold'
      when trophies >= 2500  then 'silber'
      when trophies >= 1000  then 'bronze'
      else 'anfaenger'
    end
  ) stored;

do $$ begin
  alter table public.profiles add constraint profiles_username_format
    check (username ~ '^[A-Za-z0-9_]{3,16}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_trophies_range
    check (trophies between 0 and 20000 and best_trophies between 0 and 20000);
exception when duplicate_object then null; end $$;

-- Spielernamen eindeutig, Groß-/Kleinschreibung egal
create unique index if not exists profiles_username_unique on public.profiles (lower(username));

-- Index passend zur Ranglisten-Sortierung
create index if not exists profiles_trophy_ranking_idx
  on public.profiles (trophies desc, best_trophies desc, trophies_updated_at asc, id)
  where username is not null;

-- Profile dürfen nur noch über die Funktionen geändert werden
revoke update on public.profiles from anon, authenticated;

-- =====================================================================
-- 2. Trophäen-Runden (Grundlage für späteres Anti-Cheat)
-- =====================================================================

create table if not exists public.trophy_rounds (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  seed           integer not null,
  start_trophies integer not null,
  status         text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  tasks          jsonb,      -- Einzelergebnisse inkl. Reaktionszeiten, für spätere Prüfungen
  delta          integer,
  end_trophies   integer
);

create index if not exists trophy_rounds_user_idx on public.trophy_rounds (user_id, status, started_at desc);

alter table public.trophy_rounds enable row level security;
drop policy if exists "own rounds: read" on public.trophy_rounds;
create policy "own rounds: read" on public.trophy_rounds for select using (user_id = auth.uid());
revoke all on public.trophy_rounds from anon, authenticated;
grant select on public.trophy_rounds to authenticated;

-- =====================================================================
-- 3. Freundschaften
-- =====================================================================

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  receiver_id  uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  responded_at timestamptz,
  constraint friendships_not_self check (sender_id <> receiver_id)
);

-- Pro Spielerpaar höchstens EINE Zeile – egal in welche Richtung. Verhindert doppelte Anfragen.
create unique index if not exists friendships_pair_unique
  on public.friendships (least(sender_id, receiver_id), greatest(sender_id, receiver_id));

alter table public.friendships enable row level security;
drop policy if exists "friendships: only participants" on public.friendships;
create policy "friendships: only participants" on public.friendships
  for select using (auth.uid() = sender_id or auth.uid() = receiver_id);
revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

-- =====================================================================
-- 4. Hilfsfunktionen (nicht von der App aufrufbar)
-- =====================================================================

-- Rangliste: AUSSCHLIESSLICH nach Trophäen absteigend.
-- Gleichstand: höchste je erreichte Trophäenzahl, dann wer den Stand früher erreicht hat.
create or replace function public.zwip_ranked()
returns table (id uuid, username text, trophies integer, best_trophies integer, league text,
               best_streak integer, trophy_rounds integer, world_rank bigint)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, p.trophies, p.best_trophies, p.league, p.best_streak, p.trophy_rounds,
         row_number() over (order by p.trophies desc, p.best_trophies desc, p.trophies_updated_at asc, p.id asc)
  from public.profiles p
  where p.username is not null
$$;

create or replace function public.zwip_me()
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Falls jemand sich vor dem Anlegen der Profil-Tabelle registriert hat
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;
  return uid;
end;
$$;

create or replace function public.zwip_player_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'username', r.username, 'trophies', r.trophies, 'league', r.league,
    'world_rank', r.world_rank, 'best_streak', r.best_streak, 'trophy_rounds', r.trophy_rounds)
  from public.zwip_ranked() r where r.id = p_id
$$;

-- =====================================================================
-- 5. Funktionen für die App
-- =====================================================================

-- Eigenes Trophäen-Profil
create or replace function public.get_my_trophy_profile()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); res jsonb;
begin
  select jsonb_build_object(
      'username', p.username, 'trophies', p.trophies, 'best_trophies', p.best_trophies,
      'league', p.league, 'trophy_rounds', p.trophy_rounds, 'best_streak', p.best_streak,
      'world_rank', r.world_rank)
    into res
  from public.profiles p
  left join public.zwip_ranked() r on r.id = p.id
  where p.id = me;
  return res;
end;
$$;

-- Öffentlichen Spielernamen festlegen oder ändern
create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); name text := btrim(coalesce(p_username, ''));
begin
  if name !~ '^[A-Za-z0-9_]{3,16}$' then
    raise exception 'username_invalid' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(name) and id <> me) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;
  begin
    update public.profiles set username = name, updated_at = now() where id = me;
  exception when unique_violation then
    raise exception 'username_taken' using errcode = 'P0001';
  end;
  return public.get_my_trophy_profile();
end;
$$;

-- Trophäen-Runde starten: Der Server vergibt Runden-ID und Zufalls-Seed
create or replace function public.start_trophy_round()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); p public.profiles; rid uuid; s integer;
begin
  select * into p from public.profiles where id = me;
  if p.username is null then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  -- Nicht beendete Runden gelten als abgebrochen
  update public.trophy_rounds set status = 'abandoned', finished_at = now()
    where user_id = me and status = 'active';
  s := floor(random() * 2147483646)::integer + 1;
  insert into public.trophy_rounds (user_id, seed, start_trophies)
    values (me, s, p.trophies) returning id into rid;
  return jsonb_build_object('round_id', rid, 'seed', s, 'trophies', p.trophies, 'league', p.league);
end;
$$;

-- Liga-Einsatz: wird am Ende jeder Runde abgezogen, maßgeblich ist der Stand bei Rundenbeginn.
-- Je höher die Liga, desto mehr muss man liefern, um nicht zu verlieren.
create or replace function public.zwip_league_fee(p_trophies integer)
returns integer
language sql immutable set search_path = ''
as $$
  select case
    when p_trophies >= 20000 then 115  -- Legende
    when p_trophies >= 16000 then 90   -- Meister
    when p_trophies >= 12000 then 60   -- Diamant
    when p_trophies >= 8000  then 45   -- Platin
    when p_trophies >= 5000  then 30   -- Gold
    when p_trophies >= 2500  then 20   -- Silber
    when p_trophies >= 1000  then 10   -- Bronze
    else 0                             -- Anfänger
  end
$$;

-- Trophäen-Runde beenden. Der SERVER rechnet die Trophäen aus.
-- Richtig +6, schnell +1, sehr schnell +2, falsch/Zeit um −10, Serienbonus +5/+10/+15, minus Liga-Einsatz.
-- p_tasks: 15 Einträge {game, ok, timeout, tier (0 normal | 1 schnell | 2 sehr schnell), ms}
create or replace function public.finish_trophy_round(p_round_id uuid, p_tasks jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := public.zwip_me();
  rnd public.trophy_rounds;
  p public.profiles;
  t jsonb;
  ok boolean; tier integer;
  base integer := 0; speed integer := 0; streak_bonus integer := 0; penalty integer := 0; fee integer := 0;
  streak integer := 0; best integer := 0; correct integer := 0; wrong integer := 0;
  raw_delta integer; new_trophies integer; applied integer;
begin
  select * into rnd from public.trophy_rounds where id = p_round_id and user_id = me for update;
  if rnd.id is null or rnd.status <> 'active' then
    raise exception 'round_not_active' using errcode = 'P0001';
  end if;
  if now() - rnd.started_at > interval '30 minutes' then
    update public.trophy_rounds set status = 'abandoned', finished_at = now() where id = rnd.id;
    raise exception 'round_expired' using errcode = 'P0001';
  end if;
  -- 15 Aufgaben mit Einblendung + Vorbereitung dauern realistisch deutlich länger als 20 Sekunden
  if now() - rnd.started_at < interval '20 seconds' then
    raise exception 'round_too_fast' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) <> 15 then
    raise exception 'invalid_tasks' using errcode = 'P0001';
  end if;

  for t in select value from jsonb_array_elements(p_tasks) loop
    ok := coalesce((t ->> 'ok')::boolean, false) and not coalesce((t ->> 'timeout')::boolean, false);
    tier := least(greatest(coalesce((t ->> 'tier')::integer, 0), 0), 2);
    if ok then
      correct := correct + 1;
      base := base + 6;
      speed := speed + case tier when 2 then 2 when 1 then 1 else 0 end;
      streak := streak + 1;
      if streak in (5, 10, 15) then streak_bonus := streak_bonus + streak; end if;
      best := greatest(best, streak);
    else
      wrong := wrong + 1;
      penalty := penalty + 10;
      streak := 0;
    end if;
  end loop;

  fee := public.zwip_league_fee(rnd.start_trophies);
  raw_delta := base + speed + streak_bonus - penalty - fee;

  select * into p from public.profiles where id = me for update;
  new_trophies := least(greatest(p.trophies + raw_delta, 0), 20000);
  applied := new_trophies - p.trophies;

  update public.profiles set
      trophies = new_trophies,
      best_trophies = greatest(best_trophies, new_trophies),
      trophy_rounds = trophy_rounds + 1,
      best_streak = greatest(best_streak, best),
      trophies_updated_at = case when applied <> 0 then now() else trophies_updated_at end,
      updated_at = now()
    where id = me;

  update public.trophy_rounds set status = 'finished', finished_at = now(), tasks = p_tasks,
      delta = applied, end_trophies = new_trophies
    where id = rnd.id;

  return jsonb_build_object(
    'old_trophies', p.trophies, 'new_trophies', new_trophies, 'delta', applied, 'raw_delta', raw_delta,
    'base', base, 'speed_bonus', speed, 'streak_bonus', streak_bonus, 'penalty', penalty, 'league_fee', fee,
    'correct', correct, 'wrong', wrong, 'best_streak', best,
    'old_league', p.league, 'new_league', (select league from public.profiles where id = me),
    'world_rank', (select world_rank from public.zwip_ranked() where id = me));
end;
$$;

-- Trophäen-Weltrangliste: Top-Spieler (trophies DESC) + eigener Rang + direkte Nachbarn
create or replace function public.get_trophy_board(p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); my_rank bigint; lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  select world_rank into my_rank from public.zwip_ranked() where id = me;
  return jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', r.world_rank, 'username', r.username, 'trophies', r.trophies, 'league', r.league,
               'best_streak', r.best_streak, 'trophy_rounds', r.trophy_rounds, 'is_me', r.id = me)
             order by r.world_rank)
      from public.zwip_ranked() r where r.world_rank <= lim), '[]'::jsonb),
    'me', case when my_rank is null then null else public.zwip_player_json(me) end,
    'above', (select public.zwip_player_json(r.id) from public.zwip_ranked() r where r.world_rank = my_rank - 1),
    'below', (select public.zwip_player_json(r.id) from public.zwip_ranked() r where r.world_rank = my_rank + 1),
    'total', (select count(*) from public.profiles where username is not null));
end;
$$;

-- Spieler über den Namen suchen (Anfang des Namens, max. 10 Treffer)
create or replace function public.search_players(p_query text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); q text := lower(btrim(coalesce(p_query, '')));
begin
  if length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'username', r.username, 'trophies', r.trophies, 'league', r.league,
             'relation', case
               when f.status = 'accepted' then 'friend'
               when f.status = 'pending' and f.sender_id = me then 'outgoing'
               when f.status = 'pending' then 'incoming'
               else 'none' end)
           order by r.trophies desc, r.username)
    from (select * from public.zwip_ranked() x
          where x.id <> me and starts_with(lower(x.username), q)
          order by x.trophies desc limit 10) r
    left join public.friendships f
      on least(f.sender_id, f.receiver_id) = least(r.id, me)
     and greatest(f.sender_id, f.receiver_id) = greatest(r.id, me)), '[]'::jsonb);
end;
$$;

-- Freundschaftsanfrage senden
create or replace function public.send_friend_request(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); target uuid; f public.friendships;
begin
  if (select username from public.profiles where id = me) is null then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  select id into target from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if target is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  if target = me then raise exception 'cannot_add_self' using errcode = 'P0001'; end if;

  select * into f from public.friendships
    where least(sender_id, receiver_id) = least(me, target)
      and greatest(sender_id, receiver_id) = greatest(me, target)
    for update;

  if f.id is null then
    insert into public.friendships (sender_id, receiver_id) values (me, target);
    return jsonb_build_object('status', 'pending');
  elsif f.status = 'accepted' then
    raise exception 'already_friends' using errcode = 'P0001';
  elsif f.status = 'pending' and f.sender_id = me then
    raise exception 'request_already_sent' using errcode = 'P0001';
  elsif f.status = 'pending' then
    -- Die andere Person hat mich schon angefragt → direkt Freunde
    update public.friendships set status = 'accepted', accepted_at = now(), responded_at = now() where id = f.id;
    return jsonb_build_object('status', 'accepted');
  else
    -- Früher abgelehnt: neue Anfrage von mir
    update public.friendships set sender_id = me, receiver_id = target, status = 'pending',
        created_at = now(), accepted_at = null, responded_at = null
      where id = f.id;
    return jsonb_build_object('status', 'pending');
  end if;
end;
$$;

-- Eingehende Anfrage annehmen oder ablehnen
create or replace function public.respond_friend_request(p_username text, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); other uuid; fid uuid;
begin
  select id into other from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  select id into fid from public.friendships
    where sender_id = other and receiver_id = me and status = 'pending' for update;
  if fid is null then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  update public.friendships set
      status = case when p_accept then 'accepted' else 'declined' end,
      accepted_at = case when p_accept then now() else null end,
      responded_at = now()
    where id = fid;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end);
end;
$$;

-- Freund entfernen bzw. eigene offene Anfrage zurückziehen
create or replace function public.remove_friend(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); other uuid; n integer;
begin
  select id into other from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  delete from public.friendships
    where least(sender_id, receiver_id) = least(me, other)
      and greatest(sender_id, receiver_id) = greatest(me, other)
      and (status = 'accepted' or (status = 'pending' and sender_id = me));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_friends' using errcode = 'P0001'; end if;
  return jsonb_build_object('removed', true);
end;
$$;

-- Freunde (nach Trophäen absteigend) + offene Anfragen
create or replace function public.get_friends()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  return jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(public.zwip_player_json(other_id) order by r.trophies desc, r.world_rank)
      from (select case when sender_id = me then receiver_id else sender_id end as other_id
            from public.friendships where status = 'accepted' and (sender_id = me or receiver_id = me)) fr
      join public.zwip_ranked() r on r.id = fr.other_id), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('username', r.username, 'trophies', r.trophies, 'league', r.league)
             order by f.created_at desc)
      from public.friendships f join public.zwip_ranked() r on r.id = f.sender_id
      where f.receiver_id = me and f.status = 'pending'), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('username', r.username, 'trophies', r.trophies, 'league', r.league)
             order by f.created_at desc)
      from public.friendships f join public.zwip_ranked() r on r.id = f.receiver_id
      where f.sender_id = me and f.status = 'pending'), '[]'::jsonb));
end;
$$;

-- =====================================================================
-- 6. Rechte: Hilfsfunktionen gesperrt, App-Funktionen nur für Angemeldete
-- =====================================================================

revoke all on function public.zwip_ranked() from public, anon, authenticated;
revoke all on function public.zwip_me() from public, anon, authenticated;
revoke all on function public.zwip_player_json(uuid) from public, anon, authenticated;
revoke all on function public.zwip_league_fee(integer) from public, anon, authenticated;

revoke all on function public.get_my_trophy_profile() from public, anon;
revoke all on function public.set_username(text) from public, anon;
revoke all on function public.start_trophy_round() from public, anon;
revoke all on function public.finish_trophy_round(uuid, jsonb) from public, anon;
revoke all on function public.get_trophy_board(integer) from public, anon;
revoke all on function public.search_players(text) from public, anon;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_friend_request(text, boolean) from public, anon;
revoke all on function public.remove_friend(text) from public, anon;
revoke all on function public.get_friends() from public, anon;

grant execute on function public.get_my_trophy_profile() to authenticated;
grant execute on function public.set_username(text) to authenticated;
grant execute on function public.start_trophy_round() to authenticated;
grant execute on function public.finish_trophy_round(uuid, jsonb) to authenticated;
grant execute on function public.get_trophy_board(integer) to authenticated;
grant execute on function public.search_players(text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(text, boolean) to authenticated;
grant execute on function public.remove_friend(text) to authenticated;
grant execute on function public.get_friends() to authenticated;
