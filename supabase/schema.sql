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

-- ---------- Invitaciones (enlaces que el coordinador envía por WhatsApp) ----------
create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique default replace(gen_random_uuid()::text, '-', ''),
  label        text check (char_length(label) <= 80),
  role         text not null default 'entrenador' check (role in ('entrenador', 'coordinador')),
  teams        text[] not null default '{}',
  max_uses     integer not null default 1 check (max_uses between 1 and 50),
  uses         integer not null default 0,
  expires_at   timestamptz not null default now() + interval '7 days',
  revoked      boolean not null default false,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists invitations_created_by_idx on public.invitations (created_by);
alter table public.invitations enable row level security;

drop policy if exists "Coordinadores ven invitaciones" on public.invitations;
create policy "Coordinadores ven invitaciones" on public.invitations
  for select to authenticated using ((select private.is_coordinator()));
drop policy if exists "Coordinadores crean invitaciones" on public.invitations;
create policy "Coordinadores crean invitaciones" on public.invitations
  for insert to authenticated with check ((select private.is_coordinator()));
drop policy if exists "Coordinadores modifican invitaciones" on public.invitations;
create policy "Coordinadores modifican invitaciones" on public.invitations
  for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));

revoke all on public.invitations from anon, authenticated;
grant select, insert on public.invitations to authenticated;
grant update (label, revoked, expires_at, max_uses) on public.invitations to authenticated;

-- Intencionadamente público (aviso 0028 del linter aceptado): quien abre un enlace ve
-- su rol y equipos. Solo responde al token exacto; no permite listar invitaciones.
create or replace function public.invitation_info(p_token text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('valid', true, 'role', i.role, 'teams', i.teams, 'label', i.label, 'expires_at', i.expires_at)
       from public.invitations i
      where i.token = p_token and not i.revoked and i.expires_at > now() and i.uses < i.max_uses),
    jsonb_build_object('valid', false));
$$;
revoke all on function public.invitation_info(text) from public, authenticated;
grant execute on function public.invitation_info(text) to anon;

-- ---------- Registro: solo con invitación válida; entra ya aceptado ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  inv public.invitations%rowtype;
  tok text := nullif(trim(new.raw_user_meta_data ->> 'invite'), '');
begin
  if tok is null then
    raise exception 'Se necesita una invitación para registrarse';
  end if;
  select * into inv from public.invitations
   where token = tok and not revoked and expires_at > now() and uses < max_uses
   for update;
  if not found then
    raise exception 'La invitación no es válida o ha caducado';
  end if;
  update public.invitations set uses = uses + 1, last_used_at = now() where id = inv.id;
  insert into public.profiles (id, email, full_name, role, status, teams, requested_teams, reviewed_at, reviewed_by)
  values (new.id, new.email, left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 80),
          inv.role, 'aprobado', inv.teams, inv.teams, now(), inv.created_by)
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
--  Primer coordinador: crea una invitación de coordinador y regístrate
--  con el enlace  https://TU-WEB/#invitacion=TOKEN
--    insert into public.invitations (label, role, expires_at)
--    values ('Primer coordinador', 'coordinador', now() + interval '30 days')
--    returning token;
--  El resto de invitaciones se crean desde la web («Entrenadores › Invitar»).
-- ============================================================
