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
  team         text,                                  -- null solo en reservas extraordinarias
  kind         text not null check (kind in ('entreno', 'partido', 'evento')),
  title        text check (char_length(title) <= 80),  -- nombre de la reserva extraordinaria
  format       text check (format in ('F8', 'F11')),
  zone         text not null check (zone in ('full', 'A', 'B', 'A1', 'A2', 'B1', 'B2')),
  opponent     text check (char_length(opponent) <= 80),
  notes        text check (char_length(notes) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid() references auth.users(id) on delete set null,
  constraint partido_con_formato check (kind <> 'partido' or format is not null),
  constraint entreno_con_duracion check (kind <> 'entreno' or duration_min is not null),
  constraint equipo_obligatorio check (kind = 'evento' or team is not null),
  constraint evento_con_nombre check (kind <> 'evento' or (nullif(trim(title), '') is not null and duration_min is not null))
);
-- Para proyectos creados con una versión anterior del esquema
alter table public.bookings add column if not exists title text check (char_length(title) <= 80);
alter table public.bookings drop constraint if exists bookings_kind_check;
alter table public.bookings add constraint bookings_kind_check check (kind in ('entreno', 'partido', 'evento'));
alter table public.bookings alter column team drop not null;
alter table public.bookings drop constraint if exists equipo_obligatorio;
alter table public.bookings add constraint equipo_obligatorio check (kind = 'evento' or team is not null);
alter table public.bookings drop constraint if exists evento_con_nombre;
alter table public.bookings add constraint evento_con_nombre check (kind <> 'evento' or (nullif(trim(title), '') is not null and duration_min is not null));
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

-- ---------- Partidos: confirmación, observaciones y propuestas de horario ----------
alter table public.bookings add column if not exists confirmed boolean not null default false;
alter table public.bookings add column if not exists observations text check (char_length(observations) <= 500);
comment on column public.bookings.confirmed is 'Partidos: horario confirmado (true) o por confirmar (false).';
comment on column public.bookings.observations is 'Observaciones del partido (peticiones del entrenador, motivos…).';
alter table public.bookings add column if not exists rival_status text not null default 'pendiente'
  check (rival_status in ('pendiente', 'aprobado', 'rechazado'));
comment on column public.bookings.rival_status is 'Partidos fuera del horario federativo de su categoría: aprobación del rival (pendiente, aprobado, rechazado). Dentro del horario no se usa.';
alter table public.bookings add column if not exists away boolean not null default false;
alter table public.bookings add column if not exists venue text check (char_length(venue) <= 120);
comment on column public.bookings.away is 'Partidos: true si se juega fuera (solo de referencia, no ocupa campo propio).';
comment on column public.bookings.venue is 'Partidos fuera: localidad y campo donde se juega.';

create table if not exists public.match_proposals (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  day         date not null,
  start_min   smallint check (start_min between 0 and 1439),   -- nula si es por franja o a cualquier hora
  slot        text check (slot in ('manana', 'tarde')),
  reason      text check (char_length(reason) <= 300),
  status      text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'descartada')),
  author_name text check (char_length(author_name) <= 80),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists match_proposals_booking_idx on public.match_proposals (booking_id);
create index if not exists match_proposals_created_by_idx on public.match_proposals (created_by);
alter table public.match_proposals enable row level security;

-- Coordinador o entrenador del equipo del partido
create or replace function private.can_propose(p_booking uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    join public.profiles p on p.id = (select auth.uid())
    where b.id = p_booking and b.kind = 'partido' and p.status = 'aprobado'
      and (p.role = 'coordinador' or b.team = any (p.teams))
  );
$$;
revoke all on function private.can_propose(uuid) from public, anon;
grant execute on function private.can_propose(uuid) to authenticated;

drop policy if exists "Aprobados ven propuestas" on public.match_proposals;
create policy "Aprobados ven propuestas" on public.match_proposals
  for select to authenticated using ((select private.is_approved()));
drop policy if exists "Coordinadores y entrenadores del equipo proponen" on public.match_proposals;
create policy "Coordinadores y entrenadores del equipo proponen" on public.match_proposals
  for insert to authenticated
  with check (private.can_propose(booking_id) and created_by = (select auth.uid()) and status = 'pendiente');
drop policy if exists "Coordinadores resuelven propuestas" on public.match_proposals;
create policy "Coordinadores resuelven propuestas" on public.match_proposals
  for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));
drop policy if exists "Borrar propuestas" on public.match_proposals;
create policy "Borrar propuestas" on public.match_proposals
  for delete to authenticated
  using ((select private.is_coordinator()) or (created_by = (select auth.uid()) and status = 'pendiente'));
revoke all on public.match_proposals from anon;
grant select, insert, delete on public.match_proposals to authenticated;
grant update (status, resolved_at) on public.match_proposals to authenticated;

-- ---------- Solapes partido–entreno asumidos ----------
create table if not exists public.overlap_acks (
  id           uuid primary key default gen_random_uuid(),
  entreno_id   uuid not null references public.bookings(id) on delete cascade,
  partido_id   uuid not null references public.bookings(id) on delete cascade,
  entreno_sig  text not null check (char_length(entreno_sig) <= 60),   -- día|inicio|duración|zona al asumirlo
  partido_sig  text not null check (char_length(partido_sig) <= 60),
  author_name  text check (char_length(author_name) <= 80),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint overlap_acks_unicos unique (entreno_id, partido_id, entreno_sig, partido_sig)
);
create index if not exists overlap_acks_partido_idx on public.overlap_acks (partido_id);
create index if not exists overlap_acks_created_by_idx on public.overlap_acks (created_by);
alter table public.overlap_acks enable row level security;

