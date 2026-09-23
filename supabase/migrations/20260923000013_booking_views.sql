-- Read paths for the booking list and calendar (ARCHITECTURE.md §9.4).
--
-- bookings already carries a read policy, so the list could go through
-- PostgREST. These exist because both screens need data assembled across four
-- tables, and doing that client-side means one request per booking — the
-- classic N+1 that makes a list of forty bookings feel broken.

-- ---------------------------------------------------------------------------
-- list_bookings — the list view, with its filters applied server-side
--
-- Filtering in SQL rather than fetching everything and filtering in the browser:
-- a guest house accumulates bookings indefinitely, and "all of them, every time
-- the page opens" stops working well before it stops working entirely.
-- ---------------------------------------------------------------------------

create or replace function public.list_bookings(
  p_guest_house_id uuid    default null,
  p_status         text[]  default null,
  p_from           date    default null,
  p_to             date    default null,
  p_search         text    default null,
  p_limit          integer default 100,
  p_offset         integer default 0
)
returns table (
  id              uuid,
  guest_house_id  uuid,
  guest_house_name text,
  booking_name    text,
  contact_number  text,
  note            text,
  booking_type    text,
  check_in        date,
  check_out       date,
  status          text,
  total_amount    numeric,
  public_token    uuid,
  room_numbers    text[],
  guest_count     integer,
  occupant_count  integer,
  created_at      timestamptz,
  total_count     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select b.*, gh.name as gh_name
      from public.bookings b
      join public.guest_houses gh on gh.id = b.guest_house_id
     -- SECURITY DEFINER bypasses RLS, so the read gate must be explicit here.
     -- Without it a deactivated account would keep full read access.
     where public.is_active_user()
       and (p_guest_house_id is null or b.guest_house_id = p_guest_house_id)
       and (p_status is null or b.status = any(p_status))
       -- A date filter asks "which bookings touch this window", so it uses the
       -- overlap rule (§6.3) rather than comparing check_in alone — a stay
       -- already running when the window opens must still appear.
       and (p_from is null or p_to is null or public.ranges_overlap(b.check_in, b.check_out, p_from, p_to))
       and (p_from is null or p_to is not null or b.check_out > p_from)
       and (p_to is null or p_from is not null or b.check_in < p_to)
       and (
         p_search is null
         or length(trim(p_search)) = 0
         or b.booking_name ilike '%' || trim(p_search) || '%'
         or b.contact_number ilike '%' || trim(p_search) || '%'
       )
  )
  select
    f.id,
    f.guest_house_id,
    f.gh_name,
    f.booking_name,
    f.contact_number,
    f.note,
    f.booking_type,
    f.check_in,
    f.check_out,
    f.status,
    f.total_amount,
    f.public_token,
    coalesce(rooms.numbers, '{}'),
    coalesce(guests.count, 0)::integer,
    public.booking_occupant_count(f.booking_type, coalesce(guests.count, 0)::integer),
    f.created_at,
    count(*) over () as total_count
  from filtered f
  left join lateral (
    select array_agg(r.room_number order by r.room_number) as numbers
      from public.booking_rooms br
      join public.rooms r on r.id = br.room_id
     where br.booking_id = f.id
  ) rooms on true
  left join lateral (
    select count(*) as count
      from public.booking_guests bg
     where bg.booking_id = f.id
  ) guests on true
  -- Soonest arrival first: a front desk works forwards from today.
  order by f.check_in, f.booking_name
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ---------------------------------------------------------------------------
-- get_booking_detail — one booking with everything attached (§9.5)
-- ---------------------------------------------------------------------------

