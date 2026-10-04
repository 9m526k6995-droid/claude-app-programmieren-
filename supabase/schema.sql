-- ZWIP: globale Tages-Bestenliste
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  day         integer      not null,
  name        text         not null check (char_length(name) between 1 and 24),
  device_id   uuid         not null,
  player      text         not null check (char_length(player) between 4 and 16),
  score       integer      not null check (score between 0 and 1000),
  rounds      smallint[]   not null check (array_length(rounds, 1) = 10),
  created_at  timestamptz  not null default now(),
  unique (day, device_id)          -- nur der erste Versuch pro Tag und Gerät zählt
);

create index if not exists scores_day_score_idx on public.scores (day, score desc, created_at);

alter table public.scores enable row level security;

-- Jeder darf lesen …
drop policy if exists "scores are public" on public.scores;
create policy "scores are public" on public.scores
  for select using (true);

-- … und eintragen, aber nur für heute (±1 Tag wegen Zeitzonen) und mit plausiblen Werten.
-- Daily #1 = 1. Oktober 2026.
drop policy if exists "insert today only" on public.scores;
create policy "insert today only" on public.scores
  for insert with check (
    day between (current_date - date '2026-09-30') - 1 and (current_date - date '2026-09-30') + 1
    and score = (select coalesce(sum(r), 0) from unnest(rounds) as r)
    and 0 <= all(rounds) and 100 >= all(rounds)
  );

-- Kein Ändern, kein Löschen über die öffentliche API.
revoke update, delete on public.scores from anon, authenticated;

-- Die geheime Geräte-ID ist nicht lesbar – nur Name, Punkte und öffentliche Spieler-ID.
revoke select on public.scores from anon, authenticated;
grant select (id, day, name, player, score, rounds, created_at) on public.scores to anon, authenticated;
grant insert (day, name, device_id, player, score, rounds) on public.scores to anon, authenticated;
