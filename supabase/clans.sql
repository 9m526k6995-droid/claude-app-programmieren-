-- ZWIP: Highscores für Minigames + Clans (Gründen, Einladen, Anfragen, XP, Level, Ranglisten, Wochen-Challenges, Chat)
-- Voraussetzung: profiles.sql, trophies.sql, profile.sql, minigames.sql und social.sql wurden bereits ausgeführt.
-- Mehrfaches Ausführen ist unschädlich.
--
-- Sicherheitsprinzip wie überall in ZWIP: Die App schreibt nie direkt in Tabellen, nur über die Funktionen unten.
-- Nach außen gehen nur Spielernamen, Punkte, Ligen und Clan-Daten – nie E-Mail-Adressen oder interne IDs von Spielern.

-- #####################################################################
-- TEIL A: HIGHSCORES FÜR MINIGAMES
-- #####################################################################
-- Punkte pro geschaffter Stufe n: 100 + 25·(n−1). Tempo-Bonus: sehr schnell +50 %, schnell +25 %.
-- Die Grenzen für „schnell“ sind pro Spiel dieselben wie in der App (src/games*.ts → speed). Ein Unit-Test prüft das.

alter table public.minigame_bests add column if not exists best_score integer not null default 0;
alter table public.minigame_runs add column if not exists score integer;

do $$ begin
  alter table public.minigame_bests add constraint minigame_bests_score_range check (best_score between 0 and 10000000);
exception when duplicate_object then null; end $$;

create index if not exists minigame_bests_score_idx
  on public.minigame_bests (game_id, best_score desc, best_stage desc, best_ms asc, achieved_at asc, user_id);

-- Tempo-Grenzen (ms) pro Spiel: {sehr schnell, schnell}
create or replace function public.zwip_minigame_speed(p_game text)
returns integer[]
language sql immutable set search_path = ''
as $$
  select case p_game
    when 'odd' then array[900, 1700]
    when 'stop' then array[250, 550]
    when 'wait' then array[300, 420]
    when 'more' then array[800, 1500]
    when 'pop' then array[1400, 2300]
    when 'sum' then array[1200, 2100]
    when 'ink' then array[900, 1600]
    when 'swipe' then array[650, 1200]
    when 'find' then array[1300, 2400]
    when 'memory' then array[350, 600]
    when 'beat' then array[45, 100]
    when 'pattern' then array[1200, 2100]
    when 'count' then array[700, 1300]
    when 'mole' then array[380, 560]
    when 'spell' then array[900, 1600]
    when 'clock' then array[40, 90]
    when 'big' then array[900, 1600]
    when 'shape' then array[1300, 2300]
    when 'order' then array[1800, 3000]
    when 'newone' then array[900, 1600]
    when 'cups' then array[700, 1300]
    when 'pair' then array[1300, 2400]
    when 'blocks' then array[900, 1600]
    when 'dodge' then array[450, 750]
    when 'stack' then array[40, 90]
    when 'slice' then array[650, 950]
    when 'ampel' then array[250, 380]
    else array[0, 0]
  end
$$;

-- Punkte einer Stufe
create or replace function public.zwip_stage_points(p_stage integer, p_t integer, p_speed integer[])
returns integer
language sql immutable set search_path = ''
as $$
  select round((100 + 25 * (p_stage - 1)) *
               case when p_t <= p_speed[1] then 1.5 when p_t <= p_speed[2] then 1.25 else 1.0 end)::integer
$$;

-- Punkte eines ganzen Laufs aus den Einzelschritten [{ok, ms, t}] (t = Tempo-Wert des Spiels, sonst ms)
create or replace function public.zwip_run_score(p_game text, p_steps jsonb)
returns integer
language sql immutable set search_path = ''
as $$
  select coalesce(sum(public.zwip_stage_points(i::integer,
                      greatest(0, coalesce((v ->> 't')::numeric, (v ->> 'ms')::numeric, 999999))::integer,
                      public.zwip_minigame_speed(p_game))), 0)::integer
  from jsonb_array_elements(p_steps) with ordinality e(v, i)
  where coalesce((v ->> 'ok')::boolean, false)
$$;

-- Alte Bestwerte (nur Stufen) einmalig in Punkte umrechnen – ohne Tempo-Bonus, so verliert niemand seinen Platz
update public.minigame_bests
  set best_score = (best_stage * 100 + 25 * best_stage * (best_stage - 1) / 2)
  where best_score = 0 and best_stage > 0;

-- Rangliste eines Spiels nach Punkten (bei Gleichstand: höhere Stufe, kürzere Zeit, wer früher dran war)
create or replace function public.zwip_mg_ranked(p_game text)
returns table (user_id uuid, username text, league text, best_score integer, best_stage integer, best_ms integer, world_rank bigint)
language sql stable security definer set search_path = ''
as $$
  select b.user_id, p.username, p.league, b.best_score, b.best_stage, b.best_ms,
         row_number() over (order by b.best_score desc, b.best_stage desc, b.best_ms asc, b.achieved_at asc, b.user_id asc)
  from public.minigame_bests b
  join public.profiles p on p.id = b.user_id
  where b.game_id = p_game and b.best_score > 0 and p.username is not null
$$;

-- Bisherige Funktion zeigt jetzt auch nach Punkten (gleiche Ausgabe-Spalten wie vorher)
create or replace function public.zwip_minigame_ranked(p_game text)
returns table (user_id uuid, username text, league text, best_stage integer, best_ms integer, world_rank bigint)
language sql stable security definer set search_path = ''
as $$
  select r.user_id, r.username, r.league, r.best_stage, r.best_ms, r.world_rank from public.zwip_mg_ranked(p_game) r
$$;

