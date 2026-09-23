-- Closed registration: only pre-registered people may sign in.
--
-- Enabling a social provider such as Google also enables self-signup through
-- it: anyone with a Google account could create their own login and, via the
-- signup trigger, receive a staff profile with real access to bookings. This
-- is a staff tool, not a public service, so account creation stays an
-- administrator action and any other route is refused.
--
-- An administrator pre-registers an email here; only then can that person sign
-- in, with a password or with Google.

create table public.allowed_emails (
  email      text primary key,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint allowed_emails_lowercase check (email = lower(email))
);

alter table public.allowed_emails enable row level security;

create policy allowed_emails_admin_read on public.allowed_emails
  for select to authenticated using (public.is_admin());

-- Existing accounts are, by definition, already permitted.
insert into public.allowed_emails (email)
select lower(email) from auth.users
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Replace the signup trigger with one that refuses unknown emails.
--
-- Raising here aborts the whole signup transaction, so no auth.users row
-- survives: an uninvited Google user is not left as a half-created account.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
begin
  if not exists (select 1 from public.allowed_emails where email = v_email) then
    raise exception 'NOT_AUTHORIZED: this email has not been registered by an administrator'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(trim(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    )), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep the allow-list in step with account changes.
-- ---------------------------------------------------------------------------

-- An administrator changing someone's email must not lock them out.
create or replace function public.sync_allowed_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) is distinct from lower(old.email) then
    insert into public.allowed_emails (email)
    values (lower(new.email))
    on conflict (email) do nothing;

    delete from public.allowed_emails where email = lower(old.email);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_allowed_email();

-- Removing the account removes the permission with it, so a deleted user
-- cannot walk back in through Google.
create or replace function public.revoke_allowed_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.allowed_emails where email = lower(old.email);
  return old;
end;
$$;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.revoke_allowed_email();

-- ---------------------------------------------------------------------------
-- Pre-registration, for inviting someone before their account exists.
-- ---------------------------------------------------------------------------

create or replace function public.allow_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can register an email'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.allowed_emails (email, invited_by)
  values (lower(trim(p_email)), auth.uid())
  on conflict (email) do nothing;
end;
$$;

create or replace function public.revoke_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only an administrator can withdraw an email'
      using errcode = 'insufficient_privilege';
  end if;

  -- Withdrawing an address that already has an account would be misleading:
  -- it does not sign them out, and their existing session keeps working.
  -- Deactivate the user instead.
  if exists (select 1 from auth.users where lower(email) = lower(trim(p_email))) then
    raise exception 'NOT_AUTHORIZED: this email already has an account — deactivate the user instead'
      using errcode = 'check_violation';
  end if;

  delete from public.allowed_emails where email = lower(trim(p_email));
end;
$$;

revoke all on function public.allow_email(text) from public, anon;
revoke all on function public.revoke_email(text) from public, anon;
grant execute on function public.allow_email(text) to authenticated;
grant execute on function public.revoke_email(text) to authenticated;
