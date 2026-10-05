-- Tests für supabase/regions.sql (Land im Konto, regionale Ranglisten)
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'r1@test.de'),
  ('d2000000-0000-0000-0000-000000000002', 'r2@test.de'),
  ('d3000000-0000-0000-0000-000000000003', 'r3@test.de'),
  ('d4000000-0000-0000-0000-000000000004', 'r4@test.de');
\set R1 '''d1000000-0000-0000-0000-000000000001'''
\set R2 '''d2000000-0000-0000-0000-000000000002'''
\set R3 '''d3000000-0000-0000-0000-000000000003'''
\set R4 '''d4000000-0000-0000-0000-000000000004'''

set role authenticated;
select t_login(:R1); select set_username('Reg_Anna');
select t_login(:R2); select set_username('Reg_Ben');
select t_login(:R3); select set_username('Reg_Cleo');
select t_login(:R4); select set_username('Reg_Dirk');
reset role;
update public.profiles set trophies = 5000 where id = :R1;
update public.profiles set trophies = 7000 where id = :R2;
update public.profiles set trophies = 9000 where id = :R3;
update public.profiles set trophies = 8000 where id = :R4;

set role authenticated;
select t_login(:R1);
select t_assert(get_my_country() ->> 'country' is null and (get_my_country() ->> 'can_change')::boolean, 'Am Anfang kein Land, Wahl jederzeit möglich');
select t_assert(t_error_of($$select set_country('Deutschland')$$) = 'invalid_country', 'Nur Ländercodes erlaubt');
select t_assert(set_country('de') ->> 'country' = 'DE', 'Land gewählt (Groß/klein egal)');
select t_assert(set_country('AT') ->> 'country' = 'AT', 'In den ersten 15 Minuten darf man sich korrigieren');
select t_assert(set_country('DE') ->> 'country' = 'DE', 'Nochmal korrigiert');
reset role; update public.profiles set country_changed_at = now() - interval '1 day' where id = :R1; set role authenticated; select t_login(:R1);
select t_assert(t_error_of($$select set_country('NL')$$) = 'country_locked', 'Danach erst wieder in einem Monat');
select t_assert((get_my_country() ->> 'can_change')::boolean is false and get_my_country() ->> 'next_change_at' is not null, 'App sieht, ab wann es wieder geht');
select t_assert(set_country('DE') ->> 'country' = 'DE', 'Gleiches Land nochmal setzen ist kein Fehler');
reset role; update public.profiles set country_changed_at = now() - interval '32 days' where id = :R1; set role authenticated; select t_login(:R1);
select t_assert(set_country('DE') ->> 'country' = 'DE' and (get_my_country() ->> 'can_change')::boolean, 'Nach einem Monat wieder änderbar');

select t_login(:R2); select set_country('DE');
select t_login(:R3); select set_country('NL');
select t_login(:R4); select set_country('DE'); select set_country_hidden(true);

-- Trophäen nach Land
select t_login(:R1);
select t_assert(
  (select string_agg(x ->> 'username', ',' order by (x ->> 'rank')::int) from jsonb_array_elements(get_trophy_region_board('DE', 50) -> 'top') x) = 'Reg_Ben,Reg_Anna',
  'Deutschland-Rangliste: nur deutsche Spieler, verborgene nicht');
select t_assert((get_trophy_region_board('DE', 50) -> 'me' ->> 'rank')::int = 2, 'Eigener Platz im Land');
select t_assert((get_trophy_region_board('DE', 50) -> 'me' ->> 'world_rank')::int > 2, 'Weltrang wird mitgeliefert');
select t_assert(get_trophy_region_board('DE', 50) -> 'above' ->> 'username' = 'Reg_Ben', 'Nachbar vor mir im Land');
select t_assert((get_trophy_region_board('DE', 50) ->> 'total')::int = 2, 'Zahl der Spieler im Land');
select t_assert(get_trophy_region_board('NL', 50) -> 'top' -> 0 ->> 'username' = 'Reg_Cleo', 'Niederlande-Rangliste');
select t_assert(get_trophy_region_board('NL', 50) -> 'me' = 'null'::jsonb or get_trophy_region_board('NL', 50) -> 'me' is null, 'Im fremden Land kein eigener Platz');
select t_assert(get_trophy_region_board(null, 50) -> 'country' = 'null'::jsonb and (get_trophy_region_board(null, 50) ->> 'total')::int > 3, 'Ohne Land = weltweit');
select t_assert(t_error_of($$select get_trophy_region_board('XYZ', 10)$$) = 'invalid_country', 'Ungültiges Land');
select t_assert((select bool_or(x ->> 'username' = 'Reg_Dirk') from jsonb_array_elements(get_trophy_region_board(null, 200) -> 'top') x), 'Verborgene Spieler bleiben in der Weltrangliste');

-- Profile zeigen das Land (verborgenes nicht)
select t_assert(get_player_profile('Reg_Cleo') ->> 'country' = 'NL', 'Profil zeigt das Land');
select t_assert(get_player_profile('Reg_Dirk') ->> 'country' is null, 'Verborgenes Land bleibt verborgen');

-- Minigame-Rangliste nach Land
reset role;
insert into public.minigame_bests (user_id, game_id, best_stage, best_ms, plays, best_score) values
  (:R1, 'blocks', 3, 5000, 1, 375), (:R2, 'blocks', 5, 6000, 1, 750), (:R3, 'blocks', 9, 9000, 1, 1900);
set role authenticated; select t_login(:R1);
select t_assert(
  (select string_agg(x ->> 'username', ',' order by (x ->> 'rank')::int) from jsonb_array_elements(get_minigame_ranking('blocks', 'DE') -> 'rows') x) = 'Reg_Ben,Reg_Anna',
  'Minigame-Rangliste Deutschland');
select t_assert((get_minigame_ranking('blocks', 'de') ->> 'my_rank')::int = 2, 'Eigener Platz im Land (Groß/klein egal)');
select t_assert(get_minigame_ranking('blocks', 'world') -> 'rows' -> 0 ->> 'country' = 'NL', 'Flagge in der Weltrangliste');
select t_assert(t_error_of($$select get_minigame_ranking('blocks', 'mond')$$) = 'invalid_scope', 'Unbekannte Rangliste');

-- Ohne Anmeldung nichts
reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select set_country('DE')$$) like 'permission denied%', 'Ohne Anmeldung kein Land setzen');
select t_assert(t_error_of($$select get_trophy_region_board('DE', 10)$$) like 'permission denied%', 'Ohne Anmeldung keine Länder-Rangliste');
reset role;
\echo 'ALLE LÄNDER-TESTS BESTANDEN'
