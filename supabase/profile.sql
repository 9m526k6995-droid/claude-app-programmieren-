-- ZWIP: Profil – Profilbild und öffentliches Spielerprofil (für Direktlinks)
-- Voraussetzung: profiles.sql und trophies.sql wurden bereits ausgeführt.
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen. Mehrfaches Ausführen ist unschädlich.
--
-- Das Profilbild wird von der App auf 256×256 Pixel verkleinert und als kleines JPEG
-- (meist 10–30 KB) direkt im Profil gespeichert. Dafür braucht es keinen extra Speicher-Bucket.
-- Ranglisten und Freundeslisten liefern das Bild bewusst NICHT mit, damit sie schnell bleiben.

-- =====================================================================
-- 1. Spalte für das Profilbild
-- =====================================================================

alter table public.profiles add column if not exists avatar text;

do $$ begin
  alter table public.profiles add constraint profiles_avatar_format
    check (avatar is null
           or (length(avatar) <= 150000
               and avatar ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$'));
exception when duplicate_object then null; end $$;

-- =====================================================================
-- 2. Funktionen für die App
-- =====================================================================

-- Eigenes Profil für das Profil-Popup (inkl. Bild und "Mitglied seit")
create or replace function public.get_my_profile_card()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); res jsonb;
begin
  select jsonb_build_object(
      'username', p.username, 'trophies', p.trophies, 'best_trophies', p.best_trophies,
      'league', p.league, 'trophy_rounds', p.trophy_rounds, 'best_streak', p.best_streak,
      'world_rank', r.world_rank, 'avatar', p.avatar, 'member_since', p.created_at)
    into res
  from public.profiles p
  left join public.zwip_ranked() r on r.id = p.id
  where p.id = me;
  return res;
end;
$$;

-- Profilbild setzen (null = entfernen)
create or replace function public.set_avatar(p_avatar text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); img text := nullif(btrim(coalesce(p_avatar, '')), '');
begin
  if img is not null and (length(img) > 150000
       or img !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$') then
    raise exception 'avatar_invalid' using errcode = 'P0001';
  end if;
  update public.profiles set avatar = img, updated_at = now() where id = me;
  return public.get_my_profile_card();
end;
$$;

-- Öffentliches Profil eines Spielers über den Namen (für Direktlinks und Profil-Popups).
-- Gibt nur öffentliche Angaben heraus – nie E-Mail oder Benutzer-ID.
create or replace function public.get_player_profile(p_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); target uuid; f public.friendships; rel text;
begin
  select id into target from public.profiles
    where username is not null and lower(username) = lower(btrim(coalesce(p_username, '')));
  if target is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;

  if target = me then
    rel := 'self';
  else
    select * into f from public.friendships
      where least(sender_id, receiver_id) = least(me, target)
        and greatest(sender_id, receiver_id) = greatest(me, target);
    rel := case
      when f.status = 'accepted' then 'friend'
      when f.status = 'pending' and f.sender_id = me then 'outgoing'
      when f.status = 'pending' then 'incoming'
      else 'none' end;
  end if;

  return public.zwip_player_json(target) || jsonb_build_object(
    'best_trophies', (select best_trophies from public.profiles where id = target),
    'avatar', (select avatar from public.profiles where id = target),
    'member_since', (select created_at from public.profiles where id = target),
    'relation', rel);
end;
$$;

-- =====================================================================
-- 3. Rechte: nur für Angemeldete
-- =====================================================================

revoke all on function public.get_my_profile_card() from public, anon;
revoke all on function public.set_avatar(text) from public, anon;
revoke all on function public.get_player_profile(text) from public, anon;

grant execute on function public.get_my_profile_card() to authenticated;
grant execute on function public.set_avatar(text) to authenticated;
grant execute on function public.get_player_profile(text) to authenticated;
