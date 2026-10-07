-- ZWIP: Season Pass, Aufgaben, Coins & Gems, Shop, Sammlung (kosmetische Items)
-- Voraussetzung: profiles.sql, trophies.sql, minigames.sql, clans.sql, moderation.sql, push.sql wurden ausgeführt.
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen. Mehrfaches Ausführen ist unschädlich.
--
-- Grundregeln:
--   * ALLES ist rein kosmetisch. Nichts hier verändert Trophäen, Ligen, Punkte oder Gewinnchancen.
--     Die Trophäen- und Minigame-Funktionen werden nicht angefasst; XP kommt über Trigger NACH der Wertung.
--   * Keine Lootboxen: Jeder Kauf zeigt vorher genau, was man bekommt.
--   * Die App schreibt nie direkt in Tabellen, nur über die Funktionen unten. Der Server rechnet XP, Coins und Gems.
--   * Echtgeld-Käufe laufen vorerst im Testmodus (es wird nichts abgebucht). Für Apple/Google gibt es schon
--     public.zwip_sp_store_purchase(), das später eine Edge Function nach der Beleg-Prüfung aufruft.

-- =====================================================================
-- 1. Tabellen
-- =====================================================================

-- Kosmetische Items. data hängt von der Art ab:
--   skin      {"a":"#hex","b":"#hex"}            Hintergrund-Farben der App
--   frame     {"c1":"#hex","c2":"#hex","anim":true} Rahmen ums Profilbild
--   avatar    {"e":"🦊","bg":"#hex"}              Emoji-Profilbild (wenn kein Foto)
--   title     {"t":"Blitzkönig"}                  Titel unter dem Namen
--   namecolor {"c1":"#hex","c2":"#hex"}           Farbe des Namens (c2 = Verlauf)
--   emote     {"e":"🔥","t":"Feuer!"}             Emote für den Clan-Chat
--   victory   {"e":["⭐","✨"]}                   Siegesanimation nach gewonnenen Runden
create table if not exists public.sp_items (
  id          text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  kind        text not null check (kind in ('skin', 'frame', 'avatar', 'title', 'namecolor', 'emote', 'victory')),
  name        text not null check (char_length(name) between 1 and 40),
  rarity      text not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary')),
  data        jsonb not null default '{}'::jsonb,
  season_id   integer,           -- gesetzt = gibt es nur in dieser Season (nie im Shop)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.sp_seasons (
  id         serial primary key,
  num        integer not null,
  name       text not null check (char_length(name) between 1 and 40),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  levels     integer not null default 40 check (levels between 1 and 100),
  level_xp   integer not null default 1500 check (level_xp between 100 and 100000),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists sp_seasons_time_idx on public.sp_seasons (starts_at, ends_at);

do $$ begin
  alter table public.sp_items add constraint sp_items_season_fk foreign key (season_id) references public.sp_seasons (id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.sp_rewards (
  season_id integer not null references public.sp_seasons (id) on delete cascade,
  level     integer not null check (level between 1 and 100),
  track     text not null check (track in ('free', 'premium')),
  item_id   text references public.sp_items (id) on delete set null,
  coins     integer not null default 0 check (coins between 0 and 100000),
  gems      integer not null default 0 check (gems between 0 and 10000),
  primary key (season_id, level, track)
);

create table if not exists public.sp_progress (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  season_id      integer not null references public.sp_seasons (id) on delete cascade,
  xp             integer not null default 0 check (xp >= 0),
  premium        boolean not null default false,
  premium_at     timestamptz,
  win_streak     integer not null default 0,
  day_key        date,
  day_xp         integer not null default 0,
  day_coins      integer not null default 0,
  last_daily     integer,
  unseen_xp      integer not null default 0,
  unseen_quests  integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, season_id)
);
create index if not exists sp_progress_season_idx on public.sp_progress (season_id);

create table if not exists public.sp_claims (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  season_id  integer not null references public.sp_seasons (id) on delete cascade,
  level      integer not null,
  track      text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, season_id, level, track)
);

create table if not exists public.sp_quest_pool (
  key     text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  kind    text not null check (kind in ('daily', 'weekly')),
  title   text not null,
  metric  text not null check (metric in ('rounds', 'wins', 'win_streak', 'daily', 'trophy_rounds', 'minigame_runs',
                                          'minigame_points', 'invites', 'friends')),
  goal    integer not null check (goal between 1 and 1000000),
  xp      integer not null check (xp between 0 and 100000),
  coins   integer not null default 0 check (coins between 0 and 100000),
  active  boolean not null default true
);

-- Zugeteilte Aufgaben (Kopie aus dem Pool, damit spätere Änderungen laufende Aufgaben nicht verändern)
create table if not exists public.sp_quests (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  period     text not null,          -- 'd:2026-10-07' oder 'w:2026-10-05' (Montag)
  quest_key  text not null,
  kind       text not null,
  title      text not null,
  metric     text not null,
  goal       integer not null,
  xp         integer not null,
  coins      integer not null,
  progress   integer not null default 0,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, period, quest_key)
);

create table if not exists public.sp_wallets (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  coins      bigint not null default 0 check (coins >= 0),
  gems       bigint not null default 0 check (gems >= 0),
  updated_at timestamptz not null default now()
);

-- Jede Änderung an Coins/Gems wird protokolliert (Nachvollziehbarkeit, Support)
create table if not exists public.sp_ledger (
  id      bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  coins   integer not null default 0,
  gems    integer not null default 0,
  reason  text not null,
  ref     text,
  at      timestamptz not null default now()
);
create index if not exists sp_ledger_user_idx on public.sp_ledger (user_id, at desc);

create table if not exists public.sp_inventory (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  item_id     text not null references public.sp_items (id) on delete cascade,
  source      text not null,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.sp_equipped (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  skin      text references public.sp_items (id) on delete set null,
  frame     text references public.sp_items (id) on delete set null,
  avatar    text references public.sp_items (id) on delete set null,
  title     text references public.sp_items (id) on delete set null,
  namecolor text references public.sp_items (id) on delete set null,
  victory   text references public.sp_items (id) on delete set null
);

-- Shop-Katalog: was überhaupt verkauft werden darf. Täglich werden 6 davon gezeigt (plus "always").
create table if not exists public.sp_shop (
  item_id     text primary key references public.sp_items (id) on delete cascade,
  price_coins integer check (price_coins is null or price_coins between 1 and 1000000),
  price_gems  integer check (price_gems is null or price_gems between 1 and 100000),
  always      boolean not null default false,
  active      boolean not null default true,
  check (price_coins is not null or price_gems is not null)
);

-- Echtgeld-Produkte (Preise in Cent). apple_id/google_id = Produkt-IDs in den Stores (später).
create table if not exists public.sp_products (
  id          text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name        text not null,
  price_cents integer not null check (price_cents between 0 and 99999),
  gems        integer not null default 0 check (gems between 0 and 100000),
  coins       integer not null default 0 check (coins between 0 and 1000000),
  item_ids    text[] not null default '{}',
  once        boolean not null default false,
  active      boolean not null default true,
  sort        integer not null default 0,
  apple_id    text,
  google_id   text
);

create table if not exists public.sp_purchases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  product_id  text not null references public.sp_products (id),
  price_cents integer not null,
  provider    text not null check (provider in ('test', 'apple', 'google')),
  provider_tx text,
  season_id   integer references public.sp_seasons (id) on delete set null,
  status      text not null default 'completed' check (status in ('completed', 'refunded')),
  created_at  timestamptz not null default now()
);
create unique index if not exists sp_purchases_tx_unique on public.sp_purchases (provider, provider_tx) where provider_tx is not null;
create index if not exists sp_purchases_user_idx on public.sp_purchases (user_id, created_at desc);

-- Einladungen: wer hat wen geholt (zählt für die Aufgabe "Lade einen Freund ein")
create table if not exists public.sp_referrals (
  referee_id  uuid primary key references public.profiles (id) on delete cascade,
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  at          timestamptz not null default now(),
  check (referee_id <> referrer_id)
);

create table if not exists public.sp_settings (
  key   text primary key,
  value text not null
);

