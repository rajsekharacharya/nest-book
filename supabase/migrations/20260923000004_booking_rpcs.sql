-- Booking RPCs: the only write path for bookings.
-- See ARCHITECTURE.md §6.2 (validation), §6.4 (amount), §6.5–6.8, §7.
--
-- These are SECURITY DEFINER because no role holds direct insert/update grants
-- on the booking tables (§11) — granting them would let a client write through
-- PostgREST and skip every check below. Each function therefore re-checks the
-- caller's role itself.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.booking_occupant_count(
  p_booking_type text, p_guest_count integer
) returns integer
language sql
immutable
as $$
  -- §5: SELF is the booker alone; OTHER is the listed guests only (the booker
  -- is not staying); COMBINE is the booker plus the listed guests.
  select case p_booking_type
    when 'SELF'    then 1
    when 'OTHER'   then p_guest_count
    when 'COMBINE' then p_guest_count + 1
  end
$$;

create or replace function public.assert_can_write_bookings()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED: your account is inactive or not signed in'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Validates a proposed booking and raises on the first violation.
-- Shared by create and update so the rules cannot drift apart.
create or replace function public.validate_booking(
  p_guest_house_id uuid,
  p_booking_type   text,
  p_check_in       date,
  p_check_out      date,
  p_room_ids       uuid[],
  p_guest_count    integer,
  p_exclude_booking uuid default null
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  gh_active   boolean;
  room_count  integer;
  total_cap   integer;
  occupants   integer;
  conflict    record;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'INVALID_DATES: check-out must be after check-in'
      using errcode = 'check_violation';
  end if;

  select is_active into gh_active from public.guest_houses where id = p_guest_house_id;
  if gh_active is null then
    raise exception 'GUEST_HOUSE_INACTIVE: guest house not found'
      using errcode = 'check_violation';
  elsif not gh_active then
    raise exception 'GUEST_HOUSE_INACTIVE: this guest house is deactivated'
      using errcode = 'check_violation';
  end if;

  if p_room_ids is null or array_length(p_room_ids, 1) is null then
    raise exception 'NO_ROOMS_SELECTED: select at least one room'
      using errcode = 'check_violation';
  end if;

  -- Rooms must exist, belong to this guest house, and be in service.
  select count(*), coalesce(sum(capacity), 0)
    into room_count, total_cap
    from public.rooms
   where id = any(p_room_ids)
     and guest_house_id = p_guest_house_id
     and status = 'ACTIVE';

  if room_count <> array_length(p_room_ids, 1) then
    raise exception 'ROOM_INACTIVE: one or more rooms are unavailable, out of service, or belong to another guest house'
      using errcode = 'check_violation';
  end if;

  if p_booking_type in ('OTHER', 'COMBINE') and coalesce(p_guest_count, 0) < 1 then
    raise exception 'GUEST_LIST_REQUIRED: add at least one guest for this booking type'
      using errcode = 'check_violation';
  end if;

  occupants := public.booking_occupant_count(p_booking_type, coalesce(p_guest_count, 0));
  if occupants > total_cap then
    raise exception 'CAPACITY_EXCEEDED: % guests exceed the selected roomsʼ capacity of %',
      occupants, total_cap
      using errcode = 'check_violation';
  end if;

  -- Explicit availability check. The exclusion constraint on booking_rooms is
  -- the actual guarantee under concurrency; this exists to produce a specific,
  -- human-readable message naming the room and the clashing dates.
  select r.room_number, b.check_in, b.check_out, b.booking_name
    into conflict
    from public.booking_rooms br
    join public.bookings b on b.id = br.booking_id
    join public.rooms r on r.id = br.room_id
   where br.room_id = any(p_room_ids)
     and br.is_blocking
     and (p_exclude_booking is null or br.booking_id <> p_exclude_booking)
     and public.ranges_overlap(b.check_in, b.check_out, p_check_in, p_check_out)
   limit 1;

  if found then
    raise exception 'ROOM_NOT_AVAILABLE: room % is already booked % to % (%)',
      conflict.room_number, conflict.check_in, conflict.check_out, conflict.booking_name
      using errcode = 'exclusion_violation';
  end if;
end;
$$;

create or replace function public.recalculate_booking_total(p_booking_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  nights integer;
  total  numeric(12,2);
begin
  select (check_out - check_in) into nights from public.bookings where id = p_booking_id;

  -- Rates come from the snapshot on booking_rooms, never from rooms — repricing
  -- a room must not rewrite the value of bookings already taken (§4.5).
  select coalesce(sum(rate_per_night), 0) * nights into total
    from public.booking_rooms where booking_id = p_booking_id;

  update public.bookings set total_amount = total where id = p_booking_id;
  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_booking (§7)
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(payload jsonb)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_ids uuid[];
  v_guests   jsonb;
  v_booking  public.bookings;
  v_guest_count integer;
begin
  perform public.assert_can_write_bookings();

  v_room_ids := coalesce(
    (select array_agg((value #>> '{}')::uuid) from jsonb_array_elements(payload -> 'room_ids')),
    '{}'::uuid[]
  );
  v_guests := coalesce(payload -> 'guests', '[]'::jsonb);
  v_guest_count := jsonb_array_length(v_guests);

  perform public.validate_booking(
    (payload ->> 'guest_house_id')::uuid,
    payload ->> 'booking_type',
    (payload ->> 'check_in')::date,
    (payload ->> 'check_out')::date,
    v_room_ids,
    v_guest_count
  );

  insert into public.bookings (
    guest_house_id, booking_name, contact_number, note,
    booking_type, check_in, check_out, created_by, updated_by
  ) values (
    (payload ->> 'guest_house_id')::uuid,
    trim(payload ->> 'booking_name'),
    trim(payload ->> 'contact_number'),
    nullif(trim(coalesce(payload ->> 'note', '')), ''),
    payload ->> 'booking_type',
    (payload ->> 'check_in')::date,
    (payload ->> 'check_out')::date,
    auth.uid(), auth.uid()
  ) returning * into v_booking;

  -- Rate is snapshotted here, at booking time (§4.5).
  insert into public.booking_rooms (booking_id, room_id, rate_per_night)
  select v_booking.id, r.id, r.rate_per_night
    from public.rooms r where r.id = any(v_room_ids);

  -- SELF bookings carry no guest list (§5).
  if payload ->> 'booking_type' <> 'SELF' then
    insert into public.booking_guests (booking_id, name, age, gender, contact_number, id_proof_type, id_proof_number)
    select v_booking.id,
           trim(g ->> 'name'),
           nullif(g ->> 'age', '')::integer,
           nullif(g ->> 'gender', ''),
           nullif(trim(coalesce(g ->> 'contact_number', '')), ''),
           nullif(trim(coalesce(g ->> 'id_proof_type', '')), ''),
           nullif(trim(coalesce(g ->> 'id_proof_number', '')), '')
      from jsonb_array_elements(v_guests) g;
  end if;

  perform public.recalculate_booking_total(v_booking.id);

  insert into public.booking_audit (booking_id, action, actor_id, detail)
  values (v_booking.id, 'CREATED', auth.uid(),
          jsonb_build_object('rooms', v_room_ids, 'guests', v_guest_count));

  select * into v_booking from public.bookings where id = v_booking.id;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_booking (§7)
-- ---------------------------------------------------------------------------

create or replace function public.update_booking(p_booking_id uuid, payload jsonb)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_ids uuid[];
  v_guests   jsonb;
  v_booking  public.bookings;
  v_guest_count integer;
  v_old      public.bookings;
begin
  perform public.assert_can_write_bookings();

  select * into v_old from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'NOT_FOUND: booking does not exist' using errcode = 'no_data_found';
  end if;

  if v_old.status in ('CHECKED_OUT', 'CANCELLED', 'NO_SHOW') then
    raise exception 'INVALID_STATUS_TRANSITION: a % booking cannot be edited', v_old.status
      using errcode = 'check_violation';
  end if;

  v_room_ids := coalesce(
    (select array_agg((value #>> '{}')::uuid) from jsonb_array_elements(payload -> 'room_ids')),
    '{}'::uuid[]
  );
  v_guests := coalesce(payload -> 'guests', '[]'::jsonb);
  v_guest_count := jsonb_array_length(v_guests);

  perform public.validate_booking(
    (payload ->> 'guest_house_id')::uuid,
    payload ->> 'booking_type',
    (payload ->> 'check_in')::date,
    (payload ->> 'check_out')::date,
    v_room_ids,
    v_guest_count,
    p_booking_id
  );

  update public.bookings set
    guest_house_id = (payload ->> 'guest_house_id')::uuid,
    booking_name   = trim(payload ->> 'booking_name'),
    contact_number = trim(payload ->> 'contact_number'),
    note           = nullif(trim(coalesce(payload ->> 'note', '')), ''),
    booking_type   = payload ->> 'booking_type',
    check_in       = (payload ->> 'check_in')::date,
    check_out      = (payload ->> 'check_out')::date,
    updated_by     = auth.uid()
  where id = p_booking_id;

  -- Replace rather than diff: the room set is small, and a full replace keeps
  -- the snapshot rates consistent with whatever is selected now.
  delete from public.booking_rooms where booking_id = p_booking_id;
  insert into public.booking_rooms (booking_id, room_id, rate_per_night)
  select p_booking_id, r.id, r.rate_per_night
    from public.rooms r where r.id = any(v_room_ids);

  delete from public.booking_guests where booking_id = p_booking_id;
  if payload ->> 'booking_type' <> 'SELF' then
    insert into public.booking_guests (booking_id, name, age, gender, contact_number, id_proof_type, id_proof_number)
    select p_booking_id,
           trim(g ->> 'name'),
           nullif(g ->> 'age', '')::integer,
           nullif(g ->> 'gender', ''),
           nullif(trim(coalesce(g ->> 'contact_number', '')), ''),
           nullif(trim(coalesce(g ->> 'id_proof_type', '')), ''),
           nullif(trim(coalesce(g ->> 'id_proof_number', '')), '')
      from jsonb_array_elements(v_guests) g;
  end if;

  perform public.recalculate_booking_total(p_booking_id);

  insert into public.booking_audit (booking_id, action, actor_id, detail)
  values (p_booking_id, 'UPDATED', auth.uid(),
          jsonb_build_object(
            'before', jsonb_build_object('check_in', v_old.check_in, 'check_out', v_old.check_out),
            'after',  jsonb_build_object('check_in', payload ->> 'check_in', 'check_out', payload ->> 'check_out')));

  select * into v_booking from public.bookings where id = p_booking_id;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- change_booking_status (§6.5)
-- ---------------------------------------------------------------------------

create or replace function public.change_booking_status(p_booking_id uuid, p_new_status text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.bookings;
  v_booking public.bookings;
  v_allowed boolean;
begin
  perform public.assert_can_write_bookings();

  select * into v_old from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'NOT_FOUND: booking does not exist' using errcode = 'no_data_found';
  end if;

  -- Cancellation applies only before check-in: once a guest has arrived the
  -- stay happened, and erasing it would falsify occupancy history. A guest
  -- leaving early is an early check-out, not a cancellation (§6.5).
  v_allowed := case
    when v_old.status = 'BOOKED'     and p_new_status in ('CHECKED_IN', 'CANCELLED', 'NO_SHOW') then true
    when v_old.status = 'CHECKED_IN' and p_new_status = 'CHECKED_OUT' then true
    else false
  end;

  if not v_allowed then
    raise exception 'INVALID_STATUS_TRANSITION: cannot move a booking from % to %',
      v_old.status, p_new_status
      using errcode = 'check_violation';
  end if;

  update public.bookings set
    status        = p_new_status,
    checked_in_at  = case when p_new_status = 'CHECKED_IN'  then now() else checked_in_at end,
    checked_out_at = case when p_new_status = 'CHECKED_OUT' then now() else checked_out_at end,
    cancelled_at   = case when p_new_status in ('CANCELLED', 'NO_SHOW') then now() else cancelled_at end,
    updated_by     = auth.uid()
  where id = p_booking_id;

  insert into public.booking_audit (booking_id, action, actor_id, detail)
  values (p_booking_id, 'STATUS_CHANGED', auth.uid(),
          jsonb_build_object('from', v_old.status, 'to', p_new_status));

  select * into v_booking from public.bookings where id = p_booking_id;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_booking (§6.5)
-- ---------------------------------------------------------------------------

create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare v_booking public.bookings;
begin
  v_booking := public.change_booking_status(p_booking_id, 'CANCELLED');

  update public.bookings
     set cancellation_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_booking_id;

  insert into public.booking_audit (booking_id, action, actor_id, detail)
  values (p_booking_id, 'CANCELLED', auth.uid(), jsonb_build_object('reason', p_reason));

  select * into v_booking from public.bookings where id = p_booking_id;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- extend_booking (§6.6)
-- ---------------------------------------------------------------------------

create or replace function public.extend_booking(p_booking_id uuid, p_new_check_out date)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.bookings;
  v_booking public.bookings;
  v_room_ids uuid[];
  conflict record;
begin
  perform public.assert_can_write_bookings();

  select * into v_old from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'NOT_FOUND: booking does not exist' using errcode = 'no_data_found';
  end if;

  if v_old.status not in ('BOOKED', 'CHECKED_IN') then
    raise exception 'INVALID_STATUS_TRANSITION: a % booking cannot be extended', v_old.status
      using errcode = 'check_violation';
  end if;

  if p_new_check_out <= v_old.check_in then
    raise exception 'INVALID_DATES: a stay must be at least one night'
      using errcode = 'check_violation';
  end if;

  -- Only the added nights need checking; shortening frees nights and cannot conflict.
  if p_new_check_out > v_old.check_out then
    select array_agg(room_id) into v_room_ids
      from public.booking_rooms where booking_id = p_booking_id;

    select r.room_number, b.check_in, b.check_out, b.booking_name
      into conflict
      from public.booking_rooms br
      join public.bookings b on b.id = br.booking_id
      join public.rooms r on r.id = br.room_id
     where br.room_id = any(v_room_ids)
       and br.is_blocking
       and br.booking_id <> p_booking_id
       and public.ranges_overlap(b.check_in, b.check_out, v_old.check_out, p_new_check_out)
     limit 1;

    if found then
      raise exception 'ROOM_NOT_AVAILABLE: room % is booked % to % (%) — cannot extend',
        conflict.room_number, conflict.check_in, conflict.check_out, conflict.booking_name
        using errcode = 'exclusion_violation';
    end if;
  end if;

  update public.bookings
     set check_out = p_new_check_out, updated_by = auth.uid()
   where id = p_booking_id;

  perform public.recalculate_booking_total(p_booking_id);

  insert into public.booking_audit (booking_id, action, actor_id, detail)
  values (p_booking_id, 'EXTENDED', auth.uid(),
          jsonb_build_object('from', v_old.check_out, 'to', p_new_check_out));

  select * into v_booking from public.bookings where id = p_booking_id;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- change_booking_rooms (§6.7)
-- ---------------------------------------------------------------------------

create or replace function public.change_booking_rooms(p_booking_id uuid, p_room_ids uuid[])
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.bookings;
  v_booking public.bookings;
  v_guest_count integer;
begin
  perform public.assert_can_write_bookings();

  select * into v_old from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'NOT_FOUND: booking does not exist' using errcode = 'no_data_found';
  end if;

  if v_old.status not in ('BOOKED', 'CHECKED_IN') then
    raise exception 'INVALID_STATUS_TRANSITION: rooms cannot be changed on a % booking', v_old.status
      using errcode = 'check_violation';
  end if;

  select count(*) into v_guest_count from public.booking_guests where booking_id = p_booking_id;

  perform public.validate_booking(
    v_old.guest_house_id, v_old.booking_type, v_old.check_in, v_old.check_out,
    p_room_ids, v_guest_count, p_booking_id
  );

  delete from public.booking_rooms where booking_id = p_booking_id;
  insert into public.booking_rooms (booking_id, room_id, rate_per_night)
  select p_booking_id, r.id, r.rate_per_night
    from public.rooms r where r.id = any(p_room_ids);

  perform public.recalculate_booking_total(p_booking_id);

  insert into public.booking_audit (booking_id, action, actor_id, detail)
  values (p_booking_id, 'ROOMS_CHANGED', auth.uid(), jsonb_build_object('rooms', p_room_ids));

  select * into v_booking from public.bookings where id = p_booking_id;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- check_room_availability (§7) — powers the booking form's room picker
-- ---------------------------------------------------------------------------

create or replace function public.check_room_availability(
  p_guest_house_id uuid,
  p_check_in date,
  p_check_out date,
  p_exclude_booking uuid default null
) returns table (
  room_id uuid,
  room_number text,
  room_type_name text,
  rate_per_night numeric,
  capacity integer,
  is_available boolean,
  blocked_by text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.room_number,
    rt.name,
    r.rate_per_night,
    r.capacity,
    conflict.booking_name is null,
    conflict.booking_name
  from public.rooms r
  join public.room_types rt on rt.id = r.room_type_id
  left join lateral (
    select b.booking_name
      from public.booking_rooms br
      join public.bookings b on b.id = br.booking_id
     where br.room_id = r.id
       and br.is_blocking
       and (p_exclude_booking is null or br.booking_id <> p_exclude_booking)
       and public.ranges_overlap(b.check_in, b.check_out, p_check_in, p_check_out)
     limit 1
  ) conflict on true
  where r.guest_house_id = p_guest_house_id
    and r.status = 'ACTIVE'
  order by r.room_number;
$$;

-- ---------------------------------------------------------------------------
-- set_room_status (§6.8)
-- ---------------------------------------------------------------------------

create or replace function public.set_room_status(p_room_id uuid, p_status text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can change room status'
      using errcode = 'insufficient_privilege';
  end if;

  -- Taking a room out of service while guests are booked into it would hide a
  -- real clash: the room stops appearing in new bookings but silently keeps its
  -- existing ones. Those guests must be moved first (§6.8).
  if p_status = 'INACTIVE' then
    select count(*) into v_count
      from public.booking_rooms br
      join public.bookings b on b.id = br.booking_id
     where br.room_id = p_room_id
       and br.is_blocking
       and b.check_out > current_date;

    if v_count > 0 then
      raise exception 'ROOM_HAS_BOOKINGS: % current or future booking(s) use this room; move them first', v_count
        using errcode = 'check_violation';
    end if;
  end if;

  update public.rooms set status = p_status where id = p_room_id returning * into v_room;
  return v_room;
end;
$$;

-- ---------------------------------------------------------------------------
-- rotate_booking_token (§8)
-- ---------------------------------------------------------------------------

create or replace function public.rotate_booking_token(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_token uuid;
begin
  perform public.assert_can_write_bookings();

  update public.bookings
     set public_token = gen_random_uuid(), updated_by = auth.uid()
   where id = p_booking_id
   returning public_token into v_token;

  if v_token is null then
    raise exception 'NOT_FOUND: booking does not exist' using errcode = 'no_data_found';
  end if;

  insert into public.booking_audit (booking_id, action, actor_id)
  values (p_booking_id, 'TOKEN_ROTATED', auth.uid());

  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_booking_by_token (§8) — the ONLY anonymous read path in the system
--
-- Returns a deliberately restricted projection. Internal notes, created_by,
-- and the guest list's ID-proof fields are never exposed: a guest link grants
-- exactly one booking's public details and nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.get_booking_by_token(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'booking_name', b.booking_name,
    'status',       b.status,
    'check_in',     b.check_in,
    'check_out',    b.check_out,
    'nights',       (b.check_out - b.check_in),
    'total_amount', b.total_amount,
    'guest_house', jsonb_build_object(
      'name',            gh.name,
      'address',         gh.address,
      'location_url',    gh.google_location_url,
      'contact_person',  gh.contact_person_name,
      'contact_phone',   gh.contact_person_phone
    ),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object('room_number', r.room_number, 'room_type', rt.name)
             order by r.room_number)
        from public.booking_rooms br
        join public.rooms r on r.id = br.room_id
        join public.room_types rt on rt.id = r.room_type_id
       where br.booking_id = b.id
    ), '[]'::jsonb),
    'guests', coalesce((
      select jsonb_agg(jsonb_build_object('name', g.name) order by g.created_at)
        from public.booking_guests g where g.booking_id = b.id
    ), '[]'::jsonb)
  )
  from public.bookings b
  join public.guest_houses gh on gh.id = b.guest_house_id
  where b.public_token = p_token;
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Only the token lookup is reachable anonymously. Everything else requires a
-- signed-in user, and each function re-checks the caller's role internally.
-- ---------------------------------------------------------------------------

revoke all on function public.validate_booking(uuid, text, date, date, uuid[], integer, uuid) from public, anon, authenticated;
revoke all on function public.recalculate_booking_total(uuid) from public, anon, authenticated;
revoke all on function public.assert_can_write_bookings() from public, anon, authenticated;

grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;

grant execute on function public.create_booking(jsonb) to authenticated;
grant execute on function public.update_booking(uuid, jsonb) to authenticated;
grant execute on function public.change_booking_status(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.extend_booking(uuid, date) to authenticated;
grant execute on function public.change_booking_rooms(uuid, uuid[]) to authenticated;
grant execute on function public.check_room_availability(uuid, date, date, uuid) to authenticated;
grant execute on function public.set_room_status(uuid, text) to authenticated;
grant execute on function public.rotate_booking_token(uuid) to authenticated;
grant execute on function public.booking_occupant_count(text, integer) to authenticated;