-- Coordinador o entrenador de cualquiera de los dos equipos
create or replace function private.can_ack(p_entreno uuid, p_partido uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.bookings e
    join public.bookings m on m.id = p_partido and m.kind = 'partido'
    join public.profiles p on p.id = (select auth.uid())
    where e.id = p_entreno and e.kind = 'entreno' and e.day = m.day and p.status = 'aprobado'
      and (p.role = 'coordinador' or e.team = any (p.teams) or m.team = any (p.teams))
  );
$$;
revoke all on function private.can_ack(uuid, uuid) from public, anon;
grant execute on function private.can_ack(uuid, uuid) to authenticated;

drop policy if exists "Aprobados ven solapes asumidos" on public.overlap_acks;
create policy "Aprobados ven solapes asumidos" on public.overlap_acks
  for select to authenticated using ((select private.is_approved()));
drop policy if exists "Entrenadores implicados asumen" on public.overlap_acks;
create policy "Entrenadores implicados asumen" on public.overlap_acks
  for insert to authenticated with check (private.can_ack(entreno_id, partido_id) and created_by = (select auth.uid()));
drop policy if exists "Quitar solape asumido" on public.overlap_acks;
create policy "Quitar solape asumido" on public.overlap_acks
  for delete to authenticated using ((select private.is_coordinator()) or created_by = (select auth.uid()));
revoke all on public.overlap_acks from anon, authenticated;
grant select, insert, delete on public.overlap_acks to authenticated;

-- ---------- Horario habitual (semana tipo de entrenamientos) ----------
create table if not exists public.schedule_template (
  id           uuid primary key default gen_random_uuid(),
  weekday      smallint not null check (weekday between 0 and 6),   -- 0 = lunes … 6 = domingo
  team         text not null,
  start_min    smallint not null check (start_min between 0 and 1439),
  duration_min smallint not null check (duration_min between 15 and 720),
  zone         text not null check (zone in ('full', 'A', 'B', 'A1', 'A2', 'B1', 'B2')),
  notes        text check (char_length(notes) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists schedule_template_updated_by_idx on public.schedule_template (updated_by);
alter table public.schedule_template enable row level security;

drop policy if exists "Aprobados ven el horario habitual" on public.schedule_template;
create policy "Aprobados ven el horario habitual" on public.schedule_template
  for select to authenticated using ((select private.is_approved()));
drop policy if exists "Coordinadores crean horario habitual" on public.schedule_template;
create policy "Coordinadores crean horario habitual" on public.schedule_template
  for insert to authenticated with check ((select private.is_coordinator()));
drop policy if exists "Coordinadores modifican horario habitual" on public.schedule_template;
create policy "Coordinadores modifican horario habitual" on public.schedule_template
  for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));
drop policy if exists "Coordinadores borran horario habitual" on public.schedule_template;
create policy "Coordinadores borran horario habitual" on public.schedule_template
  for delete to authenticated using ((select private.is_coordinator()));
revoke all on public.schedule_template from anon;
grant select, insert, update, delete on public.schedule_template to authenticated;

-- Cada entreno semanal recuerda de qué entreno habitual viene (para detectar cambios)
alter table public.bookings add column if not exists template_id uuid references public.schedule_template(id) on delete set null;
create index if not exists bookings_template_id_idx on public.bookings (template_id);

-- Semanas en las que el coordinador ya ha aplicado el horario habitual
create table if not exists public.generated_weeks (
  week_start   date primary key,
  generated_at timestamptz not null default now()
);
alter table public.generated_weeks enable row level security;
drop policy if exists "Aprobados ven semanas generadas" on public.generated_weeks;
create policy "Aprobados ven semanas generadas" on public.generated_weeks
  for select to authenticated using ((select private.is_approved()));
revoke all on public.generated_weeks from anon, authenticated;
grant select on public.generated_weeks to authenticated;

-- Aplicar el horario habitual a una semana (solo coordinadores, semana actual o futuras)
create or replace function private.ensure_week(p_day date)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  monday date := p_day - (extract(isodow from p_day)::int - 1);
  this_monday date := (now() at time zone 'Europe/Madrid')::date - (extract(isodow from (now() at time zone 'Europe/Madrid'))::int - 1);
begin
  if not private.is_coordinator() then
    raise exception 'Solo la coordinación puede aplicar el horario habitual' using errcode = '42501';
  end if;
  if monday < this_monday then
    raise exception 'No se puede aplicar el horario habitual a semanas pasadas';
  end if;
  insert into public.generated_weeks (week_start) values (monday) on conflict do nothing;
  if not found then return false; end if;

  -- Entrenos creados a mano ese día por el mismo equipo: se enlazan en vez de duplicarse
  update public.bookings b set template_id = t.id
    from public.schedule_template t
   where b.day = monday + t.weekday and b.team = t.team and b.kind = 'entreno' and b.template_id is null
     and not exists (select 1 from public.bookings x where x.template_id = t.id and x.day between monday and monday + 6);

  insert into public.bookings (day, start_min, duration_min, team, kind, zone, notes, template_id)
  select monday + t.weekday, t.start_min, t.duration_min, t.team, 'entreno', t.zone, t.notes, t.id
    from public.schedule_template t
   where not exists (select 1 from public.bookings x where x.template_id = t.id and x.day between monday and monday + 6);
  return true;