do $$
declare t text;
begin
  foreach t in array array['sp_items', 'sp_seasons', 'sp_rewards', 'sp_progress', 'sp_claims', 'sp_quest_pool', 'sp_quests',
                           'sp_wallets', 'sp_ledger', 'sp_inventory', 'sp_equipped', 'sp_shop', 'sp_products',
                           'sp_purchases', 'sp_referrals', 'sp_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.sp_seasons_id_seq, public.sp_ledger_id_seq from anon, authenticated;

-- =====================================================================
-- 2. Startinhalt (Items, Aufgaben, Produkte, Shop). Bestehendes wird nicht überschrieben.
-- =====================================================================

insert into public.sp_items (id, kind, name, rarity, data) values
  -- Profilbilder (Emoji)
  ('av_fox', 'avatar', 'Fuchs', 'common', '{"e":"🦊","bg":"#ff8a3d"}'),
  ('av_cat', 'avatar', 'Katze', 'common', '{"e":"🐱","bg":"#ffd23d"}'),
  ('av_rocket', 'avatar', 'Rakete', 'common', '{"e":"🚀","bg":"#3d7bff"}'),
  ('av_ghost', 'avatar', 'Geist', 'common', '{"e":"👻","bg":"#a45cff"}'),
  ('av_robot', 'avatar', 'Roboter', 'common', '{"e":"🤖","bg":"#22c36b"}'),
  ('av_dragon', 'avatar', 'Drache', 'epic', '{"e":"🐉","bg":"#16a34a"}'),
  ('av_unicorn', 'avatar', 'Einhorn', 'epic', '{"e":"🦄","bg":"#ff3d8b"}'),
  ('av_panda', 'avatar', 'Panda', 'common', '{"e":"🐼","bg":"#e6e1d8"}'),
  ('av_octopus', 'avatar', 'Krake', 'common', '{"e":"🐙","bg":"#ff5c8a"}'),
  ('av_alien', 'avatar', 'Alien', 'rare', '{"e":"👽","bg":"#7cf06b"}'),
  ('av_tiger', 'avatar', 'Tiger', 'rare', '{"e":"🐯","bg":"#ff9f1c"}'),
  ('av_star', 'avatar', 'Stern', 'rare', '{"e":"🌟","bg":"#3d2b7a"}'),
  -- Rahmen
  ('fr_mint', 'frame', 'Minze', 'common', '{"c1":"#5cf2c6","c2":"#22c3a0"}'),
  ('fr_sun', 'frame', 'Sonne', 'common', '{"c1":"#ffd23d","c2":"#ff8a3d"}'),
  ('fr_violet', 'frame', 'Violett', 'rare', '{"c1":"#c08bff","c2":"#7a3dff"}'),
  ('fr_neon', 'frame', 'Neon', 'epic', '{"c1":"#c6ff3d","c2":"#3dfff0","anim":true}'),
  ('fr_rainbow', 'frame', 'Regenbogen', 'legendary', '{"c1":"#ff3d8b","c2":"#3d7bff","anim":true}'),
  ('fr_fire', 'frame', 'Feuer', 'epic', '{"c1":"#ff3d3d","c2":"#ffd23d","anim":true}'),
  ('fr_ice', 'frame', 'Eis', 'rare', '{"c1":"#bff3ff","c2":"#3db8ff"}'),
  ('fr_toxic', 'frame', 'Toxisch', 'epic', '{"c1":"#a6ff00","c2":"#00ff8a","anim":true}'),
  ('fr_starter', 'frame', 'Starter', 'rare', '{"c1":"#ffd23d","c2":"#a45cff"}'),
  -- Skins (Hintergrund der App)
  ('sk_ocean', 'skin', 'Ozean', 'rare', '{"a":"#1fb6ff","b":"#1f4bff"}'),
  ('sk_sunset', 'skin', 'Sonnenuntergang', 'rare', '{"a":"#ff8a3d","b":"#ff3d8b"}'),
  ('sk_jungle', 'skin', 'Dschungel', 'rare', '{"a":"#22c36b","b":"#c6ff3d"}'),
  ('sk_galaxy', 'skin', 'Galaxie', 'epic', '{"a":"#5b2bff","b":"#00d1ff"}'),
  ('sk_candy', 'skin', 'Zuckerwatte', 'rare', '{"a":"#ff9ad5","b":"#9ad8ff"}'),
  ('sk_ice', 'skin', 'Gletscher', 'rare', '{"a":"#bff3ff","b":"#6a8cff"}'),
  ('sk_lava', 'skin', 'Lava', 'epic', '{"a":"#ff3d1f","b":"#ffb800"}'),
  -- Titel
  ('ti_veteran', 'title', 'Season-Veteran', 'rare', '{"t":"Season-Veteran"}'),
  ('ti_blitz', 'title', 'Blitzkönig', 'epic', '{"t":"Blitzkönig ⚡"}'),
  ('ti_pro', 'title', 'Profi', 'common', '{"t":"Profi"}'),
  ('ti_nightowl', 'title', 'Nachteule', 'common', '{"t":"Nachteule 🦉"}'),
  ('ti_speed', 'title', 'Speedrunner', 'rare', '{"t":"Speedrunner"}'),
  -- Namensfarben
  ('nc_gold', 'namecolor', 'Gold', 'rare', '{"c1":"#ffd23d","c2":"#ff9f1c"}'),
  ('nc_fire', 'namecolor', 'Feuer', 'epic', '{"c1":"#ff3d3d","c2":"#ffb800"}'),
  ('nc_rainbow', 'namecolor', 'Regenbogen', 'legendary', '{"c1":"#ff3d8b","c2":"#3dfff0"}'),
  ('nc_mint', 'namecolor', 'Minze', 'common', '{"c1":"#5cf2c6"}'),
  ('nc_ice', 'namecolor', 'Eis', 'common', '{"c1":"#9ad8ff"}'),
  -- Emotes (Clan-Chat)
  ('em_gg', 'emote', 'GG', 'common', '{"e":"🤝","t":"GG!"}'),
  ('em_fire', 'emote', 'Feuer', 'common', '{"e":"🔥","t":"Feuer!"}'),
  ('em_cool', 'emote', 'Cool', 'rare', '{"e":"😎","t":"Easy."}'),
  ('em_flex', 'emote', 'Flex', 'rare', '{"e":"💪","t":"Flex!"}'),
  ('em_party', 'emote', 'Party', 'rare', '{"e":"🥳","t":"Party!"}'),
  ('em_eyes', 'emote', 'Augen', 'rare', '{"e":"👀","t":"Ich seh dich…"}'),
  ('em_lol', 'emote', 'LOL', 'common', '{"e":"😂","t":"LOL"}'),
  ('em_cry', 'emote', 'Heulen', 'common', '{"e":"😭","t":"Nein!"}'),
  ('em_wave', 'emote', 'Winken', 'common', '{"e":"👋","t":"Hey!"}'),
  -- Siegesanimationen
  ('vi_stars', 'victory', 'Sternenregen', 'rare', '{"e":["⭐","✨","🌟"]}'),
  ('vi_bolts', 'victory', 'Blitze', 'epic', '{"e":["⚡","⚡","💥"]}'),
  ('vi_party', 'victory', 'Party', 'epic', '{"e":["🎉","🎊","🥳"]}'),
  ('vi_hearts', 'victory', 'Herzen', 'rare', '{"e":["💖","💜","💙"]}'),
  ('vi_snow', 'victory', 'Schnee', 'rare', '{"e":["❄️","☃️","✨"]}')
on conflict (id) do nothing;

insert into public.sp_quest_pool (key, kind, title, metric, goal, xp, coins) values
  ('d_play3', 'daily', 'Spiel 3 Runden', 'rounds', 3, 250, 20),
  ('d_play5', 'daily', 'Spiel 5 Runden', 'rounds', 5, 350, 30),
  ('d_win2', 'daily', 'Gewinn 2 Runden', 'wins', 2, 300, 25),
  ('d_streak2', 'daily', 'Gewinn 2 Runden am Stück', 'win_streak', 2, 350, 30),
  ('d_daily', 'daily', 'Spiel die Daily', 'daily', 1, 250, 20),
  ('d_trophy2', 'daily', 'Spiel 2 Trophäen-Runden', 'trophy_rounds', 2, 300, 25),
  ('d_mini3', 'daily', 'Spiel 3 Minigames', 'minigame_runs', 3, 250, 20),
  ('d_points2k', 'daily', 'Hol 2.000 Punkte in Minigames', 'minigame_points', 2000, 300, 25),
  ('w_play25', 'weekly', 'Spiel 25 Runden', 'rounds', 25, 1200, 100),
  ('w_win10', 'weekly', 'Gewinn 10 Runden', 'wins', 10, 1200, 100),
  ('w_streak5', 'weekly', 'Gewinn 5 Runden am Stück', 'win_streak', 5, 1500, 120),
  ('w_daily5', 'weekly', 'Spiel an 5 Tagen die Daily', 'daily', 5, 1200, 100),
  ('w_invite', 'weekly', 'Lade einen Freund ein, der sich registriert', 'invites', 1, 1500, 150),
  ('w_friend', 'weekly', 'Füge einen neuen Freund hinzu', 'friends', 1, 800, 60),
  ('w_points20k', 'weekly', 'Hol 20.000 Punkte in Minigames', 'minigame_points', 20000, 1200, 100),
  ('w_trophy10', 'weekly', 'Spiel 10 Trophäen-Runden', 'trophy_rounds', 10, 1200, 100)
on conflict (key) do nothing;

insert into public.sp_products (id, name, price_cents, gems, coins, item_ids, once, sort) values
  ('pass', 'Season Pass', 499, 0, 0, '{}', false, 1),
  ('starter', 'Starter-Paket', 199, 200, 1000, '{av_star,fr_starter}', true, 2),
  ('gems_s', '80 Gems', 99, 80, 0, '{}', false, 3),
  ('gems_m', '500 Gems', 499, 500, 0, '{}', false, 4),
  ('gems_l', '1.100 Gems', 999, 1100, 0, '{}', false, 5)
on conflict (id) do nothing;

insert into public.sp_shop (item_id, price_coins, price_gems) values
  ('av_panda', 500, 50), ('av_octopus', 500, 50), ('av_alien', 800, 80), ('av_tiger', 800, 80),
  ('fr_ice', 1200, 120), ('fr_toxic', null, 300),
  ('sk_candy', 2500, 250), ('sk_ice', 2500, 250), ('sk_lava', null, 400),
  ('em_lol', 600, 60), ('em_cry', 600, 60), ('em_wave', 600, 60),
  ('vi_hearts', 1500, 150), ('vi_snow', 1500, 150),
  ('nc_mint', 1000, 100), ('nc_ice', 1000, 100),
  ('ti_pro', 800, 80), ('ti_nightowl', 800, 80), ('ti_speed', 1500, 150)
on conflict (item_id) do nothing;

-- Testkäufe: 'admins' = nur Admin-Konten, 'all' = alle, 'off' = aus
insert into public.sp_settings (key, value) values ('test_purchases', 'admins') on conflict (key) do nothing;

-- =====================================================================
-- 3. Hilfsfunktionen (nicht von der App aufrufbar)
-- =====================================================================

create or replace function public.zwip_sp_today()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/Berlin')::date $$;

create or replace function public.zwip_sp_week()
returns date language sql stable set search_path = '' as $$ select date_trunc('week', now() at time zone 'Europe/Berlin')::date $$;

-- Mitternacht (Berlin) eines Tages als Zeitpunkt
create or replace function public.zwip_sp_midnight(p_day date)
returns timestamptz language sql stable set search_path = '' as $$ select p_day::timestamp at time zone 'Europe/Berlin' $$;

create or replace function public.zwip_sp_item_json(p_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'rarity', i.rarity, 'data', i.data,
                            'exclusive', i.season_id is not null)
  from public.sp_items i where i.id = p_id
$$;

-- Exklusiver Season-Skin (Stufe 40 Premium) – wird für jede Season neu erzeugt
create or replace function public.zwip_sp_exclusive_item(p_season integer)
returns text language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  pal text[][] := array[['#ffd23d', '#ff3d8b'], ['#3dfff0', '#a45cff'], ['#c6ff3d', '#3d7bff'], ['#ff8a3d', '#7a3dff'],
                        ['#ff3d5a', '#ffd23d'], ['#5cf2c6', '#ff3d8b'], ['#9ad8ff', '#ffd23d'], ['#ff9ad5', '#3dfff0']];
  k integer;
  iid text;
begin
  select num into n from public.sp_seasons where id = p_season;
  iid := 'sk_season_' || p_season;
  k := (coalesce(n, 1) - 1) % 8 + 1;
  insert into public.sp_items (id, kind, name, rarity, data, season_id)
    values (iid, 'skin', 'Season ' || coalesce(n, 1) || ' Legende', 'legendary',
            jsonb_build_object('a', pal[k][1], 'b', pal[k][2], 'anim', true), p_season)
    on conflict (id) do nothing;
  return iid;
end;
$$;

-- Standard-Belohnungen für eine Season (40 Stufen, zwei Spuren)
create or replace function public.zwip_sp_default_rewards(p_season integer)
returns void language plpgsql security definer set search_path = '' as $$
declare ex text := public.zwip_sp_exclusive_item(p_season);
begin
  insert into public.sp_rewards (season_id, level, track, item_id, coins, gems)
  select p_season, l, 'free', it,
         case when it is null and l not in (20, 35) then 50 + (l / 10) * 25 else 0 end,
         case when l in (20, 35) then 10 else 0 end
  from (select l, case l when 3 then 'av_fox' when 6 then 'fr_mint' when 9 then 'av_cat' when 12 then 'av_rocket'
                         when 18 then 'fr_sun' when 24 then 'av_ghost' when 28 then 'av_robot' when 32 then 'fr_violet'
                         when 40 then 'ti_veteran' end as it
        from generate_series(1, 40) l) x
  on conflict do nothing;

  insert into public.sp_rewards (season_id, level, track, item_id, coins, gems)
  select p_season, l, 'premium', it,
         case when it is null and l not in (4, 16, 34) then 100 + (l / 10) * 50 else 0 end,
         case when l in (4, 16, 34) then 20 else 0 end
  from (select l, case l when 1 then 'av_star' when 2 then 'em_gg' when 5 then 'sk_ocean' when 7 then 'nc_gold' when 8 then 'em_fire'
                         when 10 then 'fr_neon' when 11 then 'av_dragon' when 12 then 'vi_stars' when 14 then 'em_cool'
                         when 15 then 'sk_sunset' when 19 then 'nc_fire' when 21 then 'av_unicorn' when 22 then 'em_flex'
                         when 24 then 'vi_bolts' when 25 then 'sk_jungle' when 26 then 'ti_blitz' when 28 then 'em_party'
                         when 30 then 'fr_rainbow' when 31 then 'nc_rainbow' when 33 then 'sk_galaxy' when 36 then 'em_eyes'
                         when 37 then 'fr_fire' when 38 then 'vi_party' when 40 then ex end as it
        from generate_series(1, 40) l) x
  on conflict do nothing;
end;
$$;

-- Belohnungen einer Season in eine neue kopieren. Exklusive Items werden durch das neue Season-Item ersetzt.
create or replace function public.zwip_sp_copy_rewards(p_from integer, p_to integer)
returns void language plpgsql security definer set search_path = '' as $$
declare ex text;
begin
  if p_from is null or not exists (select 1 from public.sp_rewards where season_id = p_from) then
    perform public.zwip_sp_default_rewards(p_to);
    return;
  end if;
  ex := public.zwip_sp_exclusive_item(p_to);
  insert into public.sp_rewards (season_id, level, track, item_id, coins, gems)
  select p_to, r.level, r.track,
         case when i.season_id is not null then ex else r.item_id end, r.coins, r.gems
  from public.sp_rewards r left join public.sp_items i on i.id = r.item_id
  where r.season_id = p_from
    and r.level <= (select levels from public.sp_seasons where id = p_to)
  on conflict do nothing;
end;
$$;

-- Aktuelle Season. Läuft keine, startet automatisch die nächste (gleiche Länge, Belohnungen der letzten Season).
create or replace function public.zwip_sp_current_season()
returns public.sp_seasons language plpgsql security definer set search_path = '' as $$
declare
  s public.sp_seasons;
  prev public.sp_seasons;
  st timestamptz;
  en timestamptz;
  dur interval := interval '42 days';
  nxt timestamptz;
begin
  select * into s from public.sp_seasons where starts_at <= now() and ends_at > now() order by starts_at desc limit 1;
  if s.id is not null then return s; end if;

  perform pg_advisory_xact_lock(hashtext('zwip_sp_new_season'));
  select * into s from public.sp_seasons where starts_at <= now() and ends_at > now() order by starts_at desc limit 1;
  if s.id is not null then return s; end if;

  select * into prev from public.sp_seasons where starts_at <= now() order by ends_at desc limit 1;
  if prev.id is null then
    st := public.zwip_sp_midnight(public.zwip_sp_today());
  else
    dur := least(greatest(prev.ends_at - prev.starts_at, interval '1 day'), interval '182 days');
    st := prev.ends_at;
    while st + dur <= now() loop st := st + dur; end loop;
  end if;
  en := st + dur;
  -- Ist schon eine spätere Season geplant, endet die automatische vorher
  select min(starts_at) into nxt from public.sp_seasons where starts_at > now();
  if nxt is not null and nxt < en then en := nxt; end if;

  insert into public.sp_seasons (num, name, starts_at, ends_at, levels, level_xp)
    values (coalesce((select max(num) from public.sp_seasons), 0) + 1,
            'Season ' || (coalesce((select max(num) from public.sp_seasons), 0) + 1),
            st, en, coalesce(prev.levels, 40), coalesce(prev.level_xp, 1500))
    returning * into s;
  perform public.zwip_sp_copy_rewards(prev.id, s.id);
  return s;
end;
$$;

create or replace function public.zwip_sp_progress(p_user uuid, p_season integer)
returns public.sp_progress language plpgsql security definer set search_path = '' as $$
declare pr public.sp_progress;
begin
  insert into public.sp_progress (user_id, season_id) values (p_user, p_season) on conflict do nothing;
  select * into pr from public.sp_progress where user_id = p_user and season_id = p_season;
  return pr;
end;
$$;

create or replace function public.zwip_sp_wallet_json(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('coins', coalesce((select coins from public.sp_wallets where user_id = p_user), 0),
                            'gems', coalesce((select gems from public.sp_wallets where user_id = p_user), 0))
$$;

-- Coins/Gems gutschreiben oder abziehen (negativ). Schlägt fehl, wenn nicht genug da ist.
create or replace function public.zwip_sp_money(p_user uuid, p_coins integer, p_gems integer, p_reason text, p_ref text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.sp_wallets;
begin
  if coalesce(p_coins, 0) = 0 and coalesce(p_gems, 0) = 0 then return; end if;
  insert into public.sp_wallets (user_id) values (p_user) on conflict do nothing;
  select * into w from public.sp_wallets where user_id = p_user for update;
  if w.coins + coalesce(p_coins, 0) < 0 then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  if w.gems + coalesce(p_gems, 0) < 0 then raise exception 'not_enough_gems' using errcode = 'P0001'; end if;
  update public.sp_wallets set coins = coins + coalesce(p_coins, 0), gems = gems + coalesce(p_gems, 0), updated_at = now()
    where user_id = p_user;
  insert into public.sp_ledger (user_id, coins, gems, reason, ref) values (p_user, coalesce(p_coins, 0), coalesce(p_gems, 0), p_reason, p_ref);
end;
$$;

-- Item geben. Hat man es schon, gibt es 200 Coins als Ausgleich. Liefert true, wenn es neu war.
create or replace function public.zwip_sp_give_item(p_user uuid, p_item text, p_source text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_item is null or not exists (select 1 from public.sp_items where id = p_item) then return false; end if;
  insert into public.sp_inventory (user_id, item_id, source) values (p_user, p_item, p_source) on conflict do nothing;
  if found then return true; end if;
  perform public.zwip_sp_money(p_user, 200, 0, 'duplicate', p_item);
  return false;
end;
$$;

-- Aufgaben für den aktuellen Tag/die Woche zuteilen (3 Stück, verschiedene Arten, zufällig je Spieler)
create or replace function public.zwip_sp_assign(p_user uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare per text := case p_kind when 'daily' then 'd:' || public.zwip_sp_today() else 'w:' || public.zwip_sp_week() end;
begin
  if exists (select 1 from public.sp_quests where user_id = p_user and period = per) then return; end if;
  insert into public.sp_quests (user_id, period, quest_key, kind, title, metric, goal, xp, coins)
  select p_user, per, x.key, x.kind, x.title, x.metric, x.goal, x.xp, x.coins
  from (select q.*, row_number() over (partition by q.metric order by md5(p_user::text || per || q.key)) rn
        from public.sp_quest_pool q where q.kind = p_kind and q.active) x
  where x.rn = 1
  order by md5(p_user::text || per || x.key || '#')
  limit 3
  on conflict do nothing;
end;
$$;

-- XP gutschreiben (aktuelle Season)
create or replace function public.zwip_sp_add_xp(p_user uuid, p_xp integer)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sp_seasons := public.zwip_sp_current_season();
begin
  if coalesce(p_xp, 0) <= 0 then return; end if;
  perform public.zwip_sp_progress(p_user, s.id);
  update public.sp_progress set xp = least(xp + p_xp, 100000000), unseen_xp = unseen_xp + p_xp, updated_at = now()
    where user_id = p_user and season_id = s.id;
end;
$$;

-- Fortschritt bei Aufgaben. p_max = true: Wert ist ein Höchststand (z. B. Siegesserie), sonst wird addiert.
create or replace function public.zwip_sp_event(p_user uuid, p_metric text, p_amount integer, p_max boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.sp_quests; np integer; s public.sp_seasons;
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  perform public.zwip_sp_assign(p_user, 'daily');
  perform public.zwip_sp_assign(p_user, 'weekly');
  for q in select * from public.sp_quests
           where user_id = p_user and period in ('d:' || public.zwip_sp_today(), 'w:' || public.zwip_sp_week())
             and metric = p_metric and done_at is null
           for update loop
    np := case when p_max then greatest(q.progress, p_amount) else least(q.progress + p_amount, 100000000) end;
    if np >= q.goal then
      update public.sp_quests set progress = q.goal, done_at = now()
        where user_id = q.user_id and period = q.period and quest_key = q.quest_key;
      perform public.zwip_sp_add_xp(p_user, q.xp);
      perform public.zwip_sp_money(p_user, q.coins, 0, 'quest', q.quest_key);
      s := public.zwip_sp_current_season();
      update public.sp_progress set unseen_quests = unseen_quests + 1 where user_id = p_user and season_id = s.id;
    elsif np <> q.progress then
      update public.sp_quests set progress = np where user_id = q.user_id and period = q.period and quest_key = q.quest_key;
    end if;
  end loop;
end;
$$;

-- Nach jeder gewerteten Runde: XP + Coins (mit Tageslimit), Siegesserie, Aufgaben
create or replace function public.zwip_sp_on_round(p_user uuid, p_kind text, p_win boolean, p_points integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.sp_seasons := public.zwip_sp_current_season();
  pr public.sp_progress;
  v_xp integer;
  v_coins integer;
  ws integer;
begin
  perform public.zwip_sp_progress(p_user, s.id);
  select * into pr from public.sp_progress where user_id = p_user and season_id = s.id for update;
  if pr.day_key is distinct from public.zwip_sp_today() then
    pr.day_xp := 0; pr.day_coins := 0;
  end if;
  v_xp := case p_kind when 'trophy' then case when p_win then 120 else 60 end
                      else case when p_win then 60 else 30 end end;
  v_xp := least(v_xp, greatest(0, 1500 - pr.day_xp));          -- höchstens 1.500 XP am Tag aus Runden
  v_coins := least(case when p_win then 10 else 5 end, greatest(0, 150 - pr.day_coins)); -- höchstens 150 Coins
  update public.sp_progress set
      day_key = public.zwip_sp_today(), day_xp = pr.day_xp + v_xp, day_coins = pr.day_coins + v_coins,
      win_streak = case when p_win then win_streak + 1 else 0 end, updated_at = now()
    where user_id = p_user and season_id = s.id
    returning win_streak into ws;
  perform public.zwip_sp_add_xp(p_user, v_xp);
  perform public.zwip_sp_money(p_user, v_coins, 0, 'round', p_kind);

  perform public.zwip_sp_event(p_user, 'rounds', 1);
  if p_win then
    perform public.zwip_sp_event(p_user, 'wins', 1);
    perform public.zwip_sp_event(p_user, 'win_streak', ws, true);
  end if;
  if p_kind = 'trophy' then perform public.zwip_sp_event(p_user, 'trophy_rounds', 1); end if;
  if p_kind = 'minigame' then
    perform public.zwip_sp_event(p_user, 'minigame_runs', 1);
    perform public.zwip_sp_event(p_user, 'minigame_points', p_points);
  end if;
end;
$$;

-- Daily gespielt (einmal pro Daily-Nummer)
create or replace function public.zwip_sp_on_daily(p_user uuid, p_day integer)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sp_seasons := public.zwip_sp_current_season(); pr public.sp_progress;
begin
  perform public.zwip_sp_progress(p_user, s.id);
  select * into pr from public.sp_progress where user_id = p_user and season_id = s.id for update;
  if pr.last_daily is not null and pr.last_daily >= p_day then return; end if;
  update public.sp_progress set last_daily = p_day where user_id = p_user and season_id = s.id;
  perform public.zwip_sp_add_xp(p_user, 150);
  perform public.zwip_sp_money(p_user, 20, 0, 'daily', p_day::text);
  perform public.zwip_sp_event(p_user, 'daily', 1);
  perform public.zwip_sp_event(p_user, 'rounds', 1);
end;
$$;

-- Season-Pass gekauft: Premium an + alle schon erreichten Premium-Belohnungen nachträglich geben
create or replace function public.zwip_sp_unlock_premium(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sp_seasons := public.zwip_sp_current_season(); pr public.sp_progress; lvl integer; r public.sp_rewards;
begin
  pr := public.zwip_sp_progress(p_user, s.id);
  update public.sp_progress set premium = true, premium_at = coalesce(premium_at, now()) where user_id = p_user and season_id = s.id;
  lvl := least(s.levels, pr.xp / s.level_xp);
  for r in select * from public.sp_rewards where season_id = s.id and track = 'premium' and level <= lvl order by level loop
    perform public.zwip_sp_claim_one(p_user, s.id, r.level, 'premium');
  end loop;
end;
$$;

-- Eine Belohnung abholen (prüft nichts außer "schon abgeholt" – das machen die Aufrufer)
create or replace function public.zwip_sp_claim_one(p_user uuid, p_season integer, p_level integer, p_track text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.sp_rewards;
begin
  select * into r from public.sp_rewards where season_id = p_season and level = p_level and track = p_track;
  if r.season_id is null then return false; end if;
  insert into public.sp_claims (user_id, season_id, level, track) values (p_user, p_season, p_level, p_track) on conflict do nothing;
  if not found then return false; end if;
  perform public.zwip_sp_give_item(p_user, r.item_id, 'pass');
  perform public.zwip_sp_money(p_user, r.coins, r.gems, 'pass', p_season || ':' || p_level || ':' || p_track);
  return true;
end;
$$;

-- Produkt gutschreiben (für Testkäufe UND später für echte Store-Käufe)
create or replace function public.zwip_sp_grant_product(p_user uuid, p_product text, p_purchase uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.sp_products; it text;
begin
  select * into p from public.sp_products where id = p_product;
  if p.id is null then raise exception 'product_not_found' using errcode = 'P0001'; end if;
  if p.id = 'pass' then
    perform public.zwip_sp_unlock_premium(p_user);
  end if;
  perform public.zwip_sp_money(p_user, p.coins, p.gems, 'purchase', p_purchase::text);
  foreach it in array p.item_ids loop
    perform public.zwip_sp_give_item(p_user, it, 'purchase');
  end loop;
end;
$$;

create or replace function public.zwip_sp_can_test_buy()
returns boolean language sql stable security definer set search_path = '' as $$
  select case coalesce((select value from public.sp_settings where key = 'test_purchases'), 'admins')
           when 'all' then true when 'admins' then public.zwip_is_admin() else false end
$$;

-- Darf ein Produkt (noch) gekauft werden?
create or replace function public.zwip_sp_check_product(p_user uuid, p_product text)
returns public.sp_products language plpgsql security definer set search_path = '' as $$
declare p public.sp_products; s public.sp_seasons;
begin
  select * into p from public.sp_products where id = p_product and active;
  if p.id is null then raise exception 'product_not_found' using errcode = 'P0001'; end if;
  if p.once and exists (select 1 from public.sp_purchases where user_id = p_user and product_id = p.id and status = 'completed') then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  if p.id = 'pass' then
    s := public.zwip_sp_current_season();
    if exists (select 1 from public.sp_progress where user_id = p_user and season_id = s.id and premium) then
      raise exception 'already_owned' using errcode = 'P0001';
    end if;
  end if;
  return p;
end;
$$;

-- Tages-Shop: 6 zufällige (für alle gleich, jeden Tag andere) + Dauerangebote
create or replace function public.zwip_sp_rotation(p_day date)
returns table (item_id text) language sql stable security definer set search_path = '' as $$
  (select sh.item_id from public.sp_shop sh join public.sp_items i on i.id = sh.item_id
   where sh.active and not sh.always and i.active and i.season_id is null
   order by md5(p_day::text || sh.item_id) limit 6)
  union
  (select sh.item_id from public.sp_shop sh join public.sp_items i on i.id = sh.item_id
   where sh.active and sh.always and i.active and i.season_id is null)
$$;

create or replace function public.zwip_sp_equipped_json(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'skin', public.zwip_sp_item_json(e.skin), 'frame', public.zwip_sp_item_json(e.frame),
    'avatar', public.zwip_sp_item_json(e.avatar), 'title', public.zwip_sp_item_json(e.title),
    'namecolor', public.zwip_sp_item_json(e.namecolor), 'victory', public.zwip_sp_item_json(e.victory))
  from (select p_user as u) x left join public.sp_equipped e on e.user_id = x.u
$$;

create or replace function public.zwip_sp_quests_json(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'daily', coalesce((select jsonb_agg(jsonb_build_object('key', q.quest_key, 'title', q.title, 'metric', q.metric, 'goal', q.goal,
                         'progress', q.progress, 'xp', q.xp, 'coins', q.coins, 'done', q.done_at is not null) order by q.done_at is not null, q.quest_key)
                       from public.sp_quests q where q.user_id = p_user and q.period = 'd:' || public.zwip_sp_today()), '[]'::jsonb),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('key', q.quest_key, 'title', q.title, 'metric', q.metric, 'goal', q.goal,
                         'progress', q.progress, 'xp', q.xp, 'coins', q.coins, 'done', q.done_at is not null) order by q.done_at is not null, q.quest_key)
                       from public.sp_quests q where q.user_id = p_user and q.period = 'w:' || public.zwip_sp_week()), '[]'::jsonb),
    'daily_ends', public.zwip_sp_midnight(public.zwip_sp_today() + 1),
    'weekly_ends', public.zwip_sp_midnight(public.zwip_sp_week() + 7))
$$;

-- Farben und Texte in Item-Daten prüfen (Schutz vor kaputten oder gefährlichen Werten)
create or replace function public.zwip_sp_valid_data(p_kind text, p_data jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 600 then return false; end if;
  for k, v in select * from jsonb_each(p_data) loop
    if k in ('a', 'b', 'c1', 'c2', 'bg') then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
    elsif k = 'anim' then
      if jsonb_typeof(v) <> 'boolean' then return false; end if;
    elsif k = 'e' then
      if jsonb_typeof(v) = 'string' then
        if char_length(v #>> '{}') not between 1 and 12 or (v #>> '{}') ~ '[<>&"''\\]' then return false; end if;
      elsif jsonb_typeof(v) = 'array' then
        if jsonb_array_length(v) not between 1 and 6 or exists (
             select 1 from jsonb_array_elements(v) x
             where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') not between 1 and 12 or (x #>> '{}') ~ '[<>&"''\\]') then
          return false;
        end if;
      else return false;
      end if;
    elsif k = 't' then
      if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 24 then return false; end if;
    else
      return false;
    end if;
  end loop;
  return case p_kind
    when 'skin' then p_data ? 'a' and p_data ? 'b'
    when 'frame' then p_data ? 'c1'
    when 'avatar' then p_data ? 'e' and jsonb_typeof(p_data -> 'e') = 'string'
    when 'title' then p_data ? 't'
    when 'namecolor' then p_data ? 'c1'
    when 'emote' then p_data ? 'e' and jsonb_typeof(p_data -> 'e') = 'string'
    when 'victory' then p_data ? 'e' and jsonb_typeof(p_data -> 'e') = 'array'
    else false end;
end;
$$;

-- =====================================================================
-- 4. Trigger: XP nach gewerteten Runden (das Spiel selbst bleibt unverändert)
-- =====================================================================

create or replace function public.zwip_sp_trg_trophy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'finished' and old.status = 'active' then
    begin
      perform public.zwip_sp_on_round(new.user_id, 'trophy', coalesce(new.delta, 0) > 0, 0);
    exception when others then
      raise warning 'season pass (trophy): %', sqlerrm;  -- der Pass darf eine Runde nie kaputt machen
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists zwip_sp_trophy_round on public.trophy_rounds;
create trigger zwip_sp_trophy_round after update of status on public.trophy_rounds
  for each row execute function public.zwip_sp_trg_trophy();

-- Minigame-Lauf: zählt ab Stufe 1, "Sieg" ab Stufe 5. Läufe, die der Anti-Cheat hart markiert, zählen nicht.
create or replace function public.zwip_sp_trg_minigame()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'finished' and old.status = 'active' and coalesce(new.stage, 0) >= 1
     and coalesce(new.flagged, '') not like 'hard:%' then
    begin
      perform public.zwip_sp_on_round(new.user_id, 'minigame', new.stage >= 5, coalesce(new.score, 0));
    exception when others then
      raise warning 'season pass (minigame): %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists zwip_sp_minigame_run on public.minigame_runs;
create trigger zwip_sp_minigame_run after update of status on public.minigame_runs
  for each row execute function public.zwip_sp_trg_minigame();

-- Daily: kommt über mark_daily_played (profiles.last_daily_day). Nur die heutige Daily (±1 Tag Zeitzone) zählt.
create or replace function public.zwip_sp_trg_daily()
returns trigger language plpgsql security definer set search_path = '' as $$
declare today_n integer := public.zwip_sp_today() - date '2026-09-30';
begin
  if new.last_daily_day is not null and new.last_daily_day is distinct from old.last_daily_day
     and new.last_daily_day between today_n - 1 and today_n + 1 then
    begin
      perform public.zwip_sp_on_daily(new.id, new.last_daily_day);
    exception when others then
      raise warning 'season pass (daily): %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists zwip_sp_daily on public.profiles;
create trigger zwip_sp_daily after update of last_daily_day on public.profiles
  for each row execute function public.zwip_sp_trg_daily();

-- Neuer Freund (angenommene Anfrage) zählt für beide
create or replace function public.zwip_sp_trg_friend()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    begin
      perform public.zwip_sp_event(new.sender_id, 'friends', 1);
      perform public.zwip_sp_event(new.receiver_id, 'friends', 1);
    exception when others then
      raise warning 'season pass (friend): %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists zwip_sp_friend on public.friendships;
create trigger zwip_sp_friend after insert or update of status on public.friendships
  for each row execute function public.zwip_sp_trg_friend();

-- =====================================================================
-- 5. Funktionen für die App
-- =====================================================================

create or replace function public.get_season_pass()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.zwip_me();
  s public.sp_seasons := public.zwip_sp_current_season();
  pr public.sp_progress;
begin
  pr := public.zwip_sp_progress(me, s.id);
  perform public.zwip_sp_assign(me, 'daily');
  perform public.zwip_sp_assign(me, 'weekly');
  return jsonb_build_object(
    'season', jsonb_build_object('id', s.id, 'num', s.num, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                                 'levels', s.levels, 'level_xp', s.level_xp),
    'xp', pr.xp,
    'level', least(s.levels, pr.xp / s.level_xp),
    'premium', pr.premium,
    'rewards', coalesce((select jsonb_agg(jsonb_build_object(
                   'level', r.level, 'track', r.track, 'item', public.zwip_sp_item_json(r.item_id),
                   'coins', r.coins, 'gems', r.gems, 'claimed', c.user_id is not null) order by r.level, r.track)
                 from public.sp_rewards r
                 left join public.sp_claims c on c.user_id = me and c.season_id = r.season_id and c.level = r.level and c.track = r.track
                 where r.season_id = s.id and r.level <= s.levels), '[]'::jsonb),
    'quests', public.zwip_sp_quests_json(me),
    'wallet', public.zwip_sp_wallet_json(me),
    'pass_price_cents', (select price_cents from public.sp_products where id = 'pass' and active),
    'can_buy', public.zwip_sp_can_test_buy());
end;
$$;

-- Belohnung abholen. p_level = null → alle erreichbaren auf einmal.
create or replace function public.claim_season_reward(p_level integer default null, p_track text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.zwip_me();
  s public.sp_seasons := public.zwip_sp_current_season();
  pr public.sp_progress;
  lvl integer;
  r public.sp_rewards;
  n integer := 0;
begin
  pr := public.zwip_sp_progress(me, s.id);
  lvl := least(s.levels, pr.xp / s.level_xp);
  if p_level is not null then
    if p_track not in ('free', 'premium') then raise exception 'invalid_reward' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.sp_rewards where season_id = s.id and level = p_level and track = p_track) then
      raise exception 'invalid_reward' using errcode = 'P0001';
    end if;
    if p_level > lvl then raise exception 'reward_locked' using errcode = 'P0001'; end if;
    if p_track = 'premium' and not pr.premium then raise exception 'premium_required' using errcode = 'P0001'; end if;
    if not public.zwip_sp_claim_one(me, s.id, p_level, p_track) then raise exception 'already_claimed' using errcode = 'P0001'; end if;
  else
    for r in select * from public.sp_rewards where season_id = s.id and level <= lvl
               and (track = 'free' or pr.premium) order by level, track loop
      if public.zwip_sp_claim_one(me, s.id, r.level, r.track) then n := n + 1; end if;
    end loop;
  end if;
  return public.get_season_pass();
end;
$$;

-- Kurze Rückmeldung nach einer Runde: wie viel XP kam dazu, welche Aufgaben sind fertig, Stufe hoch?
create or replace function public.get_season_ping()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.zwip_me();
  s public.sp_seasons := public.zwip_sp_current_season();
  pr public.sp_progress;
begin
  pr := public.zwip_sp_progress(me, s.id);
  update public.sp_progress set unseen_xp = 0, unseen_quests = 0 where user_id = me and season_id = s.id;
  return jsonb_build_object(
    'xp', pr.unseen_xp, 'quests', pr.unseen_quests,
    'level', least(s.levels, pr.xp / s.level_xp),
    'old_level', least(s.levels, greatest(0, pr.xp - pr.unseen_xp) / s.level_xp),
    'season', s.name);
end;
$$;

create or replace function public.get_shop()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := public.zwip_me(); s public.sp_seasons := public.zwip_sp_current_season();
begin
  return jsonb_build_object(
    'day', public.zwip_sp_today(),
    'ends_at', public.zwip_sp_midnight(public.zwip_sp_today() + 1),
    'items', coalesce((select jsonb_agg(public.zwip_sp_item_json(sh.item_id) || jsonb_build_object(
                          'price_coins', sh.price_coins, 'price_gems', sh.price_gems, 'always', sh.always,
                          'owned', exists (select 1 from public.sp_inventory v where v.user_id = me and v.item_id = sh.item_id))
                        order by sh.always desc, coalesce(sh.price_gems * 10, sh.price_coins))
                      from public.sp_shop sh where sh.item_id in (select item_id from public.zwip_sp_rotation(public.zwip_sp_today()))), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'name', p.name, 'price_cents', p.price_cents, 'gems', p.gems, 'coins', p.coins,
                          'items', coalesce((select jsonb_agg(public.zwip_sp_item_json(x)) from unnest(p.item_ids) x), '[]'::jsonb),
                          'once', p.once,
                          'owned', (p.once and exists (select 1 from public.sp_purchases u where u.user_id = me and u.product_id = p.id and u.status = 'completed'))
                                   or (p.id = 'pass' and exists (select 1 from public.sp_progress g where g.user_id = me and g.season_id = s.id and g.premium)))
                        order by p.sort, p.price_cents)
                      from public.sp_products p where p.active), '[]'::jsonb),
    'wallet', public.zwip_sp_wallet_json(me),
    'test_mode', coalesce((select value from public.sp_settings where key = 'test_purchases'), 'admins'),
    'can_buy', public.zwip_sp_can_test_buy(),
    'season', s.name);
end;
$$;

-- Item aus dem Tages-Shop kaufen (mit Coins oder Gems)
create or replace function public.buy_shop_item(p_item text, p_currency text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := public.zwip_me(); sh public.sp_shop;
begin
  if p_currency not in ('coins', 'gems') then raise exception 'invalid_currency' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.zwip_sp_rotation(public.zwip_sp_today()) r where r.item_id = p_item) then
    raise exception 'not_in_shop' using errcode = 'P0001';
  end if;
  select * into sh from public.sp_shop where item_id = p_item;
  if exists (select 1 from public.sp_inventory where user_id = me and item_id = p_item) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  if (p_currency = 'coins' and sh.price_coins is null) or (p_currency = 'gems' and sh.price_gems is null) then
    raise exception 'invalid_currency' using errcode = 'P0001';
  end if;
  if p_currency = 'coins' then
    perform public.zwip_sp_money(me, -sh.price_coins, 0, 'shop', p_item);
  else
    perform public.zwip_sp_money(me, 0, -sh.price_gems, 'shop', p_item);
  end if;
  insert into public.sp_inventory (user_id, item_id, source) values (me, p_item, 'shop');
  return public.get_shop();
end;
$$;

-- Echtgeld-Produkt im TESTMODUS "kaufen": es wird nichts abgebucht, der Kauf wird mit provider = 'test' gespeichert.
create or replace function public.buy_product_test(p_product text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := public.zwip_me(); p public.sp_products; pid uuid; s public.sp_seasons;
begin
  if not public.zwip_sp_can_test_buy() then raise exception 'payments_unavailable' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('zwip_sp_buy:' || me::text));
  p := public.zwip_sp_check_product(me, p_product);
  s := public.zwip_sp_current_season();
  insert into public.sp_purchases (user_id, product_id, price_cents, provider, season_id)
    values (me, p.id, p.price_cents, 'test', s.id) returning id into pid;
  perform public.zwip_sp_grant_product(me, p.id, pid);
  return public.get_shop() || jsonb_build_object('purchase_id', pid, 'product', p.id);
end;
$$;

create or replace function public.get_my_cosmetics()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := public.zwip_me();
begin
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.zwip_sp_item_json(v.item_id) || jsonb_build_object('source', v.source, 'acquired_at', v.acquired_at)
                                        order by v.acquired_at desc)
                       from public.sp_inventory v where v.user_id = me), '[]'::jsonb),
    'equipped', public.zwip_sp_equipped_json(me),
    'wallet', public.zwip_sp_wallet_json(me));
end;
$$;

-- Item ausrüsten (p_item = null → ablegen). Emotes muss man nicht ausrüsten, die sind alle im Chat.
create or replace function public.equip_cosmetic(p_kind text, p_item text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := public.zwip_me();
begin
  if p_kind not in ('skin', 'frame', 'avatar', 'title', 'namecolor', 'victory') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if p_item is not null and not exists (
       select 1 from public.sp_inventory v join public.sp_items i on i.id = v.item_id
       where v.user_id = me and v.item_id = p_item and i.kind = p_kind) then
    raise exception 'not_owned' using errcode = 'P0001';
  end if;
  insert into public.sp_equipped (user_id) values (me) on conflict do nothing;
  update public.sp_equipped set
      skin = case when p_kind = 'skin' then p_item else skin end,
      frame = case when p_kind = 'frame' then p_item else frame end,
      avatar = case when p_kind = 'avatar' then p_item else avatar end,
      title = case when p_kind = 'title' then p_item else title end,
      namecolor = case when p_kind = 'namecolor' then p_item else namecolor end,
      victory = case when p_kind = 'victory' then p_item else victory end
    where user_id = me;
  return public.get_my_cosmetics();
end;
$$;

-- Ausgerüstete Items eines anderen Spielers (für sein Profil)
create or replace function public.get_player_cosmetics(p_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  perform public.zwip_me();
  select id into target from public.profiles
    where username is not null and lower(username) = lower(btrim(coalesce(p_username, '')));
  if target is null then raise exception 'player_not_found' using errcode = 'P0001'; end if;
  return public.zwip_sp_equipped_json(target);
end;
$$;

-- Einladung einlösen: Wer über den Link eines Spielers kommt und sich neu registriert, zählt für dessen Aufgabe.
create or replace function public.claim_referral(p_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := public.zwip_me(); ref uuid; created timestamptz;
begin
  select id into ref from public.profiles
    where username is not null and lower(username) = lower(btrim(coalesce(p_username, '')));
  if ref is null or ref = me then return jsonb_build_object('ok', false); end if;
  if exists (select 1 from public.sp_referrals where referee_id = me) then return jsonb_build_object('ok', false); end if;
  select coalesce(u.created_at, p.created_at) into created
    from public.profiles p left join auth.users u on u.id = p.id where p.id = me;
  if created is null or created < now() - interval '3 days' then return jsonb_build_object('ok', false); end if;
  insert into public.sp_referrals (referee_id, referrer_id) values (me, ref) on conflict do nothing;
  if found then perform public.zwip_sp_event(ref, 'invites', 1); end if;
  return jsonb_build_object('ok', found);
end;
$$;

-- =====================================================================
-- 6. Für den Server: echte Store-Käufe (Apple / Google) – nur mit Server-Rechten aufrufbar
-- =====================================================================
-- Eine Edge Function prüft den Beleg bei Apple/Google und ruft dann diese Funktion auf.
-- Gleiche Transaktions-ID zweimal → wird nur einmal gutgeschrieben.
create or replace function public.zwip_sp_store_purchase(p_user uuid, p_provider text, p_tx text, p_store_product text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.sp_products; pid uuid; s public.sp_seasons;
begin
  if p_provider not in ('apple', 'google') or coalesce(p_tx, '') = '' then raise exception 'invalid_purchase' using errcode = 'P0001'; end if;
  select id into pid from public.sp_purchases where provider = p_provider and provider_tx = p_tx;
  if pid is not null then return jsonb_build_object('ok', true, 'duplicate', true, 'purchase_id', pid); end if;
  select * into p from public.sp_products
    where (p_provider = 'apple' and apple_id = p_store_product) or (p_provider = 'google' and google_id = p_store_product) or id = p_store_product
    order by (id = p_store_product) asc limit 1;  -- Store-Produkt-ID hat Vorrang vor unserer eigenen ID
  if p.id is null then raise exception 'product_not_found' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('zwip_sp_buy:' || p_user::text));
  s := public.zwip_sp_current_season();
  insert into public.sp_purchases (user_id, product_id, price_cents, provider, provider_tx, season_id)
    values (p_user, p.id, p.price_cents, p_provider, p_tx, s.id) returning id into pid;
  perform public.zwip_sp_grant_product(p_user, p.id, pid);
  return jsonb_build_object('ok', true, 'duplicate', false, 'purchase_id', pid);
end;
$$;

-- =====================================================================
-- 7. Admin
-- =====================================================================

create or replace function public.admin_sp_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur public.sp_seasons;
begin
  perform public.zwip_need_admin();
  cur := public.zwip_sp_current_season();
  return jsonb_build_object(
    'current', cur.id,
    'seasons', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', s.id, 'num', s.num, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                  'levels', s.levels, 'level_xp', s.level_xp,
                  'players', (select count(*) from public.sp_progress g where g.season_id = s.id),
                  'premium', (select count(*) from public.sp_progress g where g.season_id = s.id and g.premium),
                  'rewards', (select count(*) from public.sp_rewards r where r.season_id = s.id)) order by s.starts_at desc)
                from public.sp_seasons s), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(public.zwip_sp_item_json(i.id) || jsonb_build_object('active', i.active,
                  'owners', (select count(*) from public.sp_inventory v where v.item_id = i.id)) order by i.kind, i.name)
                from public.sp_items i), '[]'::jsonb),
    'shop', coalesce((select jsonb_agg(jsonb_build_object('item_id', sh.item_id, 'price_coins', sh.price_coins, 'price_gems', sh.price_gems,
                  'always', sh.always, 'active', sh.active,
                  'today', sh.item_id in (select item_id from public.zwip_sp_rotation(public.zwip_sp_today()))) order by sh.item_id)
                from public.sp_shop sh), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort) from public.sp_products p), '[]'::jsonb),
    'settings', jsonb_build_object('test_purchases', coalesce((select value from public.sp_settings where key = 'test_purchases'), 'admins')),
    'stats', jsonb_build_object(
       'test_purchases', (select count(*) from public.sp_purchases where provider = 'test'),
       'real_purchases', (select count(*) from public.sp_purchases where provider <> 'test' and status = 'completed'),
       'real_revenue_cents', (select coalesce(sum(price_cents), 0) from public.sp_purchases where provider <> 'test' and status = 'completed')));
