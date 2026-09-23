-- Foundation: extensions, shared triggers, profiles, and role helpers.
-- See ARCHITECTURE.md §3 (roles) and §11 (security model).

create extension if not exists btree_gist;   -- required by the booking exclusion constraint (§6.2)
create extension if not exists pg_trgm;      -- powers guest-name search on the booking list (§9.4)

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- Maintained in the database so a client can never fake or forget it (§11).
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, carrying the role (§4.8)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'staff' check (role in ('admin', 'staff')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_profiles_role on public.profiles(role) where is_active;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Signup trigger — every auth user gets a profile, defaulting to 'staff'.
-- The first admin is promoted manually once (§12); all later admins in-app.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Role helpers (§3)
--
-- SECURITY DEFINER is required, not stylistic: a policy on profiles that calls
-- these would otherwise recurse into the policy it is currently evaluating.
-- search_path is pinned on every one to prevent search-path hijacking (§11).
-- ---------------------------------------------------------------------------

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

-- A deactivated user must fail every policy, not merely vanish from the admin
-- list — otherwise their existing session keeps working until the JWT expires.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- RLS on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_select_own_or_admin
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

-- Users may edit their own name, never their own role or active flag —
-- otherwise any staff member could promote themselves to admin.
create policy profiles_update_own_name
  on public.profiles for update
  to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (
    id = auth.uid()
    and role = public.current_user_role()
    and is_active = true
  );

-- Admins manage everyone else. The id <> auth.uid() guard stops an admin
-- demoting or deactivating themselves: with a single admin that would lock the
-- organisation out of user management entirely, with no in-app recovery (§11).
create policy profiles_update_admin
  on public.profiles for update
  to authenticated
  using (public.is_admin() and id <> auth.uid())
  with check (public.is_admin() and id <> auth.uid());

-- No insert policy: rows arrive only via the signup trigger.
-- No delete policy: removing a profile means removing the auth user.
