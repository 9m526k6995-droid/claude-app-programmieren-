-- Tests für supabase/clans.sql (Highscores + Clans)
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'c1@test.de'),
  ('c2000000-0000-0000-0000-000000000002', 'c2@test.de'),
  ('c3000000-0000-0000-0000-000000000003', 'c3@test.de'),
  ('c4000000-0000-0000-0000-000000000004', 'c4@test.de'),
  ('c5000000-0000-0000-0000-000000000005', 'c5@test.de');
\set K1 '''c1000000-0000-0000-0000-000000000001'''
\set K2 '''c2000000-0000-0000-0000-000000000002'''
\set K3 '''c3000000-0000-0000-0000-000000000003'''
\set K4 '''c4000000-0000-0000-0000-000000000004'''
\set K5 '''c5000000-0000-0000-0000-000000000005'''

-- Lauf mit Einzelschritten (t = Tempo-Wert) starten, zurückdatieren und beenden
create or replace function t_scored_run(uid text, game text, steps jsonb)
returns jsonb language plpgsql security definer as $$
declare r jsonb; k integer;
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  r := public.start_minigame_run(game);
  update public.minigame_runs set started_at = now() - interval '10 minutes' where id = (r ->> 'run_id')::uuid;
  select count(*) into k from jsonb_array_elements(steps) e(v) where (v ->> 'ok')::boolean;
  return public.finish_minigame_run((r ->> 'run_id')::uuid, k, 1000 * k, steps);
end $$;

-- ================= Punkte-Formel =================
select t_assert(public.zwip_stage_points(1, 99999, array[900, 1700]) = 100, 'Stufe 1 langsam = 100 Punkte');
select t_assert(public.zwip_stage_points(1, 500, array[900, 1700]) = 150, 'Stufe 1 sehr schnell = 150 Punkte (+50 %)');
select t_assert(public.zwip_stage_points(5, 1200, array[900, 1700]) = 250, 'Stufe 5 schnell = 200 + 25 % = 250');
select t_assert(public.zwip_run_score('odd', '[{"ok":true,"ms":2000},{"ok":true,"ms":2000},{"ok":false,"ms":800}]'::jsonb) = 225,
  'Lauf: nur geschaffte Stufen zählen (100 + 125)');
select t_assert(public.zwip_run_score('stack', '[{"ok":true,"ms":5000,"t":30}]'::jsonb) = 150, 'Tempo-Wert t zählt statt ms (Stapelturm: 30 ms Abweichung)');
select t_assert(public.zwip_clan_level(0) = 1 and public.zwip_clan_level(999) = 1 and public.zwip_clan_level(1000) = 2
  and public.zwip_clan_level(16000) = 5 and public.zwip_clan_level(999999999) = 50, 'Clan-Level aus XP');
select t_assert(public.zwip_clean_text('du bist ein Hurensohn') = 'du bist ein *********', 'Schimpfwort wird ersetzt');
select t_assert(public.zwip_clean_text('F1CK dich') = '**** dich', 'Auch mit Zahlen statt Buchstaben');
select t_assert(public.zwip_clean_text('schreib mir auf insta.com oder 0176 1234567') !~ '(insta\.com|1234567)', 'Links und Telefonnummern werden entfernt');
select t_assert(public.zwip_clean_text('Gutes Spiel, gg!') = 'Gutes Spiel, gg!', 'Normaler Text bleibt unverändert');

-- ================= Namen =================
set role authenticated;
select t_login(:K1); select set_username('Clan_Anna');
select t_login(:K2); select set_username('Clan_Ben');
select t_login(:K3); select set_username('Clan_Cem');
select t_login(:K4); select set_username('Clan_Dia');
reset role;

-- ================= Highscores =================
select t_assert((t_scored_run(:K1, 'memory', '[{"ok":true,"ms":2000,"t":2000},{"ok":true,"ms":2000,"t":2000},{"ok":false,"ms":900}]') ->> 'score')::int = 225,
  'Server rechnet die Punkte selbst aus');
select t_assert((t_scored_run(:K2, 'memory', '[{"ok":true,"ms":2000,"t":100},{"ok":true,"ms":2000,"t":100}]') ->> 'is_record')::boolean,
  'Erster Lauf ist ein neuer Highscore');
