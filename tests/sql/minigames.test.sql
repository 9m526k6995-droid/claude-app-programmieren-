-- Tests für supabase/minigames.sql (Stufen-Läufe und Ranglisten pro Minigame).
\set ON_ERROR_STOP 1
\set QUIET 1

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
create or replace function t_login(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
end $$;
grant execute on function t_assert(boolean, text), t_error_of(text), t_login(text) to authenticated, anon;

-- k geschaffte Stufen (+ optional ein Fehlversuch am Ende)
create or replace function t_steps(k integer, failed boolean default true) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from (
    select i, jsonb_build_object('ok', i <= k, 'ms', 700) as x
    from generate_series(1, k + case when failed then 1 else 0 end) i) s
$$;
grant execute on function t_steps(integer, boolean) to authenticated, anon;

-- Lauf starten und "zurückdatieren", als wäre er wirklich gespielt worden (nur als Admin möglich)
create or replace function t_run(uid text, game text, stage integer, total_ms integer, ago interval default '5 minutes')
returns jsonb language plpgsql security definer as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  r := public.start_minigame_run(game);
  update public.minigame_runs set started_at = now() - ago where id = (r ->> 'run_id')::uuid;
  return public.finish_minigame_run((r ->> 'run_id')::uuid, stage, total_ms, t_steps(stage));
end $$;

-- Aktive Läufe zurückdatieren (simuliert echte Spielzeit)
create or replace function t_backdate() returns void language sql security definer as $$
  update public.minigame_runs set started_at = now() - interval '10 minutes' where status = 'active'
$$;
grant execute on function t_backdate() to authenticated;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'mia@test.de'),
  ('a2000000-0000-0000-0000-000000000002', 'noah@test.de'),
  ('a3000000-0000-0000-0000-000000000003', 'ella@test.de'),
  ('a4000000-0000-0000-0000-000000000004', 'ohne@test.de');
\set MIA '''a1000000-0000-0000-0000-000000000001'''
\set NOAH '''a2000000-0000-0000-0000-000000000002'''
\set ELLA '''a3000000-0000-0000-0000-000000000003'''
\set OHNE '''a4000000-0000-0000-0000-000000000004'''

set role authenticated;
select t_login(:MIA); select set_username('Mia_MG');
select t_login(:NOAH); select set_username('Noah_MG');
select t_login(:ELLA); select set_username('Ella_MG');

-- ---------- Start ----------
select t_login(:MIA);
select t_assert(t_error_of($$select start_minigame_run('gibtsnicht')$$) = 'unknown_game', 'Unbekanntes Minigame wird abgelehnt');
select t_assert((start_minigame_run('memory') ->> 'seed')::int > 0, 'Lauf starten liefert einen Seed vom Server');
select t_assert(get_my_minigame_bests() = '[]'::jsonb, 'Noch keine Bestwerte');
select t_assert((select bool_and((start_minigame_run(g) ->> 'seed')::int > 0) from unnest(array['count','mole','spell','clock','big','shape','order','newone','cups','pair']) g),
  'Alle 10 Minigames der 3. Welle haben einen Lauf und eine Rangliste');
select t_assert((select bool_and((start_minigame_run(g) ->> 'seed')::int > 0) from unnest(array['blocks','dodge','stack','slice','ampel']) g),
  'Alle 5 neuen Minigames (Block-Lücke, Ausweichen, Stapelturm, Schnippeln, Rotes Licht) haben einen Lauf');
select start_minigame_run('memory');

-- Direkt beenden geht nicht (zu schnell für 5 Memory-Stufen)
select t_assert(
  t_error_of($$select finish_minigame_run((select id from public.minigame_runs where status = 'active' limit 1), 5, 4000, t_steps(5))$$) = 'run_too_fast',
  'Zu schnelle Läufe werden abgelehnt');

-- ---------- Rekord / kein Rekord ----------
reset role;
select t_assert((t_run(:MIA, 'memory', 6, 9000) ->> 'is_record')::boolean, 'Erster Lauf ist ein Rekord');
select t_assert((t_run(:MIA, 'memory', 4, 3000) ->> 'is_record')::boolean is false, 'Schlechterer Lauf ist kein Rekord');
select t_assert((t_run(:MIA, 'memory', 6, 8000) ->> 'is_record')::boolean, 'Gleiche Stufe, schneller = Rekord');
select t_assert((t_run(:MIA, 'memory', 6, 8500) ->> 'is_record')::boolean is false, 'Gleiche Stufe, langsamer = kein Rekord');
select t_assert((select best_stage || '/' || best_ms || '/' || plays from public.minigame_bests where game_id = 'memory' and user_id = :MIA) = '6/8000/4',
  'Bestwert 6 Stufen in 8000 ms, 4 Spiele gezählt');
select t_assert((t_run(:MIA, 'memory', 0, 0) ->> 'plays')::int = 5, 'Lauf ohne geschaffte Stufe zählt als Spiel');

-- ---------- Rangliste ----------
select t_run(:NOAH, 'memory', 9, 20000);
select t_run(:ELLA, 'memory', 6, 7000);
select t_run(:OHNE, 'memory', 12, 20000);  -- ohne Spielernamen: nicht in der Rangliste
set role authenticated;
select t_login(:MIA);
select t_assert(
  (select string_agg(x ->> 'username', ',' order by (x ->> 'rank')::int) from jsonb_array_elements(get_minigame_board('memory') -> 'top') x) = 'Noah_MG,Ella_MG,Mia_MG',
  'Rangliste: höhere Stufe zuerst, bei Gleichstand die kürzere Zeit');
