-- Tests für supabase/moderation.sql (Alter, Zustimmung, Export, Admin, Sperren, Meldungen, Anti-Cheat)
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'Luis.Hausner@web.de'),
  ('e2000000-0000-0000-0000-000000000002', 'kid@test.de'),
  ('e3000000-0000-0000-0000-000000000003', 'troll@test.de');
\set ADM '''e1000000-0000-0000-0000-000000000001'''
\set KID '''e2000000-0000-0000-0000-000000000002'''
\set TROLL '''e3000000-0000-0000-0000-000000000003'''

create or replace function t_run_steps(uid text, game text, steps jsonb, ago interval default '10 minutes')
returns jsonb language plpgsql security definer as $$
declare r jsonb; k integer;
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  r := public.start_minigame_run(game);
  update public.minigame_runs set started_at = now() - ago where id = (r ->> 'run_id')::uuid;
  select count(*) into k from jsonb_array_elements(steps) e(v) where (v ->> 'ok')::boolean;
  return public.finish_minigame_run((r ->> 'run_id')::uuid, k, 100 * k, steps);
end $$;

set role authenticated;
select t_login(:ADM); select set_username('Mod_Luis');
select t_login(:KID); select set_username('Mod_Kid');
select t_login(:TROLL);
select t_assert(t_error_of($$select set_username('Fick_Dich')$$) = 'username_bad', 'Schimpfwörter im Spielernamen sind gesperrt');
select set_username('Mod_Troll');

-- ---------- Alter & Zustimmung ----------
select t_login(:KID);
select t_assert((get_my_terms() ->> 'accepted')::boolean is false, 'Neue Konten haben noch nicht zugestimmt');
select t_assert(t_error_of($$select accept_terms(12, false)$$) = 'parent_consent_required', 'Unter 16 braucht es das Eltern-Häkchen');
select t_assert(t_error_of($$select accept_terms(3, true)$$) = 'invalid_age', 'Unsinniges Alter wird abgelehnt');
select t_assert((accept_terms(12, true) ->> 'under16')::boolean, 'Mit Eltern-Häkchen geht es (unter 16)');
select t_assert((get_my_terms() ->> 'accepted')::boolean, 'Zustimmung gespeichert');
select t_login(:TROLL);
select t_assert((accept_terms(17, false) ->> 'under16')::boolean is false, 'Ab 16 ohne Eltern-Häkchen');

-- ---------- Datenexport ----------
select t_login(:KID);
select t_assert(export_my_data() -> 'account' ->> 'email' = 'kid@test.de', 'Export enthält die eigene E-Mail');
select t_assert(export_my_data() -> 'profile' ->> 'username' = 'Mod_Kid', 'Export enthält das Profil');
select t_assert(not (export_my_data() -> 'profile' ? 'avatar'), 'Profilbild selbst nicht im Export (nur ob vorhanden)');

-- ---------- Melden ----------
select t_assert(report_player('Mod_Troll', 'name', null, 'Name ist beleidigend') ->> 'ok' = 'true', 'Spielername melden');
select t_assert(t_error_of($$select report_player('Mod_Kid', 'name')$$) = 'cannot_add_self', 'Sich selbst melden geht nicht');
select t_assert(t_error_of($$select report_player('Mod_Troll', 'quatsch')$$) = 'invalid_report', 'Unbekannte Meldungsart');
select report_player('Mod_Troll', 'name');
reset role;
select t_assert((select count(*) from public.player_reports where kind = 'name') = 1, 'Doppelte offene Meldung wird nicht doppelt gespeichert');