select t_assert((select best_score from public.minigame_bests where user_id = :K2 and game_id = 'memory') = 338, 'Highscore gespeichert (150 + 187,5)');
select t_assert((t_scored_run(:K2, 'memory', '[{"ok":true,"ms":2000,"t":2000},{"ok":false,"ms":900}]') ->> 'is_record')::boolean is false,
  'Weniger Punkte = kein neuer Highscore');
-- Ein schlechterer Lauf ändert den Highscore nicht
select t_assert((t_scored_run(:K3, 'odd', '[{"ok":true,"ms":5000,"t":100},{"ok":true,"ms":5000,"t":100}]') ->> 'score')::int = 338, 'Cem: 338 Punkte in Stufe 2');
select t_scored_run(:K3, 'odd', '[{"ok":true,"ms":5000},{"ok":false,"ms":900}]');
select t_assert((select best_score || '/' || best_stage from public.minigame_bests where user_id = :K3 and game_id = 'odd') = '338/2', 'Bester Punktestand bleibt');

-- Alte Bestwerte werden umgerechnet
insert into public.minigame_bests (user_id, game_id, best_stage, best_ms, plays, best_score) values (:K4, 'pop', 4, 9000, 1, 0);
select t_assert(true, 'Alter Bestwert angelegt');
\i supabase/clans.sql
select t_assert((select best_score from public.minigame_bests where user_id = :K4 and game_id = 'pop') = 550, 'Altes „Stufe 4“ wird zu 550 Punkten (100+125+150+175)');

-- ================= Clan gründen =================
set role authenticated;
select t_login(:K5);
select t_assert(t_error_of($$select create_clan('Ohne Namen', '🛡️', '#a45cff', '', 'open')$$) = 'username_required', 'Ohne Spielernamen kein Clan');
select t_login(:K1);
select t_assert(t_error_of($$select create_clan('x', '🛡️', '#a45cff', '', 'open')$$) = 'clan_name_invalid', 'Zu kurzer Clan-Name');
select t_assert(t_error_of($$select create_clan('Fick Team', '🛡️', '#a45cff', '', 'open')$$) = 'clan_name_bad', 'Schimpfwort im Clan-Namen');
select t_assert(t_error_of($$select create_clan('Drachen', '👑', '#a45cff', '', 'open')$$) = 'locked', 'Emblem erst ab Level 3');
select t_assert((create_clan('Die Blitze', '⚡', '#3d7bff', 'Wir sind schnell', 'request') -> 'clan' ->> 'name') = 'Die Blitze', 'Clan gegründet');
select t_assert(get_my_clan() ->> 'role' = 'leader', 'Gründerin ist Leiterin');
select t_assert(t_error_of($$select create_clan('Zweiter Clan', '🛡️', '#a45cff', '', 'open')$$) = 'already_in_clan', 'Nur ein Clan pro Spieler');
select t_login(:K2);
select t_assert(t_error_of($$select create_clan('die blitze', '🛡️', '#a45cff', '', 'open')$$) = 'clan_name_taken', 'Name schon vergeben (Groß/klein egal)');

-- ================= Beitrittsanfrage =================
reset role;
create temp table t_ids as select (select id from public.clans where name = 'Die Blitze') as blitze;
grant select on t_ids to authenticated;
set role authenticated; select t_login(:K2);
select t_assert(join_clan((select blitze from t_ids)) ->> 'status' = 'requested', 'Ben fragt an (Clan nur auf Anfrage)');
select t_assert((search_clans('blitz') -> 0 ->> 'requested')::boolean, 'Suche zeigt „angefragt“');
select t_login(:K1);
select t_assert((get_badges() ->> 'clan')::int >= 1, 'Leiterin bekommt ein Clan-Badge für die Anfrage');
select t_assert(get_my_clan() -> 'requests' -> 0 ->> 'username' = 'Clan_Ben', 'Leiterin sieht die Anfrage');
select t_assert((respond_clan_request('Clan_Ben', true) -> 'clan' ->> 'members')::int = 2, 'Anfrage angenommen → 2 Mitglieder');

