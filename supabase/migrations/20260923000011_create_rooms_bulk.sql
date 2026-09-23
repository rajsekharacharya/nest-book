-- create_rooms_bulk (ARCHITECTURE.md §7, §9.2)
--
-- A guest house is configured in batches: "5 double rooms at 1800, numbers
-- 201-205". Inserting those one request at a time is both slow and unsafe — the
-- room cap trigger (§6.1) fires per row, so a batch that overruns the declared
-- total would leave some rooms created and some not, with no clear way back.
--
-- This inserts the whole batch in one transaction: either every room appears or
-- none does. It also reports WHICH numbers clashed rather than failing on the
-- first one, so the operator can fix the list in a single pass instead of
-- discovering duplicates one at a time.

create or replace function public.create_rooms_bulk(
  p_guest_house_id uuid,
  p_room_type_id   uuid,
  p_room_numbers   text[],
  p_rate           numeric,
  p_capacity       integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numbers    text[];
  v_existing   text[];
  v_declared   integer;
  v_configured integer;
  v_created    integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can configure rooms'
      using errcode = 'insufficient_privilege';
  end if;

  if p_rate is null or p_rate < 0 then
    raise exception 'INVALID_RATE: rate must be zero or more'
      using errcode = 'check_violation';
  end if;

  if p_capacity is null or p_capacity < 1 then
    raise exception 'INVALID_CAPACITY: a room must hold at least one guest'
      using errcode = 'check_violation';
  end if;

  -- Normalise: trim, drop blanks, de-duplicate within the batch itself. Typing
  -- "101, 101" is a slip, not a request for two rooms — and the unique
  -- constraint would reject the whole batch for it.
  select array_agg(distinct trim(n) order by trim(n))
    into v_numbers
    from unnest(coalesce(p_room_numbers, '{}')) as n
   where length(trim(n)) > 0;

  if v_numbers is null or array_length(v_numbers, 1) = 0 then
    raise exception 'NO_ROOM_NUMBERS: supply at least one room number'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.guest_houses where id = p_guest_house_id and is_active
  ) then
    raise exception 'GUEST_HOUSE_INACTIVE: that guest house is not active'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.room_types where id = p_room_type_id and is_active
  ) then
    raise exception 'ROOM_TYPE_INACTIVE: that room type is not available'
      using errcode = 'check_violation';
  end if;

  -- Report every clash at once. Failing on the first duplicate would make the
  -- operator resubmit repeatedly to discover the rest.
  select array_agg(r.room_number order by r.room_number)
    into v_existing
    from public.rooms r
   where r.guest_house_id = p_guest_house_id
     and r.room_number = any(v_numbers);

  if v_existing is not null then
    raise exception 'DUPLICATE_ROOM_NUMBER: already in this guest house: %',
      array_to_string(v_existing, ', ')
      using errcode = 'unique_violation';
  end if;

  -- Check the cap up front so the message can state the real numbers. The
  -- trigger would catch an overrun anyway, but only after partially working
  -- through the batch, and its message cannot mention the batch size.
  select total_rooms into v_declared
    from public.guest_houses where id = p_guest_house_id;

  select count(*) into v_configured
    from public.rooms where guest_house_id = p_guest_house_id;

  if v_configured + array_length(v_numbers, 1) > v_declared then
    raise exception
      'ROOM_CAP_EXCEEDED: % room(s) configured of % declared; this batch of % would exceed it',
      v_configured, v_declared, array_length(v_numbers, 1)
      using errcode = 'check_violation';
  end if;

  insert into public.rooms (guest_house_id, room_type_id, room_number, rate_per_night, capacity)
  select p_guest_house_id, p_room_type_id, n, p_rate, p_capacity
    from unnest(v_numbers) as n;

  get diagnostics v_created = row_count;

  return jsonb_build_object(
    'created',    v_created,
    'numbers',    to_jsonb(v_numbers),
    'configured', v_configured + v_created,
    'declared',   v_declared
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_room
--
-- Rooms are physical: one wrongly typed during setup should be removable, not
-- merely deactivated. But booking_rooms.room_id is ON DELETE RESTRICT, so a room
-- with any booking history cannot go — deleting it would erase part of a
-- booking's record. Those are deactivated instead (§6.8).
-- ---------------------------------------------------------------------------

create or replace function public.delete_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can delete a room'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_count
    from public.booking_rooms where room_id = p_room_id;

  if v_count > 0 then
    raise exception
      'ROOM_HAS_BOOKINGS: this room appears on % booking(s); take it out of service instead', v_count
      using errcode = 'check_violation';
  end if;

  delete from public.rooms where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_room — edit a single room that differs from its batch (§9.2)
-- ---------------------------------------------------------------------------

create or replace function public.update_room(
  p_room_id      uuid,
  p_room_type_id uuid,
  p_room_number  text,
  p_rate         numeric,
  p_capacity     integer
)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_gh   uuid;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can edit a room'
      using errcode = 'insufficient_privilege';
  end if;

  select guest_house_id into v_gh from public.rooms where id = p_room_id;
  if v_gh is null then
    raise exception 'NOT_FOUND: that room no longer exists' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.rooms
     where guest_house_id = v_gh
       and room_number = trim(p_room_number)
       and id <> p_room_id
  ) then
    raise exception 'DUPLICATE_ROOM_NUMBER: % already exists in this guest house', trim(p_room_number)
      using errcode = 'unique_violation';
  end if;

  -- Rate changes apply from now on only. Existing bookings hold their own
  -- snapshot on booking_rooms (§4.5), so repricing never rewrites history.
  update public.rooms
     set room_type_id   = p_room_type_id,
         room_number    = trim(p_room_number),
         rate_per_night = p_rate,
         capacity       = p_capacity
   where id = p_room_id
   returning * into v_room;

  return v_room;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_guest_house
--
-- rooms cascade from guest_houses, but bookings.guest_house_id is ON DELETE
-- RESTRICT, so a guest house that has ever been booked cannot be removed. That
-- is deliberate: deleting it would orphan the booking history it belongs to.
-- ---------------------------------------------------------------------------

create or replace function public.delete_guest_house(p_guest_house_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can delete a guest house'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_count
    from public.bookings where guest_house_id = p_guest_house_id;

  if v_count > 0 then
    raise exception
      'GUEST_HOUSE_HAS_BOOKINGS: % booking(s) belong to this guest house; deactivate it instead', v_count
      using errcode = 'check_violation';
  end if;

  delete from public.guest_houses where id = p_guest_house_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. All four re-check is_admin() internally; the grant is the outer
-- boundary, the check is the real one.
-- ---------------------------------------------------------------------------

revoke all on function public.create_rooms_bulk(uuid, uuid, text[], numeric, integer) from public, anon;
revoke all on function public.delete_room(uuid) from public, anon;
revoke all on function public.update_room(uuid, uuid, text, numeric, integer) from public, anon;
revoke all on function public.delete_guest_house(uuid) from public, anon;

grant execute on function public.create_rooms_bulk(uuid, uuid, text[], numeric, integer) to authenticated;
grant execute on function public.delete_room(uuid) to authenticated;
grant execute on function public.update_room(uuid, uuid, text, numeric, integer) to authenticated;
grant execute on function public.delete_guest_house(uuid) to authenticated;
