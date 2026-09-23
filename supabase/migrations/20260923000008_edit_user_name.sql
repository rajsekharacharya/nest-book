-- Let an administrator correct any user's display name.
--
-- update_my_name only covers the signed-in user, so a typo in a colleague's
-- name had no in-app fix. Name is the one profile field that carries no
-- privilege, so unlike role and activation it needs no self-change guard —
-- an admin correcting their own name is harmless.

create or replace function public.update_user_name(p_user_id uuid, p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can rename another user'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'NOT_FOUND: that user no longer exists' using errcode = 'no_data_found';
  end if;

  update public.profiles
     set full_name = nullif(trim(p_full_name), '')
   where id = p_user_id;
end;
$$;

revoke all on function public.update_user_name(uuid, text) from public, anon;
grant execute on function public.update_user_name(uuid, text) to authenticated;
