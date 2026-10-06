-- ZWIP: Rechtliches (Nutzungsbedingungen, Alter), Konto löschen/exportieren, Moderation (Admins, Sperren, Meldungen, Filter-Wörter)
-- Voraussetzung: alle anderen SQL-Dateien (profiles, trophies, profile, minigames, social, clans, regions). Mehrfaches Ausführen ist unschädlich.
-- Bewusst ohne Lösch-Befehle: Erledigtes wird markiert, Filter-Wörter werden deaktiviert statt entfernt.

-- =====================================================================
-- 1. Spalten und Tabellen
-- =====================================================================

alter table public.profiles add column if not exists birth_year integer;
alter table public.profiles add column if not exists parental_ok boolean not null default false;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists warnings integer not null default 0;
alter table public.profiles add column if not exists last_warning text;
alter table public.profiles add column if not exists last_warning_at timestamptz;

do $$ begin
  alter table public.profiles add constraint profiles_birth_year check (birth_year is null or birth_year between 1900 and 2100);
exception when duplicate_object then null; end $$;

alter table public.clan_messages add column if not exists reviewed_at timestamptz;
alter table public.minigame_runs add column if not exists flagged text;
alter table public.minigame_runs add column if not exists review text check (review is null or review in ('open', 'ok', 'rejected'));

create table if not exists public.zwip_admins (
  email text primary key check (email = lower(email))
);
insert into public.zwip_admins (email) values ('luis.hausner@web.de') on conflict do nothing;

-- (Tabelle bad_words steht in clans.sql, weil der Filter sie dort schon braucht)

create table if not exists public.player_reports (
  id          bigserial primary key,
  reporter_id uuid references public.profiles (id) on delete set null,
  target_id   uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('name', 'avatar', 'highscore', 'other')),
  game_id     text,
  detail      text not null default '',
  status      text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  handled_by  uuid references public.profiles (id) on delete set null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists player_reports_open_idx on public.player_reports (status, created_at);
create index if not exists minigame_runs_review_idx on public.minigame_runs (review) where review = 'open';

alter table public.zwip_admins enable row level security;
alter table public.player_reports enable row level security;
revoke all on public.zwip_admins, public.player_reports from anon, authenticated;

-- =====================================================================
-- 2. Hilfsfunktionen
-- =====================================================================

create or replace function public.zwip_is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from auth.users u join public.zwip_admins a on a.email = lower(u.email) where u.id = auth.uid())
$$;

create or replace function public.zwip_need_admin()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.zwip_is_admin() then raise exception 'not_admin' using errcode = 'P0001'; end if;
  return auth.uid();
end;
$$;

-- Gesperrte Spieler dürfen nicht chatten, keine Werte einreichen und keine Clans gründen
create or replace function public.zwip_check_ban(p_user uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = p_user and banned_until is not null and banned_until > now()) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
end;
$$;

-- =====================================================================
-- 3. Nutzungsbedingungen, Alter, eigener Status
-- =====================================================================

create or replace function public.get_my_terms()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); p public.profiles;
begin
  select * into p from public.profiles where id = me;
  return jsonb_build_object(
    'accepted', p.terms_accepted_at is not null,
    'accepted_at', p.terms_accepted_at,
    'under16', case when p.birth_year is null then null else extract(year from now())::integer - p.birth_year < 16 end,
    'banned_until', case when p.banned_until > now() then p.banned_until else null end,
    'ban_reason', case when p.banned_until > now() then p.ban_reason else null end,
    'warning', case when p.last_warning_at > now() - interval '14 days' then p.last_warning else null end,
    'warning_at', p.last_warning_at,
    'is_admin', public.zwip_is_admin());
end;
$$;

