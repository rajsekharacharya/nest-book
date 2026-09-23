-- get_dashboard_stats (ARCHITECTURE.md §9.1)
--
-- One round trip. The dashboard opens dozens of times a day, and assembling it
-- from eight separate queries would make the first screen the slowest.
--
-- Every figure below uses the half-open rule (§6.3): a stay occupies a room on
-- its check-in date but NOT on its check-out date, because the room is free for
-- a new arrival that day. Cancelled and no-show bookings are excluded
-- throughout via is_blocking — they released their rooms.

create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today        date := current_date;
  v_month_start  date := date_trunc('month', current_date)::date;
  v_month_end    date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_total_rooms  integer;
  v_occupied     integer;
  v_result       jsonb;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED: sign in to view the dashboard'
      using errcode = 'insufficient_privilege';
  end if;

  -- Out-of-service rooms are excluded from the denominator: a room under
  -- maintenance cannot be sold, so counting it would understate occupancy and
  -- make the number look worse than the business is doing.
  select count(*) into v_total_rooms
    from public.rooms r
    join public.guest_houses gh on gh.id = r.guest_house_id
   where r.status = 'ACTIVE' and gh.is_active;

  select count(distinct br.room_id) into v_occupied
    from public.booking_rooms br
    join public.bookings b on b.id = br.booking_id
   where br.is_blocking
     and b.check_in <= v_today
     and b.check_out > v_today;

  select jsonb_build_object(
    'today', v_today,

    'counts', jsonb_build_object(
      'guest_houses', (select count(*) from public.guest_houses where is_active),
      'rooms',        v_total_rooms,
      'rooms_out_of_service', (
        select count(*) from public.rooms r
          join public.guest_houses gh on gh.id = r.guest_house_id
         where r.status = 'INACTIVE' and gh.is_active
      ),
      -- "Active" is what is live right now: booked ahead or currently staying.
      'active_bookings', (
        select count(*) from public.bookings
         where status in ('BOOKED', 'CHECKED_IN') and check_out > v_today
      ),
      -- Heads actually in the building, by the §5 occupant rule.
      'guests_in_house', coalesce((
        select sum(public.booking_occupant_count(b.booking_type, coalesce(g.n, 0)))
          from public.bookings b
          left join lateral (
            select count(*) as n from public.booking_guests bg where bg.booking_id = b.id
          ) g on true
         where b.status = 'CHECKED_IN'
           and b.check_in <= v_today and b.check_out > v_today
      ), 0)
    ),

    'occupancy', jsonb_build_object(
      'occupied', v_occupied,
      'total',    v_total_rooms,
      'percent',  case when v_total_rooms = 0 then 0
                       else round(v_occupied::numeric * 100 / v_total_rooms) end
    ),

    'today_counts', jsonb_build_object(
      -- Still to arrive: BOOKED and due today. A guest already checked in has
      -- left this queue, which is the point of the number.
      'arrivals_due', (
        select count(*) from public.bookings
         where check_in = v_today and status = 'BOOKED'
      ),
      'departures_due', (
        select count(*) from public.bookings
         where check_out = v_today and status = 'CHECKED_IN'
      ),
      'arrived', (
        select count(*) from public.bookings
         where check_in = v_today and status in ('CHECKED_IN', 'CHECKED_OUT')
      )
    ),

    -- Confirmed money only: cancelled and no-show are excluded (§6.3), so this
    -- never counts revenue that was released.
    'revenue', jsonb_build_object(
      'month_total', coalesce((
        select sum(total_amount) from public.bookings
         where status not in ('CANCELLED', 'NO_SHOW')
           and check_in >= v_month_start and check_in < v_month_end
      ), 0),
      'month_label', to_char(v_today, 'FMMonth YYYY')
    ),

    'arrivals', coalesce((
      select jsonb_agg(row_to_json(a) order by a.booking_name)
        from (
          select b.id, b.booking_name, b.contact_number, b.status,
                 gh.name as guest_house_name,
                 (select array_agg(r.room_number order by r.room_number)
                    from public.booking_rooms br
                    join public.rooms r on r.id = br.room_id
                   where br.booking_id = b.id) as room_numbers
            from public.bookings b
            join public.guest_houses gh on gh.id = b.guest_house_id
           where b.check_in = v_today and b.status in ('BOOKED', 'CHECKED_IN')
           limit 12
        ) a
    ), '[]'::jsonb),

    'departures', coalesce((
      select jsonb_agg(row_to_json(d) order by d.booking_name)
        from (
          select b.id, b.booking_name, b.contact_number, b.status,
                 gh.name as guest_house_name,
                 (select array_agg(r.room_number order by r.room_number)
                    from public.booking_rooms br
                    join public.rooms r on r.id = br.room_id
                   where br.booking_id = b.id) as room_numbers
            from public.bookings b
            join public.guest_houses gh on gh.id = b.guest_house_id
           where b.check_out = v_today and b.status = 'CHECKED_IN'
           limit 12
        ) d
    ), '[]'::jsonb),

    'recent', coalesce((
      select jsonb_agg(row_to_json(rc) order by rc.created_at desc)
        from (
          select b.id, b.booking_name, b.status, b.check_in, b.check_out,
                 b.total_amount, b.created_at, gh.name as guest_house_name
            from public.bookings b
            join public.guest_houses gh on gh.id = b.guest_house_id
           order by b.created_at desc
           limit 6
        ) rc
    ), '[]'::jsonb),

    -- 14 days back and forward, for the sparkline. Forward matters more than
    -- back: it shows what is coming, which is what you can still act on.
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d.day,
               'occupied', (
                 select count(distinct br.room_id)
                   from public.booking_rooms br
                   join public.bookings b on b.id = br.booking_id
                  where br.is_blocking
                    and b.check_in <= d.day and b.check_out > d.day
               )
             ) order by d.day)
        from generate_series(v_today - 7, v_today + 13, interval '1 day') as d(day)
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_dashboard_stats() from public, anon;
grant execute on function public.get_dashboard_stats() to authenticated;