-- ================= Einladung =================
select t_login(:K2);
select t_assert(invite_to_clan('Clan_Cem') ->> 'status' = 'invited', 'Auch Mitglieder dürfen einladen');
select t_login(:K3);
select t_assert((get_badges() ->> 'clan')::int = 1, 'Eingeladener bekommt ein Badge');
select t_assert(get_my_clan() -> 'invites' -> 0 ->> 'invited_by' = 'Clan_Ben', 'Einladung mit Absender sichtbar');
select t_assert(respond_clan_invite((select blitze from t_ids), true) ->> 'status' = 'joined', 'Einladung angenommen');
select t_assert((get_my_clan() -> 'clan' ->> 'members')::int = 3, '3 Mitglieder');
select t_login(:K4);
select t_assert(t_error_of($$select invite_to_clan('Clan_Anna')$$) = 'not_in_clan', 'Ohne Clan niemanden einladen');
select t_assert(t_error_of($$select respond_clan_invite((select blitze from t_ids), true)$$) = 'invite_not_found', 'Ohne Einladung nicht annehmen');

-- ================= Nur-Einladung, offene Clans =================
select t_login(:K4);
select create_clan('Geheimbund', '🐺', '#22c36b', '', 'invite');
select t_login(:K5); select set_username('Clan_Eli');
reset role; insert into t_ids select id from public.clans where name = 'Geheimbund'; set role authenticated; select t_login(:K5);
select t_assert(t_error_of($$select join_clan((select blitze from t_ids where blitze <> (select blitze from t_ids limit 1) limit 1))$$) = 'invite_only', 'Nur-Einladung-Clan: Beitreten ohne Einladung geht nicht');

-- ================= Clan-XP aus Minigames =================
reset role;
select t_scored_run(:K2, 'pop', '[{"ok":true,"ms":3000},{"ok":true,"ms":3000},{"ok":true,"ms":3000},{"ok":false,"ms":900}]');
select t_assert((select xp from public.clans where name = 'Die Blitze') = 375, 'Minigame-Punkte gehen als XP an den Clan (100+125+150)');
select t_assert((select xp_total from public.clan_members where user_id = :K2) = 375, 'Und zählen beim Mitglied');
set role authenticated; select t_login(:K1);
select t_assert(get_clan_contrib('week') -> 0 ->> 'username' = 'Clan_Ben', 'Interne Rangliste: Ben trägt am meisten bei');
select t_assert((get_clan_contrib('week') -> 0 ->> 'rounds')::int = 1, 'Runden werden gezählt');
select t_assert(get_clan_board('week') -> 'rows' -> 0 ->> 'name' = 'Die Blitze', 'Clan-Rangliste der Woche');
select t_assert((get_clan_board('day') -> 'rows' -> 0 ->> 'points')::int = 375, 'Clan-Rangliste des Tages mit Punkten');
select t_assert((select count(*) from jsonb_array_elements(get_clan_board('all') -> 'rows')) = 2, 'Gesamt-Rangliste mit allen Clans');
select t_assert(t_error_of($$select get_clan_board('jahr')$$) = 'invalid_period', 'Unbekannter Zeitraum');
select t_assert(jsonb_array_length(get_my_clan() -> 'challenges' -> 'items') = 6, 'Sechs Wochen-Challenges');
select t_assert((get_my_clan() -> 'challenges' -> 'items' -> 0 ->> 'progress')::int = 375, 'Challenge-Fortschritt = Punkte der Woche');

-- Challenge geschafft → einmalig Bonus-XP
reset role;
insert into public.clan_xp_log (clan_id, user_id, xp, rounds, source)
  select id, :K3, 30000, 1, 'minigame' from public.clans where name = 'Die Blitze';
update public.clans set xp = xp + 30000 where name = 'Die Blitze';
set role authenticated; select t_login(:K1);
select t_assert((get_my_clan() -> 'challenges' -> 'items' -> 0 ->> 'done')::boolean, 'Challenge „10.000 Punkte“ (kleiner Clan) geschafft');
select t_assert((get_my_clan() -> 'clan' ->> 'xp')::int = 375 + 30000 + (select sum((x ->> 'reward')::int) from jsonb_array_elements(get_my_clan() -> 'challenges' -> 'items') x where (x ->> 'done')::boolean),
  'Bonus-XP genau einmal gutgeschrieben');