end;
$$;
revoke all on function private.ensure_week(date) from public, anon;
grant execute on function private.ensure_week(date) to authenticated;

create or replace function public.apply_template(p_day date)
returns boolean
language sql
set search_path = ''
as $$ select private.ensure_week(p_day); $$;
revoke all on function public.apply_template(date) from public, anon;
grant execute on function public.apply_template(date) to authenticated;

-- Borra todos los eventos de una semana y la deja sin publicar (solo coordinadores)
create or replace function private.clear_week(p_day date)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  monday date := p_day - (extract(isodow from p_day)::int - 1);
  n integer;
begin
  if not private.is_coordinator() then
    raise exception 'Solo la coordinación puede borrar una semana' using errcode = '42501';
  end if;
  delete from public.bookings where day between monday and monday + 6;
  get diagnostics n = row_count;
  delete from public.generated_weeks where week_start = monday;
  return n;
end;
$$;
revoke all on function private.clear_week(date) from public, anon;
grant execute on function private.clear_week(date) to authenticated;

create or replace function public.clear_week(p_day date)
returns integer
language sql
set search_path = ''
as $$ select private.clear_week(p_day); $$;
revoke all on function public.clear_week(date) from public, anon;
grant execute on function public.clear_week(date) to authenticated;

-- Cambios en el horario habitual: se aplican desde hoy a las semanas ya publicadas,
-- solo en los entrenos que no se hayan modificado a mano.
create or replace function private.template_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Europe/Madrid')::date;
begin
  if tg_op = 'INSERT' then
    insert into public.bookings (day, start_min, duration_min, team, kind, zone, notes, template_id)
    select g.week_start + new.weekday, new.start_min, new.duration_min, new.team, 'entreno', new.zone, new.notes, new.id
    from public.generated_weeks g
    where g.week_start + new.weekday >= today;
    return new;
  elsif tg_op = 'UPDATE' then
    new.updated_at := now();
    update public.bookings b
       set day = (b.day - (extract(isodow from b.day)::int - 1)) + new.weekday,
           start_min = new.start_min, duration_min = new.duration_min, zone = new.zone, team = new.team, notes = new.notes
     where b.template_id = new.id
       and b.day >= today
       and b.day = (b.day - (extract(isodow from b.day)::int - 1)) + old.weekday
       and b.start_min = old.start_min and b.duration_min = old.duration_min
       and b.zone = old.zone and b.team = old.team;
    return new;
  else
    delete from public.bookings b
     where b.template_id = old.id
       and b.day >= today
       and b.day = (b.day - (extract(isodow from b.day)::int - 1)) + old.weekday
       and b.start_min = old.start_min and b.duration_min = old.duration_min
       and b.zone = old.zone and b.team = old.team;
    return old;
  end if;
end;
$$;
revoke all on function private.template_changed() from public, anon, authenticated;

drop trigger if exists template_after_insert on public.schedule_template;
create trigger template_after_insert after insert on public.schedule_template
  for each row execute function private.template_changed();
drop trigger if exists template_before_update on public.schedule_template;
create trigger template_before_update before update on public.schedule_template
  for each row execute function private.template_changed();
drop trigger if exists template_before_delete on public.schedule_template;
create trigger template_before_delete before delete on public.schedule_template
  for each row execute function private.template_changed();

-- ---------- Tiempo real ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedule_template') then
    alter publication supabase_realtime add table public.schedule_template;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_proposals') then
    alter publication supabase_realtime add table public.match_proposals;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overlap_acks') then
    alter publication supabase_realtime add table public.overlap_acks;
  end if;
end $$;

-- ---------- Recordatorios de la coordinación (pestaña Inicio) ----------
-- Tareas propias del coordinador: qué hay que hacer, equipo (opcional), fecha máxima y fecha de aviso
-- (desde la que pasa de «pendiente» a «urgente»). Solo los ven y gestionan los coordinadores aprobados.
create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  team        text check (char_length(team) <= 40),
  due_date    date,                 -- fecha máxima
  alert_date  date,                 -- fecha de aviso: desde ese día sale como urgente
  notes       text check (char_length(notes) <= 1000),
  booking_id  uuid references public.bookings(id) on delete set null,
  done        boolean not null default false,
  done_at     timestamptz,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reminders_aviso_antes check (alert_date is null or due_date is null or alert_date <= due_date)
);
create index if not exists reminders_pendientes_idx on public.reminders (done, due_date);
create index if not exists reminders_booking_idx on public.reminders (booking_id);
create index if not exists reminders_created_by_idx on public.reminders (created_by);
alter table public.reminders enable row level security;
comment on table public.reminders is 'Recordatorios de la coordinación: equipo opcional, fecha máxima y fecha de aviso (pasa de pendiente a urgente).';

drop policy if exists "Coordinadores ven recordatorios" on public.reminders;
create policy "Coordinadores ven recordatorios" on public.reminders
  for select to authenticated using ((select private.is_coordinator()));
drop policy if exists "Coordinadores crean recordatorios" on public.reminders;
create policy "Coordinadores crean recordatorios" on public.reminders
  for insert to authenticated with check ((select private.is_coordinator()) and created_by = (select auth.uid()));
