-- Fix: guests_in_house raised "function booking_occupant_count(text, bigint)
-- does not exist", so the whole dashboard failed to load.
--
-- count(*) returns bigint, and booking_occupant_count takes integer. Postgres
-- will widen integer to bigint but never silently narrow the other way, so the
-- call did not resolve. list_bookings already casts explicitly; this call site
-- was the one that did not.
--
-- The rest of the function is unchanged from migration 15.

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
      'active_bookings', (
        select count(*) from public.bookings
         where status in ('BOOKED', 'CHECKED_IN') and check_out > v_today
      ),
      'guests_in_house', coalesce((
        select sum(public.booking_occupant_count(b.booking_type, coalesce(g.n, 0)::integer))
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