create or replace function public.get_booking_detail(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id,
    'guest_house_id', b.guest_house_id,
    'guest_house_name', gh.name,
    'guest_house_address', gh.address,
    'booking_name', b.booking_name,
    'contact_number', b.contact_number,
    'note', b.note,
    'booking_type', b.booking_type,
    'check_in', b.check_in,
    'check_out', b.check_out,
    'status', b.status,
    'cancellation_reason', b.cancellation_reason,
    'cancelled_at', b.cancelled_at,
    'checked_in_at', b.checked_in_at,
    'checked_out_at', b.checked_out_at,
    'total_amount', b.total_amount,
    'public_token', b.public_token,
    'created_at', b.created_at,
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'room_id', r.id,
        'room_number', r.room_number,
        'room_type_name', rt.name,
        -- The snapshot, not rooms.rate_per_night: repricing a room must never
        -- rewrite what a past booking cost (§4.5).
        'rate_per_night', br.rate_per_night,
        'capacity', r.capacity
      ) order by r.room_number)
      from public.booking_rooms br
      join public.rooms r on r.id = br.room_id
      join public.room_types rt on rt.id = r.room_type_id
     where br.booking_id = b.id
    ), '[]'::jsonb),
    'guests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'age', g.age,
        'gender', g.gender,
        'contact_number', g.contact_number,
        'id_proof_type', g.id_proof_type,
        'id_proof_number', g.id_proof_number
      ) order by g.created_at)
      from public.booking_guests g
     where g.booking_id = b.id
    ), '[]'::jsonb)
  )
  from public.bookings b
  join public.guest_houses gh on gh.id = b.guest_house_id
  where b.id = p_booking_id
    and public.is_active_user();
$$;

-- ---------------------------------------------------------------------------
-- get_calendar — the month grid (§9.4)
--
-- Returns one row per room, with its bookings in the window as JSON. Rooms with
-- no bookings are included: an occupancy grid that omits empty rooms cannot show
-- where the free space is, which is most of the reason to look at it.
--
-- Only the visible window is queried. Cancelled and no-show bookings are absent
-- because is_blocking is false for them (§6.3) — they released their rooms.
-- ---------------------------------------------------------------------------

create or replace function public.get_calendar(
  p_from date,
  p_to   date,
  p_guest_house_id uuid default null
)
returns table (
  guest_house_id   uuid,
  guest_house_name text,
  room_id          uuid,
  room_number      text,
  room_type_name   text,
  room_status      text,
  bookings         jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gh.id,
    gh.name,
    r.id,
    r.room_number,
    rt.name,
    r.status,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'booking_name', b.booking_name,
        'check_in', b.check_in,
        'check_out', b.check_out,
        'status', b.status,
        'booking_type', b.booking_type
      ) order by b.check_in)
      from public.booking_rooms br
      join public.bookings b on b.id = br.booking_id
     where br.room_id = r.id
       and br.is_blocking
       and public.ranges_overlap(b.check_in, b.check_out, p_from, p_to)
    ), '[]'::jsonb)
  from public.rooms r
  join public.guest_houses gh on gh.id = r.guest_house_id
  join public.room_types rt on rt.id = r.room_type_id
  where public.is_active_user()
    and (p_guest_house_id is null or r.guest_house_id = p_guest_house_id)
    and gh.is_active
  order by gh.name, r.room_number;
$$;

-- ---------------------------------------------------------------------------
-- find_previous_guest — repeat-guest prefill (§9.3)
--
-- Most guest houses have returning visitors, and retyping their details is both
-- slow and a source of inconsistent records. Past bookings are the source;
-- there is no separate guest master.
-- ---------------------------------------------------------------------------

create or replace function public.find_previous_guest(p_contact_number text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'booking_name', b.booking_name,
    'booking_type', b.booking_type,
    'last_stay', b.check_in,
    'guests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', g.name, 'age', g.age, 'gender', g.gender,
        'contact_number', g.contact_number,
        'id_proof_type', g.id_proof_type,
        'id_proof_number', g.id_proof_number
      ) order by g.created_at)
      from public.booking_guests g where g.booking_id = b.id
    ), '[]'::jsonb)
  )
  from public.bookings b
  where public.is_active_user()
    and length(trim(coalesce(p_contact_number, ''))) >= 6
    and b.contact_number = trim(p_contact_number)
  order by b.created_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Every function gates on is_active_user() or, for list_bookings,
-- inherits the caller's own read policy through the joined tables.
-- ---------------------------------------------------------------------------

revoke all on function public.list_bookings(uuid, text[], date, date, text, integer, integer) from public, anon;
revoke all on function public.get_booking_detail(uuid) from public, anon;
revoke all on function public.get_calendar(date, date, uuid) from public, anon;
revoke all on function public.find_previous_guest(text) from public, anon;

grant execute on function public.list_bookings(uuid, text[], date, date, text, integer, integer) to authenticated;
grant execute on function public.get_booking_detail(uuid) to authenticated;
grant execute on function public.get_calendar(date, date, uuid) to authenticated;
grant execute on function public.find_previous_guest(text) to authenticated;
