-- Lists registered emails, flagging which already have an account.
--
-- The distinction matters on screen: an entry with no account is a pending
-- invitation waiting for a first Google sign-in, and it is the only kind that
-- can be withdrawn (revoke_email refuses the rest).

create or replace function public.list_allowed_emails()
returns table (
  email       text,
  created_at  timestamptz,
  has_account boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can view registered emails'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    a.email,
    a.created_at,
    exists (select 1 from auth.users u where lower(u.email) = a.email)
  from public.allowed_emails a
  order by a.created_at desc;
end;
$$;

revoke all on function public.list_allowed_emails() from public, anon;
grant execute on function public.list_allowed_emails() to authenticated;
