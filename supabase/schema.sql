-- ============================================================
--  Planificador de Campo · Esquema Supabase (estado completo)
--  Ejecuta este script entero en Supabase > SQL Editor para montar
--  un proyecto desde cero. Es idempotente: se puede repetir.
-- ============================================================

-- ---------- Perfiles: entrenadores y coordinadores ----------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  full_name       text check (char_length(full_name) <= 80),
  role            text not null default 'entrenador' check (role in ('entrenador', 'coordinador')),
  status          text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado')),
  teams           text[] not null default '{}',   -- equipos asignados (ids de config.js)
  requested_teams text[] not null default '{}',   -- equipos que pidió al registrarse
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid references auth.users(id) on delete set null
);
create index if not exists profiles_reviewed_by_idx on public.profiles (reviewed_by);
create index if not exists profiles_status_idx on public.profiles (status);
alter table public.profiles enable row level security;

-- ---------- Funciones de permisos (esquema privado, fuera de la API) ----------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_coordinator()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'coordinador' and status = 'aprobado'
  );
$$;
revoke all on function private.is_coordinator() from public, anon;
grant execute on function private.is_coordinator() to authenticated;

create or replace function private.is_approved()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'aprobado'
  );
$$;
revoke all on function private.is_approved() from public, anon;
grant execute on function private.is_approved() to authenticated;

-- ---------- Alta automática del perfil al registrarse (queda pendiente) ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  t text[] := '{}';
begin
  if jsonb_typeof(new.raw_user_meta_data -> 'teams') = 'array' then
    select coalesce(array_agg(x), '{}') into t
    from (
      select x from jsonb_array_elements_text(new.raw_user_meta_data -> 'teams') as x
      where x ~ '^[a-z0-9-]{1,30}$' limit 12
    ) s;
  end if;
  insert into public.profiles (id, email, full_name, requested_teams, teams)
  values (new.id, new.email, left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 80), t, t)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Cada uno ve su perfil; el coordinador ve y gestiona todos.
drop policy if exists "Ver perfiles" on public.profiles;
create policy "Ver perfiles" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_coordinator()));

drop policy if exists "Coordinadores gestionan perfiles" on public.profiles;
create policy "Coordinadores gestionan perfiles" on public.profiles
  for update to authenticated
  using ((select private.is_coordinator()))
  with check ((select private.is_coordinator()));

revoke all on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, role, status, teams, reviewed_at, reviewed_by) on public.profiles to authenticated;

-- ---------- Reservas del campo ----------
create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  day          date not null,
  start_min    smallint not null check (start_min between 0 and 1439),
  duration_min smallint check (duration_min between 5 and 720),
  team         text not null,
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
comment on column public.bookings.start_min is 'Minutos desde 00:00. Entreno: inicio. Partido: hora del saque (el calentamiento va antes).';
comment on column public.bookings.duration_min is 'Solo entrenos; la duración de los partidos se calcula por equipo (config.js).';
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

-- Solo usuarios aceptados ven el calendario; solo coordinadores lo cambian.
drop policy if exists "Usuarios aprobados leen" on public.bookings;
create policy "Usuarios aprobados leen" on public.bookings
  for select to authenticated using ((select private.is_approved()));

drop policy if exists "Coordinadores crean" on public.bookings;
create policy "Coordinadores crean" on public.bookings
  for insert to authenticated with check ((select private.is_coordinator()));

drop policy if exists "Coordinadores modifican" on public.bookings;
create policy "Coordinadores modifican" on public.bookings
  for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));

drop policy if exists "Coordinadores eliminan" on public.bookings;
create policy "Coordinadores eliminan" on public.bookings
  for delete to authenticated using ((select private.is_coordinator()));

revoke all on public.bookings from anon;
grant select, insert, update, delete on public.bookings to authenticated;

-- ---------- Tiempo real ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ============================================================
--  Primer coordinador (después de crear el usuario en Authentication
--  o de registrarse desde la web):
--    update public.profiles set role = 'coordinador', status = 'aprobado'
--    where email = 'persona@club.com';
--  El resto se gestiona desde la propia web («Entrenadores»).
-- ============================================================