drop policy if exists "Coordinadores editan recordatorios" on public.reminders;
create policy "Coordinadores editan recordatorios" on public.reminders
  for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));
drop policy if exists "Coordinadores borran recordatorios" on public.reminders;
create policy "Coordinadores borran recordatorios" on public.reminders
  for delete to authenticated using ((select private.is_coordinator()));
revoke all on public.reminders from anon, authenticated;
grant select, insert, update, delete on public.reminders to authenticated;

create or replace function private.reminders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.done and not coalesce(old.done, false) then new.done_at := now(); end if;
  if not new.done then new.done_at := null; end if;
  return new;
end;
$$;
drop trigger if exists reminders_touch on public.reminders;
create trigger reminders_touch before update on public.reminders
  for each row execute function private.reminders_touch();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reminders') then
    alter publication supabase_realtime add table public.reminders;
  end if;
end $$;

-- ---------- Atajos del iPhone: códigos personales para crear recordatorios ----------
-- Cada coordinador genera un código para su iPhone. Solo se guarda su huella (sha256); el código
-- se muestra una vez. La función «atajo-recordatorio» (Edge Function) lo comprueba con la clave de servicio.
create table if not exists public.shortcut_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label         text not null default 'iPhone' check (char_length(btrim(label)) between 1 and 60),
  token_hash    text not null unique check (char_length(token_hash) = 64),
  hint          text check (char_length(hint) <= 12),            -- últimos caracteres, para reconocerlo
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  uses_day      date,
  uses_count    integer not null default 0                       -- usos en uses_day (límite diario)
);
create index if not exists shortcut_tokens_user_idx on public.shortcut_tokens (user_id);
alter table public.shortcut_tokens enable row level security;
comment on table public.shortcut_tokens is 'Códigos personales de los Atajos de iPhone (solo la huella sha256). Los usa la Edge Function atajo-recordatorio.';

drop policy if exists "Ver mis códigos de Atajos" on public.shortcut_tokens;
create policy "Ver mis códigos de Atajos" on public.shortcut_tokens
  for select to authenticated using (user_id = (select auth.uid()) and (select private.is_coordinator()));
drop policy if exists "Revocar mis códigos de Atajos" on public.shortcut_tokens;
create policy "Revocar mis códigos de Atajos" on public.shortcut_tokens
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.shortcut_tokens from anon, authenticated;
grant select (id, label, hint, created_at, last_used_at, uses_day, uses_count), delete on public.shortcut_tokens to authenticated;

-- Genera un código nuevo para el coordinador que llama y lo devuelve (es la única vez que se ve).
-- La parte con privilegios vive en private; la pública es solo la puerta (security invoker).
drop function if exists public.create_shortcut_token(text);
create or replace function private.create_shortcut_token(p_label text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not private.is_coordinator() then
    raise exception 'Solo los coordinadores pueden conectar Atajos';
  end if;
  if (select count(*) from public.shortcut_tokens where user_id = auth.uid()) >= 5 then
    raise exception 'Ya tienes 5 códigos: revoca alguno antes de crear otro';
  end if;
  v_token := 'cfc_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.shortcut_tokens (user_id, label, token_hash, hint)
  values (auth.uid(), coalesce(nullif(btrim(p_label), ''), 'iPhone'), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), right(v_token, 4));
  return v_token;
end;
$$;
revoke all on function private.create_shortcut_token(text) from public, anon;
grant execute on function private.create_shortcut_token(text) to authenticated;
create or replace function public.create_shortcut_token(p_label text default 'iPhone')
returns text
language sql security invoker
set search_path = ''
as $$ select private.create_shortcut_token(p_label); $$;
revoke all on function public.create_shortcut_token(text) from public, anon;
grant execute on function public.create_shortcut_token(text) to authenticated;

-- Origen del recordatorio: creado en la herramienta o desde un Atajo (y el texto que se interpretó)
alter table public.reminders add column if not exists source text not null default 'app' check (source in ('app', 'atajo'));
alter table public.reminders add column if not exists source_text text check (char_length(source_text) <= 2000);
comment on column public.reminders.source is 'app = creado en la herramienta; atajo = creado desde un Atajo del iPhone (interpretado por Claude).';
comment on column public.reminders.source_text is 'Atajos: texto que se envió o que se leyó en la captura (para revisar qué se interpretó).';

-- En espera de otra persona: quién tiene que hacer algo y desde cuándo
alter table public.reminders add column if not exists waiting_on text check (char_length(btrim(waiting_on)) between 1 and 80);
alter table public.reminders add column if not exists waiting_since date;
comment on column public.reminders.waiting_on is 'En espera de otra persona (entrenador, federación…): quién tiene que hacer algo para poder cerrarlo.';
comment on column public.reminders.waiting_since is 'Desde cuándo está en espera de esa persona.';

-- Hora de aviso: notificación al móvil ese día (fecha de aviso o, si falta, fecha máxima) a esa hora
alter table public.reminders add column if not exists alert_time time;
alter table public.reminders add column if not exists alert_sent_sig text check (char_length(alert_sent_sig) <= 40);
comment on column public.reminders.alert_time is 'Hora de la notificación al móvil: se envía ese día (fecha de aviso o, si no hay, fecha máxima) a esa hora.';
comment on column public.reminders.alert_sent_sig is 'Fecha|hora de la notificación ya enviada; si cambian (posponer), se vuelve a avisar.';