create or replace function public.zwip_minigame_entry(p_game text, p_user uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('rank', r.world_rank, 'username', r.username, 'league', r.league,
                            'score', r.best_score, 'stage', r.best_stage, 'ms', r.best_ms)
  from public.zwip_mg_ranked(p_game) r where r.user_id = p_user
$$;

-- #####################################################################
-- TEIL B: CLANS
-- #####################################################################

create table if not exists public.clans (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  emblem       text not null default '🛡️',
  color        text not null default '#a45cff',
  frame        text not null default 'none',
  description  text not null default '',
  join_mode    text not null default 'request' check (join_mode in ('open', 'request', 'invite')),
  xp           bigint not null default 0,
  member_count integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint clans_name_len check (char_length(name) between 3 and 20),
  constraint clans_desc_len check (char_length(description) <= 160),
  constraint clans_color check (color ~ '^#[0-9a-f]{6}$')
);
create unique index if not exists clans_name_unique on public.clans (lower(name));
create index if not exists clans_xp_idx on public.clans (xp desc);

create table if not exists public.clan_members (
  user_id      uuid primary key references public.profiles (id) on delete cascade,  -- 1 Clan pro Spieler
  clan_id      uuid not null references public.clans (id) on delete cascade,
  role         text not null default 'member' check (role in ('leader', 'member')),
  joined_at    timestamptz not null default now(),
  xp_total     bigint not null default 0,
  muted_until  timestamptz,
  last_read_id bigint not null default 0
);
create index if not exists clan_members_clan_idx on public.clan_members (clan_id, role);

create table if not exists public.clan_requests (
  id          uuid primary key default gen_random_uuid(),
  clan_id     uuid not null references public.clans (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('invite', 'request')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (clan_id, user_id, kind)
);
create index if not exists clan_requests_user_idx on public.clan_requests (user_id, kind);

create table if not exists public.clan_xp_log (
  id         bigserial primary key,
  clan_id    uuid not null references public.clans (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  xp         integer not null,
  rounds     integer not null default 0,
  source     text not null default 'minigame',
  created_at timestamptz not null default now()
);
create index if not exists clan_xp_log_clan_time_idx on public.clan_xp_log (clan_id, created_at);
create index if not exists clan_xp_log_time_idx on public.clan_xp_log (created_at);

create table if not exists public.clan_challenge_done (
  clan_id   uuid not null references public.clans (id) on delete cascade,
  week      date not null,
  key       text not null,
  done_at   timestamptz not null default now(),
  primary key (clan_id, week, key)
);

create table if not exists public.clan_messages (
  id         bigserial primary key,
  clan_id    uuid not null references public.clans (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  body       text not null,
  kind       text not null default 'text' check (kind in ('text', 'quick', 'system')),
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  constraint clan_messages_len check (char_length(body) between 1 and 200)
);
create index if not exists clan_messages_clan_idx on public.clan_messages (clan_id, id desc);

create table if not exists public.clan_reports (
  message_id  bigint not null references public.clan_messages (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  primary key (message_id, reporter_id)
);

-- Nichts wird hart gelöscht: Austritte, erledigte Anfragen und aufgelöste Clans werden nur markiert.
-- So bleibt die Historie (XP-Log, Chat) erhalten und es gibt keine versehentlich verlorenen Daten.
alter table public.clan_members add column if not exists active boolean not null default true;
alter table public.clan_requests add column if not exists closed_at timestamptz;
alter table public.clans add column if not exists dissolved_at timestamptz;

-- Sichten auf die aktiven Einträge (nur für die Funktionen unten)
create or replace view public.zwip_cm with (security_invoker = true) as
  select * from public.clan_members where active;
create or replace view public.zwip_cr with (security_invoker = true) as
  select * from public.clan_requests where closed_at is null;
create or replace view public.zwip_clans with (security_invoker = true) as
  select * from public.clans where dissolved_at is null;
revoke all on public.zwip_cm, public.zwip_cr, public.zwip_clans from public, anon, authenticated;

-- Alle Clan-Tabellen: kein Direktzugriff aus der App
do $$
declare t text;
begin
  foreach t in array array['clans', 'clan_members', 'clan_requests', 'clan_xp_log', 'clan_challenge_done', 'clan_messages', 'clan_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------

create or replace function public.zwip_clan_max() returns integer language sql immutable set search_path = '' as $$ select 500 $$;

-- Level aus XP: Level L braucht 1000·(L−1)² XP (L2 = 1.000, L3 = 4.000, L5 = 16.000, L10 = 81.000 …), höchstens 50
create or replace function public.zwip_clan_level(p_xp bigint)
returns integer
language sql immutable set search_path = ''
as $$ select least(50, floor(sqrt(greatest(p_xp, 0) / 1000.0))::integer + 1) $$;

-- Freischaltungen: ab welchem Level gibt es welches Emblem / welche Farbe / welchen Rahmen
create or replace function public.zwip_clan_unlock_level(p_kind text, p_value text)
returns integer
language sql immutable set search_path = ''
as $$
  select case p_kind
    when 'emblem' then case
      when p_value in ('🛡️', '⚔️', '🔥', '⚡', '🐺', '🦊') then 1
      when p_value in ('🐉', '🦅', '💀', '👑') then 3
      when p_value in ('🌪️', '🌋', '🦁', '🐍') then 5
      when p_value in ('💎', '🚀', '🪐') then 8
      when p_value in ('🏆', '🌟', '🔱') then 12
      else null end
    when 'color' then case
      when p_value in ('#a45cff', '#ff3d8b', '#3d7bff', '#22c36b') then 1
      when p_value in ('#ff8a3d', '#ffd23d', '#25d9e8') then 2
      when p_value in ('#ff3d5a', '#c6ff3d', '#ffffff') then 4
      when p_value in ('#111111', '#b8860b') then 7
      else null end
    when 'frame' then case
      when p_value = 'none' then 1
      when p_value = 'silver' then 5
      when p_value = 'gold' then 10
      when p_value = 'diamond' then 15
      when p_value = 'legend' then 20
      else null end
    else null end
$$;

-- Wochenbeginn (Montag) und Zeitraum-Start für Ranglisten
create or replace function public.zwip_period_start(p_period text)
returns timestamptz
language sql stable set search_path = ''
as $$
  select case p_period
    when 'day'    then date_trunc('day', now())
    when 'week'   then date_trunc('week', now())
    when 'month'  then date_trunc('month', now())
    when 'season' then date_trunc('quarter', now())
    else '-infinity'::timestamptz end
$$;

-- Schimpfwörter, Links, Telefonnummern und E-Mail-Adressen werden durch *** ersetzt
create or replace function public.zwip_clean_text(p text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  norm text;
  res text := p;
  w text;
  pos integer;
  startp integer;
  words text[] := array[
    'hurensohn', 'huren', 'hure', 'fotze', 'fick', 'wichser', 'wixer', 'wixxer', 'arschloch', 'arsch', 'schlampe',
    'missgeburt', 'spasti', 'spast', 'behindi', 'schwuchtel', 'kanake', 'neger', 'nigger', 'nigga', 'nazi', 'hitler',
    'scheiße', 'scheisse', 'scheiss', 'scheiß', 'bastard', 'pisser', 'drecksau', 'mongo', 'opfa', 'kys',
    'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'whore', 'slut', 'retard', 'faggot', 'motherf', 'stfu',
    'bring dich um', 'kill dich', 'kill yourself', 'stirb'];
begin
  if p is null then return null; end if;
  -- gleiche Länge wie das Original, damit die Stellen passen (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s)
  norm := translate(lower(p), '013457@$', 'oieastas');
  foreach w in array words loop
    startp := 1;
    loop
      pos := strpos(substr(norm, startp), w);
      exit when pos = 0;
      pos := startp + pos - 1;
      res := overlay(res placing repeat('*', char_length(w)) from pos for char_length(w));
      startp := pos + char_length(w);
    end loop;
  end loop;
  res := regexp_replace(res, '(https?://\S+|www\.\S+)', '***', 'gi');
  res := regexp_replace(res, '\m[\w-]+\.(de|com|net|org|io|gg|tk|me|ru|at|ch|xyz|app|link|ly)\M(/\S*)?', '***', 'gi');
  res := regexp_replace(res, '\S+@\S+\.\S+', '***', 'g');
  res := regexp_replace(res, '\+?\d[\d \-/]{6,}\d', '***', 'g');
  return res;
end;
$$;

-- Schnellnachrichten (Nummer 1–7)
create or replace function public.zwip_quick_message(p_n integer)
returns text
language sql immutable set search_path = ''
as $$
  select (array['GG! 🎉', 'Wer spielt mit? 🎮', 'Los, Clan-Challenge! 💪', 'Neuer Rekord! 🏆',
                'Gute Nacht 🌙', 'Danke! 🙌', 'Wir schaffen das! 🔥'])[p_n]
$$;

create or replace function public.zwip_my_clan_member()
returns public.clan_members
language sql stable security definer set search_path = ''
as $$ select * from public.zwip_cm where user_id = auth.uid() $$;

-- Wochen-Challenges: Ziele hängen nicht vom Zufall ab, damit alle Clans fair verglichen werden können
create or replace function public.zwip_clan_challenges(p_clan uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  wk timestamptz := date_trunc('week', now());
  pts bigint;
  rnds bigint;
  active bigint;
  res jsonb := '[]'::jsonb;
  c record;
  prog bigint;
  done boolean;
begin
  select coalesce(sum(xp) filter (where source = 'minigame'), 0), coalesce(sum(rounds), 0), count(distinct user_id)
    into pts, rnds, active
    from public.clan_xp_log where clan_id = p_clan and created_at >= wk and source = 'minigame';
  for c in
    select * from (values
      ('points_1', 'Sammelt zusammen 25.000 Punkte', 'points', 25000, 1500),
      ('points_2', 'Sammelt zusammen 100.000 Punkte', 'points', 100000, 5000),
      ('points_3', 'Sammelt zusammen 500.000 Punkte', 'points', 500000, 20000),
      ('rounds_1', 'Spielt zusammen 50 Runden', 'rounds', 50, 1000),
      ('rounds_2', 'Spielt zusammen 500 Runden', 'rounds', 500, 8000),
      ('active_1', '5 Mitglieder spielen diese Woche', 'active', 5, 2000)
    ) v(key, title, metric, goal, reward)
  loop
    prog := case c.metric when 'points' then pts when 'rounds' then rnds else active end;
    done := exists (select 1 from public.clan_challenge_done d where d.clan_id = p_clan and d.week = wk::date and d.key = c.key);
    -- Ziel erreicht → einmalig Bonus-XP für den Clan
    if not done and prog >= c.goal then
      insert into public.clan_challenge_done (clan_id, week, key) values (p_clan, wk::date, c.key) on conflict do nothing;
      if found then
        insert into public.clan_xp_log (clan_id, user_id, xp, rounds, source) values (p_clan, null, c.reward, 0, 'challenge');
        update public.clans set xp = xp + c.reward where id = p_clan;
      end if;
      done := true;
    end if;
    res := res || jsonb_build_object('key', c.key, 'title', c.title, 'metric', c.metric, 'goal', c.goal,
                                     'progress', least(prog, c.goal), 'reward', c.reward, 'done', done);
  end loop;
  return jsonb_build_object('week_start', wk, 'week_end', wk + interval '7 days', 'items', res);
end;
$$;

-- Wird nach jedem gewerteten Minigame-Lauf aufgerufen: Punkte → Clan-XP
create or replace function public.zwip_clan_on_run(p_user uuid, p_score integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare m public.clan_members; v_xp integer := greatest(0, coalesce(p_score, 0));
begin
  select * into m from public.zwip_cm where user_id = p_user;
  if m.user_id is null then return 0; end if;
  insert into public.clan_xp_log (clan_id, user_id, xp, rounds, source) values (m.clan_id, p_user, v_xp, 1, 'minigame');
  update public.clans set xp = xp + v_xp where id = m.clan_id;
  update public.clan_members set xp_total = xp_total + v_xp where user_id = p_user;
  return v_xp;
end;
$$;

create or replace function public.zwip_clan_json(p_clan uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'emblem', c.emblem, 'color', c.color, 'frame', c.frame,
    'description', c.description, 'join_mode', c.join_mode, 'xp', c.xp,
    'level', public.zwip_clan_level(c.xp),
    'level_xp', 1000 * power(public.zwip_clan_level(c.xp) - 1, 2)::bigint,
    'next_level_xp', case when public.zwip_clan_level(c.xp) >= 50 then null else 1000 * power(public.zwip_clan_level(c.xp), 2)::bigint end,
    'members', c.member_count, 'max_members', public.zwip_clan_max(),
    'leader', (select p.username from public.zwip_cm m join public.profiles p on p.id = m.user_id
               where m.clan_id = c.id and m.role = 'leader' limit 1),
    'rank', (select count(*) + 1 from public.zwip_clans o where o.xp > c.xp))
  from public.clans c where c.id = p_clan
$$;

create or replace function public.zwip_clan_system(p_clan uuid, p_text text)
returns void
language sql security definer set search_path = ''
as $$ insert into public.clan_messages (clan_id, user_id, body, kind) values (p_clan, null, left(p_text, 200), 'system') $$;

create or replace function public.zwip_add_member(p_clan uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare cnt integer; nm text;
begin
  select member_count into cnt from public.clans where id = p_clan and dissolved_at is null for update;
  if cnt is null then raise exception 'clan_not_found' using errcode = 'P0001'; end if;
  if cnt >= public.zwip_clan_max() then raise exception 'clan_full' using errcode = 'P0001'; end if;
  if exists (select 1 from public.zwip_cm where user_id = p_user) then
    raise exception 'already_in_clan' using errcode = 'P0001';
  end if;
  insert into public.clan_members (clan_id, user_id, role, last_read_id, active, joined_at, xp_total, muted_until)
    values (p_clan, p_user, p_role, coalesce((select max(id) from public.clan_messages where clan_id = p_clan), 0), true, now(), 0, null)
    on conflict (user_id) do update set clan_id = excluded.clan_id, role = excluded.role, last_read_id = excluded.last_read_id,
      active = true, joined_at = now(), xp_total = 0, muted_until = null;
  update public.clans set member_count = member_count + 1 where id = p_clan;
  -- Offene Einladungen/Anfragen dieses Spielers erledigen sich
  update public.clan_requests set closed_at = now() where user_id = p_user and closed_at is null;
  select username into nm from public.profiles where id = p_user;
  if p_role <> 'leader' then perform public.zwip_clan_system(p_clan, nm || ' ist dem Clan beigetreten 👋'); end if;
end;
$$;

create or replace function public.zwip_need_name(p_user uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare nm text;
begin
  select username into nm from public.profiles where id = p_user;
  if nm is null then raise exception 'username_required' using errcode = 'P0001'; end if;
  return nm;
end;
$$;

create or replace function public.zwip_need_leader()
returns public.clan_members
language plpgsql stable security definer set search_path = ''
as $$
declare m public.clan_members;
begin
  select * into m from public.zwip_cm where user_id = auth.uid();
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  if m.role <> 'leader' then raise exception 'not_leader' using errcode = 'P0001'; end if;
  return m;
end;
$$;

-- #####################################################################
-- TEIL C: FUNKTIONEN FÜR DIE APP
-- #####################################################################

-- ---------- Highscores ----------

-- Lauf beenden (gleiche Prüfungen wie bisher, jetzt mit Punkten und Clan-XP).
-- p_steps = je versuchter Stufe {ok, ms, t}; ms = Spielzeit (für die Plausibilität), t = Tempo-Wert für den Bonus.
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
  sc integer;
  prev_score integer;
  clan_xp integer;
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
  if exists (select 1 from jsonb_array_elements(p_steps) with ordinality e(v, i)
             where (i <= p_stage and coalesce((v ->> 'ok')::boolean, false) is not true)
                or (i > p_stage and coalesce((v ->> 'ok')::boolean, false))) then
    raise exception 'invalid_steps' using errcode = 'P0001';
  end if;

  sc := public.zwip_run_score(run.game_id, p_steps);
  update public.minigame_runs set status = 'finished', finished_at = now(), stage = p_stage,
      total_ms = p_total_ms, steps = p_steps, score = sc
    where id = run.id;

  insert into public.minigame_bests (user_id, game_id) values (me, run.game_id)
    on conflict (user_id, game_id) do nothing;
  select * into b from public.minigame_bests where user_id = me and game_id = run.game_id for update;
  prev_score := b.best_score;

  record := sc > 0 and (sc > b.best_score or (sc = b.best_score and p_stage = b.best_stage and p_total_ms < b.best_ms));
  update public.minigame_bests set
      plays = plays + 1,
      best_score = case when record then sc else best_score end,
      best_stage = case when record then p_stage else greatest(best_stage, p_stage) end,
      best_ms = case when record then p_total_ms else best_ms end,
      achieved_at = case when record then now() else achieved_at end
    where user_id = me and game_id = run.game_id
    returning * into b;

  clan_xp := public.zwip_clan_on_run(me, sc);

  select r.world_rank into my_rank from public.zwip_mg_ranked(run.game_id) r where r.user_id = me;
  return jsonb_build_object(
    'stage', p_stage, 'total_ms', p_total_ms, 'score', sc,
    'best_score', b.best_score, 'prev_best_score', prev_score,
    'best_stage', b.best_stage, 'best_ms', b.best_ms, 'plays', b.plays,
    'is_record', record, 'rank', my_rank, 'clan_xp', clan_xp,
    'total_players', (select count(*) from public.zwip_mg_ranked(run.game_id)));
end;
$$;

-- Rangliste eines Spiels: Welt, Freunde oder eigener Clan
create or replace function public.get_minigame_ranking(p_game text, p_scope text default 'world', p_limit integer default 50)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := public.zwip_me();
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  scope text := coalesce(p_scope, 'world');
  my_clan uuid;
  rows jsonb;
  my_pos bigint;
begin
  if public.zwip_minigame_min_ms(p_game) is null then
    raise exception 'unknown_game' using errcode = 'P0001';
  end if;
  if scope not in ('world', 'friends', 'clan') then raise exception 'invalid_scope' using errcode = 'P0001'; end if;
  select clan_id into my_clan from public.zwip_cm where user_id = me;

  with base as (
    select r.*,
           row_number() over (order by r.world_rank) as pos
    from public.zwip_mg_ranked(p_game) r
    where scope = 'world'
       or (scope = 'friends' and (r.user_id = me or exists (
             select 1 from public.friendships f where f.status = 'accepted'
               and ((f.sender_id = me and f.receiver_id = r.user_id) or (f.receiver_id = me and f.sender_id = r.user_id)))))
       or (scope = 'clan' and my_clan is not null and exists (
             select 1 from public.zwip_cm m where m.user_id = r.user_id and m.clan_id = my_clan))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', b.pos, 'world_rank', b.world_rank, 'username', b.username, 'league', b.league,
           'score', b.best_score, 'stage', b.best_stage, 'ms', b.best_ms, 'is_me', b.user_id = me)
           order by b.pos) filter (where b.pos <= lim or b.user_id = me), '[]'::jsonb),
         max(b.pos) filter (where b.user_id = me)
    into rows, my_pos
    from base b;

  return jsonb_build_object(
    'scope', scope, 'rows', rows, 'my_rank', my_pos, 'has_clan', my_clan is not null,
    'total', (select count(*) from public.zwip_mg_ranked(p_game)));
end;
$$;

-- Bisherige Rangliste (Welt) – jetzt nach Punkten, mit Punkten in der Ausgabe
create or replace function public.get_minigame_board(p_game text, p_limit integer default 50)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); my_rank bigint; lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if public.zwip_minigame_min_ms(p_game) is null then
    raise exception 'unknown_game' using errcode = 'P0001';
  end if;
  select world_rank into my_rank from public.zwip_mg_ranked(p_game) where user_id = me;
  return jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', r.world_rank, 'username', r.username, 'league', r.league,
               'score', r.best_score, 'stage', r.best_stage, 'ms', r.best_ms, 'is_me', r.user_id = me)
             order by r.world_rank)
      from public.zwip_mg_ranked(p_game) r where r.world_rank <= lim), '[]'::jsonb),
    'me', case when my_rank is null then null else public.zwip_minigame_entry(p_game, me) end,
    'above', (select public.zwip_minigame_entry(p_game, r.user_id) from public.zwip_mg_ranked(p_game) r where r.world_rank = my_rank - 1),
    'below', (select public.zwip_minigame_entry(p_game, r.user_id) from public.zwip_mg_ranked(p_game) r where r.world_rank = my_rank + 1),
    'total', (select count(*) from public.zwip_mg_ranked(p_game)));
end;
$$;

create or replace function public.get_my_minigame_bests()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'game', b.game_id, 'best_score', b.best_score, 'best_stage', b.best_stage, 'best_ms', b.best_ms, 'plays', b.plays,
             'rank', (select r.world_rank from public.zwip_mg_ranked(b.game_id) r where r.user_id = me))
           order by b.game_id)
    from public.minigame_bests b where b.user_id = me), '[]'::jsonb);