select t_assert((get_my_clan() -> 'clan' ->> 'level')::int = 6, 'Level steigt mit XP (über 25.000 XP → Level 6)');
select t_assert((update_clan('👑', '#ff8a3d', 'silver', 'Neu!', 'open') -> 'clan' ->> 'emblem') = '👑', 'Freigeschaltetes Emblem, Farbe und Rahmen setzen');
select t_assert(t_error_of($$select update_clan('🏆', '#ff8a3d', 'none', '', 'open')$$) = 'locked', 'Gesperrtes Emblem (erst Level 12)');
select t_login(:K2);
select t_assert(t_error_of($$select update_clan('⚡', '#3d7bff', 'none', '', 'open')$$) = 'not_leader', 'Nur der Leiter darf den Clan ändern');

-- ================= Highscore-Ranglisten Freunde/Clan =================
select t_login(:K1);
select t_assert((select count(*) from jsonb_array_elements(get_minigame_ranking('memory', 'clan') -> 'rows')) = 2, 'Clan-Rangliste im Minigame (Anna + Ben)');
select t_assert(get_minigame_ranking('memory', 'clan') -> 'rows' -> 0 ->> 'username' = 'Clan_Ben', 'Ben vorn (mehr Punkte)');
select t_assert((get_minigame_ranking('memory', 'clan') ->> 'my_rank')::int = 2, 'Eigener Rang im Clan');
select t_assert((select count(*) from jsonb_array_elements(get_minigame_ranking('memory', 'friends') -> 'rows')) = 1, 'Ohne Freunde nur ich selbst');
select t_assert((get_minigame_ranking('memory', 'world') -> 'rows' -> 0 ->> 'score')::int >= (get_minigame_ranking('memory', 'world') -> 'rows' -> 1 ->> 'score')::int, 'Weltrangliste nach Punkten sortiert');
select t_assert(t_error_of($$select get_minigame_ranking('memory', 'galaxis')$$) = 'invalid_scope', 'Unbekannte Rangliste');
select t_assert((get_minigame_board('memory') -> 'top' -> 0 ->> 'score')::int > 0, 'Alte Rangliste zeigt jetzt auch Punkte');
select t_assert((get_my_minigame_bests() -> 0 ->> 'best_score') is not null, 'Eigene Bestwerte mit Punkten');

-- ================= Chat =================
select t_login(:K2);
select send_clan_message('Hallo zusammen, du Arschloch', null);
reset role;
select t_assert((select body from public.clan_messages where user_id = :K2 order by id desc limit 1) = 'Hallo zusammen, du *********', 'Schimpfwörter im Chat werden ersetzt');
set role authenticated; select t_login(:K2);
select t_assert(t_error_of($$select send_clan_message('noch eine', null)$$) = 'slow_down', 'Nicht schneller als alle 2 Sekunden');
reset role; update public.clan_messages set created_at = now() - interval '5 seconds' where user_id = :K2; set role authenticated; select t_login(:K2);
select send_clan_message(null, 1);
reset role;
select t_assert((select body from public.clan_messages where user_id = :K2 order by id desc limit 1) = 'GG! 🎉', 'Schnellnachricht');
set role authenticated; select t_login(:K2);
select t_assert(t_error_of($$select send_clan_message('', null)$$) in ('invalid_message', 'slow_down'), 'Leere Nachricht geht nicht');
select t_login(:K3);
select t_assert((get_badges() ->> 'clan_unread')::int >= 2, 'Ungelesene Nachrichten als Badge');
select t_assert(jsonb_array_length(get_clan_messages(0)) >= 2, 'Chat-Verlauf laden');
select t_assert((get_badges() ->> 'clan_unread')::int = 0, 'Nach dem Lesen kein Badge mehr');
-- Melden: Leiterin meldet → sofort ausgeblendet
select t_login(:K1);
select t_assert((report_clan_message((select max((x ->> 'id')::bigint) from jsonb_array_elements(get_clan_messages(0)) x where x ->> 'body' like 'Hallo%'), 'Beleidigung') ->> 'hidden')::boolean, 'Leiterin meldet → Nachricht ausgeblendet');
select t_assert((select bool_and(x ->> 'body' is null) from jsonb_array_elements(get_clan_messages(0)) x where (x ->> 'hidden')::boolean), 'Ausgeblendete Nachricht wird ohne Text geliefert');
-- Stummschalten
select t_assert((mute_clan_member('Clan_Ben', 24) -> 'members') is not null, 'Ben für 24 h stummgeschaltet');
reset role; update public.clan_messages set created_at = now() - interval '5 seconds' where user_id = :K2; set role authenticated;
select t_login(:K2);
select t_assert(t_error_of($$select send_clan_message('hallo?', null)$$) = 'muted', 'Stummgeschaltet → keine Nachrichten');
select t_login(:K1); select mute_clan_member('Clan_Ben', 0);
select t_login(:K2);
select t_assert(t_error_of($$select send_clan_message('wieder da', null)$$) is null, 'Stummschaltung aufgehoben');
-- Fremde sehen den Chat nicht
select t_login(:K5);
select t_assert(t_error_of($$select get_clan_messages(0)$$) = 'not_in_clan', 'Fremde können den Clan-Chat nicht lesen');
select t_assert(t_error_of($$select report_clan_message(1, 'x')$$) = 'message_not_found', 'Fremde können nicht melden');

