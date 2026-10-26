-- ============================================================
--  Planificador de Campo · Esquema Supabase
--  Ejecuta este script completo en Supabase > SQL Editor.
--  Es idempotente: puedes volver a ejecutarlo sin perder datos.
-- ============================================================

-- ---------- Perfiles y roles ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'lector' check (role in ('lector', 'coordinador')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "Cada usuario ve su perfil" on public.profiles;
create policy "Cada usuario ve su perfil" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
-- Nadie puede modificar perfiles desde la web: los roles se asignan por SQL (ver README).

-- ¿El usuario actual es coordinador?
create or replace function public.is_coordinator()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'coordinador'
  );
$$;
revoke all on function public.is_coordinator() from public;
grant execute on function public.is_coordinator() to anon, authenticated;

-- Crea el perfil (rol lector) cuando se da de alta un usuario
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Perfiles para usuarios que ya existieran antes de este script
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ---------- Reservas del campo ----------
create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  day          date not null,
  start_min    smallint not null check (start_min between 0 and 1439),   -- minutos desde 00:00 (entreno: inicio; partido: hora del saque, el calentamiento va antes)
  duration_min smallint check (duration_min between 5 and 720),          -- solo entrenos; los partidos se calculan por equipo
  team         text not null,                                            -- id del equipo (config.js)
  kind         text not null check (kind in ('entreno', 'partido')),
  format       text check (format in ('F8', 'F11')),
  zone         text not null check (zone in ('full', 'A', 'B', 'A1', 'A2', 'B1', 'B2')),
  opponent     text check (char_length(opponent) <= 80),
  notes        text check (char_length(notes) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid() references auth.users(id) on delete set null,
  constraint partido_con_formato check (kind <> 'partido' or format is not null),
  constraint entreno_con_duracion check (kind <> 'entreno' or duration_min is not null)
);
create index if not exists bookings_day_idx on public.bookings (day);
create index if not exists bookings_updated_by_idx on public.bookings (updated_by);

create or replace function public.touch_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch
  before update on public.bookings
  for each row execute function public.touch_booking();

alter table public.bookings enable row level security;

drop policy if exists "Lectura pública" on public.bookings;
create policy "Lectura pública" on public.bookings
  for select to anon, authenticated using (true);

drop policy if exists "Coordinadores crean" on public.bookings;
create policy "Coordinadores crean" on public.bookings
  for insert to authenticated with check ((select public.is_coordinator()));

drop policy if exists "Coordinadores modifican" on public.bookings;
create policy "Coordinadores modifican" on public.bookings
  for update to authenticated using ((select public.is_coordinator())) with check ((select public.is_coordinator()));

drop policy if exists "Coordinadores eliminan" on public.bookings;
create policy "Coordinadores eliminan" on public.bookings
  for delete to authenticated using ((select public.is_coordinator()));

-- Permisos de la API (RLS sigue filtrando fila a fila)
grant select on public.bookings to anon, authenticated;
grant insert, update, delete on public.bookings to authenticated;
grant select on public.profiles to authenticated;

-- ---------- Tiempo real ----------
-- Para que todos los navegadores abiertos se actualicen al instante.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;

-- ============================================================
--  Dar rol de coordinador (ejecutar tras crear el usuario):
--    update public.profiles set role = 'coordinador' where email = 'persona@club.com';
-- ============================================================
