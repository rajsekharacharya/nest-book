-- "Today" must resolve in the property's time zone, not UTC.
--
-- The database runs in UTC. The properties are in India (+05:30), so between
-- local midnight and 05:30 IST, current_date still returns YESTERDAY. During
-- that window the dashboard reported a guest whose stay had started as not yet
-- arrived: occupancy read 0, arrivals read 0, and an in-house guest appeared
-- to be staying nowhere.
--
-- This is the rule CLAUDE.md already states — "Today resolves in the property's
-- configured time zone, not the browser's and not UTC" — which the dashboard
-- did not follow.
--
-- A single helper rather than scattered casts, so there is one definition to
-- change when a property is somewhere else.

-- ---------------------------------------------------------------------------
-- app_settings — one row, holding operational configuration
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  id         boolean primary key default true,
  time_zone  text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Enforces exactly one row: the primary key is a boolean pinned to true.
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

drop policy if exists app_settings_read on public.app_settings;
drop policy if exists app_settings_write on public.app_settings;

create policy app_settings_read on public.app_settings
  for select to authenticated using (public.is_active_user());
create policy app_settings_write on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- property_today() — THE definition of "today" for this application
-- ---------------------------------------------------------------------------

create or replace function public.property_today()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone coalesce(
    (select time_zone from public.app_settings where id), 'Asia/Kolkata'
  ))::date
$$;

revoke all on function public.property_today() from public, anon;
grant execute on function public.property_today() to authenticated;

-- ---------------------------------------------------------------------------
-- set_room_status — "future bookings" must also mean future locally (§6.8)
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

  if p_status = 'INACTIVE' then
    select count(*) into v_count
      from public.booking_rooms br
      join public.bookings b on b.id = br.booking_id
     where br.room_id = p_room_id
       and br.is_blocking
       and b.check_out > public.property_today();

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
-- get_dashboard_stats — every figure now resolves against the local day
-- ---------------------------------------------------------------------------

create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today        date := public.property_today();
  v_month_start  date := date_trunc('month', v_today)::date;
  v_month_end    date := (date_trunc('month', v_today) + interval '1 month')::date;
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
      -- Anyone CHECKED_IN is physically present, whatever their booked dates
      -- say. Gating this on the dates too meant a guest who arrived early, or
      -- whose checkout had passed, vanished from the count while standing in
      -- the building.
      'guests_in_house', coalesce((
        select sum(public.booking_occupant_count(b.booking_type, coalesce(g.n, 0)::integer))
          from public.bookings b
          left join lateral (
            select count(*) as n from public.booking_guests bg where bg.booking_id = b.id
          ) g on true
         where b.status = 'CHECKED_IN'
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
      ),
      -- Someone checked in whose checkout date has passed. They are still in
      -- the building and nothing else on the dashboard would surface them.
      'overdue', (
        select count(*) from public.bookings
         where status = 'CHECKED_IN' and check_out < v_today
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
           -- Includes anyone overdue, so a stay that should have ended does
           -- not silently drop off the departures list.
           where b.check_out <= v_today and b.status = 'CHECKED_IN'
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
               'date', d.day::date,
               'occupied', (
                 select count(distinct br.room_id)
                   from public.booking_rooms br
                   join public.bookings b on b.id = br.booking_id
                  where br.is_blocking
                    and b.check_in <= d.day::date and b.check_out > d.day::date
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

-- ---------------------------------------------------------------------------
-- get_dashboard_extras — same correction
-- ---------------------------------------------------------------------------

create or replace function public.get_dashboard_extras()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := public.property_today();
  v_result jsonb;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED: sign in to view the dashboard'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(

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
               date_trunc('month', v_today::timestamp) - interval '5 months',
               date_trunc('month', v_today::timestamp),
               interval '1 month') as m(month)
    ), '[]'::jsonb),

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

    'status_mix', jsonb_build_object(
      'booked', (select count(*) from public.bookings
                  where status = 'BOOKED' and check_out > v_today),
      'checked_in', (select count(*) from public.bookings where status = 'CHECKED_IN'),
      'upcoming_week', (select count(*) from public.bookings
                         where status = 'BOOKED'
                           and check_in > v_today and check_in <= v_today + 7)
    ),

    'avg_rate', coalesce((
      select round(avg(br.rate_per_night))
        from public.booking_rooms br
        join public.bookings b on b.id = br.booking_id
       where br.is_blocking
         and b.check_in >= date_trunc('month', v_today::timestamp)
         and b.check_in < date_trunc('month', v_today::timestamp) + interval '1 month'
    ), 0)

  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_dashboard_extras() from public, anon;
grant execute on function public.get_dashboard_extras() to authenticated;