-- ---------- Notificaciones push (coordinación) ----------
-- Dispositivos suscritos (Web Push), preferencias de cada coordinador, registro de envíos para no repetir,
-- y una «foto» de las incidencias calculadas por la herramienta (conflictos y cambios) para el resumen diario.
create extension if not exists pg_net with schema extensions;   -- sus funciones viven en el esquema net
create extension if not exists pg_cron;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique check (char_length(endpoint) <= 1000),
  p256dh      text not null check (char_length(p256dh) <= 200),
  auth        text not null check (char_length(auth) <= 100),
  device      text check (char_length(device) <= 80),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  integer not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "Ver mis dispositivos" on public.push_subscriptions;
create policy "Ver mis dispositivos" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Añadir mi dispositivo" on public.push_subscriptions;
create policy "Añadir mi dispositivo" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()) and (select private.is_coordinator()));
drop policy if exists "Actualizar mi dispositivo" on public.push_subscriptions;
create policy "Actualizar mi dispositivo" on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Quitar mi dispositivo" on public.push_subscriptions;
create policy "Quitar mi dispositivo" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table if not exists public.notify_settings (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  notify_time     time not null default '08:30' check (extract(minute from notify_time)::int % 15 = 0),
  kinds           jsonb not null default '{"recordatorios": true, "conflictos": true, "resumen": true, "altas": true}'::jsonb,
  enabled         boolean not null default true,
  last_digest_on  date,
  updated_at      timestamptz not null default now()
);
alter table public.notify_settings enable row level security;
drop policy if exists "Mis preferencias de avisos" on public.notify_settings;
create policy "Mis preferencias de avisos" on public.notify_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select private.is_coordinator()));
revoke all on public.notify_settings from anon, authenticated;
grant select, insert, update, delete on public.notify_settings to authenticated;
comment on table public.notify_settings is 'Hora del aviso diario (tramos de 15 min, hora de Madrid) y qué se notifica a cada coordinador.';

-- Solo la usa la función de envío (clave de servicio): evita repetir el mismo aviso
create table if not exists public.push_log (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  kind      text not null,
  ref       text not null,
  sent_on   date not null default current_date,
  created_at timestamptz not null default now(),
  constraint push_log_unico unique (user_id, kind, ref, sent_on)
);
alter table public.push_log enable row level security;
drop policy if exists "Solo el servidor" on public.push_log;
create policy "Solo el servidor" on public.push_log for select to authenticated using (false);
revoke all on public.push_log from anon, authenticated;

-- Foto de incidencias (conflictos, avisos, cambios) que calcula la herramienta con su motor
create table if not exists public.issue_snapshot (
  id           smallint primary key default 1 check (id = 1),
  computed_at  timestamptz not null default now(),
  items        jsonb not null default '[]'::jsonb
);
alter table public.issue_snapshot enable row level security;
drop policy if exists "Coordinadores leen la foto" on public.issue_snapshot;
create policy "Coordinadores leen la foto" on public.issue_snapshot for select to authenticated using ((select private.is_coordinator()));
drop policy if exists "Coordinadores guardan la foto" on public.issue_snapshot;
create policy "Coordinadores guardan la foto" on public.issue_snapshot for insert to authenticated with check ((select private.is_coordinator()));
drop policy if exists "Coordinadores actualizan la foto" on public.issue_snapshot;
create policy "Coordinadores actualizan la foto" on public.issue_snapshot for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));
revoke all on public.issue_snapshot from anon, authenticated;
grant select, insert, update on public.issue_snapshot to authenticated;

-- Secreto para que la tarea programada llame a la función (se genera aquí, nunca sale de la base de datos)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'notif_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'notif_cron_secret', 'Clave de la tarea programada de notificaciones');
  end if;
end $$;

-- Configuración para la función de envío (solo clave de servicio): secreto de la tarea y claves VAPID
create or replace function public.notif_config()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'cron_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notif_cron_secret'),
    'vapid_private', (select decrypted_secret from vault.decrypted_secrets where name = 'notif_vapid_private'),
    'vapid_public', (select decrypted_secret from vault.decrypted_secrets where name = 'notif_vapid_public'));
$$;
revoke all on function public.notif_config() from public, anon, authenticated;
grant execute on function public.notif_config() to service_role;

-- La función genera las claves VAPID la primera vez y las guarda aquí
create or replace function public.notif_set_vapid(p_private text, p_public text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from vault.secrets where name = 'notif_vapid_private') then
    perform vault.create_secret(p_private, 'notif_vapid_private', 'Clave privada VAPID (Web Push)');
    perform vault.create_secret(p_public, 'notif_vapid_public', 'Clave pública VAPID (Web Push)');
  end if;
end;
$$;
revoke all on function public.notif_set_vapid(text, text) from public, anon, authenticated;
grant execute on function public.notif_set_vapid(text, text) to service_role;

-- Llama a la función de envío (desde la tarea programada y al darse de alta alguien)
create or replace function private.notif_call(p_body jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://wwkfaxrmmbptuithqpxn.supabase.co/functions/v1/notificaciones',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notif_cron_secret')),
    body := p_body,
    timeout_milliseconds := 25000);
end;
$$;
revoke all on function private.notif_call(jsonb) from public, anon, authenticated;