-- ---------- Admin ----------
set role authenticated; select t_login(:KID);
select t_assert(is_admin() is false, 'Normale Spieler sind keine Admins');
select t_assert(t_error_of($$select admin_overview()$$) = 'not_admin', 'Admin-Funktionen sind gesperrt');
select t_assert(t_error_of($$select admin_ban('Mod_Troll', 24, 'x')$$) = 'not_admin', 'Nur Admins dürfen sperren');
select t_login(:ADM);
select t_assert(is_admin(), 'luis.hausner@web.de ist Admin (Groß/klein egal)');
select t_assert((admin_overview() ->> 'open_players')::int = 1, 'Admin sieht offene Meldungen');
select t_assert(admin_reports() -> 'players' -> 0 ->> 'target' = 'Mod_Troll', 'Meldung mit gemeldetem Spieler');
select t_assert(admin_warn('Mod_Troll', 'Bitte Namen ändern') ->> 'warnings' = '1', 'Verwarnung');
select t_assert((admin_reset_name('Mod_Troll') ->> 'username') like 'Spieler%', 'Name wird ersetzt');
reset role;
create temp table t_names as select (select username from public.profiles where id = 'e3000000-0000-0000-0000-000000000003') as troll;
grant select on t_names to authenticated; set role authenticated; select t_login(:ADM);
select t_assert(admin_resolve_report((admin_reports() -> 'players' -> 0 ->> 'id')::bigint, 'done') ->> 'open_players' = '0', 'Meldung erledigt');
select t_assert(admin_ban((select troll from t_names), 24, 'Beleidigungen') ->> 'banned_until' is not null, 'Spieler 24 h gesperrt');
select t_login(:TROLL);
select t_assert(get_my_terms() ->> 'warning' = 'Bitte Namen ändern', 'Verwarnter Spieler sieht die Verwarnung');
select t_assert(get_my_terms() ->> 'ban_reason' = 'Beleidigungen', 'Gesperrter Spieler sieht den Grund');
select t_assert(t_error_of($$select start_trophy_round()$$) = 'banned', 'Gesperrt: keine Trophäen-Runde');
select t_assert(t_error_of($$select create_clan('Trollclan', '🛡️', '#a45cff', '', 'open')$$) = 'banned', 'Gesperrt: kein Clan gründen');
select t_assert(t_error_of($$select set_username('Neu_Troll')$$) = 'banned', 'Gesperrt: kein neuer Name');
select t_assert(export_my_data() ->> 'exported_at' is not null, 'Daten exportieren geht auch gesperrt');
select t_login(:ADM);
select t_assert(admin_ban((select troll from t_names), 0, '') ->> 'banned_until' is null, 'Sperre aufgehoben');
select t_assert(jsonb_array_length(admin_search('mod_')) >= 2, 'Admin-Suche');

-- ---------- Filter-Wörter ----------
select t_assert(jsonb_array_length(admin_set_word('Lappen', true)) >= 1, 'Admin fügt Filter-Wort hinzu');
reset role;
select t_assert(public.zwip_clean_text('du Lappen') = 'du ******', 'Neues Wort wird gefiltert');
set role authenticated; select t_login(:ADM);
select admin_set_word('lappen', false);
reset role;
select t_assert(public.zwip_clean_text('du Lappen') = 'du Lappen', 'Deaktiviertes Wort wird nicht mehr gefiltert');

-- ---------- Anti-Cheat ----------
select t_assert((t_run_steps(:KID, 'wait', '[{"ok":true,"ms":900,"t":20},{"ok":false,"ms":500}]') ->> 'flagged')::boolean, 'Unmögliche Reaktionszeit wird nicht gewertet');
select t_assert(not exists (select 1 from public.minigame_bests where user_id = :KID and game_id = 'wait' and best_score > 0), 'Kein Highscore aus einem verdächtigen Lauf');
select t_assert((t_run_steps(:KID, 'wait', '[{"ok":true,"ms":900,"t":250},{"ok":false,"ms":500}]') ->> 'flagged')::boolean is false, 'Normaler Lauf zählt');
set role authenticated; select t_login(:ADM);
select t_assert((admin_overview() ->> 'open_runs')::int = 1, 'Admin sieht den verdächtigen Lauf');
select t_assert(admin_reports() -> 'runs' -> 0 ->> 'flagged' = 'hard:impossible_speed', 'Mit Grund');
select admin_resolve_run((admin_reports() -> 'runs' -> 0 ->> 'id')::uuid, false);
select t_assert((admin_overview() ->> 'open_runs')::int = 0, 'Lauf geprüft');

-- ---------- Konto löschen (Vorbereitung) ----------
reset role;
select t_assert(t_error_of($$set role authenticated; select public.zwip_prepare_delete('e2000000-0000-0000-0000-000000000002')$$) like 'permission denied%', 'Vorbereitung nur für den Server');
reset role;
set role authenticated; select t_login(:KID); select create_clan('Kinderclan', '🦊', '#22c36b', '', 'open');
select t_login(:ADM); select join_clan((search_clans('kinderclan') -> 0 ->> 'id')::uuid);
reset role;
select public.zwip_prepare_delete(:KID);
select t_assert((select role from public.clan_members where user_id = :ADM) = 'leader', 'Beim Löschen geht die Clan-Leitung an das nächste Mitglied');
select t_assert((select active from public.clan_members where user_id = :KID) is false, 'Gelöschtes Konto ist nicht mehr im Clan');

reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select accept_terms(20, false)$$) like 'permission denied%', 'Ohne Anmeldung nichts');
reset role;
\echo 'ALLE MODERATIONS-TESTS BESTANDEN'