end;
$$;

create or replace function public.admin_sp_rewards(p_season integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.zwip_need_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('level', r.level, 'track', r.track, 'item_id', r.item_id,
                    'coins', r.coins, 'gems', r.gems) order by r.level, r.track)
                   from public.sp_rewards r where r.season_id = p_season), '[]'::jsonb);
end;
$$;

create or replace function public.admin_sp_set_reward(p_season integer, p_level integer, p_track text, p_item text, p_coins integer, p_gems integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sp_seasons; it text := nullif(btrim(coalesce(p_item, '')), '');
begin
  perform public.zwip_need_admin();
  select * into s from public.sp_seasons where id = p_season;
  if s.id is null then raise exception 'season_not_found' using errcode = 'P0001'; end if;
  if p_level is null or p_level < 1 or p_level > s.levels or p_track not in ('free', 'premium') then
    raise exception 'invalid_reward' using errcode = 'P0001';
  end if;
  if it is not null and not exists (select 1 from public.sp_items where id = it) then
    raise exception 'item_not_found' using errcode = 'P0001';
  end if;
  if coalesce(p_coins, 0) not between 0 and 100000 or coalesce(p_gems, 0) not between 0 and 10000 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if it is null and coalesce(p_coins, 0) = 0 and coalesce(p_gems, 0) = 0 then
    delete from public.sp_rewards where season_id = p_season and level = p_level and track = p_track;
  else
    insert into public.sp_rewards (season_id, level, track, item_id, coins, gems)
      values (p_season, p_level, p_track, it, coalesce(p_coins, 0), coalesce(p_gems, 0))
      on conflict (season_id, level, track) do update set item_id = excluded.item_id, coins = excluded.coins, gems = excluded.gems;
  end if;
  return public.admin_sp_rewards(p_season);
end;
$$;

-- Neue Season planen (startet zum gewählten Zeitpunkt, Belohnungen werden von der aktuellen kopiert)
create or replace function public.admin_sp_create_season(p_name text, p_starts_at timestamptz, p_weeks integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur public.sp_seasons; s public.sp_seasons; en timestamptz; nm text := btrim(coalesce(p_name, ''));
begin
  perform public.zwip_need_admin();
  cur := public.zwip_sp_current_season();
  if p_weeks is null or p_weeks not between 1 and 26 then raise exception 'invalid_weeks' using errcode = 'P0001'; end if;
  if p_starts_at is null or p_starts_at < cur.ends_at then raise exception 'season_overlap' using errcode = 'P0001'; end if;
  en := p_starts_at + make_interval(weeks => p_weeks);
  if exists (select 1 from public.sp_seasons where starts_at < en and ends_at > p_starts_at) then
    raise exception 'season_overlap' using errcode = 'P0001';
  end if;
  insert into public.sp_seasons (num, name, starts_at, ends_at, levels, level_xp)
    values (coalesce((select max(num) from public.sp_seasons), 0) + 1,
            coalesce(nullif(left(nm, 40), ''), 'Season ' || (coalesce((select max(num) from public.sp_seasons), 0) + 1)),
            p_starts_at, en, cur.levels, cur.level_xp)
    returning * into s;
  perform public.zwip_sp_copy_rewards(cur.id, s.id);
  return public.admin_sp_overview();
end;
$$;

-- Season umbenennen oder Ende verschieben (keine Überschneidung mit anderen Seasons)
create or replace function public.admin_sp_update_season(p_id integer, p_name text, p_ends_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sp_seasons; nm text := btrim(coalesce(p_name, ''));
begin
  perform public.zwip_need_admin();
  select * into s from public.sp_seasons where id = p_id;
  if s.id is null then raise exception 'season_not_found' using errcode = 'P0001'; end if;
  if char_length(nm) not between 1 and 40 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if p_ends_at is null or p_ends_at <= s.starts_at or p_ends_at < now() then raise exception 'invalid_date' using errcode = 'P0001'; end if;
  if exists (select 1 from public.sp_seasons where id <> s.id and starts_at < p_ends_at and ends_at > s.starts_at) then
    raise exception 'season_overlap' using errcode = 'P0001';
  end if;
  update public.sp_seasons set name = nm, ends_at = p_ends_at where id = s.id;
  return public.admin_sp_overview();
end;
$$;

create or replace function public.admin_sp_save_item(p_id text, p_kind text, p_name text, p_rarity text, p_data jsonb, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare nm text := btrim(coalesce(p_name, ''));
begin
  perform public.zwip_need_admin();
  if coalesce(p_id, '') !~ '^[a-z0-9_]{2,40}$' then raise exception 'invalid_item_id' using errcode = 'P0001'; end if;
  if p_kind not in ('skin', 'frame', 'avatar', 'title', 'namecolor', 'emote', 'victory') then raise exception 'invalid_kind' using errcode = 'P0001'; end if;
  if char_length(nm) not between 1 and 40 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if p_rarity not in ('common', 'rare', 'epic', 'legendary') then raise exception 'invalid_rarity' using errcode = 'P0001'; end if;
  if not public.zwip_sp_valid_data(p_kind, p_data) then raise exception 'invalid_item_data' using errcode = 'P0001'; end if;
  if p_kind in ('title', 'emote') and p_data ? 't' and public.zwip_clean_text(p_data ->> 't') <> (p_data ->> 't') then
    raise exception 'invalid_item_data' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.sp_items where id = p_id and kind <> p_kind) then raise exception 'invalid_kind' using errcode = 'P0001'; end if;
  insert into public.sp_items (id, kind, name, rarity, data, active) values (p_id, p_kind, nm, p_rarity, p_data, coalesce(p_active, true))
    on conflict (id) do update set name = excluded.name, rarity = excluded.rarity, data = excluded.data, active = excluded.active;
  return public.admin_sp_overview();
end;
$$;

-- Shop-Katalog pflegen. Beide Preise leer → Item fliegt aus dem Shop.
create or replace function public.admin_sp_set_shop(p_item text, p_price_coins integer, p_price_gems integer, p_always boolean, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.zwip_need_admin();
  if not exists (select 1 from public.sp_items where id = p_item) then raise exception 'item_not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from public.sp_items where id = p_item and season_id is not null) then
    raise exception 'exclusive_item' using errcode = 'P0001';
  end if;
  if (p_price_coins is not null and p_price_coins not between 1 and 1000000) or (p_price_gems is not null and p_price_gems not between 1 and 100000) then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if p_price_coins is null and p_price_gems is null then
    delete from public.sp_shop where item_id = p_item;
  else
    insert into public.sp_shop (item_id, price_coins, price_gems, always, active)
      values (p_item, p_price_coins, p_price_gems, coalesce(p_always, false), coalesce(p_active, true))
      on conflict (item_id) do update set price_coins = excluded.price_coins, price_gems = excluded.price_gems,
        always = excluded.always, active = excluded.active;
  end if;
  return public.admin_sp_overview();
end;
$$;

create or replace function public.admin_sp_set_product(p_id text, p_name text, p_price_cents integer, p_gems integer, p_coins integer, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare nm text := btrim(coalesce(p_name, ''));
begin
  perform public.zwip_need_admin();
  if not exists (select 1 from public.sp_products where id = p_id) then raise exception 'product_not_found' using errcode = 'P0001'; end if;
  if char_length(nm) not between 1 and 40 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if p_price_cents is null or p_price_cents not between 0 and 99999 or coalesce(p_gems, 0) not between 0 and 100000
     or coalesce(p_coins, 0) not between 0 and 1000000 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  update public.sp_products set name = nm, price_cents = p_price_cents, gems = coalesce(p_gems, 0), coins = coalesce(p_coins, 0),
      active = coalesce(p_active, true)
    where id = p_id;
  return public.admin_sp_overview();
end;
$$;

create or replace function public.admin_sp_set_setting(p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.zwip_need_admin();
  if p_key <> 'test_purchases' or p_value not in ('off', 'admins', 'all') then raise exception 'invalid_setting' using errcode = 'P0001'; end if;
  insert into public.sp_settings (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value;
  return public.admin_sp_overview();
end;
$$;

-- Für "Meine Daten herunterladen" (export_my_data in moderation.sql)
create or replace function public.zwip_sp_export(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'wallet', public.zwip_sp_wallet_json(p_user),
    'seasons', coalesce((select jsonb_agg(jsonb_build_object('season', s.name, 'xp', g.xp, 'premium', g.premium, 'premium_at', g.premium_at) order by s.starts_at)
                         from public.sp_progress g join public.sp_seasons s on s.id = g.season_id where g.user_id = p_user), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('item', v.item_id, 'source', v.source, 'at', v.acquired_at) order by v.acquired_at)
                       from public.sp_inventory v where v.user_id = p_user), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object('product', u.product_id, 'price_cents', u.price_cents, 'provider', u.provider,
                                                              'status', u.status, 'at', u.created_at) order by u.created_at)
                           from public.sp_purchases u where u.user_id = p_user), '[]'::jsonb),
    'coin_and_gem_log', coalesce((select jsonb_agg(jsonb_build_object('coins', l.coins, 'gems', l.gems, 'reason', l.reason, 'at', l.at) order by l.id desc)
                                  from (select * from public.sp_ledger where user_id = p_user order by id desc limit 1000) l), '[]'::jsonb),
    'invited_by', (select p.username from public.sp_referrals r join public.profiles p on p.id = r.referrer_id where r.referee_id = p_user))
$$;

-- =====================================================================
-- 8. Rechte
-- =====================================================================

do $$
declare f text;
begin
  -- interne Helfer: niemand von außen
  foreach f in array array[
    'zwip_sp_today()', 'zwip_sp_week()', 'zwip_sp_midnight(date)', 'zwip_sp_item_json(text)', 'zwip_sp_exclusive_item(integer)',
    'zwip_sp_default_rewards(integer)', 'zwip_sp_copy_rewards(integer, integer)', 'zwip_sp_current_season()',
    'zwip_sp_progress(uuid, integer)', 'zwip_sp_wallet_json(uuid)', 'zwip_sp_money(uuid, integer, integer, text, text)',
    'zwip_sp_give_item(uuid, text, text)', 'zwip_sp_assign(uuid, text)', 'zwip_sp_add_xp(uuid, integer)',
    'zwip_sp_event(uuid, text, integer, boolean)', 'zwip_sp_on_round(uuid, text, boolean, integer)', 'zwip_sp_on_daily(uuid, integer)',
    'zwip_sp_unlock_premium(uuid)', 'zwip_sp_claim_one(uuid, integer, integer, text)', 'zwip_sp_grant_product(uuid, text, uuid)',
    'zwip_sp_can_test_buy()', 'zwip_sp_check_product(uuid, text)', 'zwip_sp_rotation(date)', 'zwip_sp_equipped_json(uuid)',
    'zwip_sp_quests_json(uuid)', 'zwip_sp_valid_data(text, jsonb)', 'zwip_sp_trg_trophy()', 'zwip_sp_trg_minigame()',
    'zwip_sp_trg_daily()', 'zwip_sp_trg_friend()', 'zwip_sp_store_purchase(uuid, text, text, text)', 'zwip_sp_export(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Funktionen für angemeldete Spieler
  foreach f in array array[
    'get_season_pass()', 'claim_season_reward(integer, text)', 'get_season_ping()', 'get_shop()', 'buy_shop_item(text, text)',
    'buy_product_test(text)', 'get_my_cosmetics()', 'equip_cosmetic(text, text)', 'get_player_cosmetics(text)', 'claim_referral(text)',
    'admin_sp_overview()', 'admin_sp_rewards(integer)', 'admin_sp_set_reward(integer, integer, text, text, integer, integer)',
    'admin_sp_create_season(text, timestamptz, integer)', 'admin_sp_update_season(integer, text, timestamptz)',
    'admin_sp_save_item(text, text, text, text, jsonb, boolean)', 'admin_sp_set_shop(text, integer, integer, boolean, boolean)',
    'admin_sp_set_product(text, text, integer, integer, integer, boolean)', 'admin_sp_set_setting(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.zwip_sp_store_purchase(uuid, text, text, text) to service_role;

-- Erste Season sofort anlegen (falls noch keine existiert)
select public.zwip_sp_current_season();