-- Aviso inmediato de altas de entrenadores
create or replace function private.notif_new_profile()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.notif_call(jsonb_build_object('mode', 'altas', 'profile_id', new.id));
  return new;
exception when others then
  return new;   -- nunca bloquear un registro por un aviso
end;
$$;
revoke all on function private.notif_new_profile() from public, anon, authenticated;
drop trigger if exists notif_new_profile on public.profiles;
create trigger notif_new_profile after insert on public.profiles
  for each row execute function private.notif_new_profile();

-- Cada 5 minutos: envía el resumen a quien le toque a esa hora y los recordatorios con hora de aviso
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'notificaciones';
  perform cron.schedule('notificaciones', '*/5 * * * *', $c$ select private.notif_call('{"mode": "tick"}'::jsonb); $c$);
end $$;

-- ---------- Partidos: datos para compartir el horario confirmado (WhatsApp) ----------
-- Jornada, hora de quedada, hora de salida (fuera) y si el campo de fuera está confirmado.
alter table public.bookings add column if not exists matchday smallint check (matchday between 1 and 60);
alter table public.bookings add column if not exists meet_min smallint check (meet_min between 0 and 1439);
alter table public.bookings add column if not exists depart_min smallint check (depart_min between 0 and 1439);
alter table public.bookings add column if not exists venue_confirmed boolean not null default false;
comment on column public.bookings.matchday is 'Partidos: número de jornada (opcional), para el mensaje del horario.';
comment on column public.bookings.meet_min is 'Partidos: hora de quedada (minutos desde las 00:00).';
comment on column public.bookings.depart_min is 'Partidos fuera: hora de salida (minutos desde las 00:00).';
comment on column public.bookings.venue_confirmed is 'Partidos fuera: el campo se ha confirmado antes de compartir el horario.';
alter table public.bookings add column if not exists venue_map_url text check (venue_map_url ~ '^https://' and char_length(venue_map_url) <= 400);
comment on column public.bookings.venue_map_url is 'Partidos fuera: enlace de Google Maps del campo (para el mensaje del horario).';

-- Comunicación del horario confirmado, por dos canales: a la directiva (mensaje semanal con todos los partidos) y al
-- grupo del equipo (mensaje detallado de «Compartir horario»). La firma guarda día|hora|fuera|campo; si cambia, la web
-- avisa de que hay que volver a comunicarlo.
alter table public.bookings add column if not exists communicated_at timestamptz;
alter table public.bookings add column if not exists communicated_sig text check (char_length(communicated_sig) <= 200);
alter table public.bookings add column if not exists board_communicated_at timestamptz;
alter table public.bookings add column if not exists board_communicated_sig text check (char_length(board_communicated_sig) <= 200);
comment on column public.bookings.communicated_at is 'Partidos: cuándo se comunicó el horario confirmado al grupo del equipo (padres, jugadores y entrenadores).';
comment on column public.bookings.communicated_sig is 'Partidos: firma día|hora|fuera|campo al comunicarlo al grupo; si cambia, hay que volver a comunicarlo.';
comment on column public.bookings.board_communicated_at is 'Partidos: cuándo se comunicó el horario confirmado a la directiva (mensaje semanal del finde).';
comment on column public.bookings.board_communicated_sig is 'Partidos: firma día|hora|fuera|campo al comunicarlo a la directiva.';

-- Si cambia el día o la hora del partido, la quedada y la salida dejan de valer; si cambia el campo, deja de estar
-- confirmado. Solo cuando ese mismo cambio no trae ya los valores nuevos.
create or replace function private.match_share_reset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'partido' then
    if (new.day is distinct from old.day or new.start_min is distinct from old.start_min) then
      if new.meet_min is not distinct from old.meet_min then new.meet_min := null; end if;
      if new.depart_min is not distinct from old.depart_min then new.depart_min := null; end if;
    end if;
    if new.venue is distinct from old.venue then
      if new.venue_confirmed is not distinct from old.venue_confirmed then new.venue_confirmed := false; end if;
      if new.venue_map_url is not distinct from old.venue_map_url then new.venue_map_url := null; end if;
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger match_share_reset before update on public.bookings
  for each row execute function private.match_share_reset();
-- La jornada no se rellena en la base de datos: la herramienta la lee de las notas («… · J7 · …») si matchday está vacío.

-- ============================================================
--  Primer coordinador: crea una invitación de coordinador y regístrate
--  con el enlace  https://TU-WEB/#invitacion=TOKEN
--    insert into public.invitations (label, role, expires_at)
--    values ('Primer coordinador', 'coordinador', now() + interval '30 days')
--    returning token;
--  El resto de invitaciones se crean desde la web («Entrenadores › Invitar»).
-- ============================================================

-- ---------- Plantillas: jugadores de cada equipo ----------
-- Dorsal (opcional, único dentro del equipo) y nombre. Las ven y editan los coordinadores
-- y los entrenadores aprobados de ese equipo.
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  team        text not null check (char_length(team) between 1 and 40),
  number      smallint check (number between 0 and 99),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists players_dorsal_unico on public.players (team, number) where number is not null;
create index if not exists players_team_idx on public.players (team);
create index if not exists players_created_by_idx on public.players (created_by);
alter table public.players enable row level security;
comment on table public.players is 'Plantilla de cada equipo: dorsal y nombre. Coordinadores y entrenadores del equipo.';