-- Bei der Registrierung (oder beim ersten Start nach dem Update): Alter + Zustimmung
create or replace function public.accept_terms(p_age integer, p_parent_ok boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  if p_age is null or p_age < 6 or p_age > 120 then raise exception 'invalid_age' using errcode = 'P0001'; end if;
  if p_age < 16 and coalesce(p_parent_ok, false) is not true then
    raise exception 'parent_consent_required' using errcode = 'P0001';
  end if;
  update public.profiles set
      birth_year = extract(year from now())::integer - p_age,
      parental_ok = p_age < 16,
      terms_accepted_at = now()
    where id = me;
  return public.get_my_terms();
end;
$$;

-- Alle eigenen Daten als JSON (Auskunft nach DSGVO)
create or replace function public.export_my_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at) from auth.users u where u.id = me),
    'profile', (select to_jsonb(p) - 'avatar' || jsonb_build_object('has_avatar', p.avatar is not null) from public.profiles p where p.id = me),
    'minigame_bests', coalesce((select jsonb_agg(to_jsonb(b) - 'user_id') from public.minigame_bests b where b.user_id = me), '[]'::jsonb),
    'minigame_runs', coalesce((select jsonb_agg(jsonb_build_object('game', r.game_id, 'stage', r.stage, 'score', r.score, 'status', r.status,
                                                 'started_at', r.started_at, 'finished_at', r.finished_at) order by r.started_at desc)
                               from (select * from public.minigame_runs where user_id = me order by started_at desc limit 500) r), '[]'::jsonb),
    'trophy_rounds', coalesce((select jsonb_agg(to_jsonb(t) - 'user_id' order by t.started_at desc)
                               from (select * from public.trophy_rounds where user_id = me order by started_at desc limit 500) t), '[]'::jsonb),
    'friends', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'status', f.status, 'since', f.created_at))
                         from public.friendships f join public.profiles p on p.id = case when f.sender_id = me then f.receiver_id else f.sender_id end
                         where f.sender_id = me or f.receiver_id = me), '[]'::jsonb),
    'clan', (select jsonb_build_object('name', c.name, 'role', m.role, 'joined_at', m.joined_at, 'xp_total', m.xp_total)
             from public.zwip_cm m join public.clans c on c.id = m.clan_id where m.user_id = me),
    'clan_messages', coalesce((select jsonb_agg(jsonb_build_object('text', x.body, 'at', x.created_at) order by x.id desc)
                               from (select * from public.clan_messages where user_id = me order by id desc limit 1000) x), '[]'::jsonb),
    'reports_filed', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'at', r.created_at, 'status', r.status))
                               from public.player_reports r where r.reporter_id = me), '[]'::jsonb));
end;
$$;

-- Vor dem Löschen eines Kontos (nur für die Edge Function „delete-account“ mit Service-Rolle):
-- aus dem Clan austreten (Leitung abgeben bzw. Clan auflösen). Das eigentliche Löschen übernimmt Supabase Auth,
-- alle persönlichen Daten hängen per "on delete cascade" am Konto.
create or replace function public.zwip_prepare_delete(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.clan_members; heir uuid;
begin
  select * into m from public.zwip_cm where user_id = p_user;
  if m.user_id is null then return; end if;
  update public.clan_members set active = false, role = 'member', muted_until = null where user_id = p_user;
  update public.clans set member_count = greatest(0, member_count - 1) where id = m.clan_id;
  if not exists (select 1 from public.zwip_cm where clan_id = m.clan_id) then
    update public.clans set dissolved_at = now(), member_count = 0, name = left(name, 11) || '~' || left(id::text, 8) where id = m.clan_id;
    return;
  end if;
  if m.role = 'leader' then
    select user_id into heir from public.zwip_cm where clan_id = m.clan_id order by xp_total desc, joined_at asc limit 1;
    update public.clan_members set role = 'leader' where user_id = heir;
    perform public.zwip_clan_system(m.clan_id, 'Ein Mitglied hat sein Konto gelöscht. Neuer Leiter: ' ||
      (select username from public.profiles where id = heir) || ' 👑');
  end if;
end;
$$;

-- Spieler melden (Name, Profilbild, verdächtiger Highscore)
create or replace function public.report_player(p_username text, p_kind text, p_game text default null, p_detail text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); target uuid;
begin
  select id into target from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if target is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  if target = me then raise exception 'cannot_add_self' using errcode = 'P0001'; end if;
  if coalesce(p_kind, '') not in ('name', 'avatar', 'highscore', 'other') then raise exception 'invalid_report' using errcode = 'P0001'; end if;
  if (select count(*) from public.player_reports where reporter_id = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'slow_down' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.player_reports where reporter_id = me and target_id = target and kind = p_kind and status = 'open') then
    insert into public.player_reports (reporter_id, target_id, kind, game_id, detail)
      values (me, target, p_kind, left(p_game, 20), left(coalesce(p_detail, ''), 200));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Spielername: gleiche Regeln wie bisher + keine Schimpfwörter + nicht gesperrt
create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); name text := btrim(coalesce(p_username, ''));
begin
  perform public.zwip_check_ban(me);
  if name !~ '^[A-Za-z0-9_]{3,16}$' then
    raise exception 'username_invalid' using errcode = 'P0001';
  end if;
  if public.zwip_clean_text(name) <> name then raise exception 'username_bad' using errcode = 'P0001'; end if;
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

