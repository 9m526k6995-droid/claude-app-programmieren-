-- ZWIP: Benachrichtigungen (Badges an der Tab-Leiste)
-- Voraussetzung: profiles.sql und trophies.sql wurden bereits ausgeführt. Mehrfaches Ausführen ist unschädlich.
--
-- Freunde-Badge: neue Freundesanfragen + angenommene eigene Anfragen seit dem letzten Öffnen des Freunde-Tabs.

alter table public.profiles add column if not exists friends_seen_at timestamptz not null default now();

-- Zahlen für die Badges (später erweitert um Clan-Einladungen, Beitrittsanfragen und ungelesene Chat-Nachrichten)
create or replace function public.get_badges()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  seen timestamptz;
  incoming integer;
  accepted integer;
  accepted_names jsonb;
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select friends_seen_at into seen from public.profiles where id = me;
  seen := coalesce(seen, now());
  select count(*) into incoming from public.friendships
    where receiver_id = me and status = 'pending' and created_at > seen;
  select count(*), coalesce(jsonb_agg(p.username order by f.accepted_at desc) filter (where p.username is not null), '[]'::jsonb)
    into accepted, accepted_names
    from public.friendships f join public.profiles p on p.id = f.receiver_id
    where f.sender_id = me and f.status = 'accepted' and f.accepted_at > seen;
  return jsonb_build_object(
    'friends', incoming + accepted,
    'friend_requests', incoming,
    'friends_accepted', accepted,
    'accepted_names', accepted_names);
end;
$$;

-- Freunde-Tab geöffnet → Badge verschwindet
create or replace function public.mark_friends_seen()
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me();
begin
  update public.profiles set friends_seen_at = now() where id = me;
end;
$$;

revoke all on function public.get_badges() from public, anon;
revoke all on function public.mark_friends_seen() from public, anon;
grant execute on function public.get_badges() to authenticated;
grant execute on function public.mark_friends_seen() to authenticated;
