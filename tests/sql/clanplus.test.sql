-- Tests für supabase/clanplus.sql (Einladungslink, Clan-Ligen, Challenges nach Clan-Größe)
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'boss@test.de'),
  ('f2000000-0000-0000-0000-000000000002', 'gast@test.de'),
  ('f3000000-0000-0000-0000-000000000003', 'solo@test.de'),
  ('f4000000-0000-0000-0000-000000000004', 'fremd@test.de');
\set BOSS '''f1000000-0000-0000-0000-000000000001'''
\set GAST '''f2000000-0000-0000-0000-000000000002'''
\set SOLO '''f3000000-0000-0000-0000-000000000003'''
\set FREMD '''f4000000-0000-0000-0000-000000000004'''

set role authenticated;
select t_login(:BOSS); select set_username('Cp_Boss');
select create_clan('Link Crew', '🛡️', '#a45cff', '', 'invite');
select t_login(:GAST); select set_username('Cp_Gast');
select t_login(:SOLO); select set_username('Cp_Solo');
select create_clan('Solo Wolf', '🛡️', '#a45cff', '', 'open');
select t_login(:FREMD); select set_username('Cp_Fremd');

-- ---------- Einladungslink ----------
select t_assert(t_error_of($$select get_clan_invite()$$) = 'not_in_clan', 'Ohne Clan kein Einladungslink');
select t_login(:BOSS);
create temp table t_code as select get_clan_invite() ->> 'code' as c;
select t_assert((select c from t_code) ~ '^[A-HJKMNP-Z2-9]{8}$', 'Code hat 8 gut lesbare Zeichen');
select t_assert(get_clan_invite() ->> 'code' = (select c from t_code), 'Code bleibt gleich, bis er erneuert wird');
select t_assert((get_clan_invite() ->> 'can_reset')::boolean, 'Leiter darf den Link erneuern');

select t_login(:GAST);
select t_assert(clan_by_invite(lower((select c from t_code))) ->> 'name' = 'Link Crew', 'Vorschau zeigt den Clan (auch klein geschrieben)');
select t_assert(t_error_of($$select join_clan(( select id from public.zwip_clans where name = 'Link Crew'))$$) in ('invite_only', 'permission denied for view zwip_clans'),
  'Ohne Link kommt man in „Nur Einladung“-Clans nicht rein');
select t_assert(join_clan_by_invite((select c from t_code)) ->> 'status' = 'joined', 'Mit dem Link direkt beitreten (auch bei „Nur Einladung“)');
select t_assert((clan_by_invite((select c from t_code)) ->> 'in_this_clan')::boolean, 'Vorschau weiß, dass man schon drin ist');
select t_assert(t_error_of($$select join_clan_by_invite('ZZZZZZZZ')$$) = 'invite_invalid', 'Falscher Code wird abgelehnt');
select t_assert((get_clan_invite() ->> 'can_reset')::boolean is false, 'Mitglieder können den Link teilen, aber nicht erneuern');
select t_assert(t_error_of($$select reset_clan_invite()$$) = 'not_leader', 'Nur der Leiter erneuert den Link');

select t_login(:BOSS);
select reset_clan_invite();
select t_login(:FREMD);
select t_assert(t_error_of(format('select join_clan_by_invite(%L)', (select c from t_code))) = 'invite_invalid', 'Alter Link gilt nach dem Erneuern nicht mehr');
select t_login(:SOLO);
select t_assert(t_error_of(format('select join_clan_by_invite(%L)', (select get_clan_invite() ->> 'code'))) = 'already_in_clan', 'Wer schon in einem Clan ist, kann nicht per Link wechseln');

-- ---------- Clan-Ligen ----------
reset role;
-- Vorwoche: Link Crew 2 aktive Mitglieder mit je 10.000 XP → Silber; Solo Wolf 1 Mitglied mit 20.000 XP → Gold
insert into public.clan_xp_log (clan_id, user_id, xp, rounds, source, created_at)
select c.id, p.id, 10000, 5, 'minigame', date_trunc('week', now()) - interval '3 days'
from public.clans c, public.profiles p where c.name = 'Link Crew' and p.username in ('Cp_Boss', 'Cp_Gast');
insert into public.clan_xp_log (clan_id, user_id, xp, rounds, source, created_at)
select c.id, p.id, 20000, 5, 'minigame', date_trunc('week', now()) - interval '3 days'
from public.clans c, public.profiles p where c.name = 'Solo Wolf' and p.username = 'Cp_Solo';
-- Diese Woche: Link Crew 40.000 XP von einem Mitglied
insert into public.clan_xp_log (clan_id, user_id, xp, rounds, source)
select c.id, p.id, 40000, 3, 'minigame' from public.clans c, public.profiles p where c.name = 'Link Crew' and p.username = 'Cp_Boss';

set role authenticated;
select t_login(:BOSS);
select t_assert(get_clan_league() ->> 'league' = 'silver', 'Liga ergibt sich aus XP pro aktivem Mitglied der Vorwoche');
select t_assert((get_clan_league() ->> 'per_member')::bigint = 40000, 'Diese Woche: 40.000 XP pro aktivem Mitglied');
select t_assert(get_clan_league() ->> 'next_league' = 'platinum', 'Zeigt, in welche Liga es nächste Woche geht');
select t_assert(jsonb_array_length(get_clan_league() -> 'rows') >= 1 and (get_clan_league() -> 'rows' -> 0 ->> 'is_mine')::boolean, 'Tabelle der eigenen Liga');
select t_login(:SOLO);
select t_assert(get_clan_league() ->> 'league' = 'gold', 'Kleiner Clan mit viel Einsatz ist höher – fair für jede Größe');
select t_login(:FREMD);
select t_assert(t_error_of($$select get_clan_league()$$) = 'not_in_clan', 'Ohne Clan keine Liga');

-- ---------- Challenges nach Clan-Größe ----------
select t_login(:SOLO);
select t_assert((get_my_clan() -> 'challenges' -> 'items' -> 0 ->> 'goal')::bigint = 10000, 'Mini-Clan: kleines Punkteziel (10.000)');
select t_assert(get_my_clan() -> 'challenges' -> 'items' -> 5 ->> 'title' = 'Mindestens 1 Mitglied spielt diese Woche', 'Aktiv-Ziel passt zur Größe');
reset role;
update public.clans set member_count = 300 where name = 'Solo Wolf';
set role authenticated; select t_login(:SOLO);
select t_assert((get_my_clan() -> 'challenges' -> 'items' -> 0 ->> 'goal')::bigint = 10000, 'Ziele ändern sich nicht mitten in der Woche');
reset role;
update public.clan_week_size set week = week - 7 where clan_id = (select id from public.clans where name = 'Solo Wolf');
set role authenticated; select t_login(:SOLO);
select t_assert((get_my_clan() -> 'challenges' -> 'items' -> 0 ->> 'goal')::bigint = 600000, 'Großer Clan (300): großes Ziel (600.000)');
select t_assert(get_my_clan() -> 'challenges' -> 'items' -> 0 ->> 'title' = 'Sammelt zusammen 600.000 Punkte', 'Titel mit deutscher Zahl');
select t_assert(get_my_clan() -> 'challenges' -> 'items' -> 5 ->> 'title' = '180 Mitglieder spielen diese Woche', 'Aktiv-Ziel: 60 % der Mitglieder');
reset role;
update public.clans set member_count = 1 where name = 'Solo Wolf';

reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select clan_by_invite('ABCDEFGH')$$) like 'permission denied%', 'Ohne Anmeldung nichts');
reset role;
\echo 'ALLE CLAN-PLUS-TESTS BESTANDEN'