-- Trophäen-Runde starten: wie bisher, aber nicht für gesperrte Spieler
create or replace function public.start_trophy_round()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); p public.profiles; rid uuid; s integer;
begin
  perform public.zwip_check_ban(me);
  select * into p from public.profiles where id = me;
  if p.username is null then
    raise exception 'username_required' using errcode = 'P0001';
  end if;
  update public.trophy_rounds set status = 'abandoned', finished_at = now()
    where user_id = me and status = 'active';
  s := floor(random() * 2147483646)::integer + 1;
  insert into public.trophy_rounds (user_id, seed, start_trophies)
    values (me, s, p.trophies) returning id into rid;
  return jsonb_build_object('round_id', rid, 'seed', s, 'trophies', p.trophies, 'league', p.league);
end;
$$;

-- =====================================================================
-- 4. Admin-Funktionen (nur für Konten in zwip_admins)
-- =====================================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.zwip_is_admin() $$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.zwip_need_admin();
  return jsonb_build_object(
    'players', (select count(*) from public.profiles where username is not null),
    'clans', (select count(*) from public.zwip_clans),
    'open_chat', (select count(distinct r.message_id) from public.clan_reports r join public.clan_messages m on m.id = r.message_id where m.reviewed_at is null),
    'open_players', (select count(*) from public.player_reports where status = 'open'),
    'open_runs', (select count(*) from public.minigame_runs where review = 'open'),
    'banned', (select count(*) from public.profiles where banned_until > now()));
end;
$$;

create or replace function public.admin_reports()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.zwip_need_admin();
  return jsonb_build_object(
    'chat', coalesce((
      select jsonb_agg(x order by (x ->> 'last_report') desc) from (
        select jsonb_build_object(
          'id', m.id, 'body', m.body, 'hidden', m.hidden, 'at', m.created_at,
          'username', p.username, 'clan', c.name,
          'reports', count(r.*), 'reasons', jsonb_agg(distinct r.reason), 'last_report', max(r.created_at),
          'banned', p.banned_until > now()) as x
        from public.clan_messages m
        join public.clan_reports r on r.message_id = m.id
        left join public.profiles p on p.id = m.user_id
        left join public.clans c on c.id = m.clan_id
        where m.reviewed_at is null
        group by m.id, p.username, c.name, p.banned_until
        limit 100) s), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'kind', r.kind, 'game', r.game_id, 'detail', r.detail, 'at', r.created_at,
               'target', t.username, 'reporter', rp.username, 'avatar', t.avatar,
               'warnings', t.warnings, 'banned', t.banned_until > now(),
               'same_reports', (select count(*) from public.player_reports o where o.target_id = r.target_id and o.kind = r.kind and o.status = 'open'))
             order by r.created_at desc)
      from (select * from public.player_reports where status = 'open' order by created_at desc limit 100) r
      join public.profiles t on t.id = r.target_id
      left join public.profiles rp on rp.id = r.reporter_id), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'game', x.game_id, 'stage', x.stage, 'score', x.score, 'flagged', x.flagged,
               'at', x.finished_at, 'username', p.username, 'banned', p.banned_until > now())
             order by x.finished_at desc)
      from (select * from public.minigame_runs where review = 'open' order by finished_at desc limit 100) x
      join public.profiles p on p.id = x.user_id), '[]'::jsonb));
