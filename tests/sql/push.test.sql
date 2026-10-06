-- Tests für supabase/push.sql (Abos, Ruhezeit, höchstens 2 am Tag)
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('b7000000-0000-0000-0000-000000000001', 'push1@test.de'),
  ('b7000000-0000-0000-0000-000000000002', 'push2@test.de');
\set P1 '''b7000000-0000-0000-0000-000000000001'''
\set P2 '''b7000000-0000-0000-0000-000000000002'''

-- Eine Zeitzone finden, in der es gerade zwischen 8 und 19 Uhr ist, und eine, in der gerade Nacht ist
reset role;
create temp table t_tz as
  select (select z from (select 'Etc/GMT' || case when o > 0 then '-' || o else '+' || (-o) end as z
                         from generate_series(-12, 14) o) x
          where extract(hour from now() at time zone z) between 8 and 19 limit 1) as day_tz,
         (select z from (select 'Etc/GMT' || case when o > 0 then '-' || o else '+' || (-o) end as z
                         from generate_series(-12, 14) o) x
          where extract(hour from now() at time zone z) not between 8 and 21 limit 1) as night_tz;
grant select on t_tz to authenticated;

insert into public.zwip_secrets (key, value) values ('vapid_public', 'BPUBLICKEY') on conflict (key) do update set value = excluded.value;

set role authenticated;
select t_login(:P1);
select t_assert(get_push_settings() ->> 'public_key' = 'BPUBLICKEY', 'App bekommt den öffentlichen Push-Schlüssel');
select t_assert(t_error_of($$select save_push_sub('http://unsicher', 'k', 'a', 'Europe/Berlin')$$) = 'invalid_push', 'Nur sichere Push-Adressen');
select t_assert((save_push_sub('https://push.example/1', 'key1', 'auth1', (select day_tz from t_tz),
                 extract(hour from now() at time zone (select day_tz from t_tz))::integer) ->> 'devices')::int = 1, 'Gerät für Push angemeldet');
select t_assert((save_push_sub('https://push.example/1', 'key1', 'auth1', (select day_tz from t_tz),
                 extract(hour from now() at time zone (select day_tz from t_tz))::integer) ->> 'devices')::int = 1, 'Gleiches Gerät nicht doppelt');
select t_login(:P2);
select save_push_sub('https://push.example/2', 'key2', 'auth2', (select night_tz from t_tz), 20);
select mark_daily_played(0, 0);

reset role;
select t_assert(t_error_of($$set role authenticated; select public.zwip_push_due()$$) like 'permission denied%', 'Fällige Pushes kann nur der Server abrufen');
reset role;
create temp table t_due as select * from public.zwip_push_due();
select t_assert((select count(*) from t_due) = 1, 'Genau eine Erinnerung fällig (zur Wunschzeit, tagsüber)');
select t_assert((select endpoint from t_due) = 'https://push.example/1', 'Nachts wird niemand geweckt (Ruhezeit 22–8 Uhr)');
select t_assert((select title from t_due) like '⚡ Daily #%', 'Text: Daily ist da');
select t_assert((select count(*) from public.zwip_push_due()) = 0, 'Gleiche Erinnerung nicht zweimal');

-- Wer heute schon gespielt hat, wird nicht erinnert
update public.push_subs set sent_day = null, sent_count = 0;
update public.profiles set last_daily_day = (now() at time zone (select day_tz from t_tz))::date - date '2026-09-30'
  where id = :P1;
select t_assert((select count(*) from public.zwip_push_due()) = 0, 'Schon gespielt → keine Erinnerung');

-- Höchstens 2 am Tag
update public.profiles set last_daily_day = null where id = :P1;
update public.push_subs set sent_day = (now() at time zone (select day_tz from t_tz))::date, sent_count = 2 where endpoint = 'https://push.example/1';
select t_assert((select count(*) from public.zwip_push_due()) = 0, 'Nie mehr als 2 Erinnerungen am Tag');

-- Streak-Text
update public.push_subs set sent_day = null, sent_count = 0;
update public.profiles set daily_streak = 5, last_daily_day = (now() at time zone (select day_tz from t_tz))::date - date '2026-09-30' - 1
  where id = :P1;
select t_assert((select title from public.zwip_push_due()) = '🔥 Deine 5-Tage-Streak!', 'Mit Streak: Streak-Erinnerung');

-- Abmelden und gelöschte Abos
set role authenticated; select t_login(:P1);
select t_assert((remove_push_sub(null) ->> 'devices')::int = 0, 'Push wieder ausschalten');
reset role;
select public.zwip_push_gone(array[(select id from public.push_subs where endpoint = 'https://push.example/2')]);
select t_assert((select count(*) from public.push_subs where active) = 0, 'Abgelaufene Abos werden abgeschaltet');

reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select get_push_settings()$$) like 'permission denied%', 'Ohne Anmeldung nichts');
reset role;
\echo 'ALLE PUSH-TESTS BESTANDEN'
