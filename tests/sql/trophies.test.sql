-- Tests für supabase/trophies.sql. Läuft gegen eine echte Postgres-Datenbank (siehe tests/run-sql.sh).
\set ON_ERROR_STOP 1
\set QUIET 1

-- ---------- Test-Helfer ----------
create or replace function t_assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FEHLGESCHLAGEN: %', msg; end if;
  raise notice '✔ %', msg;
end $$;

create or replace function t_error_of(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlerrm;
end $$;

create or replace function t_tasks(n_ok integer, tier integer, n_wrong integer) returns jsonb language sql as $$
  select jsonb_agg(x order by i) from (
    select i, case when i <= n_ok then jsonb_build_object('game', 'odd', 'ok', true, 'tier', tier, 'ms', 500)
                   else jsonb_build_object('game', 'sum', 'ok', false, 'tier', 0, 'ms', 900) end as x
    from generate_series(1, n_ok + n_wrong) i) s
$$;

grant execute on function t_assert(boolean, text), t_error_of(text), t_tasks(integer, integer, integer) to authenticated, anon;

create or replace function t_login(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
end $$;
grant execute on function t_login(text) to authenticated, anon;

-- Runde starten und "zurückdatieren", als wäre sie gespielt worden (nur als Admin möglich)
create or replace function t_play(uid text, tasks jsonb) returns jsonb language plpgsql security definer as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  r := public.start_trophy_round();
  update public.trophy_rounds set started_at = now() - interval '45 seconds' where id = (r ->> 'round_id')::uuid;
  return public.finish_trophy_round((r ->> 'round_id')::uuid, tasks);
end $$;

-- ---------- Spieler anlegen ----------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'lena@test.de'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben@test.de'),
  ('cccccccc-0000-0000-0000-000000000003', 'cem@test.de'),
  ('dddddddd-0000-0000-0000-000000000004', 'dana@test.de'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'eli@test.de'),
  ('ffffffff-0000-0000-0000-000000000006', 'fynn@test.de');

\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''
\set D '''dddddddd-0000-0000-0000-000000000004'''
\set E '''eeeeeeee-0000-0000-0000-000000000005'''
\set F '''ffffffff-0000-0000-0000-000000000006'''

select t_assert((select count(*) from public.profiles) = 6, 'Profil entsteht automatisch bei Registrierung');

-- ---------- Spielername ----------
set role authenticated;
select t_login(:A);
select t_assert((get_my_trophy_profile() ->> 'trophies')::int = 0, 'Neues Profil startet mit 0 Trophäen');
select t_assert(t_error_of($$select set_username('ab')$$) = 'username_invalid', 'Zu kurzer Name wird abgelehnt');
select t_assert(t_error_of($$select set_username('Lena Müller')$$) = 'username_invalid', 'Leerzeichen/Umlaute im Namen werden abgelehnt');
select t_assert(set_username('Lena_1') ->> 'username' = 'Lena_1', 'Gültiger Spielername wird gespeichert');
select t_login(:B);
select t_assert(t_error_of($$select set_username('lena_1')$$) = 'username_taken', 'Vergebener Name (andere Schreibweise) wird abgelehnt');
select set_username('Ben');
select t_login(:C); select set_username('Cem');
select t_login(:D); select set_username('Dana');
select t_login(:E); select set_username('Eli');

-- ---------- Manipulation direkt an der Tabelle ----------
select t_login(:A);
select t_assert(t_error_of($$update public.profiles set trophies = 20000 where id = auth.uid()$$) like 'permission denied%',
                'Trophäen lassen sich NICHT direkt ändern');
select t_assert(t_error_of($$insert into public.trophy_rounds (user_id, seed, start_trophies) values (auth.uid(), 1, 0)$$) like 'permission denied%',
                'Runden lassen sich NICHT direkt anlegen');
select t_assert(t_error_of($$select public.zwip_ranked()$$) like 'permission denied%', 'Interne Hilfsfunktionen sind gesperrt');

-- ---------- Trophäen-Runden ----------
select t_login(:F);
select t_assert(t_error_of($$select start_trophy_round()$$) = 'username_required', 'Ohne Spielernamen kein Trophäen-Modus');

select t_login(:A);
select t_assert(t_error_of($$select finish_trophy_round((start_trophy_round() ->> 'round_id')::uuid, t_tasks(15, 2, 0))$$) = 'round_too_fast',
                'Sofort beendete Runde wird abgelehnt (Plausibilität)');
reset role;

-- 15 richtige, alle sehr schnell (Anfänger, kein Einsatz): 90 + 30 + Serienbonus 5+10+15 = 150
select t_assert((t_play(:A, t_tasks(15, 2, 0)) ->> 'delta')::int = 150, 'Perfekte Runde als Anfänger: +150 (Basis 90, Tempo 30, Serie 30)');
select t_assert((select trophies from public.profiles where id = :A) = 150, 'Trophäenstand gespeichert');
select t_assert((select best_streak from public.profiles where id = :A) = 15, 'Beste Serie gespeichert');
select t_assert((select trophy_rounds from public.profiles where id = :A) = 1, 'Anzahl Runden gezählt');

-- 12 richtig (schnell), 3 falsch: 72 + 12 + Serie(5,10) 15 − 30 = 69
select t_assert((t_play(:A, t_tasks(12, 1, 3)) ->> 'delta')::int = 69, '12 richtig / 3 falsch: +69');
select t_assert((t_play(:A, t_tasks(4, 0, 11)) ->> 'delta')::int = 24 - 110, 'Schlechte Runde kostet Trophäen (−86)');

-- Liga-Einsatz je nach Liga bei Rundenbeginn
update public.profiles set trophies = 6000, best_trophies = 6000 where id = :C;
select t_assert((t_play(:C, t_tasks(15, 2, 0)) ->> 'league_fee')::int = 30, 'Gold: Einsatz 30');
update public.profiles set trophies = 6000 where id = :C;
select t_assert((t_play(:C, t_tasks(15, 2, 0)) ->> 'delta')::int = 120, 'Gold, perfekte Runde: 150 − 30 = +120');
update public.profiles set trophies = 6000 where id = :C;
select t_assert((t_play(:C, t_tasks(12, 1, 3)) ->> 'delta')::int = 39, 'Gold, 12/15: 69 − 30 = +39');
update public.profiles set trophies = 6000 where id = :C;
select t_assert((t_play(:C, t_tasks(9, 0, 6)) ->> 'delta')::int = -31, 'Gold, 9/15: 54 + 5 − 60 − 30 = −31 (Minus!)');
-- Abstieg
update public.profiles set trophies = 5010 where id = :C;
select t_assert(t_play(:C, t_tasks(9, 0, 6)) ->> 'new_league' = 'silber', 'Abstieg Gold → Silber wird gemeldet');
-- Meister: nur 14/15 oder besser bringt Plus
update public.profiles set trophies = 17000 where id = :C;
select t_assert((t_play(:C, t_tasks(14, 1, 1)) ->> 'delta')::int = 13, 'Meister, 14/15: 103 − 90 = +13');
update public.profiles set trophies = 17000 where id = :C;
select t_assert((t_play(:C, t_tasks(13, 1, 2)) ->> 'delta')::int = -4, 'Meister, 13/15: 86 − 90 = −4');
-- Legende: nur (fast) perfekt reicht
update public.profiles set trophies = 20000, best_trophies = 20000 where id = :C;
select t_assert((t_play(:C, t_tasks(14, 1, 1)) ->> 'new_trophies')::int = 19988, 'Legende, 14/15 (schnell): 103 − 115 = −12');
update public.profiles set trophies = 0, best_trophies = 0 where id = :C;

do $$ declare r jsonb; begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  r := public.start_trophy_round();
  update public.trophy_rounds set started_at = now() - interval '45 seconds' where id = (r ->> 'round_id')::uuid;
  perform t_assert(t_error_of(format('select public.finish_trophy_round(%L, t_tasks(14, 0, 0))', r ->> 'round_id')) = 'invalid_tasks', 'Nicht genau 15 Aufgaben → abgelehnt');
  perform public.finish_trophy_round((r ->> 'round_id')::uuid, t_tasks(15, 0, 0));
  perform t_assert(t_error_of(format('select public.finish_trophy_round(%L, t_tasks(15, 2, 0))', r ->> 'round_id')) = 'round_not_active', 'Runde kann nur einmal gewertet werden');
end $$;

-- Untergrenze 0
select t_assert((t_play(:B, t_tasks(0, 0, 15)) ->> 'new_trophies')::int = 0, 'Trophäen fallen nie unter 0');
-- Obergrenze 20.000
update public.profiles set trophies = 19990, best_trophies = 19990 where id = :D;
select t_assert((t_play(:D, t_tasks(15, 2, 0)) ->> 'new_trophies')::int = 20000, 'Trophäen steigen nie über 20.000');
select t_assert((select league from public.profiles where id = :D) = 'legende', 'Liga LEGENDE bei 20.000');

-- Ligen-Grenzen
update public.profiles set trophies = 999 where id = :F;   select t_assert((select league from public.profiles where id = :F) = 'anfaenger', '999 = Anfänger');
update public.profiles set trophies = 1000 where id = :F;  select t_assert((select league from public.profiles where id = :F) = 'bronze', '1.000 = Bronze');
update public.profiles set trophies = 2500 where id = :F;  select t_assert((select league from public.profiles where id = :F) = 'silber', '2.500 = Silber');
update public.profiles set trophies = 5000 where id = :F;  select t_assert((select league from public.profiles where id = :F) = 'gold', '5.000 = Gold');
update public.profiles set trophies = 8000 where id = :F;  select t_assert((select league from public.profiles where id = :F) = 'platin', '8.000 = Platin');
update public.profiles set trophies = 12000 where id = :F; select t_assert((select league from public.profiles where id = :F) = 'diamant', '12.000 = Diamant');
update public.profiles set trophies = 16000 where id = :F; select t_assert((select league from public.profiles where id = :F) = 'meister', '16.000 = Meister');
select t_assert((t_error_of($$update public.profiles set trophies = 20001$$)) like '%profiles_trophies_range%', 'Datenbank selbst erlaubt keine Werte über 20.000');
update public.profiles set trophies = 0 where id = :F;

-- Liga-Aufstieg wird gemeldet
update public.profiles set trophies = 4900, best_trophies = 4900 where id = :E;
select t_assert(t_play(:E, t_tasks(15, 2, 0)) ->> 'new_league' = 'gold', 'Ergebnis meldet neue Liga (Silber → Gold)');

-- ---------- Weltrangliste ----------
update public.profiles set trophies = 15000, best_trophies = 15000, trophies_updated_at = now() - interval '5 days' where id = :A;
update public.profiles set trophies = 5000,  best_trophies = 5000,  trophies_updated_at = now() - interval '4 days' where id = :B;
update public.profiles set trophies = 17910, best_trophies = 17910, trophies_updated_at = now() - interval '3 days' where id = :C;
update public.profiles set trophies = 19850, best_trophies = 20000, trophies_updated_at = now() - interval '2 days' where id = :D;
update public.profiles set trophies = 5000,  best_trophies = 6000,  trophies_updated_at = now() - interval '1 day'  where id = :E;

set role authenticated;
select t_login(:B);
select t_assert(
  (select string_agg(x ->> 'username', ',' order by (x ->> 'rank')::int) from jsonb_array_elements(get_trophy_board() -> 'top') x)
    = 'Dana,Cem,Lena_1,Eli,Ben',
  'Rangliste nach Trophäen ABSTEIGEND: 19.850, 17.910, 15.000, 5.000 (Bestwert 6.000), 5.000');
select t_assert(
  (select (x ->> 'rank')::int from jsonb_array_elements(get_trophy_board() -> 'top') x where x ->> 'username' = 'Lena_1')
  < (select (x ->> 'rank')::int from jsonb_array_elements(get_trophy_board() -> 'top') x where x ->> 'username' = 'Ben'),
  'Spieler mit 15.000 Trophäen steht VOR Spieler mit 5.000');
select t_assert((get_trophy_board() -> 'top' -> 0 ->> 'trophies')::int = 19850, 'Platz 1 = meiste Trophäen');
select t_assert((get_trophy_board() -> 'me' ->> 'world_rank')::int = 5, 'Eigener Weltrang wird geliefert');
select t_assert(get_trophy_board() -> 'above' ->> 'username' = 'Eli', 'Spieler vor mir wird geliefert');
select t_assert((select bool_or((x ->> 'is_me')::boolean) from jsonb_array_elements(get_trophy_board() -> 'top') x), 'Eigener Eintrag ist markiert');
select t_assert(get_trophy_board()::text not like '%@%', 'Keine E-Mail-Adressen in der Rangliste');
select t_assert(jsonb_array_length(get_trophy_board(2) -> 'top') = 2, 'Nur Top-N werden geladen, eigener Rang trotzdem separat');
select t_assert((get_trophy_board(2) -> 'me' ->> 'world_rank')::int = 5, 'Eigener Rang auch außerhalb der Top-N');
select t_login(:F);
select t_assert(get_trophy_board() -> 'me' = 'null'::jsonb, 'Spieler ohne Namen stehen nicht in der Rangliste');
reset role;

-- Gleichstand: früher erreicht = vorne
update public.profiles set trophies = 5000, best_trophies = 6000, trophies_updated_at = now() - interval '10 days' where id = :B;
set role authenticated; select t_login(:A);
select t_assert(
  (select string_agg(x ->> 'username', ',' order by (x ->> 'rank')::int) from jsonb_array_elements(get_trophy_board() -> 'top') x where (x ->> 'trophies')::int = 5000)
    = 'Ben,Eli', 'Gleichstand: wer den Stand früher erreicht hat, steht vorne');

-- ---------- Freunde ----------
select t_login(:A);
select t_assert(t_error_of($$select send_friend_request('Lena_1')$$) = 'cannot_add_self', 'Man kann sich nicht selbst hinzufügen');
select t_assert(t_error_of($$select send_friend_request('gibtsnicht')$$) = 'player_not_found', 'Unbekannter Name → verständlicher Fehler');
select t_assert(send_friend_request('ben') ->> 'status' = 'pending', 'Anfrage senden (Groß-/Kleinschreibung egal)');
select t_assert(t_error_of($$select send_friend_request('Ben')$$) = 'request_already_sent', 'Doppelte Anfrage wird verhindert');
select t_assert(jsonb_array_length(get_friends() -> 'friends') = 0, 'Vor dem Annehmen noch keine Freundschaft');
select t_assert(get_friends() -> 'outgoing' -> 0 ->> 'username' = 'Ben', 'Gesendete Anfrage sichtbar');
select t_assert(t_error_of($$insert into public.friendships (sender_id, receiver_id) values (auth.uid(), 'cccccccc-0000-0000-0000-000000000003')$$) like 'permission denied%',
                'Freundschaften lassen sich nicht direkt in die Tabelle schreiben');

select t_login(:C);
select t_assert((select count(*) from public.friendships) = 0, 'Unbeteiligte sehen fremde Freundschaften nicht (RLS)');
select t_assert(t_error_of($$select respond_friend_request('Lena_1', true)$$) = 'request_not_found', 'Fremde Anfrage kann nicht angenommen werden');

select t_login(:B);
select t_assert((select count(*) from public.friendships) = 1, 'Beteiligte sehen ihre Anfrage');
select t_assert(get_friends() -> 'incoming' -> 0 ->> 'username' = 'Lena_1', 'Eingehende Anfrage sichtbar');
select t_assert(respond_friend_request('Lena_1', true) ->> 'status' = 'accepted', 'Anfrage annehmen');
select t_assert(t_error_of($$select send_friend_request('Lena_1')$$) = 'already_friends', 'Keine neue Anfrage zwischen Freunden');

-- Gegenseitige Anfrage → automatisch Freunde
select t_login(:C); select send_friend_request('Lena_1');
select t_login(:A);
select t_assert(send_friend_request('Cem') ->> 'status' = 'accepted', 'Gegenanfrage nimmt automatisch an');
select t_login(:D); select send_friend_request('Lena_1');
select t_login(:A); select respond_friend_request('Dana', true);

select t_assert(
  (select string_agg(x ->> 'username', ',' order by ord) from jsonb_array_elements(get_friends() -> 'friends') with ordinality as t(x, ord))
    = 'Dana,Cem,Ben', 'Freundesliste nach Trophäen absteigend');
select t_assert((get_friends() -> 'friends' -> 0 ? 'world_rank') and (get_friends() -> 'friends' -> 0 ? 'best_streak'),
                'Freunde mit Weltrang und Profil-Infos');
select t_assert(get_friends()::text not like '%@%', 'Keine E-Mail-Adressen in der Freundesliste');

-- Ablehnen und erneut anfragen
select t_login(:E); select send_friend_request('Lena_1');
select t_login(:A);
select t_assert(respond_friend_request('Eli', false) ->> 'status' = 'declined', 'Anfrage ablehnen');
select t_assert(jsonb_array_length(get_friends() -> 'incoming') = 0, 'Abgelehnte Anfrage verschwindet');
select t_login(:E);
select t_assert(send_friend_request('Lena_1') ->> 'status' = 'pending', 'Nach Ablehnung neue Anfrage möglich');

-- Suche
select t_login(:A);
select t_assert(
  (select string_agg(x ->> 'username' || ':' || (x ->> 'relation'), ',') from jsonb_array_elements(search_players('e')) x) is null,
  'Suche erst ab 2 Zeichen');
select t_assert(search_players('el') -> 0 ->> 'relation' = 'incoming', 'Suche zeigt Beziehung (offene Anfrage)');
select t_assert(search_players('le') = '[]'::jsonb, 'Suche findet sich selbst nicht');
select t_assert(search_players('be') -> 0 ->> 'relation' = 'friend', 'Suche zeigt Freunde als Freunde');

-- Entfernen
select t_assert(remove_friend('Ben') ->> 'removed' = 'true', 'Freund entfernen');
select t_assert(t_error_of($$select remove_friend('Ben')$$) = 'not_friends', 'Nicht befreundet → verständlicher Fehler');
select t_assert(jsonb_array_length(get_friends() -> 'friends') = 2, 'Freund ist weg');

-- Nicht angemeldet
reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select get_trophy_board()$$) like 'permission denied%', 'Ohne Anmeldung kein Zugriff auf die Rangliste');
select t_assert(t_error_of($$select get_friends()$$) like 'permission denied%', 'Ohne Anmeldung kein Zugriff auf Freunde');
reset role;

\echo 'ALLE SQL-TESTS BESTANDEN'
