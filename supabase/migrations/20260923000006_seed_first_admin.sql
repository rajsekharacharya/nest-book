-- Promote the first account to administrator.
--
-- The signup trigger assigns every new user the 'staff' role, so a fresh
-- deployment has no admin and no in-app way to create one (ARCHITECTURE.md §12).
-- This bootstraps exactly one: the earliest-created account, and only while no
-- administrator exists yet. Re-running it is a no-op once one does.

do $$
declare
  v_id    uuid;
  v_email text;
begin
  if exists (select 1 from public.profiles where role = 'admin' and is_active) then
    raise notice 'An administrator already exists; nothing to do.';
    return;
  end if;

  select p.id, u.email
    into v_id, v_email
    from public.profiles p
    join auth.users u on u.id = p.id
   order by p.created_at
   limit 1;

  if v_id is null then
    raise notice 'No accounts exist yet; create one, then re-run this migration.';
    return;
  end if;

  update public.profiles
     set role = 'admin',
         full_name = coalesce(nullif(trim(full_name), ''), split_part(v_email, '@', 1))
   where id = v_id;

  raise notice 'Promoted % to administrator.', v_email;
end $$;