end;
$$;

-- ---------- Clans: Übersicht ----------

-- Eigener Clan (oder null) + Einladungen an mich
create or replace function public.get_my_clan()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := public.zwip_me();
  m public.clan_members;
  wk timestamptz := date_trunc('week', now());
begin
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then
    return jsonb_build_object(
      'clan', null,
      'invites', coalesce((
        select jsonb_agg(public.zwip_clan_json(r.clan_id) || jsonb_build_object('invited_by', p.username) order by r.created_at desc)
        from public.zwip_cr r join public.zwip_clans c on c.id = r.clan_id left join public.profiles p on p.id = r.created_by
        where r.user_id = me and r.kind = 'invite'), '[]'::jsonb),
      'my_requests', coalesce((
        select jsonb_agg(r.clan_id) from public.zwip_cr r where r.user_id = me and r.kind = 'request'), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'clan', public.zwip_clan_json(m.clan_id),
    'role', m.role,
    'muted_until', m.muted_until,
    'my_xp_total', m.xp_total,
    'my_xp_week', (select coalesce(sum(xp), 0) from public.clan_xp_log where user_id = me and clan_id = m.clan_id and created_at >= wk),
    'members', coalesce((
      select jsonb_agg(x order by (x ->> 'xp_week')::bigint desc, (x ->> 'xp_total')::bigint desc, x ->> 'username')
      from (
        select jsonb_build_object(
          'username', p.username, 'league', p.league, 'trophies', p.trophies, 'role', cm.role,
          'joined_at', cm.joined_at, 'xp_total', cm.xp_total, 'is_me', cm.user_id = me,
          'muted', cm.muted_until is not null and cm.muted_until > now(),
          'xp_week', (select coalesce(sum(l.xp), 0) from public.clan_xp_log l
                      where l.clan_id = m.clan_id and l.user_id = cm.user_id and l.created_at >= wk)) as x
        from public.zwip_cm cm join public.profiles p on p.id = cm.user_id
        where cm.clan_id = m.clan_id) s), '[]'::jsonb),
    'requests', case when m.role = 'leader' then coalesce((
        select jsonb_agg(jsonb_build_object('username', p.username, 'league', p.league, 'trophies', p.trophies) order by r.created_at)
        from public.zwip_cr r join public.profiles p on p.id = r.user_id
        where r.clan_id = m.clan_id and r.kind = 'request'), '[]'::jsonb) else '[]'::jsonb end,
    'invited', coalesce((
        select jsonb_agg(p.username order by r.created_at)
        from public.zwip_cr r join public.profiles p on p.id = r.user_id
        where r.clan_id = m.clan_id and r.kind = 'invite'), '[]'::jsonb),
    'challenges', public.zwip_clan_challenges(m.clan_id),
    'unread', (select count(*) from public.clan_messages x where x.clan_id = m.clan_id and x.id > m.last_read_id
               and not x.hidden and x.user_id is distinct from me));
end;
$$;

-- Clan gründen
create or replace function public.create_clan(p_name text, p_emblem text, p_color text, p_description text, p_join_mode text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); nm text := btrim(coalesce(p_name, '')); cid uuid;
begin
  perform public.zwip_need_name(me);
  if exists (select 1 from public.zwip_cm where user_id = me) then
    raise exception 'already_in_clan' using errcode = 'P0001';
  end if;
  if nm !~ '^[A-Za-z0-9ÄÖÜäöüß _\-]{3,20}$' or nm ~ '  ' then
    raise exception 'clan_name_invalid' using errcode = 'P0001';
  end if;
  if public.zwip_clean_text(nm) <> nm then raise exception 'clan_name_bad' using errcode = 'P0001'; end if;
  if exists (select 1 from public.zwip_clans where lower(name) = lower(nm)) then
    raise exception 'clan_name_taken' using errcode = 'P0001';
  end if;
  if coalesce(public.zwip_clan_unlock_level('emblem', p_emblem), 99) > 1 then raise exception 'locked' using errcode = 'P0001'; end if;
  if coalesce(public.zwip_clan_unlock_level('color', p_color), 99) > 1 then raise exception 'locked' using errcode = 'P0001'; end if;
  if coalesce(p_join_mode, '') not in ('open', 'request', 'invite') then raise exception 'invalid_mode' using errcode = 'P0001'; end if;
  insert into public.clans (name, emblem, color, description, join_mode)
    values (nm, p_emblem, p_color, left(public.zwip_clean_text(btrim(coalesce(p_description, ''))), 160), p_join_mode)
    returning id into cid;
  perform public.zwip_add_member(cid, me, 'leader');
  perform public.zwip_clan_system(cid, 'Clan gegründet! Lade deine Freunde ein 🚀');
  return public.get_my_clan();
exception when unique_violation then
  raise exception 'clan_name_taken' using errcode = 'P0001';
end;
$$;

-- Clan bearbeiten (nur Leiter) – Emblem, Farbe und Rahmen müssen schon freigeschaltet sein
create or replace function public.update_clan(p_emblem text, p_color text, p_frame text, p_description text, p_join_mode text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m public.clan_members := public.zwip_need_leader(); lvl integer;
begin
  select public.zwip_clan_level(xp) into lvl from public.clans where id = m.clan_id;
  if coalesce(public.zwip_clan_unlock_level('emblem', p_emblem), 99) > lvl
     or coalesce(public.zwip_clan_unlock_level('color', p_color), 99) > lvl
     or coalesce(public.zwip_clan_unlock_level('frame', p_frame), 99) > lvl then
    raise exception 'locked' using errcode = 'P0001';
  end if;
  if coalesce(p_join_mode, '') not in ('open', 'request', 'invite') then raise exception 'invalid_mode' using errcode = 'P0001'; end if;
  update public.clans set emblem = p_emblem, color = p_color, frame = p_frame, join_mode = p_join_mode,
      description = left(public.zwip_clean_text(btrim(coalesce(p_description, ''))), 160)
    where id = m.clan_id;
  return public.get_my_clan();
end;
$$;

-- Clans suchen (leer = die besten)
create or replace function public.search_clans(p_query text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); q text := lower(btrim(coalesce(p_query, '')));
begin
  return coalesce((
    select jsonb_agg(public.zwip_clan_json(c.id) || jsonb_build_object(
             'requested', exists (select 1 from public.zwip_cr r where r.clan_id = c.id and r.user_id = me and r.kind = 'request'),
             'invited', exists (select 1 from public.zwip_cr r where r.clan_id = c.id and r.user_id = me and r.kind = 'invite'))
           order by c.xp desc, c.created_at)
    from (select * from public.zwip_clans
          where q = '' or strpos(lower(name), q) > 0
          order by xp desc, created_at limit 30) c), '[]'::jsonb);
end;
$$;

-- Öffentliche Ansicht eines Clans (Mitglieder mit Wochen-XP)
create or replace function public.get_clan(p_clan uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); wk timestamptz := date_trunc('week', now());
begin
  if not exists (select 1 from public.zwip_clans where id = p_clan) then raise exception 'clan_not_found' using errcode = 'P0001'; end if;
  return public.zwip_clan_json(p_clan) || jsonb_build_object(
    'requested', exists (select 1 from public.zwip_cr r where r.clan_id = p_clan and r.user_id = me and r.kind = 'request'),
    'invited', exists (select 1 from public.zwip_cr r where r.clan_id = p_clan and r.user_id = me and r.kind = 'invite'),
    'is_member', exists (select 1 from public.zwip_cm where user_id = me and clan_id = p_clan),
    'member_list', coalesce((
      select jsonb_agg(jsonb_build_object('username', p.username, 'league', p.league, 'role', cm.role,
                                          'xp_week', coalesce(w.xp, 0)) order by cm.role = 'leader' desc, coalesce(w.xp, 0) desc, p.username)
      from public.zwip_cm cm join public.profiles p on p.id = cm.user_id
      left join (select user_id, sum(xp) as xp from public.clan_xp_log where clan_id = p_clan and created_at >= wk group by user_id) w
        on w.user_id = cm.user_id
      where cm.clan_id = p_clan), '[]'::jsonb));
end;
$$;

-- ---------- Clans: Beitreten, Einladen, Anfragen ----------

-- Beitreten: offen → sofort drin, „auf Anfrage“ → Anfrage an den Leiter, „nur Einladung“ → geht nicht.
-- Liegt eine Einladung vor, ist man immer sofort drin.
create or replace function public.join_clan(p_clan uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); c public.clans; nm text;
begin
  nm := public.zwip_need_name(me);
  select * into c from public.zwip_clans where id = p_clan;
  if c.id is null then raise exception 'clan_not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from public.zwip_cm where user_id = me) then raise exception 'already_in_clan' using errcode = 'P0001'; end if;
  if c.join_mode = 'open' or exists (select 1 from public.zwip_cr where clan_id = p_clan and user_id = me and kind = 'invite') then
    perform public.zwip_add_member(p_clan, me, 'member');
    return jsonb_build_object('status', 'joined');
  end if;
  if c.join_mode = 'invite' then raise exception 'invite_only' using errcode = 'P0001'; end if;
  if c.member_count >= public.zwip_clan_max() then raise exception 'clan_full' using errcode = 'P0001'; end if;
  if (select count(*) from public.zwip_cr where user_id = me and kind = 'request') >= 5 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  insert into public.clan_requests (clan_id, user_id, kind, created_by) values (p_clan, me, 'request', me)
    on conflict (clan_id, user_id, kind) do update set closed_at = null, created_at = now(), created_by = excluded.created_by;
  return jsonb_build_object('status', 'requested');
end;
$$;

create or replace function public.cancel_clan_request(p_clan uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  update public.clan_requests set closed_at = now() where clan_id = p_clan and user_id = me and kind = 'request' and closed_at is null;
end;
$$;

-- Einladen: jedes Mitglied darf Spieler einladen
create or replace function public.invite_to_clan(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members; other uuid; cnt integer;
begin
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  select id into other from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if other is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  if other = me then raise exception 'cannot_add_self' using errcode = 'P0001'; end if;
  if exists (select 1 from public.zwip_cm where user_id = other) then raise exception 'player_in_clan' using errcode = 'P0001'; end if;
  select member_count into cnt from public.clans where id = m.clan_id;
  if cnt >= public.zwip_clan_max() then raise exception 'clan_full' using errcode = 'P0001'; end if;
  -- Hat der Spieler selbst schon angefragt, ist er sofort drin
  if exists (select 1 from public.zwip_cr where clan_id = m.clan_id and user_id = other and kind = 'request') then
    perform public.zwip_add_member(m.clan_id, other, 'member');
    return jsonb_build_object('status', 'joined');
  end if;
  if (select count(*) from public.zwip_cr where clan_id = m.clan_id and kind = 'invite' and created_by = me
        and created_at > now() - interval '1 day') >= 50 then
    raise exception 'too_many_invites' using errcode = 'P0001';
  end if;
  insert into public.clan_requests (clan_id, user_id, kind, created_by) values (m.clan_id, other, 'invite', me)
    on conflict (clan_id, user_id, kind) do update set closed_at = null, created_at = now(), created_by = excluded.created_by;
  return jsonb_build_object('status', 'invited');
end;
$$;

-- Einladung annehmen oder ablehnen
create or replace function public.respond_clan_invite(p_clan uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  if not exists (select 1 from public.zwip_cr where clan_id = p_clan and user_id = me and kind = 'invite') then
    raise exception 'invite_not_found' using errcode = 'P0001';
  end if;
  if p_accept then
    perform public.zwip_need_name(me);
    perform public.zwip_add_member(p_clan, me, 'member');
    return jsonb_build_object('status', 'joined');
  end if;
  update public.clan_requests set closed_at = now() where clan_id = p_clan and user_id = me and kind = 'invite' and closed_at is null;
  return jsonb_build_object('status', 'declined');
end;
$$;

-- Beitrittsanfrage annehmen oder ablehnen (nur Leiter)
create or replace function public.respond_clan_request(p_username text, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m public.clan_members := public.zwip_need_leader(); other uuid;
begin
  select id into other from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if other is null or not exists (select 1 from public.zwip_cr where clan_id = m.clan_id and user_id = other and kind = 'request') then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if p_accept then
    perform public.zwip_add_member(m.clan_id, other, 'member');
  else
    update public.clan_requests set closed_at = now() where clan_id = m.clan_id and user_id = other and kind = 'request' and closed_at is null;
  end if;
  return public.get_my_clan();
end;
$$;

-- Clan verlassen. Der Leiter gibt die Leitung automatisch an das aktivste Mitglied ab; wer als Letzter geht, löst den Clan auf.
create or replace function public.leave_clan()
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members; heir uuid; nm text;
begin
  select * into m from public.zwip_cm where user_id = me for update;
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  select username into nm from public.profiles where id = me;
  update public.clan_members set active = false, role = 'member', muted_until = null where user_id = me;
  update public.clans set member_count = greatest(0, member_count - 1) where id = m.clan_id;
  if not exists (select 1 from public.zwip_cm where clan_id = m.clan_id) then
    update public.clans set dissolved_at = now(), member_count = 0, name = left(name, 11) || '~' || left(id::text, 8) where id = m.clan_id;
    return;
  end if;
  if m.role = 'leader' then
    select user_id into heir from public.zwip_cm where clan_id = m.clan_id order by xp_total desc, joined_at asc limit 1;
    update public.clan_members set role = 'leader' where user_id = heir;
    perform public.zwip_clan_system(m.clan_id, nm || ' hat den Clan verlassen. Neuer Leiter: ' ||
      (select username from public.profiles where id = heir) || ' 👑');
  else
    perform public.zwip_clan_system(m.clan_id, nm || ' hat den Clan verlassen');
  end if;
end;
$$;

-- Mitglied entfernen (nur Leiter)
create or replace function public.kick_clan_member(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m public.clan_members := public.zwip_need_leader(); other uuid;
begin
  select cm.user_id into other from public.zwip_cm cm join public.profiles p on p.id = cm.user_id
    where cm.clan_id = m.clan_id and lower(p.username) = lower(btrim(coalesce(p_username, '')));
  if other is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  if other = m.user_id then raise exception 'cannot_add_self' using errcode = 'P0001'; end if;
  update public.clan_members set active = false, role = 'member', muted_until = null where user_id = other;
  update public.clans set member_count = greatest(0, member_count - 1) where id = m.clan_id;
  perform public.zwip_clan_system(m.clan_id, btrim(p_username) || ' wurde aus dem Clan entfernt');
  return public.get_my_clan();
end;
$$;

-- Leitung übergeben (nur Leiter)
create or replace function public.transfer_clan_leader(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m public.clan_members := public.zwip_need_leader(); other uuid;
begin
  select cm.user_id into other from public.zwip_cm cm join public.profiles p on p.id = cm.user_id
    where cm.clan_id = m.clan_id and lower(p.username) = lower(btrim(coalesce(p_username, '')));
  if other is null or other = m.user_id then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  update public.clan_members set role = 'member' where user_id = m.user_id;
  update public.clan_members set role = 'leader' where user_id = other;
  perform public.zwip_clan_system(m.clan_id, btrim(p_username) || ' ist jetzt Clan-Leiter 👑');
  return public.get_my_clan();
end;
$$;

-- ---------- Clans: Ranglisten ----------

-- Clan-Rangliste nach Zeitraum: day | week | month | season | all
create or replace function public.get_clan_board(p_period text default 'week')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := public.zwip_me();
  per text := coalesce(p_period, 'week');
  since timestamptz;
  my_clan uuid;
begin
  if per not in ('day', 'week', 'month', 'season', 'all') then raise exception 'invalid_period' using errcode = 'P0001'; end if;
  since := public.zwip_period_start(per);
  select clan_id into my_clan from public.zwip_cm where user_id = me;
  return (
    with scores as (
      select c.id, c.name, c.emblem, c.color, c.frame, c.member_count, c.xp,
             case when per = 'all' then c.xp
                  else coalesce((select sum(l.xp) from public.clan_xp_log l where l.clan_id = c.id and l.created_at >= since), 0) end as pts
      from public.zwip_clans c
    ), ranked as (
      select s.*, row_number() over (order by s.pts desc, s.xp desc, s.name) as pos from scores s
    )
    select jsonb_build_object(
      'period', per, 'since', case when per = 'all' then null else since end,
      'rows', coalesce(jsonb_agg(jsonb_build_object(
                'rank', r.pos, 'id', r.id, 'name', r.name, 'emblem', r.emblem, 'color', r.color, 'frame', r.frame,
                'members', r.member_count, 'level', public.zwip_clan_level(r.xp), 'points', r.pts, 'is_mine', r.id = my_clan)
                order by r.pos) filter (where r.pos <= 50 or r.id = my_clan), '[]'::jsonb),
      'total', count(*))
    from ranked r);
end;
$$;

-- Clan-interne Rangliste: Wer trägt am meisten bei? (week | month | all)
create or replace function public.get_clan_contrib(p_period text default 'week')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members; since timestamptz;
begin
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  since := public.zwip_period_start(coalesce(p_period, 'week'));
  return coalesce((
    select jsonb_agg(jsonb_build_object('rank', pos, 'username', username, 'league', league, 'role', role,
                                        'points', pts, 'rounds', rnds, 'is_me', uid = me) order by pos)
    from (
      select cm.user_id as uid, p.username, p.league, cm.role,
             coalesce(sum(l.xp), 0) as pts, coalesce(sum(l.rounds), 0) as rnds,
             row_number() over (order by coalesce(sum(l.xp), 0) desc, p.username) as pos
      from public.zwip_cm cm join public.profiles p on p.id = cm.user_id
      left join public.clan_xp_log l on l.user_id = cm.user_id and l.clan_id = m.clan_id and l.created_at >= since
      where cm.clan_id = m.clan_id
      group by cm.user_id, p.username, p.league, cm.role) s), '[]'::jsonb);
end;
$$;

-- ---------- Clans: Chat ----------

create or replace function public.get_clan_messages(p_after bigint default 0)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members; newest bigint;
begin
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  select max(id) into newest from public.clan_messages where clan_id = m.clan_id;
  if newest is not null and newest > m.last_read_id then
    update public.clan_members set last_read_id = newest where user_id = me;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'username', p.username, 'body', case when x.hidden then null else x.body end,
             'hidden', x.hidden, 'kind', x.kind, 'at', x.created_at, 'is_me', x.user_id = me)
           order by x.id)
    from (select * from public.clan_messages
          where clan_id = m.clan_id and id > coalesce(p_after, 0)
          order by id desc limit 60) x
    left join public.profiles p on p.id = x.user_id), '[]'::jsonb);
end;
$$;

-- Nachricht schicken: freier Text (gefiltert) oder Schnellnachricht 1–7. Höchstens 1 Nachricht pro 2 s und 15 pro Minute.
create or replace function public.send_clan_message(p_body text, p_quick integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members; txt text; k text;
begin
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  if m.muted_until is not null and m.muted_until > now() then raise exception 'muted' using errcode = 'P0001'; end if;
  if exists (select 1 from public.clan_messages where user_id = me and created_at > now() - interval '2 seconds')
     or (select count(*) from public.clan_messages where user_id = me and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'slow_down' using errcode = 'P0001';
  end if;
  if p_quick is not null then
    txt := public.zwip_quick_message(p_quick);
    if txt is null then raise exception 'invalid_message' using errcode = 'P0001'; end if;
    k := 'quick';
  else
    txt := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
    if char_length(txt) < 1 or char_length(txt) > 200 then raise exception 'invalid_message' using errcode = 'P0001'; end if;
    txt := public.zwip_clean_text(txt);
    k := 'text';
  end if;
  insert into public.clan_messages (clan_id, user_id, body, kind) values (m.clan_id, me, txt, k);
  return public.get_clan_messages(greatest(0, (select max(id) from public.clan_messages where clan_id = m.clan_id) - 1));
end;
$$;

-- Nachricht melden: Ab 3 Meldungen (oder wenn der Leiter meldet) wird sie ausgeblendet
create or replace function public.report_clan_message(p_id bigint, p_reason text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members; msg public.clan_messages; n integer;
begin
  select * into m from public.zwip_cm where user_id = me;
  select * into msg from public.clan_messages where id = p_id;
  if m.user_id is null or msg.id is null or msg.clan_id <> m.clan_id then raise exception 'message_not_found' using errcode = 'P0001'; end if;
  if msg.user_id = me then raise exception 'cannot_add_self' using errcode = 'P0001'; end if;
  insert into public.clan_reports (message_id, reporter_id, reason) values (p_id, me, left(coalesce(p_reason, ''), 100))
    on conflict do nothing;
  select count(*) into n from public.clan_reports where message_id = p_id;
  if n >= 3 or m.role = 'leader' then
    update public.clan_messages set hidden = true where id = p_id;
  end if;
  return jsonb_build_object('hidden', n >= 3 or m.role = 'leader', 'reports', n);
end;
$$;

-- Nachricht löschen: eigene Nachricht oder als Leiter jede
create or replace function public.hide_clan_message(p_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members; msg public.clan_messages;
begin
  select * into m from public.zwip_cm where user_id = me;
  select * into msg from public.clan_messages where id = p_id;
  if m.user_id is null or msg.id is null or msg.clan_id <> m.clan_id then raise exception 'message_not_found' using errcode = 'P0001'; end if;
  if msg.user_id is distinct from me and m.role <> 'leader' then raise exception 'not_leader' using errcode = 'P0001'; end if;
  update public.clan_messages set hidden = true where id = p_id;
end;
$$;

-- Mitglied stummschalten (nur Leiter): p_hours = 0 hebt es auf, sonst 1–168 Stunden
create or replace function public.mute_clan_member(p_username text, p_hours integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m public.clan_members := public.zwip_need_leader(); other uuid;
begin
  select cm.user_id into other from public.zwip_cm cm join public.profiles p on p.id = cm.user_id
    where cm.clan_id = m.clan_id and lower(p.username) = lower(btrim(coalesce(p_username, '')));
  if other is null or other = m.user_id then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  update public.clan_members
    set muted_until = case when coalesce(p_hours, 0) <= 0 then null else now() + make_interval(hours => least(p_hours, 168)) end
    where user_id = other;
  return public.get_my_clan();
end;
$$;

-- ---------- Badges: jetzt auch für Clans ----------
create or replace function public.get_badges()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  seen timestamptz;
  incoming integer;
  accepted integer;
  accepted_names jsonb;
  m public.clan_members;
  clan_n integer := 0;
  unread integer := 0;
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select friends_seen_at into seen from public.profiles where id = me;
  seen := coalesce(seen, now());
  select count(*) into incoming from public.friendships
    where receiver_id = me and status = 'pending' and created_at > seen;
  select count(*), coalesce(jsonb_agg(p.username order by f.accepted_at desc) filter (where p.username is not null), '[]'::jsonb)
    into accepted, accepted_names
    from public.friendships f join public.profiles p on p.id = f.receiver_id
    where f.sender_id = me and f.status = 'accepted' and f.accepted_at > seen;
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then
    select count(*) into clan_n from public.zwip_cr r join public.zwip_clans c on c.id = r.clan_id where r.user_id = me and r.kind = 'invite';
  else
    select count(*) into unread from public.clan_messages x
      where x.clan_id = m.clan_id and x.id > m.last_read_id and not x.hidden and x.user_id is distinct from me;
    clan_n := unread;
    if m.role = 'leader' then
      clan_n := clan_n + (select count(*) from public.zwip_cr where clan_id = m.clan_id and kind = 'request');
    end if;
  end if;
  return jsonb_build_object(
    'friends', incoming + accepted,
    'friend_requests', incoming,
    'friends_accepted', accepted,
    'accepted_names', accepted_names,
    'clan', clan_n,
    'clan_unread', unread);
end;
$$;

-- Clan eines Spielers für Profile (Name, Emblem, Farbe) – oder null
create or replace function public.zwip_player_clan(p_user uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'emblem', c.emblem, 'color', c.color, 'frame', c.frame,
                            'level', public.zwip_clan_level(c.xp), 'role', m.role)
  from public.zwip_cm m join public.clans c on c.id = m.clan_id where m.user_id = p_user
$$;

create or replace function public.get_player_clan(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); other uuid;
begin
  select id into other from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if other is null then return null; end if;
  return public.zwip_player_clan(other);
end;
$$;

-- #####################################################################
-- TEIL D: RECHTE
-- #####################################################################

revoke all on function public.zwip_minigame_speed(text) from public, anon, authenticated;
revoke all on function public.zwip_stage_points(integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public.zwip_run_score(text, jsonb) from public, anon, authenticated;
revoke all on function public.zwip_mg_ranked(text) from public, anon, authenticated;
revoke all on function public.zwip_minigame_ranked(text) from public, anon, authenticated;
revoke all on function public.zwip_minigame_entry(text, uuid) from public, anon, authenticated;
revoke all on function public.zwip_clan_max() from public, anon, authenticated;
revoke all on function public.zwip_clan_level(bigint) from public, anon, authenticated;
revoke all on function public.zwip_clan_unlock_level(text, text) from public, anon, authenticated;
revoke all on function public.zwip_period_start(text) from public, anon, authenticated;
revoke all on function public.zwip_clean_text(text) from public, anon, authenticated;
revoke all on function public.zwip_quick_message(integer) from public, anon, authenticated;
revoke all on function public.zwip_my_clan_member() from public, anon, authenticated;
revoke all on function public.zwip_clan_challenges(uuid) from public, anon, authenticated;
revoke all on function public.zwip_clan_on_run(uuid, integer) from public, anon, authenticated;
revoke all on function public.zwip_clan_json(uuid) from public, anon, authenticated;
revoke all on function public.zwip_clan_system(uuid, text) from public, anon, authenticated;
revoke all on function public.zwip_add_member(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.zwip_need_name(uuid) from public, anon, authenticated;
revoke all on function public.zwip_need_leader() from public, anon, authenticated;
revoke all on function public.zwip_player_clan(uuid) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.finish_minigame_run(uuid, integer, integer, jsonb)', 'public.get_minigame_ranking(text, text, integer)',
    'public.get_minigame_board(text, integer)', 'public.get_my_minigame_bests()',
    'public.get_my_clan()', 'public.create_clan(text, text, text, text, text)',
    'public.update_clan(text, text, text, text, text)', 'public.search_clans(text)', 'public.get_clan(uuid)',
    'public.join_clan(uuid)', 'public.cancel_clan_request(uuid)', 'public.invite_to_clan(text)',
    'public.respond_clan_invite(uuid, boolean)', 'public.respond_clan_request(text, boolean)', 'public.leave_clan()',
    'public.kick_clan_member(text)', 'public.transfer_clan_leader(text)', 'public.get_clan_board(text)',
    'public.get_clan_contrib(text)', 'public.get_clan_messages(bigint)', 'public.send_clan_message(text, integer)',
    'public.report_clan_message(bigint, text)', 'public.hide_clan_message(bigint)', 'public.mute_clan_member(text, integer)',
    'public.get_badges()', 'public.get_player_clan(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
