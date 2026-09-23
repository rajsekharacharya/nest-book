-- Booking core: bookings, room holds, guest lists, audit trail.
-- See ARCHITECTURE.md §4.4–4.7, §5 (booking types), §6.2–6.5.

-- ---------------------------------------------------------------------------
-- Shared date-overlap definition (§6.3)
--
-- Half-open semantics: checkout day is free for a new check-in, so a guest
-- leaving on the 10th does not block someone arriving on the 10th.
-- This is the ONLY definition of overlap in the system.
-- ---------------------------------------------------------------------------

create or replace function public.ranges_overlap(
  a_from date, a_to date, b_from date, b_to date
) returns boolean
language sql
immutable
as $$
  select a_from < b_to and a_to > b_from
$$;

-- ---------------------------------------------------------------------------
-- bookings (§4.4)
-- ---------------------------------------------------------------------------

create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  guest_house_id      uuid not null references public.guest_houses(id) on delete restrict,
  booking_name        text not null,
  contact_number      text not null,
  note                text,
  booking_type        text not null check (booking_type in ('SELF', 'OTHER', 'COMBINE')),
  check_in            date not null,
  check_out           date not null,
  status              text not null default 'BOOKED'
                        check (status in ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW')),
  cancellation_reason text,
  cancelled_at        timestamptz,
  checked_in_at       timestamptz,
  checked_out_at      timestamptz,
  total_amount        numeric(12,2) not null default 0 check (total_amount >= 0),
  public_token        uuid not null unique default gen_random_uuid(),
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint bookings_dates_ordered check (check_out > check_in),
  constraint bookings_name_not_blank check (length(trim(booking_name)) > 0),
  constraint bookings_contact_not_blank check (length(trim(contact_number)) > 0)
);

create index idx_bookings_house_dates on public.bookings (guest_house_id, check_in, check_out);
create index idx_bookings_status on public.bookings (status);
create index idx_bookings_check_in on public.bookings (check_in);
create index idx_bookings_check_out on public.bookings (check_out);
create index idx_bookings_contact on public.bookings (contact_number);
-- Trigram index for the fuzzy guest-name search on the booking list (§9.4).
create index idx_bookings_name_trgm on public.bookings using gin (booking_name gin_trgm_ops);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- A booking blocks its rooms unless it was cancelled or the guest never showed.
create or replace function public.booking_is_blocking(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status not in ('CANCELLED', 'NO_SHOW')
$$;

-- ---------------------------------------------------------------------------
-- booking_rooms (§4.5)
--
-- stay and is_blocking are denormalised from the parent booking because an
-- exclusion constraint can only reference columns on its own table. Both are
-- maintained by trigger and never written by a client.
-- ---------------------------------------------------------------------------

create table public.booking_rooms (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  room_id        uuid not null references public.rooms(id) on delete restrict,
  rate_per_night numeric(10,2) not null check (rate_per_night >= 0),
  stay           daterange not null,
  is_blocking    boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint booking_rooms_unique_room unique (booking_id, room_id)
);

create index idx_booking_rooms_booking on public.booking_rooms (booking_id);
create index idx_booking_rooms_room on public.booking_rooms (room_id);

-- THE double-booking guard (§6.2).
--
-- Checking availability with a SELECT and then inserting is a read-then-write
-- race: two staff booking the same room at the same moment both pass the check
-- and both inserts succeed. No application logic can close that window — only
-- the database can. This constraint makes overlapping holds on one room
-- physically impossible, whatever the timing.
--
-- The half-open daterange '[in, out)' encodes the checkout-day-free rule from
-- §6.3 natively, so the constraint and ranges_overlap() agree by construction.
alter table public.booking_rooms
  add constraint booking_rooms_no_overlap
  exclude using gist (
    room_id with =,
    stay with &&
  ) where (is_blocking);

-- ---------------------------------------------------------------------------
-- Keep booking_rooms in step with its parent booking.
-- ---------------------------------------------------------------------------

create or replace function public.sync_booking_room_stay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = new.booking_id;
  new.stay := daterange(b.check_in, b.check_out, '[)');
  new.is_blocking := public.booking_is_blocking(b.status);
  return new;
end;
$$;

create trigger booking_rooms_sync_stay
  before insert or update of booking_id on public.booking_rooms
  for each row execute function public.sync_booking_room_stay();

-- When a booking's dates or status change, every room hold must follow —
-- otherwise a cancelled booking would keep blocking its rooms, and a date
-- change would leave the constraint guarding the wrong window.
create or replace function public.cascade_booking_change_to_rooms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.check_in is distinct from old.check_in
     or new.check_out is distinct from old.check_out
     or new.status is distinct from old.status then
    update public.booking_rooms
       set stay = daterange(new.check_in, new.check_out, '[)'),
           is_blocking = public.booking_is_blocking(new.status)
     where booking_id = new.id;
  end if;
  return new;
end;
$$;

create trigger bookings_cascade_to_rooms
  after update of check_in, check_out, status on public.bookings
  for each row execute function public.cascade_booking_change_to_rooms();

-- ---------------------------------------------------------------------------
-- booking_guests (§4.6)
-- ---------------------------------------------------------------------------

create table public.booking_guests (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  name            text not null,
  age             integer check (age is null or (age >= 0 and age < 130)),
  gender          text check (gender is null or gender in ('MALE', 'FEMALE', 'OTHER')),
  contact_number  text,
  id_proof_type   text,
  id_proof_number text,
  created_at      timestamptz not null default now(),
  constraint booking_guests_name_not_blank check (length(trim(name)) > 0)
);

create index idx_booking_guests_booking on public.booking_guests (booking_id);

-- ---------------------------------------------------------------------------
-- booking_audit (§4.7)
--
-- updated_by alone only ever shows the last writer. Bookings carry money and
-- disputes, so every state change is appended here, inside the same
-- transaction as the change itself.
-- ---------------------------------------------------------------------------

create table public.booking_audit (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  action     text not null check (action in (
               'CREATED', 'UPDATED', 'STATUS_CHANGED', 'EXTENDED',
               'ROOMS_CHANGED', 'CANCELLED', 'TOKEN_ROTATED')),
  actor_id   uuid references public.profiles(id) on delete set null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index idx_booking_audit_booking on public.booking_audit (booking_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS (§11)
--
-- Read-only for signed-in staff; deletes for admins only. No role holds direct
-- insert or update grants on these tables — every write goes through the
-- validating RPCs in migration 4, so a client cannot skip the availability and
-- capacity checks by calling PostgREST directly.
-- ---------------------------------------------------------------------------

alter table public.bookings       enable row level security;
alter table public.booking_rooms  enable row level security;
alter table public.booking_guests enable row level security;
alter table public.booking_audit  enable row level security;

create policy bookings_read on public.bookings
  for select to authenticated using (public.is_active_user());
create policy bookings_delete_admin on public.bookings
  for delete to authenticated using (public.is_admin());

create policy booking_rooms_read on public.booking_rooms
  for select to authenticated using (public.is_active_user());
create policy booking_rooms_delete_admin on public.booking_rooms
  for delete to authenticated using (public.is_admin());

create policy booking_guests_read on public.booking_guests
  for select to authenticated using (public.is_active_user());
create policy booking_guests_delete_admin on public.booking_guests
  for delete to authenticated using (public.is_admin());

-- Audit is append-only from the API's perspective: readable by admins, never
-- updatable or deletable by anyone. Rows are written by SECURITY DEFINER RPCs.
create policy booking_audit_read_admin on public.booking_audit
  for select to authenticated using (public.is_admin());