create or replace function private.can_roster(p_team text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'aprobado'
      and (p.role = 'coordinador' or p_team = any (p.teams))
  );
$$;
revoke all on function private.can_roster(text) from public, anon;
grant execute on function private.can_roster(text) to authenticated;

create or replace function private.players_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists players_touch on public.players;
create trigger players_touch before update on public.players
  for each row execute function private.players_touch();
drop policy if exists "Ven la plantilla de su equipo" on public.players;
create policy "Ven la plantilla de su equipo" on public.players
  for select to authenticated using (private.can_roster(team));
drop policy if exists "Añaden a la plantilla de su equipo" on public.players;
create policy "Añaden a la plantilla de su equipo" on public.players
  for insert to authenticated with check (private.can_roster(team));
drop policy if exists "Editan la plantilla de su equipo" on public.players;
create policy "Editan la plantilla de su equipo" on public.players
  for update to authenticated using (private.can_roster(team)) with check (private.can_roster(team));
drop policy if exists "Quitan de la plantilla de su equipo" on public.players;
create policy "Quitan de la plantilla de su equipo" on public.players
  for delete to authenticated using (private.can_roster(team));
revoke all on public.players from anon, authenticated;
grant select, insert, update, delete on public.players to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
end $$;

-- ---------- Convocables de equipos inferiores ----------
-- El entrenador de un equipo puede proponer como convocables a jugadores del equipo de debajo según las reglas
-- de callup_rules (las ajusta la coordinación; las iniciales son las de abajo). Con sub23_only, solo valen los jugadores
-- que cumplen la condición de su equipo (players.sub23): sub-23 (Senior B → Senior A), 15 cumplidos (Cadete → Juvenil)
-- y 2º año (Infantil A → Cadete).
alter table public.players add column if not exists sub23 boolean not null default false;
comment on column public.players.sub23 is 'Cumple la condición para subir de su equipo (config.js > upFlag): Sub-23 en los Senior, 15 cumplidos en el Cadete, 2º año en el Infantil A.';

-- Estado del jugador (disponibilidad) y notas a tener en cuenta
alter table public.players add column if not exists status text check (status in ('molestias', 'lesion_leve', 'lesion', 'lesion_grave', 'no_disponible'));
alter table public.players add column if not exists status_note text check (char_length(status_note) <= 200);
alter table public.players add column if not exists status_until date;
alter table public.players add column if not exists status_since date;
alter table public.players add column if not exists notes text check (char_length(notes) <= 500);
comment on column public.players.status is 'Disponibilidad: null = disponible; molestias = convocable en duda; lesion_leve/lesion/lesion_grave/no_disponible = no convocable.';
comment on column public.players.status_note is 'Detalle del estado (lesión o motivo de no estar disponible).';
comment on column public.players.status_until is 'Fecha prevista de vuelta (opcional).';
comment on column public.players.status_since is 'Desde cuándo tiene ese estado.';
comment on column public.players.notes is 'A tener en cuenta siempre (p. ej. «el domingo por la mañana no puede»).';
alter table public.players add column if not exists status_team text check (char_length(status_team) <= 40);
comment on column public.players.status_team is 'Con status = no_disponible: equipo superior con el que va (solo si cumple las reglas de convocables).';

create table if not exists public.callup_rules (
  team        text not null,
  from_team   text not null,
  sub23_only  boolean not null default false,
  primary key (team, from_team)
);
alter table public.callup_rules enable row level security;
comment on table public.callup_rules is 'Qué equipo puede tener como convocables a jugadores de qué equipo inferior. Las ajusta la coordinación.';
drop policy if exists "Aprobados ven las reglas de convocables" on public.callup_rules;
create policy "Aprobados ven las reglas de convocables" on public.callup_rules
  for select to authenticated using ((select private.is_approved()));
-- Las reglas las ajusta la coordinación desde Equipos
drop policy if exists "Coordinadores crean reglas de convocables" on public.callup_rules;
create policy "Coordinadores crean reglas de convocables" on public.callup_rules
  for insert to authenticated with check ((select private.is_coordinator()));
drop policy if exists "Coordinadores cambian reglas de convocables" on public.callup_rules;
create policy "Coordinadores cambian reglas de convocables" on public.callup_rules
  for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));
drop policy if exists "Coordinadores quitan reglas de convocables" on public.callup_rules;
create policy "Coordinadores quitan reglas de convocables" on public.callup_rules
  for delete to authenticated using ((select private.is_coordinator()));
revoke all on public.callup_rules from anon, authenticated;
grant select, insert, update, delete on public.callup_rules to authenticated;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'callup_rules_distintos') then
    alter table public.callup_rules add constraint callup_rules_distintos check (team <> from_team) not valid;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'callup_rules') then
    alter publication supabase_realtime add table public.callup_rules;
  end if;
end $$;
insert into public.callup_rules (team, from_team, sub23_only) values
  ('senior-a', 'senior-b', true),
  ('senior-a', 'juvenil', false),
  ('senior-b', 'juvenil', false),
  ('juvenil', 'cadete', true),
  ('cadete', 'infantil-a', true),
  ('infantil-a', 'alevin-a', false),
  ('alevin-a', 'alevin-b', false)
on conflict (team, from_team) do nothing;
comment on column public.callup_rules.sub23_only is 'Solo valen los jugadores que cumplen la condición de su equipo (players.sub23).';

