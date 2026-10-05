-- Tests für supabase/profile.sql (Profilbild und öffentliches Profil).
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

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-00000000000a', 'pia@test.de'),
  ('22222222-0000-0000-0000-00000000000b', 'tom@test.de'),
  ('33333333-0000-0000-0000-00000000000c', 'ole@test.de');
\set P '''11111111-0000-0000-0000-00000000000a'''
\set T '''22222222-0000-0000-0000-00000000000b'''
\set O '''33333333-0000-0000-0000-00000000000c'''

\set IMG '''data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='''

set role authenticated;

-- Eigenes Profil ohne Namen
select t_login(:P);
select t_assert(get_my_profile_card() ->> 'avatar' is null, 'Neues Profil hat noch kein Bild');
select t_assert(get_my_profile_card() ->> 'member_since' is not null, 'Profil kennt "Mitglied seit"');
select t_assert(get_my_profile_card() ->> 'username' is null, 'Profil-Karte geht auch ohne Spielernamen');

-- Profilbild
select t_assert(set_avatar(:IMG) ->> 'avatar' = :IMG, 'Profilbild wird gespeichert');
select t_assert(get_my_profile_card() ->> 'avatar' = :IMG, 'Profilbild kommt wieder zurück');
select t_assert(t_error_of($$select set_avatar('https://evil.example/x.png')$$) = 'avatar_invalid', 'Fremde Bild-URLs werden abgelehnt');
select t_assert(t_error_of($$select set_avatar('data:text/html;base64,PHNjcmlwdD4=')$$) = 'avatar_invalid', 'Nur echte Bildformate erlaubt');
select t_assert(t_error_of($$select set_avatar('data:image/jpeg;base64,' || repeat('A', 160000))$$) = 'avatar_invalid', 'Zu große Bilder werden abgelehnt');
select t_assert(t_error_of($$select set_avatar('data:image/jpeg;base64,AAA"><script>')$$) = 'avatar_invalid', 'Kein HTML im Bild-Feld möglich');
select t_assert(get_my_profile_card() ->> 'avatar' = :IMG, 'Abgelehnter Versuch ändert das Bild nicht');

-- Bild direkt in die Tabelle schreiben geht nicht
select t_assert(t_error_of($$update public.profiles set avatar = null$$) like 'permission denied%', 'Profil kann nicht direkt geändert werden');

-- Öffentliches Profil
select set_username('Pia_Profil');
select t_login(:T); select set_username('Tom_Profil');
select t_login(:O);
select t_assert(t_error_of($$select get_player_profile('gibtsnicht_123')$$) = 'player_not_found', 'Unbekannter Name → verständlicher Fehler');
select t_assert(get_player_profile('pia_profil') ->> 'username' = 'Pia_Profil', 'Profil-Link funktioniert ohne Groß-/Kleinschreibung');
select t_assert(get_player_profile('Pia_Profil') ->> 'avatar' = :IMG, 'Fremdes Profil zeigt das Profilbild');
select t_assert(get_player_profile('Pia_Profil') ->> 'relation' = 'none', 'Beziehung: noch nicht befreundet');
select t_assert(not (get_player_profile('Pia_Profil') ? 'email') and not (get_player_profile('Pia_Profil') ? 'id'), 'Öffentliches Profil verrät weder E-Mail noch ID');
select t_assert((get_player_profile('Pia_Profil') ->> 'world_rank') is not null, 'Öffentliches Profil zeigt den Weltrang');

select t_assert(t_error_of($$select send_friend_request('Pia_Profil')$$) = 'username_required', 'Ohne eigenen Namen keine Anfrage');
select set_username('Ole_Profil');
select send_friend_request('Pia_Profil');
select t_assert(get_player_profile('Pia_Profil') ->> 'relation' = 'outgoing', 'Beziehung: Anfrage gesendet');
select t_login(:P);
select t_assert(get_player_profile('Ole_Profil') ->> 'relation' = 'incoming', 'Beziehung: Anfrage erhalten');
select respond_friend_request('Ole_Profil', true);
select t_assert(get_player_profile('Ole_Profil') ->> 'relation' = 'friend', 'Beziehung: befreundet');
select t_assert(get_player_profile('Pia_Profil') ->> 'relation' = 'self', 'Eigenes Profil wird erkannt');

-- Bild entfernen
select t_assert(set_avatar(null) ->> 'avatar' is null, 'Profilbild entfernen');

-- Ranglisten bleiben schlank
select t_assert(not ((get_trophy_board() -> 'top' -> 0) ? 'avatar'), 'Rangliste liefert keine Bilder mit');

reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select get_player_profile('Pia_Profil')$$) like 'permission denied%', 'Ohne Anmeldung kein Zugriff auf Profile');
select t_assert(t_error_of($$select set_avatar(null)$$) like 'permission denied%', 'Ohne Anmeldung kein Profilbild');
reset role;

\echo 'ALLE PROFIL-TESTS BESTANDEN'
