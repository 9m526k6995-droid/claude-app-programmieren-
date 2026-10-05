-- ZWIP: Benutzerprofile (Grundgerüst für später)
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.
--
-- Jeder registrierte Account (auth.users) bekommt automatisch genau ein Profil mit derselben ID.
-- Spätere Tabellen für Highscores, Level, Fortschritt, Statistiken, Einstellungen oder Spielmodi
-- hängen sich einfach per   user_id uuid not null references public.profiles(id) on delete cascade
-- an diese ID und schützen sich mit der Regel   using (user_id = auth.uid()).

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Jeder sieht und ändert nur das eigene Profil.
drop policy if exists "own profile: read" on public.profiles;
create policy "own profile: read" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "own profile: update" on public.profiles;
create policy "own profile: update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Rechte ausdrücklich vergeben (funktioniert auch, wenn "Automatically expose new tables" aus ist).
-- Angemeldete dürfen lesen/ändern (die Regeln oben begrenzen das aufs eigene Profil).
-- Anlegen und Löschen passiert nur automatisch, nie direkt über die App.
revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;

-- Profil automatisch anlegen, sobald sich jemand registriert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Die Trigger-Funktion darf nicht über die API aufrufbar sein (der Trigger funktioniert trotzdem).
revoke all on function public.handle_new_user() from public, anon, authenticated;
