-- Guest house photographs (extends ARCHITECTURE.md §4.2)
--
-- A photo is how someone recognises a property at a glance — in the list, on
-- the booking form, and on the guest's shared link.
--
-- Storage rather than a base64 column: images are large and binary, and putting
-- them in Postgres bloats every row read and every backup, for data that is
-- served far better from a CDN.

-- ---------------------------------------------------------------------------
-- The column holds the storage object PATH, not a full URL.
--
-- A URL embeds the project hostname, so it would all break on a project move or
-- a custom domain. The path is stable and the client derives the URL from it.
-- ---------------------------------------------------------------------------

alter table public.guest_houses
  add column if not exists image_path text;

comment on column public.guest_houses.image_path is
  'Path within the guest-house-images storage bucket; the public URL is derived client-side.';

-- ---------------------------------------------------------------------------
-- Bucket
--
-- PUBLIC READ, deliberately. The guest booking link (§8) is unauthenticated by
-- design, and a private bucket would require signed URLs that expire — which
-- would silently break a link a guest saved or a host forwarded. The images are
-- promotional photographs of a building, carrying nothing sensitive.
--
-- Writes remain admin-only, enforced below. Public read does not mean public
-- write.
--
-- The size and MIME limits are set here rather than in the browser because the
-- storage API is reachable directly with any user's token; a client-side check
-- is a convenience, not a control.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'guest-house-images',
  'guest-house-images',
  true,
  5242880,  -- 5 MB; a photograph, not a raw camera file
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Object policies
--
-- Storage authorization is RLS on storage.objects, the same model as every
-- other table here.
-- ---------------------------------------------------------------------------

drop policy if exists guest_house_images_read   on storage.objects;
drop policy if exists guest_house_images_insert on storage.objects;
drop policy if exists guest_house_images_update on storage.objects;
drop policy if exists guest_house_images_delete on storage.objects;

-- anon included on purpose: the guest link has no session (§8).
create policy guest_house_images_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'guest-house-images');

create policy guest_house_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'guest-house-images' and public.is_admin());

create policy guest_house_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'guest-house-images' and public.is_admin())
  with check (bucket_id = 'guest-house-images' and public.is_admin());

create policy guest_house_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'guest-house-images' and public.is_admin());
