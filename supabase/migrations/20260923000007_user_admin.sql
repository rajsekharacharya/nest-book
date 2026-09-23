-- User administration: listing with emails, and guarded role changes.
--
-- auth.users is not exposed through the API, so an admin screen that shows only
-- public.profiles cannot display who each row actually is. These SECURITY
-- DEFINER functions join the two and return just the fields the screen needs.

create or replace function public.list_users()
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          text,
  is_active     boolean,
  created_at    timestamptz,
  last_sign_in_at timestamptz,
  is_self       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can list users'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.full_name,
    p.role,
    p.is_active,
    p.created_at,
    u.last_sign_in_at,
    p.id = auth.uid()
  from public.profiles p
  join auth.users u on u.id = p.id
  order by (p.id = auth.uid()) desc, p.created_at;
end;
$$;

-- Role and activation changes go through one function so the self-lockout
-- guard cannot be bypassed by writing the table directly.
create or replace function public.update_user_access(
  p_user_id   uuid,
  p_role      text default null,
  p_is_active boolean default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles%rowtype;
  v_remaining_admins integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can change user access'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception 'NOT_FOUND: that user no longer exists' using errcode = 'no_data_found';
  end if;

  -- An admin demoting or deactivating themselves could strip the organisation
  -- of its last administrator, leaving no in-app route back (§11).
  if p_user_id = auth.uid() then
    raise exception 'NOT_AUTHORIZED: you cannot change your own role or access'
      using errcode = 'insufficient_privilege';
  end if;

  if p_role is not null and p_role not in ('admin', 'staff') then
    raise exception 'NOT_AUTHORIZED: unknown role %', p_role using errcode = 'check_violation';
  end if;

  -- Belt and braces: refuse a change that would leave zero active admins, even
  -- though the self-guard above already covers the common case.
  if (p_role = 'staff' or p_is_active = false) and v_target.role = 'admin' then
    select count(*) into v_remaining_admins
      from public.profiles
     where role = 'admin' and is_active and id <> p_user_id;

    if v_remaining_admins = 0 then
      raise exception 'NOT_AUTHORIZED: this is the last active administrator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  update public.profiles
     set role      = coalesce(p_role, role),
         is_active = coalesce(p_is_active, is_active)
   where id = p_user_id;
end;
$$;

-- Lets a signed-in user correct their own display name.
create or replace function public.update_my_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED: sign in first' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set full_name = nullif(trim(p_full_name), '')
   where id = auth.uid();
end;
$$;

revoke all on function public.list_users() from public, anon;
revoke all on function public.update_user_access(uuid, text, boolean) from public, anon;
revoke all on function public.update_my_name(text) from public, anon;

grant execute on function public.list_users() to authenticated;
grant execute on function public.update_user_access(uuid, text, boolean) to authenticated;
grant execute on function public.update_my_name(text) to authenticated;