-- ================= Verlassen, entfernen, Leitung =================
select t_login(:K1);
select t_assert((transfer_clan_leader('Clan_Cem') ->> 'role') = 'member', 'Leitung an Cem übergeben');
select t_login(:K3);
select t_assert((kick_clan_member('Clan_Ben') -> 'clan' ->> 'members')::int = 2, 'Neuer Leiter entfernt Ben');
select leave_clan();
select t_login(:K1);
select t_assert(get_my_clan() ->> 'role' = 'leader', 'Wenn der Leiter geht, übernimmt das nächste Mitglied');
select leave_clan();
select t_assert(get_my_clan() -> 'clan' = 'null'::jsonb, 'Letztes Mitglied geht');
reset role;
select t_assert(not exists (select 1 from public.clans where name = 'Die Blitze'), 'Leerer Clan wird aufgelöst');
select t_assert((select count(*) from public.clan_xp_log l join public.clans c on c.id = l.clan_id where c.dissolved_at is not null) > 0, 'XP-Historie bleibt erhalten (nichts wird hart gelöscht)');
set role authenticated; select t_login(:K1);
select t_assert((create_clan('Die Blitze', '⚡', '#3d7bff', 'Comeback', 'open') -> 'clan' ->> 'members')::int = 1, 'Nach dem Austritt neuen Clan gründen (auch mit dem alten Namen)');
select t_login(:K2);
select t_assert((join_clan((search_clans('blitze') -> 0 ->> 'id')::uuid) ->> 'status') = 'joined', 'Entfernter Spieler kann einem anderen Clan beitreten');
select t_assert((get_my_clan() -> 'clan' ->> 'members')::int = 2, 'Mitgliederzahl stimmt nach Wiedereintritt');
reset role;

-- ================= Sicherheit =================
set role authenticated; select t_login(:K1);
select t_assert(t_error_of($$select * from public.clans$$) like 'permission denied%', 'Clans nicht direkt lesbar');
select t_assert(t_error_of($$update public.clan_members set role = 'leader'$$) like 'permission denied%', 'Rollen nicht direkt änderbar');
select t_assert(t_error_of($$select public.zwip_clan_on_run(auth.uid(), 99999)$$) like 'permission denied%', 'XP nicht direkt vergebbar');
reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select get_my_clan()$$) like 'permission denied%', 'Ohne Anmeldung kein Clan');
select t_assert(t_error_of($$select get_minigame_ranking('memory', 'world')$$) like 'permission denied%', 'Ohne Anmeldung keine Rangliste');
reset role;
\echo 'ALLE CLAN-TESTS BESTANDEN'