create table if not exists public.player_callups (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players(id) on delete cascade,
  team        text not null check (char_length(team) between 1 and 40),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (player_id, team)
);
-- Lo propone el entrenador (pendiente) y lo aprueba o rechaza la coordinación; si lo añade la coordinación, va aprobado.
alter table public.player_callups add column if not exists status text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado'));
alter table public.player_callups add column if not exists resolved_at timestamptz;
alter table public.player_callups add column if not exists resolved_by uuid references auth.users(id) on delete set null;
create index if not exists player_callups_resolved_by_idx on public.player_callups (resolved_by);
create index if not exists player_callups_pendientes_idx on public.player_callups (status) where status = 'pendiente';
comment on column public.player_callups.status is 'Lo propone el entrenador (pendiente) y lo aprueba o rechaza la coordinación.';
create index if not exists player_callups_team_idx on public.player_callups (team);
create index if not exists player_callups_created_by_idx on public.player_callups (created_by);
alter table public.player_callups enable row level security;
comment on table public.player_callups is 'Jugadores de un equipo inferior que otro equipo tiene en cuenta como convocables.';

create or replace function private.can_see_lower(p_team text, p_sub23 boolean)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.callup_rules r
    where r.from_team = p_team and (not r.sub23_only or p_sub23) and private.can_roster(r.team)
  );
$$;
revoke all on function private.can_see_lower(text, boolean) from public, anon;
grant execute on function private.can_see_lower(text, boolean) to authenticated;

create or replace function private.callup_ok(p_player uuid, p_team text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_roster(p_team) and exists (
    select 1 from public.players p
    join public.callup_rules r on r.from_team = p.team and r.team = p_team
    where p.id = p_player and (not r.sub23_only or p.sub23)
  );
$$;
revoke all on function private.callup_ok(uuid, text) from public, anon;
grant execute on function private.callup_ok(uuid, text) to authenticated;

create or replace function private.can_see_callup(p_player uuid, p_team text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_roster(p_team) or exists (
    select 1 from public.players p where p.id = p_player and private.can_roster(p.team)
  );
$$;
revoke all on function private.can_see_callup(uuid, text) from public, anon;
grant execute on function private.can_see_callup(uuid, text) to authenticated;

drop policy if exists "Ven a los convocables de equipos inferiores" on public.players;
create policy "Ven a los convocables de equipos inferiores" on public.players
  for select to authenticated using (private.can_see_lower(team, sub23));

drop policy if exists "Ven las convocatorias de sus equipos" on public.player_callups;
create policy "Ven las convocatorias de sus equipos" on public.player_callups
  for select to authenticated using (private.can_see_callup(player_id, team));
drop policy if exists "Añaden convocables a su equipo" on public.player_callups;
create policy "Añaden convocables a su equipo" on public.player_callups
  for insert to authenticated with check (private.callup_ok(player_id, team) and (status = 'pendiente' or (select private.is_coordinator())));
drop policy if exists "Coordinadores aprueban convocables" on public.player_callups;
create policy "Coordinadores aprueban convocables" on public.player_callups
  for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));
drop policy if exists "Quitan convocables de sus equipos" on public.player_callups;
create policy "Quitan convocables de sus equipos" on public.player_callups
  for delete to authenticated using (private.can_see_callup(player_id, team));
revoke all on public.player_callups from anon, authenticated;
grant select, insert, delete on public.player_callups to authenticated;
grant update (status, resolved_at, resolved_by) on public.player_callups to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'player_callups') then
    alter publication supabase_realtime add table public.player_callups;
  end if;
end $$;

-- ---------- Ajustes de cada equipo (los cambia la coordinación en Equipos) ----------
create table if not exists public.team_settings (
  team             text primary key check (char_length(team) between 1 and 40),
  meet_before_min  smallint check (meet_before_min between 0 and 240),
  updated_at       timestamptz not null default now(),
  updated_by       uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists team_settings_updated_by_idx on public.team_settings (updated_by);
alter table public.team_settings enable row level security;
comment on table public.team_settings is 'Ajustes de cada equipo que cambia la coordinación (p. ej. cuánto antes del partido se queda en el campo).';
comment on column public.team_settings.meet_before_min is 'Minutos antes del saque para la hora de quedada (si falta, la de config.js > match.meet o 60).';
drop policy if exists "Aprobados ven los ajustes de equipo" on public.team_settings;
create policy "Aprobados ven los ajustes de equipo" on public.team_settings
  for select to authenticated using ((select private.is_approved()));
drop policy if exists "Coordinadores crean ajustes de equipo" on public.team_settings;
create policy "Coordinadores crean ajustes de equipo" on public.team_settings
  for insert to authenticated with check ((select private.is_coordinator()));
drop policy if exists "Coordinadores cambian ajustes de equipo" on public.team_settings;
create policy "Coordinadores cambian ajustes de equipo" on public.team_settings
  for update to authenticated using ((select private.is_coordinator())) with check ((select private.is_coordinator()));
revoke all on public.team_settings from anon, authenticated;
grant select, insert, update on public.team_settings to authenticated;
insert into public.team_settings (team, meet_before_min) values ('senior-a', 75), ('senior-b', 75)
on conflict (team) do nothing;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_settings') then
    alter publication supabase_realtime add table public.team_settings;
  end if;
end $$;