select t_assert((get_minigame_board('memory') -> 'me' ->> 'rank')::int = 3, 'Eigener Rang stimmt');
select t_assert(get_minigame_board('memory') -> 'above' ->> 'username' = 'Ella_MG', 'Nachbar vor mir');
select t_assert(get_minigame_board('memory') -> 'below' = 'null'::jsonb or get_minigame_board('memory') -> 'below' is null, 'Niemand hinter mir');
select t_assert((get_minigame_board('memory') ->> 'total')::int = 3, 'Spieler ohne Namen zählen nicht mit');
select t_assert(((get_minigame_board('memory') -> 'top' -> 2) ->> 'is_me')::boolean, 'Eigener Eintrag ist markiert');
select t_assert(not ((get_minigame_board('memory') -> 'top' -> 0) ?| array['avatar', 'email', 'user_id', 'id']), 'Rangliste ohne Bild, E-Mail und IDs');
select t_assert(get_minigame_board('odd') -> 'top' = '[]'::jsonb, 'Ranglisten sind pro Spiel getrennt');
select t_assert(t_error_of($$select get_minigame_board('xyz')$$) = 'unknown_game', 'Unbekanntes Spiel in der Rangliste');

-- Gleichstand in Stufe UND Zeit: wer es früher geschafft hat, steht vorn
reset role;
select t_run(:NOAH, 'odd', 5, 3000);
select pg_sleep(0.01);
select t_run(:MIA, 'odd', 5, 3000);
set role authenticated; select t_login(:MIA);
select t_assert(get_minigame_board('odd') -> 'top' -> 0 ->> 'username' = 'Noah_MG', 'Kompletter Gleichstand: Wer früher dran war, gewinnt');

select t_assert(
  (select (x ->> 'best_stage')::int from jsonb_array_elements(get_my_minigame_bests()) x where x ->> 'game' = 'memory') = 6
  and (select (x ->> 'rank')::int from jsonb_array_elements(get_my_minigame_bests()) x where x ->> 'game' = 'memory') = 3,
  'Eigene Bestwerte mit Rang');

-- ---------- Betrugsversuche ----------
select t_login(:MIA);
select start_minigame_run('pop');
select t_backdate();
select t_assert(
  t_error_of($$select finish_minigame_run((select id from public.minigame_runs where status = 'active' and user_id = auth.uid()), 500, 1000, t_steps(500))$$) = 'invalid_stage',
  'Unmöglich hohe Stufe wird abgelehnt');
select t_assert(
  t_error_of($$select finish_minigame_run((select id from public.minigame_runs where status = 'active' and user_id = auth.uid()), 3, 1000, t_steps(5))$$) = 'invalid_steps',
  'Stufe passt nicht zu den Einzelschritten');
select t_assert(
  t_error_of($$select finish_minigame_run((select id from public.minigame_runs where status = 'active' and user_id = auth.uid()), 2, 1000, '[{"ok":true},{"ok":false},{"ok":false}]'::jsonb)$$) = 'invalid_steps',
  'Fehlversuch mitten im Lauf wird erkannt');
select t_assert(
  t_error_of($$select finish_minigame_run((select id from public.minigame_runs where status = 'active' and user_id = auth.uid()), 1, 99999999, t_steps(1))$$) = 'invalid_time',
  'Mehr Spielzeit als vergangene Zeit wird abgelehnt');
-- Fremder Lauf
reset role;
create temp table t_noah_run as select (r ->> 'run_id')::uuid as id from (select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000002', false), public.start_minigame_run('ink') as r) s;
grant select on t_noah_run to authenticated;
set role authenticated; select t_login(:MIA);
select t_assert(t_error_of($$select finish_minigame_run((select id from t_noah_run), 1, 100, t_steps(1))$$) = 'run_not_active', 'Fremde Läufe können nicht beendet werden');
-- Doppelt beenden
reset role;
create temp table t_done as select (t_run(:MIA, 'sum', 2, 2000) ->> 'stage') as s;
select t_assert((select count(*) from public.minigame_runs where game_id = 'sum' and status = 'finished') = 1, 'Lauf ist beendet');
set role authenticated; select t_login(:MIA);
select t_assert(t_error_of($$select finish_minigame_run((select id from public.minigame_runs where game_id = 'sum' and status = 'finished' limit 1), 3, 2000, t_steps(3))$$) = 'run_not_active', 'Doppelt beenden geht nicht');
-- Neuer Start bricht den alten Lauf ab
select start_minigame_run('pop');
select t_assert((select count(*) from public.minigame_runs where user_id = auth.uid() and status = 'active') = 1, 'Nur ein aktiver Lauf pro Spieler');

-- Direkt in Tabellen schreiben geht nicht
select t_assert(t_error_of($$update public.minigame_bests set best_stage = 200$$) like 'permission denied%', 'Bestwerte nicht direkt änderbar');
select t_assert(t_error_of($$insert into public.minigame_runs (user_id, game_id, seed) values (auth.uid(), 'odd', 1)$$) like 'permission denied%', 'Läufe nicht direkt anlegbar');

-- ---------- Ohne Anmeldung ----------
reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select get_minigame_board('memory')$$) like 'permission denied%', 'Ohne Anmeldung keine Minigame-Rangliste');
select t_assert(t_error_of($$select start_minigame_run('memory')$$) like 'permission denied%', 'Ohne Anmeldung kein Lauf');
reset role;

\echo 'ALLE MINIGAME-TESTS BESTANDEN'
