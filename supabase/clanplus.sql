-- ZWIP: Clan-Einladungslink und Clan-Ligen (fair nach XP pro aktivem Mitglied).
-- Muss nach clans.sql und moderation.sql laufen. Kann gefahrlos mehrfach ausgeführt werden.

-- ---------------------------------------------------------------------
-- 1. Einladungslink: ?clan=CODE
-- ---------------------------------------------------------------------
alter table public.clans add column if not exists invite_code text;
create unique index if not exists clans_invite_code_unique on public.clans (invite_code) where invite_code is not null;

-- 8 Zeichen ohne verwechselbare Zeichen (kein 0/O, 1/I/L)
create or replace function public.zwip_new_invite_code()
returns text
language plpgsql volatile set search_path = ''
as $$
declare abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text;
begin
  loop
    c := '';
    for i in 1..8 loop
      c := c || substr(abc, 1 + floor(random() * length(abc))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.clans where invite_code = c);
  end loop;
  return c;
end;
$$;

-- Jedes Mitglied kann den Link teilen
create or replace function public.get_clan_invite()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members; code text;
begin
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  select invite_code into code from public.clans where id = m.clan_id;
  if code is null then
    code := public.zwip_new_invite_code();
    update public.clans set invite_code = code where id = m.clan_id and invite_code is null;
    select invite_code into code from public.clans where id = m.clan_id;
  end if;
  return jsonb_build_object('code', code, 'can_reset', m.role = 'leader');
end;
$$;

-- Leiter: neuer Link, der alte gilt nicht mehr
create or replace function public.reset_clan_invite()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); m public.clan_members;
begin
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  if m.role <> 'leader' then raise exception 'not_leader' using errcode = 'P0001'; end if;
  update public.clans set invite_code = public.zwip_new_invite_code() where id = m.clan_id;
  return public.get_clan_invite();
end;
$$;

-- Vorschau: Welcher Clan steckt hinter dem Code?
create or replace function public.clan_by_invite(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare cid uuid;
begin
  perform public.zwip_me();
  select id into cid from public.zwip_clans where invite_code = upper(btrim(coalesce(p_code, '')));
  if cid is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;
  return public.zwip_clan_json(cid) || jsonb_build_object(
    'in_this_clan', exists (select 1 from public.zwip_cm where user_id = auth.uid() and clan_id = cid),
    'in_a_clan', exists (select 1 from public.zwip_cm where user_id = auth.uid()));
end;
$$;

-- Beitreten per Link: wirkt wie eine Einladung (auch bei „Nur Einladung“)
create or replace function public.join_clan_by_invite(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me uuid := public.zwip_me(); c public.clans;
begin
  perform public.zwip_check_ban(me);
  perform public.zwip_need_name(me);
  select * into c from public.zwip_clans where invite_code = upper(btrim(coalesce(p_code, '')));
  if c.id is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;
  if exists (select 1 from public.zwip_cm where user_id = me) then raise exception 'already_in_clan' using errcode = 'P0001'; end if;
  if c.member_count >= public.zwip_clan_max() then raise exception 'clan_full' using errcode = 'P0001'; end if;
  perform public.zwip_add_member(c.id, me, 'member');
  return jsonb_build_object('status', 'joined', 'clan_id', c.id);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Clan-Ligen
-- Maßstab: XP pro aktivem Mitglied in der Woche – so haben kleine und große Clans die gleiche Chance.
-- Die Liga dieser Woche ergibt sich aus der Vorwoche; was ihr diese Woche schafft, entscheidet über nächste Woche.
-- ---------------------------------------------------------------------
create or replace function public.zwip_clan_league_id(p_per_member bigint)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_per_member >= 250000 then 'champion'
    when p_per_member >= 100000 then 'diamond'
    when p_per_member >= 40000 then 'platinum'
    when p_per_member >= 15000 then 'gold'
    when p_per_member >= 5000 then 'silver'
    else 'bronze'
  end
$$;

-- XP pro aktivem Mitglied für alle Clans in einem Zeitraum
create or replace function public.zwip_clan_week_stats(p_from timestamptz, p_to timestamptz)
returns table (clan_id uuid, xp bigint, active bigint, per_member bigint)
language sql stable security definer set search_path = ''
as $$
  select l.clan_id, sum(l.xp)::bigint, count(distinct l.user_id)::bigint,
         (sum(l.xp) / greatest(1, count(distinct l.user_id)))::bigint
  from public.clan_xp_log l
  join public.zwip_clans c on c.id = l.clan_id
  where l.created_at >= p_from and l.created_at < p_to and l.source = 'minigame' and l.user_id is not null
  group by l.clan_id
$$;

create or replace function public.get_clan_league()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := public.zwip_me();
  m public.clan_members;
  wk timestamptz := date_trunc('week', now());
begin
  select * into m from public.zwip_cm where user_id = me;
  if m.user_id is null then raise exception 'not_in_clan' using errcode = 'P0001'; end if;
  return (
    with t as (
      select c.id as clan_id,
             public.zwip_clan_league_id(coalesce(lw.per_member, 0)) as league,
             coalesce(tw.xp, 0) as xp, coalesce(tw.active, 0) as active, coalesce(tw.per_member, 0) as per_member
      from public.zwip_clans c
      left join public.zwip_clan_week_stats(wk - interval '7 days', wk) lw on lw.clan_id = c.id
      left join public.zwip_clan_week_stats(wk, wk + interval '7 days') tw on tw.clan_id = c.id
    ),
    mine as (select * from t where t.clan_id = m.clan_id),
    lg as (select t.* from t, mine where t.league = mine.league)
    select jsonb_build_object(
      'league', mine.league,
      'week_end', wk + interval '7 days',
      'xp', mine.xp, 'active', mine.active, 'per_member', mine.per_member,
      'next_league', public.zwip_clan_league_id(mine.per_member),
      'clans_in_league', (select count(*) from lg),
      'my_rank', (select count(*) + 1 from lg where lg.per_member > mine.per_member),
      'rows', coalesce((
        select jsonb_agg(r order by (r ->> 'rank')::integer, r ->> 'name')
        from (
          select public.zwip_clan_json(lg.clan_id) || jsonb_build_object(
                   'rank', rank() over (order by lg.per_member desc),
                   'per_member', lg.per_member, 'active', lg.active, 'week_xp', lg.xp,
                   'is_mine', lg.clan_id = m.clan_id) as r
          from lg order by lg.per_member desc limit 50) s), '[]'::jsonb))
    from mine);
end;
$$;

-- ---------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------
revoke all on function public.zwip_new_invite_code() from public, anon, authenticated;
revoke all on function public.zwip_clan_week_stats(timestamptz, timestamptz) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.get_clan_invite()', 'public.reset_clan_invite()', 'public.clan_by_invite(text)',
                           'public.join_clan_by_invite(text)', 'public.get_clan_league()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
