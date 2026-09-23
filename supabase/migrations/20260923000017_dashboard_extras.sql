-- Richer dashboard data (extends §9.1).
--
-- Adds four things the first version could not show:
--   * a six-month revenue trend, so this month has something to be judged against
--   * per-guest-house occupancy, which is where an owner with two properties
--     actually looks — a single blended percentage hides a half-empty building
--   * room-type mix, to show what is actually selling
--   * status breakdown of live bookings
--
-- Kept in the same single round trip; the dashboard still makes one call.

create or replace function public.get_dashboard_extras()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_result jsonb;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED: sign in to view the dashboard'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(

    -- Revenue by month, six back including this one. Attributed by check-in
    -- date, matching how month_total is computed, so the last bar and the
    -- headline figure always agree.
    'revenue_months', coalesce((
      select jsonb_agg(jsonb_build_object(
               'month', to_char(m.month, 'YYYY-MM'),
               'label', to_char(m.month, 'Mon'),
               'total', coalesce((
                 select sum(b.total_amount) from public.bookings b
                  where b.status not in ('CANCELLED', 'NO_SHOW')
                    and b.check_in >= m.month
                    and b.check_in < m.month + interval '1 month'
               ), 0),
               'bookings', coalesce((
                 select count(*) from public.bookings b
                  where b.status not in ('CANCELLED', 'NO_SHOW')
                    and b.check_in >= m.month
                    and b.check_in < m.month + interval '1 month'
               ), 0)
             ) order by m.month)
        from generate_series(
               date_trunc('month', v_today) - interval '5 months',
               date_trunc('month', v_today),
               interval '1 month') as m(month)
    ), '[]'::jsonb),

    -- Per-property occupancy today. An owner with two guest houses needs these
    -- apart: one full and one empty averages to "fine" and tells them nothing.
    'houses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', gh.id,
               'name', gh.name,
               'rooms', stats.total_rooms,
               'occupied', stats.occupied,
               'percent', case when stats.total_rooms = 0 then 0
                          else round(stats.occupied::numeric * 100 / stats.total_rooms) end
             ) order by gh.name)
        from public.guest_houses gh
        join lateral (
          select
            (select count(*) from public.rooms r
              where r.guest_house_id = gh.id and r.status = 'ACTIVE') as total_rooms,
            (select count(distinct br.room_id)
               from public.booking_rooms br
               join public.bookings b on b.id = br.booking_id
               join public.rooms r on r.id = br.room_id
              where r.guest_house_id = gh.id
                and br.is_blocking
                and b.check_in <= v_today and b.check_out > v_today) as occupied
        ) stats on true
       where gh.is_active
    ), '[]'::jsonb),

    -- What is actually selling, by room type.
    'room_types', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', rt.name,
               'rooms', stats.total_rooms,
               'occupied', stats.occupied
             ) order by stats.total_rooms desc, rt.name)
        from public.room_types rt
        join lateral (
          select
            (select count(*) from public.rooms r
               join public.guest_houses gh on gh.id = r.guest_house_id
              where r.room_type_id = rt.id and r.status = 'ACTIVE' and gh.is_active) as total_rooms,
            (select count(distinct br.room_id)
               from public.booking_rooms br
               join public.bookings b on b.id = br.booking_id
               join public.rooms r on r.id = br.room_id
              where r.room_type_id = rt.id
                and br.is_blocking
                and b.check_in <= v_today and b.check_out > v_today) as occupied
        ) stats on true
       where rt.is_active and stats.total_rooms > 0
    ), '[]'::jsonb),

    -- Live pipeline: what is booked ahead versus in house right now.
    'status_mix', jsonb_build_object(
      'booked', (select count(*) from public.bookings
                  where status = 'BOOKED' and check_out > v_today),
      'checked_in', (select count(*) from public.bookings where status = 'CHECKED_IN'),
      'upcoming_week', (select count(*) from public.bookings
                         where status = 'BOOKED'
                           and check_in > v_today and check_in <= v_today + 7)
    ),

    -- Average nightly rate actually achieved this month, from the snapshots
    -- (§4.5) rather than current room rates — repricing must not rewrite it.
    'avg_rate', coalesce((
      select round(avg(br.rate_per_night))
        from public.booking_rooms br
        join public.bookings b on b.id = br.booking_id
       where br.is_blocking
         and b.check_in >= date_trunc('month', v_today)
         and b.check_in < date_trunc('month', v_today) + interval '1 month'
    ), 0)

  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_dashboard_extras() from public, anon;
grant execute on function public.get_dashboard_extras() to authenticated;
