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

-- ============================================================
--  Primer coordinador: crea una invitación de coordinador y regístrate
--  con el enlace  https://TU-WEB/#invitacion=TOKEN
--    insert into public.invitations (label, role, expires_at)
--    values ('Primer coordinador', 'coordinador', now() + interval '30 days')
--    returning token;
--  El resto de invitaciones se crean desde la web («Entrenadores › Invitar»).
-- ============================================================
