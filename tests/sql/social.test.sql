-- Tests für supabase/social.sql (Badges an der Tab-Leiste)
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'sa@test.de'),
  ('b2000000-0000-0000-0000-000000000002', 'sb@test.de'),
  ('b3000000-0000-0000-0000-000000000003', 'sc@test.de');
\set SA '''b1000000-0000-0000-0000-000000000001'''
\set SB '''b2000000-0000-0000-0000-000000000002'''
\set SC '''b3000000-0000-0000-0000-000000000003'''
-- Alle haben den Tab „vor langer Zeit“ zuletzt gesehen
update public.profiles set friends_seen_at = now() - interval '1 day' where id in (:SA, :SB, :SC);

set role authenticated;
select t_login(:SA); select set_username('Social_A');
select t_login(:SB); select set_username('Social_B');
select t_login(:SC); select set_username('Social_C');

select t_login(:SB);
select t_assert((get_badges() ->> 'friends')::int = 0, 'Ohne Anfragen kein Badge');
select t_login(:SA); select send_friend_request('Social_B');
select t_login(:SC); select send_friend_request('Social_B');
select t_login(:SB);
select t_assert((get_badges() ->> 'friend_requests')::int = 2 and (get_badges() ->> 'friends')::int = 2, 'Zwei neue Freundesanfragen → Badge 2');
select respond_friend_request('Social_A', true);
select t_login(:SA);
select t_assert((get_badges() ->> 'friends_accepted')::int = 1 and get_badges() -> 'accepted_names' ->> 0 = 'Social_B', 'Angenommene Anfrage erscheint beim Absender');
select mark_friends_seen();
select t_assert((get_badges() ->> 'friends')::int = 0, 'Nach dem Öffnen des Freunde-Tabs ist das Badge weg');
select t_login(:SB); select mark_friends_seen();
select t_assert((get_badges() ->> 'friends')::int = 0, 'Auch beim Empfänger verschwindet das Badge');
reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select get_badges()$$) like 'permission denied%', 'Ohne Anmeldung keine Badges');
reset role;
\echo 'ALLE SOCIAL-TESTS BESTANDEN'