end;
$$;

-- Verlauf rund um eine gemeldete Nachricht (je 8 davor und danach)
create or replace function public.admin_message_context(p_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare msg public.clan_messages;
begin
  perform public.zwip_need_admin();
  select * into msg from public.clan_messages where id = p_id;
  if msg.id is null then raise exception 'message_not_found' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'username', p.username, 'body', x.body, 'kind', x.kind,
                                        'hidden', x.hidden, 'at', x.created_at, 'is_target', x.id = p_id) order by x.id)
    from (
      (select * from public.clan_messages where clan_id = msg.clan_id and id < p_id order by id desc limit 8)
      union all (select * from public.clan_messages where id = p_id)
      union all (select * from public.clan_messages where clan_id = msg.clan_id and id > p_id order by id limit 8)) x
    left join public.profiles p on p.id = x.user_id), '[]'::jsonb);
end;
$$;

create or replace function public.admin_resolve_message(p_id bigint, p_hide boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.zwip_need_admin();
  update public.clan_messages set reviewed_at = now(), hidden = hidden or coalesce(p_hide, false) where id = p_id;
  return public.admin_overview();
end;
$$;

create or replace function public.admin_resolve_report(p_id bigint, p_status text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_need_admin();
begin
  if coalesce(p_status, '') not in ('done', 'dismissed') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  update public.player_reports set status = p_status, handled_by = me, handled_at = now() where id = p_id;
  return public.admin_overview();
end;
$$;

-- Verdächtigen Lauf prüfen: ok = zählt (wird nachträglich gewertet), rejected = Bestwert dieses Spiels wird zurückgesetzt
create or replace function public.admin_resolve_run(p_id uuid, p_valid boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.minigame_runs; b public.minigame_bests;
begin
  perform public.zwip_need_admin();
  select * into r from public.minigame_runs where id = p_id for update;
  if r.id is null then raise exception 'run_not_found' using errcode = 'P0001'; end if;
  update public.minigame_runs set review = case when p_valid then 'ok' else 'rejected' end where id = p_id;
  select * into b from public.minigame_bests where user_id = r.user_id and game_id = r.game_id;
  if p_valid then
    if r.flagged not like 'soft:%' and coalesce(r.score, 0) > coalesce(b.best_score, 0) then
      update public.minigame_bests set best_score = r.score, best_stage = r.stage, best_ms = coalesce(r.total_ms, 0), achieved_at = now()
        where user_id = r.user_id and game_id = r.game_id;
    end if;
  else
    if b.best_score = r.score then
      update public.minigame_bests set best_score = 0, best_stage = 0, best_ms = 0 where user_id = r.user_id and game_id = r.game_id;
    end if;
  end if;
  return public.admin_overview();
end;
$$;

-- Sperren: p_hours > 0 = für so viele Stunden, -1 = dauerhaft, 0 = Sperre aufheben
create or replace function public.admin_ban(p_username text, p_hours integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare target uuid;
begin
  perform public.zwip_need_admin();
  select id into target from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if target is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  update public.profiles set
      banned_until = case when coalesce(p_hours, 0) = 0 then null
                          when p_hours < 0 then now() + interval '100 years'
                          else now() + make_interval(hours => least(p_hours, 24 * 365)) end,
      ban_reason = case when coalesce(p_hours, 0) = 0 then null else left(coalesce(p_reason, ''), 200) end
    where id = target;
  return public.admin_player(p_username);
end;
$$;

create or replace function public.admin_warn(p_username text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare target uuid;
begin
  perform public.zwip_need_admin();
  select id into target from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if target is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  update public.profiles set warnings = warnings + 1, last_warning = left(coalesce(p_reason, ''), 200), last_warning_at = now()
    where id = target;
  return public.admin_player(p_username);
end;
$$;

-- Unpassenden Namen durch „Spieler123456“ ersetzen
create or replace function public.admin_reset_name(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare target uuid; nm text;
begin
  perform public.zwip_need_admin();
  select id into target from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if target is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  loop
    nm := 'Spieler' || (100000 + floor(random() * 900000))::integer;
    exit when not exists (select 1 from public.profiles where lower(username) = lower(nm));
  end loop;
  update public.profiles set username = nm, updated_at = now() where id = target;
  return public.admin_player(nm);
end;
$$;

create or replace function public.admin_reset_avatar(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.zwip_need_admin();
  update public.profiles set avatar = null where lower(username) = lower(btrim(coalesce(p_username, '')));
  return public.admin_player(p_username);
end;
$$;

-- Clan-Name und Beschreibung zurücksetzen
create or replace function public.admin_reset_clan(p_clan uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.zwip_need_admin();
  update public.clans set name = 'Clan ' || left(id::text, 6), description = '' where id = p_clan;
  return public.zwip_clan_json(p_clan);
end;
$$;

-- Spieler suchen (für Admins: mit Sperr- und Verwarn-Status)
create or replace function public.admin_player(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.zwip_need_admin();
  return (
    select jsonb_build_object(
      'username', p.username, 'trophies', p.trophies, 'league', p.league, 'country', p.country,
      'created_at', p.created_at, 'warnings', p.warnings, 'last_warning', p.last_warning,
      'banned_until', case when p.banned_until > now() then p.banned_until else null end, 'ban_reason', p.ban_reason,
      'has_avatar', p.avatar is not null, 'avatar', p.avatar,
      'clan', (select jsonb_build_object('id', c.id, 'name', c.name) from public.zwip_cm m join public.clans c on c.id = m.clan_id where m.user_id = p.id),
      'reports', (select count(*) from public.player_reports where target_id = p.id),
      'chat_reports', (select count(*) from public.clan_reports r join public.clan_messages x on x.id = r.message_id where x.user_id = p.id))
    from public.profiles p where lower(p.username) = lower(btrim(coalesce(p_username, ''))));
end;
$$;

create or replace function public.admin_search(p_query text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare q text := lower(btrim(coalesce(p_query, '')));
begin
  perform public.zwip_need_admin();
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('username', p.username, 'warnings', p.warnings,
                                        'banned', p.banned_until > now(), 'league', p.league) order by p.username)
    from (select * from public.profiles where username is not null and strpos(lower(username), q) > 0 order by username limit 30) p), '[]'::jsonb);
end;
$$;

-- Filter-Wörter verwalten (aktivieren/deaktivieren statt löschen)
create or replace function public.admin_words()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.zwip_need_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('word', word, 'active', active, 'at', created_at) order by active desc, word)
                   from public.bad_words), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_word(p_word text, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_need_admin(); w text := lower(btrim(coalesce(p_word, '')));
begin
  if char_length(w) < 2 or char_length(w) > 40 then raise exception 'invalid_word' using errcode = 'P0001'; end if;
  insert into public.bad_words (word, active, added_by) values (w, coalesce(p_active, true), me)
    on conflict (word) do update set active = excluded.active;
  return public.admin_words();
end;
$$;

-- =====================================================================
-- 5. Rechte
-- =====================================================================

revoke all on function public.zwip_is_admin() from public, anon, authenticated;
revoke all on function public.zwip_need_admin() from public, anon, authenticated;
revoke all on function public.zwip_check_ban(uuid) from public, anon, authenticated;
revoke all on function public.zwip_prepare_delete(uuid) from public, anon, authenticated;
grant execute on function public.zwip_prepare_delete(uuid) to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.get_my_terms()', 'public.accept_terms(integer, boolean)', 'public.export_my_data()',
    'public.report_player(text, text, text, text)', 'public.set_username(text)', 'public.start_trophy_round()',
    'public.is_admin()', 'public.admin_overview()', 'public.admin_reports()', 'public.admin_message_context(bigint)',
    'public.admin_resolve_message(bigint, boolean)', 'public.admin_resolve_report(bigint, text)', 'public.admin_resolve_run(uuid, boolean)',
    'public.admin_ban(text, integer, text)', 'public.admin_warn(text, text)', 'public.admin_reset_name(text)',
    'public.admin_reset_avatar(text)', 'public.admin_reset_clan(uuid)', 'public.admin_player(text)', 'public.admin_search(text)',
    'public.admin_words()', 'public.admin_set_word(text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
