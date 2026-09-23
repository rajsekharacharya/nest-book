-- Tighten function grants.
--
-- PostgREST exposes any function the anon role can execute. check_room_availability
-- is SECURITY DEFINER, so it bypasses RLS by design — without an explicit caller
-- check an anonymous visitor could enumerate a guest house's room numbers, rates,
-- and occupancy by supplying a guest house id. It now refuses non-users outright.

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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED: sign in to check availability'
      using errcode = 'insufficient_privilege';
  end if;

  return query
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
end;
$$;

revoke all on function public.check_room_availability(uuid, date, date, uuid) from public, anon;
grant execute on function public.check_room_availability(uuid, date, date, uuid) to authenticated;

-- Same reasoning for the occupant-count helper: harmless, but there is no
-- reason for it to be reachable without a session.
revoke all on function public.booking_occupant_count(text, integer) from public, anon;
grant execute on function public.booking_occupant_count(text, integer) to authenticated;

revoke all on function public.ranges_overlap(date, date, date, date) from public, anon;
grant execute on function public.ranges_overlap(date, date, date, date) to authenticated;

revoke all on function public.booking_is_blocking(text) from public, anon;
grant execute on function public.booking_is_blocking(text) to authenticated;

-- Role helpers must not be callable by anonymous clients either.
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;
