-- Masters: room types, guest houses, rooms.
-- See ARCHITECTURE.md §4.1–4.3, §6.1 (room cap), §6.8 (taking a room out of service).

-- ---------------------------------------------------------------------------
-- room_types — global catalogue of room categories (§4.1)
-- ---------------------------------------------------------------------------

create table public.room_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint room_types_name_not_blank check (length(trim(name)) > 0)
);

-- Case-insensitive uniqueness: "Deluxe" and "deluxe" are the same category, and
-- allowing both produces two indistinguishable entries in every dropdown.
create unique index idx_room_types_name_lower on public.room_types (lower(trim(name)));

create trigger room_types_set_updated_at
  before update on public.room_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- guest_houses (§4.2)
-- ---------------------------------------------------------------------------

create table public.guest_houses (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  address              text not null,
  total_rooms          integer not null check (total_rooms > 0),
  google_location_url  text,
  contact_person_name  text not null,
  contact_person_phone text not null,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint guest_houses_name_not_blank check (length(trim(name)) > 0),
  constraint guest_houses_address_not_blank check (length(trim(address)) > 0),
  constraint guest_houses_contact_name_not_blank check (length(trim(contact_person_name)) > 0),
  constraint guest_houses_contact_phone_not_blank check (length(trim(contact_person_phone)) > 0)
);

create index idx_guest_houses_active on public.guest_houses (is_active);

create trigger guest_houses_set_updated_at
  before update on public.guest_houses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- rooms — individual physical rooms (§4.3)
--
-- ON DELETE RESTRICT on room_type_id: deleting a type that rooms still
-- reference would orphan them. Types are deactivated, not deleted (§11).
-- ---------------------------------------------------------------------------

create table public.rooms (
  id             uuid primary key default gen_random_uuid(),
  guest_house_id uuid not null references public.guest_houses(id) on delete cascade,
  room_type_id   uuid not null references public.room_types(id) on delete restrict,
  room_number    text not null,
  rate_per_night numeric(10,2) not null check (rate_per_night >= 0),
  capacity       integer not null default 1 check (capacity > 0),
  status         text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint rooms_number_not_blank check (length(trim(room_number)) > 0),
  constraint rooms_unique_number_per_house unique (guest_house_id, room_number)
);

create index idx_rooms_guest_house on public.rooms (guest_house_id);
create index idx_rooms_type on public.rooms (room_type_id);
create index idx_rooms_available on public.rooms (guest_house_id, status) where status = 'ACTIVE';

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Room cap (§6.1)
--
-- A guest house declares total_rooms; the configured rooms may not exceed it.
-- Enforced by trigger rather than in application code so a bulk insert or a
-- direct API call cannot slip past it.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_room_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  declared_total integer;
  current_count  integer;
begin
  select total_rooms into declared_total
    from public.guest_houses
   where id = new.guest_house_id;

  -- Count all rooms including inactive ones: an out-of-service room still
  -- occupies a slot in the building, so it must count against the declared total.
  select count(*) into current_count
    from public.rooms
   where guest_house_id = new.guest_house_id
     and (tg_op = 'INSERT' or id <> new.id);

  if current_count + 1 > declared_total then
    raise exception 'ROOM_CAP_EXCEEDED: guest house already has % of % rooms configured',
      current_count, declared_total
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger rooms_enforce_cap
  before insert or update of guest_house_id on public.rooms
  for each row execute function public.enforce_room_cap();

-- Lowering total_rooms below the number already configured would leave the
-- guest house permanently in violation, so it is rejected up front.
create or replace function public.enforce_total_rooms_not_below_configured()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  configured integer;
begin
  if new.total_rooms >= old.total_rooms then
    return new;
  end if;

  select count(*) into configured
    from public.rooms
   where guest_house_id = new.id;

  if new.total_rooms < configured then
    raise exception 'ROOM_CAP_EXCEEDED: % rooms are already configured; cannot set total to %',
      configured, new.total_rooms
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger guest_houses_enforce_total_rooms
  before update of total_rooms on public.guest_houses
  for each row execute function public.enforce_total_rooms_not_below_configured();

-- ---------------------------------------------------------------------------
-- RLS (§11)
--
-- Everyone signed in and active may read the masters — staff need them to make
-- a booking. Only admins may write.
-- ---------------------------------------------------------------------------

alter table public.room_types   enable row level security;
alter table public.guest_houses enable row level security;
alter table public.rooms        enable row level security;

create policy room_types_read on public.room_types
  for select to authenticated using (public.is_active_user());
create policy room_types_write on public.room_types
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy guest_houses_read on public.guest_houses
  for select to authenticated using (public.is_active_user());
create policy guest_houses_write on public.guest_houses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy rooms_read on public.rooms
  for select to authenticated using (public.is_active_user());
create policy rooms_write on public.rooms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
