-- Add the guest house photo to the guest link projection (§8).
--
-- A guest arriving in an unfamiliar town recognises the building from a
-- photograph faster than from an address. The bucket is already public-read
-- for exactly this reason, so the path is safe to expose here.
--
-- Everything else about the projection is unchanged and deliberately narrow:
-- no internal note, no created_by, no contact numbers for the guests, and no
-- ID-proof fields. A guest link grants one booking's public details, nothing
-- more.

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
    'booking_type', b.booking_type,
    'check_in',     b.check_in,
    'check_out',    b.check_out,
    'nights',       (b.check_out - b.check_in),
    'total_amount', b.total_amount,
    -- Shown so a guest can tell a cancelled booking from a live one; the
    -- internal reason text stays private.
    'cancelled',    (b.status in ('CANCELLED', 'NO_SHOW')),
    'guest_house', jsonb_build_object(
      'name',            gh.name,
      'address',         gh.address,
      'location_url',    gh.google_location_url,
      'contact_person',  gh.contact_person_name,
      'contact_phone',   gh.contact_person_phone,
      'image_path',      gh.image_path
    ),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object('room_number', r.room_number, 'room_type', rt.name)
             order by r.room_number)
        from public.booking_rooms br
        join public.rooms r on r.id = br.room_id
        join public.room_types rt on rt.id = r.room_type_id
       where br.booking_id = b.id
    ), '[]'::jsonb),
    -- Names only. A guest list carries ages, phone numbers and ID-proof
    -- numbers, none of which belong on an unauthenticated page.
    'guests', coalesce((
      select jsonb_agg(jsonb_build_object('name', g.name) order by g.created_at)
        from public.booking_guests g where g.booking_id = b.id
    ), '[]'::jsonb)
  )
  from public.bookings b
  join public.guest_houses gh on gh.id = b.guest_house_id
  where b.public_token = p_token;
$$;

revoke all on function public.get_booking_by_token(uuid) from public;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;
