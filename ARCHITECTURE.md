# Guest House Management System — Architecture

Status: **Design phase.** This document is the source of truth for the build. If implementation
diverges, update this document in the same change.

---

## 1. Overview

A web application for managing guest houses, rooms, and bookings, with role-based access and
a shareable read-only booking link for guests.

**Core entities:** Room Types → Guest Houses → Rooms → Bookings (+ Guests on a booking).

**Deployment model:** static frontend on GitHub Pages, hosted Postgres + auth + API from
Supabase. There is no self-managed server.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite, TypeScript | Static build output, deployable to GitHub Pages |
| Routing | React Router (hash or basename-aware) | GitHub Pages has no server rewrites — see §10 |
| Styling | Tailwind CSS | Design pass happens later; utility CSS keeps restyling cheap |
| Data/API | Supabase (Postgres + PostgREST) | DB and REST API in one; callable directly from the browser |
| Auth | Supabase Auth (email + password) | Real accounts, needed for role-based access |
| Authorization | Postgres Row Level Security (RLS) | Rules live in the DB, not in client code |
| Hosting | GitHub Pages via GitHub Actions | Free, no server to run |

**Why not a custom backend:** every write goes through PostgREST with RLS enforcing
permissions server-side. The browser holds only the Supabase `anon` key, which grants nothing
on its own — the user's JWT plus RLS policies decide what is readable or writable.

---

## 3. Roles & access model

Three roles, stored in `profiles.role`:

| Role | Capabilities |
|---|---|
| `admin` | Full access: manage room types, guest houses, rooms, users, bookings; delete anything |
| `staff` | Create/edit bookings, perform check-in / check-out, view lists and dashboard. Cannot manage masters (room types, guest houses, rooms) or users |
| *(guest)* | Not a logged-in role. A guest views exactly one booking via an unguessable token link (§8) |

### How the role is resolved

- Supabase Auth owns credentials in `auth.users`.
- `public.profiles` holds one row per user, keyed by `auth.users.id`, carrying `role` and `full_name`.
- A row is created automatically on signup by an `on_auth_user_created` trigger, defaulting to `staff`.
- Role is read in policies through a `SECURITY DEFINER` helper, never trusted from the client:

```sql
create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'admin', false)
$$;
```

`current_role()` must be `SECURITY DEFINER` — otherwise a policy on `profiles` that calls it
would recurse into itself while evaluating.

### Creating users

Admins do not create passwords directly from the browser (that requires the Supabase service
key, which must never reach client code). Two supported paths:

1. **Invite (preferred):** admin triggers a Supabase Edge Function that calls the Admin API with
   the service key held server-side; Supabase emails an invite link.
2. **Manual:** create the user in the Supabase dashboard, then the admin sets their role in-app.

Either way, role changes happen through a policy that only admins can satisfy.

---

## 4. Data model

Every table uses `uuid` primary keys (`gen_random_uuid()`), plus `created_at` / `updated_at`
timestamps maintained by a shared trigger.

```
room_types ──┐
             ├──> rooms <──┐
guest_houses ─┘            │
     │                     │
     ▼                     │
  bookings ──┬── booking_rooms ──┘
             ├── booking_guests
             └── booking_audit

profiles ──> (created_by / updated_by / actor_id)
```

### 4.1 `room_types`

Master list of room categories, global (shared across all guest houses).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text, not null, unique (case-insensitive) | "Single", "Double", "Deluxe" |
| `description` | text | optional |
| `is_active` | boolean, default true | soft delete |
| `created_at` / `updated_at` | timestamptz | |

### 4.2 `guest_houses`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text, not null | |
| `address` | text, not null | |
| `total_rooms` | integer, not null, check > 0 | declared capacity; caps how many `rooms` may be created (§6.1) |
| `google_location_url` | text | plain URL string, never geocoded |
| `contact_person_name` | text, not null | |
| `contact_person_phone` | text, not null | |
| `image_path` | text | object path in the `guest-house-images` bucket, not a URL (see below) |
| `is_active` | boolean, default true | |
| `created_at` / `updated_at` | timestamptz | |

**Photograph.** Stored in Supabase Storage rather than the database: images are large and binary,
and a base64 column would bloat every row read and every backup for data a CDN serves better.

The column holds the object *path*, never a full URL — a URL embeds the project hostname, so it
would break on a project move or custom domain. The client derives the URL from the path.

The `guest-house-images` bucket is **public-read**, deliberately. The guest booking link (§8) is
unauthenticated, so a private bucket would need signed URLs that expire, silently breaking a link
a guest saved. The images are photographs of a building and carry nothing sensitive. Writes stay
admin-only, enforced by RLS on `storage.objects`; a 5 MB cap and an image-only MIME whitelist are
set on the bucket itself, because the storage API is reachable directly with any user's token.

### 4.3 `rooms`

Individual physical rooms, each belonging to one guest house and one room type, with its own
rate. This is the breakdown step: "2 single rooms with rate and room number".

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `guest_house_id` | uuid FK → `guest_houses` ON DELETE CASCADE | |
| `room_type_id` | uuid FK → `room_types` ON DELETE RESTRICT | |
| `room_number` | text, not null | unique per guest house |
| `rate_per_night` | numeric(10,2), not null, check >= 0 | |
| `capacity` | integer, not null, default 1, check > 0 | max guests in this room |
| `status` | text, default `'ACTIVE'` | `ACTIVE` \| `INACTIVE` (maintenance/blocked) |
| `created_at` / `updated_at` | timestamptz | |

Constraint: `unique (guest_house_id, room_number)`.

**Rooms are created in bulk, not one at a time.** Rooms of the same type usually share a rate and
capacity, so the UI captures those once and takes a set of room numbers (§9.2). Each number still
becomes its own row — per-room rows are what make per-room availability (§6.2) possible — but the
operator never re-enters the shared fields. Individual rooms can be edited afterwards if one
differs (a corner room at a higher rate, say).

### 4.4 `bookings`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `guest_house_id` | uuid FK → `guest_houses` ON DELETE RESTRICT | |
| `booking_name` | text, not null | person the booking is under |
| `contact_number` | text, not null | |
| `note` | text | description / remarks |
| `booking_type` | text, not null | `SELF` \| `OTHER` \| `COMBINE` (§5) |
| `check_in` | date, not null | |
| `check_out` | date, not null | check `check_out > check_in` |
| `status` | text, not null, default `'BOOKED'` | `BOOKED` \| `CHECKED_IN` \| `CHECKED_OUT` \| `CANCELLED` \| `NO_SHOW` (§6.5) |
| `cancellation_reason` | text | set on cancel (§6.5) |
| `cancelled_at` | timestamptz | set on cancel |
| `checked_in_at` | timestamptz | actual arrival, not the booked date (§6.5) |
| `checked_out_at` | timestamptz | actual departure |
| `total_amount` | numeric(12,2) | computed on save from rooms × nights (§6.3) |
| `public_token` | uuid, not null, unique, default `gen_random_uuid()` | powers the guest link (§8) |
| `created_by` | uuid FK → `profiles` | audit |
| `updated_by` | uuid FK → `profiles` | audit — who last modified |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `(guest_house_id, check_in, check_out)`, `(status)`, `(public_token)`,
`(contact_number)` and a trigram index on `booking_name` for the list search (§9.4).

### 4.5 `booking_rooms`

Which specific rooms a booking holds. Specific room numbers are **required** at booking time.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `booking_id` | uuid FK → `bookings` ON DELETE CASCADE | |
| `room_id` | uuid FK → `rooms` ON DELETE RESTRICT | |
| `rate_per_night` | numeric(10,2), not null | **snapshot** of the room's rate at booking time |
| `created_at` | timestamptz | |

Constraint: `unique (booking_id, room_id)` — a room cannot be added twice to one booking.

The rate is copied rather than joined so that later edits to a room's price never silently
rewrite the value of past bookings.

### 4.6 `booking_guests`

Guest list attached to a booking. Empty for `SELF` bookings (§5).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `booking_id` | uuid FK → `bookings` ON DELETE CASCADE | |
| `name` | text, not null | |
| `age` | integer | optional |
| `gender` | text | `MALE` \| `FEMALE` \| `OTHER` \| null |
| `contact_number` | text | optional |
| `id_proof_type` | text | optional |
| `id_proof_number` | text | optional |
| `created_at` | timestamptz | |

### 4.7 `booking_audit`

Bookings carry money and disputes ("we cancelled that", "the rate was different"), and
`updated_by` alone only ever shows the *last* writer. An append-only trail records every
state-changing action.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `booking_id` | uuid FK → `bookings` ON DELETE CASCADE | |
| `action` | text, not null | `CREATED` \| `UPDATED` \| `STATUS_CHANGED` \| `EXTENDED` \| `ROOMS_CHANGED` \| `CANCELLED` \| `TOKEN_ROTATED` |
| `actor_id` | uuid FK → `profiles` | null for system actions |
| `detail` | jsonb | before/after for the fields that changed |
| `created_at` | timestamptz | |

Written by the RPCs of §7, inside the same transaction as the change. Readable by admins; never
updatable or deletable by anyone through the API.

### 4.8 `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK, FK → `auth.users` ON DELETE CASCADE | |
| `full_name` | text | |
| `role` | text, not null, default `'staff'` | `admin` \| `staff` |
| `is_active` | boolean, default true | |
| `created_at` / `updated_at` | timestamptz | |

---

## 5. Booking types

`booking_type` controls whether a guest list is captured, and who is counted as staying:

| Type | Guest list | Meaning |
|---|---|---|
| `SELF` | Not required, and not shown in the UI | The person named in `booking_name` is the only occupant |
| `OTHER` | Required (≥ 1 guest) | Booking is made *on behalf of* others — `booking_name` is the booker and is **not** an occupant |
| `COMBINE` | Required (≥ 1 guest) | `booking_name` stays **plus** the listed guests |

Derived occupant count, used for capacity checks (§6.2):

```
SELF     → 1
OTHER    → count(booking_guests)
COMBINE  → count(booking_guests) + 1
```

This rule is implemented once, in a single shared module, and reused by the booking form, the
validation function, and the dashboard. It is never re-derived inline.

---

## 6. Business rules

All rules below are enforced **in the database** (constraints + a transactional RPC), not only in
the frontend. Client-side checks exist for fast feedback, never as the authority.

### 6.1 Room configuration cap

The number of `rooms` rows for a guest house may not exceed `guest_houses.total_rooms`.
Enforced by a trigger on `rooms` insert.

### 6.2 Booking validation

Performed atomically inside `create_booking` / `update_booking` (§7):

1. `check_out > check_in`; both required.
2. Guest house exists and `is_active`.
3. At least one room selected.
4. Every selected room belongs to the booking's guest house and has `status = 'ACTIVE'`.
5. **Availability:** no selected room may overlap another non-cancelled booking.
6. Occupant count (§5) must not exceed the summed `capacity` of the selected rooms.
7. `OTHER` / `COMBINE` require at least one `booking_guests` row.

On any failure the transaction rolls back and a typed error code is returned — no partial writes.

#### Concurrency — why validation alone is not enough

Checking availability with a `SELECT` and then inserting is a read-then-write race. Two staff
booking the same room at the same moment both pass the check, and both inserts succeed: the room
is double-booked with no error shown to anyone. Application-level validation cannot close this;
the database has to.

The guard is an exclusion constraint on `booking_rooms`, which makes overlapping holds on one room
physically impossible regardless of timing:

```sql
create extension if not exists btree_gist;

alter table booking_rooms
  add column stay daterange not null,          -- '[check_in, check_out)', mirrored from the booking
  add column is_blocking boolean not null default true;  -- false once CANCELLED / NO_SHOW

alter table booking_rooms
  add constraint booking_rooms_no_overlap
  exclude using gist (
    room_id with =,
    stay with &&
  ) where (is_blocking);
```

A half-open `daterange` (`[in, out)`) encodes the checkout-day-free rule from §6.3 natively, so
the constraint and the helper function agree by construction rather than by careful duplication.

`stay` and `is_blocking` are denormalised onto `booking_rooms` because an exclusion constraint can
only see columns on its own table. Both are maintained by trigger from the parent booking —
never written by the client — so changing a booking's dates or cancelling it keeps the constraint
rows in step automatically.

The explicit check in step 5 still runs first: it produces the friendly, specific message naming
the conflicting room and dates. The constraint is the backstop that makes the guarantee real. A
constraint violation surfacing to the RPC is translated into the same `ROOM_NOT_AVAILABLE` error
so the caller sees one consistent failure either way.

### 6.3 Date-overlap semantics — single source of truth

Two date ranges overlap iff:

```
existing.check_in < new.check_out AND existing.check_out > new.check_in
```

**Checkout day is free for a new check-in** — a guest leaving on the 10th does not block someone
arriving on the 10th.

This is expressed once as a SQL helper and reused everywhere (availability check, calendar view,
dashboard occupancy). Cancelled bookings (`status = 'CANCELLED'`) are excluded from every
availability, occupancy, and revenue calculation.

```sql
create or replace function public.ranges_overlap(
  a_from date, a_to date, b_from date, b_to date
) returns boolean language sql immutable as $$
  select a_from < b_to and a_to > b_from
$$;
```

### 6.4 Amount calculation

```
total_amount = Σ over selected rooms ( booking_rooms.rate_per_night × nights )
nights       = check_out − check_in
```

Computed server-side during the booking RPC from the snapshotted rates, never accepted from the
client.

### 6.5 Status transitions

```
BOOKED     → CHECKED_IN | CANCELLED | NO_SHOW
CHECKED_IN → CHECKED_OUT
CHECKED_OUT → (terminal)
CANCELLED   → (terminal)
NO_SHOW     → (terminal)
```

Allowed transitions are validated in the status-change RPC; anything else returns
`INVALID_STATUS_TRANSITION`.

**Cancellation applies only before check-in.** Once a guest has physically checked in, the stay
happened and cancelling it would erase a real occupancy from history. A guest leaving early is an
*early check-out* (§6.6), not a cancellation.

**`NO_SHOW`** covers the guest who never arrived. It is distinct from `CANCELLED` — the rooms are
released identically, but the two mean different things for reporting, and conflating them hides
a real operational signal. Both are excluded from availability, occupancy, and revenue (§6.3).

**Cancellation** sets `status = 'CANCELLED'` and never deletes the row — the booking stays in
history and drops out of every availability, occupancy, and revenue calculation (§6.3), freeing
its rooms immediately. `cancellation_reason` and `cancelled_at` are recorded. Only admins may
hard-delete (§11).

**Check-in and check-out timestamps** (`checked_in_at`, `checked_out_at`) are recorded by the
status RPC, not inferred from the booked dates — a guest may arrive a day late or leave early, and
the dashboard's "in-house now" figure must reflect what actually happened.

### 6.6 Extending and shortening a stay

A guest asking to stay longer is a distinct operation from editing a booking, because it can
fail on availability — the room may already be taken by someone arriving on the original
checkout date.

`extend_booking(booking_id, new_check_out)` handles both directions:

- **Extending** (`new_check_out` later): re-runs the overlap check (§6.3) for every room on the
  booking over the *added* nights only, excluding this booking itself. If any room is taken for
  part of that window, the whole extension is rejected with `ROOM_NOT_AVAILABLE`, naming the
  conflicting room and date. Nothing is partially applied.
- **Shortening** (`new_check_out` earlier): always permitted, provided the result stays at least
  one night (`new_check_out > check_in`). The released nights immediately become bookable.

In both cases `total_amount` is recomputed from the snapshotted `booking_rooms.rate_per_night`
(§6.4) over the new night count, so the amount always matches the actual stay.

Allowed from `BOOKED` and `CHECKED_IN` (a mid-stay extension is the common case). Rejected on
`CHECKED_OUT` and `CANCELLED` with `INVALID_STATUS_TRANSITION`.

Early check-out is handled by changing status to `CHECKED_OUT`; if the amount should reflect the
shorter stay, the operator shortens the booking first, then checks out.

### 6.7 Changing rooms on an existing booking

Distinct from extending, and a common front-desk need: the guest wants a different room, or the
booked room has a problem. `change_booking_rooms(booking_id, room_ids[])` replaces the room set,
re-running availability (excluding this booking) and the capacity check (§6.2 steps 4–6) against
the new selection, in one transaction.

Rates are re-snapshotted from the new rooms and `total_amount` recomputed. Allowed from `BOOKED`
and `CHECKED_IN`.

This also answers the case flagged in §9.5: when an extension fails because the room is taken,
the operator changes rooms rather than cancelling and rebooking.

### 6.8 Taking a room out of service

Setting `rooms.status = 'INACTIVE'` stops the room appearing in new bookings, but says nothing
about bookings already holding it. Left unhandled, a room can be marked for maintenance while
guests are still booked into it, and nothing surfaces the clash.

Deactivating a room therefore checks for current and future non-cancelled bookings first. If any
exist, the operation is rejected with `ROOM_HAS_BOOKINGS`, listing them, so the operator can move
those guests (§6.7) before taking the room down. Past bookings never block it.

The same rule applies to deactivating a guest house: it is blocked while any of its rooms carry
future bookings.

---

## 7. Database functions (RPC)

Multi-table writes go through `SECURITY INVOKER` Postgres functions so that validation and
insertion share one transaction and RLS still applies to the caller.

| Function | Purpose |
|---|---|
| `create_booking(payload jsonb)` | Validates §6.2, inserts booking + rooms + guests, computes total, returns the new booking |
| `update_booking(booking_id uuid, payload jsonb)` | Same validation, excluding the booking itself from the overlap check |
| `change_booking_status(booking_id uuid, new_status text)` | Validates the transition (§6.5) and applies it |
| `cancel_booking(booking_id uuid, reason text)` | Sets `CANCELLED`, records reason and timestamp, releases the rooms (§6.5) |
| `extend_booking(booking_id uuid, new_check_out date)` | Extends or shortens a stay with a fresh availability check over the added nights, then recomputes the total (§6.6) |
| `change_booking_rooms(booking_id uuid, room_ids uuid[])` | Swaps the rooms on a booking, re-validating availability and capacity, re-snapshotting rates (§6.7) |
| `set_room_status(room_id uuid, status text)` | Activates/deactivates a room, refusing deactivation while future bookings exist (§6.8) |
| `rotate_booking_token(booking_id uuid)` | Issues a new `public_token`, invalidating the old guest link (§8) |
| `check_room_availability(gh uuid, from date, to date, exclude uuid)` | Returns rooms in a guest house free for that range — powers the booking form's room picker |
| `create_rooms_bulk(gh uuid, room_type uuid, numbers text[], rate numeric, capacity int)` | Inserts a batch of same-type rooms in one transaction (§9.2); rejects the whole batch if any number duplicates an existing room or if the total would exceed `total_rooms`. Reports *every* clashing number at once, so the list can be corrected in one pass |
| `update_room(room uuid, room_type uuid, number text, rate numeric, capacity int)` | Edits a single room that differs from its batch. Repricing affects future bookings only — existing ones hold their snapshot (§4.5) |
| `delete_room(room uuid)` | Removes a room typed in wrongly during setup; refused once it appears on any booking, since that would erase part of a booking's record. Those are deactivated instead (§6.8) |
| `delete_guest_house(gh uuid)` | Removes a guest house and cascades to its rooms; refused once any booking references it |
| `get_dashboard_stats()` | Returns the dashboard aggregate (§9.1) in one round trip |
| `get_booking_by_token(token uuid)` | Returns the trimmed, guest-safe booking view (§8) |

Error codes returned by the booking functions: `INVALID_DATES`, `GUEST_HOUSE_INACTIVE`,
`NO_ROOMS_SELECTED`, `ROOM_NOT_AVAILABLE`, `ROOM_INACTIVE`, `ROOM_WRONG_GUEST_HOUSE`,
`CAPACITY_EXCEEDED`, `GUEST_LIST_REQUIRED`, `INVALID_STATUS_TRANSITION`, `ROOM_HAS_BOOKINGS`,
`DUPLICATE_ROOM_NUMBER`, `ROOM_CAP_EXCEEDED`, `NOT_AUTHORIZED`. The UI maps each to a
plain-language message; no raw Postgres error ever reaches the user.

**Date handling.** All stay dates are `date`, not `timestamptz` — a booking is for a calendar day,
and storing it as a timestamp makes "today" ambiguous across time zones. "Today" in the dashboard
and status rules is resolved in the property's configured time zone (a single app-level setting),
not the browser's and not UTC. Without this, a late-evening check-in in `Asia/Kolkata` lands on
the previous UTC day and the arrivals list is wrong.

---

## 8. Guest link

On booking creation, `public_token` (a random uuid) is generated. The guest receives:

```
https://<user>.github.io/<repo>/#/b/<public_token>
```

- Requires no login. Anyone holding the link can view that one booking.
- Read-only. There is no write path from this page.
- Served by `get_booking_by_token`, a `SECURITY DEFINER` function that returns a **restricted
  projection**: guest house name/address/location, contact person, check-in/out dates, room
  numbers and types, booking status, total amount.
- Deliberately excluded: `created_by`, internal notes, the guest list's ID-proof fields, and every
  other booking's data.
- `bookings` itself stays fully locked by RLS for anonymous users — the function is the only
  anonymous read path, so a token grants exactly one booking and nothing more.

Tokens are uuid v4 (122 bits of entropy) — not enumerable. If a link needs to be withdrawn, an
admin can rotate the token, invalidating the old URL.

---

## 9. Screens

### 9.1 Dashboard

Single `get_dashboard_stats()` call returning:

- Counts: total guest houses, total rooms, active bookings, total guests in-house today
- Today: check-ins due, check-outs due
- Occupancy: rooms occupied vs. total, as a percentage
- Revenue: current month's confirmed total
- Lists: today's arrivals, today's departures, recent bookings
- Optional: 7-day occupancy trend for a small chart

### 9.2 Masters (admin only)

- **Room Types** — list + create/edit, soft delete via `is_active`
- **Guest Houses** — list + create/edit; the form captures name, address, total rooms, Google
  location URL, contact person name and phone
- **Rooms** — nested under a guest house. Shows *configured / total_rooms* against the declared
  cap (§6.1), rooms grouped by type.

  **Bulk add** is the primary flow, since a guest house typically has several identical rooms of
  one type. The operator picks the room type, sets rate and capacity once, then supplies the room
  numbers as a list or range:

  ```
  Room type:  Single          Rate: 1200      Capacity: 2
  Room numbers:  101, 102, 103-105
  → creates 101, 102, 103, 104, 105
  ```

  Numbers accept comma-separated values, ranges (`103-105`), or a mix. The form previews the
  expanded list before saving, flags any number that already exists in that guest house, and
  blocks the save if the batch would exceed `total_rooms`. Non-numeric numbers (`A1`, `G-2`) are
  allowed as individual entries; ranges require numeric endpoints.

  Individual rooms remain editable afterwards for the cases where one differs.

### 9.3 Booking form

Flow: pick guest house → pick dates → the room picker calls `check_room_availability` and shows
only genuinely free rooms → choose booking type → guest list appears for `OTHER` / `COMBINE` →
live summary shows nights, rooms, occupants, and computed total → save.

**Repeat guests.** Typing a contact number searches previous bookings and offers to prefill the
name and guest list. Most guest houses have returning visitors, and retyping their details every
time is both slow and a source of inconsistent records. There is no separate guest master —
past bookings are the source.

**Availability is re-checked on save**, not only when the picker loaded. A room can be taken by a
colleague between opening the form and submitting it; the server rejects it, and the form shows
which room went and lets the operator pick another without losing the rest of the entry.

**Changing the dates or guest house after rooms are picked** clears the room selection and
re-queries, rather than silently keeping rooms that may no longer be free.

**Client-side validation** mirrors §6.2 for fast feedback but is never authoritative: required
fields, `check_out > check_in`, at least one room, guest list non-empty for `OTHER`/`COMBINE`,
occupant count within the selected rooms' capacity.

**Past dates** are allowed (staff frequently record a walk-in after the fact) but warned on, so an
accidental wrong year is caught.

### 9.4 Booking list — two views

- **List view:** searchable (booking name, contact), filterable by guest house / status / date
  range, paginated. Row actions: view, edit, check-in, check-out, **extend**, cancel, copy guest
  link — each shown only where the booking's current status permits it (§6.5, §6.6).
- **Calendar view:** a month grid where **Y = rooms** (grouped by guest house) and **X = days of
  the month**, with each booking drawn as a bar spanning its date range. Sticky left column,
  horizontal scroll, month navigation. Only the visible window is queried.

> Note: the original sketch said "Y = list of guest". Rows are **rooms** instead, because that is
> what makes occupancy and free space readable at a glance — a guest-per-row grid cannot show
> which rooms are open. Guest names are shown inside the bars.

### 9.5 Booking detail

Full booking, guest list, rooms and rates, computed total, status timeline, and the guest link
with a copy button. Actions gated by role and by current status.

**Extend stay** opens a small dialog: pick the new checkout date, and the dialog immediately shows
whether the rooms are free for the added nights and what the new total will be, before the
operator commits. If a room is taken, it names which one and on which date, so the operator can
offer a room change instead.

**Cancel** asks for a reason and warns that the rooms will be released.

### 9.6 Users (admin only)

List of profiles, role assignment, activate/deactivate, invite new user.

### 9.7 Guest view (public)

Read-only booking summary from the token link (§8). No navigation into the rest of the app.

Handles the cases a shared link inevitably hits: an unknown or rotated token shows a plain "this
link is no longer valid" page rather than an error, and a cancelled booking is shown as cancelled
rather than hidden — a guest following an old link needs to know the booking is off, not see a
dead page.

### 9.8 Cross-cutting UI states

Specified once here rather than per screen:

- **Empty states** — every list has a first-run state that says what to do next, not a blank
  panel. These matter most at setup, when a new operator sees the app with nothing in it: no room
  types yet blocks creating rooms, and no guest houses blocks booking, so each empty state links
  to the step that unblocks it.
- **Loading** — skeleton placeholders on first load; existing data stays visible during refetches
  rather than collapsing to a spinner.
- **Errors** — the typed codes from §7 map to specific sentences ("Room 102 is already booked for
  12–14 March"). Network failure is distinguished from validation failure, because one is worth
  retrying and the other is not.
- **Destructive actions** — cancel, delete, deactivate, and token rotation all confirm, and the
  confirmation states the consequence ("the rooms will be released").
- **Permission-aware UI** — actions a `staff` user cannot perform are not rendered. The server
  enforces it regardless (§11); hiding is for clarity, never for security.
- **Optimistic-free writes** — booking mutations wait for the server, since the server may reject
  them. Showing a booking as saved and then retracting it is worse than a brief spinner.

---

## 10. Frontend structure

```
src/
 ├── lib/
 │   ├── supabase.ts          # client singleton
 │   ├── queries/             # one module per entity; the ONLY place Supabase is called
 │   └── booking-rules.ts     # occupant count (§5), nights, overlap — shared with display code
 ├── auth/
 │   ├── AuthProvider.tsx     # session + profile/role context
 │   └── RequireRole.tsx      # route guard
 ├── components/              # shared UI primitives
 ├── features/
 │   ├── dashboard/
 │   ├── room-types/
 │   ├── guest-houses/
 │   ├── rooms/
 │   ├── bookings/            # list view, calendar view, form, detail
 │   ├── users/
 │   └── guest-view/          # public token page
 ├── routes.tsx
 └── main.tsx
```

**Layering rule:** components never call Supabase directly — only through `lib/queries/*`. This
keeps every query in one place when the schema changes.

**Routing:** GitHub Pages cannot rewrite unknown paths to `index.html`, so deep links to
`/bookings/123` would 404 on refresh. Use `HashRouter` (`/#/bookings/123`). The standard
workaround — copying `index.html` to `404.html` — also works, but hash routing has no redirect
flicker and is the safer default here.

**Config:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are injected at build time from
GitHub Actions secrets. Both are public by design; all real protection is RLS. The service role
key is never used in frontend code.

---

## 11. Security model

RLS is enabled on **every** table. There is no "public access" policy anywhere.

| Table | anon | staff | admin |
|---|---|---|---|
| `room_types` | — | read | full |
| `guest_houses` | — | read | full |
| `rooms` | — | read | full |
| `bookings` | — | read only | read, delete |
| `booking_rooms` | — | read only | read, delete |
| `booking_guests` | — | read only | read, delete |
| `booking_audit` | — | — | read |
| `profiles` | — | read own | full |

**Booking writes go through RPCs only — no direct table writes, for anyone.** Granting staff
`insert`/`update` on `bookings` would let a client write a booking straight through PostgREST,
skipping every check in §6.2. So no role holds direct write grants on the three booking tables;
all writes happen inside the `SECURITY DEFINER` functions of §7, which run the validation first.
The functions themselves check the caller's role via `is_admin()` / `current_role()` before
writing, so authorization is enforced once, in the place that also enforces the business rules.

Guest access to a single booking bypasses these tables entirely, going through the
`SECURITY DEFINER` function in §8 — the only anonymous read path in the system.

Additional measures:

- Deletes on `bookings` are admin-only; staff cancel instead, preserving history.
- Masters use soft delete (`is_active`) so historical bookings never break their references.
- Every `SECURITY DEFINER` function sets `search_path = public` explicitly, preventing
  search-path hijacking.
- `updated_at` is maintained by trigger, not by the client.
- **Deactivated users are blocked at the policy level.** `profiles.is_active = false` must fail
  every policy, not merely hide the user from the admin list — otherwise a deactivated employee's
  session keeps working until their JWT expires. Every policy requires an active profile:
  ```sql
  create or replace function public.is_active_user()
  returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select is_active from public.profiles where id = auth.uid()), false)
  $$;
  ```
- **An admin cannot remove their own admin role or deactivate themselves.** Without this, the last
  admin can lock the whole organisation out of user management with no recovery path short of the
  Supabase dashboard. Enforced in the profiles update policy.

---

## 12. Deployment

```
push to main
   └── GitHub Actions
         ├── npm ci
         ├── npm run build        (Vite, env from repo secrets)
         └── deploy dist/ to GitHub Pages
```

Database migrations live in `supabase/migrations/*.sql`, applied through the Supabase SQL editor
or CLI. Migrations are forward-only and committed to the repo so the schema history is reviewable.

### Bootstrapping the first admin

The signup trigger defaults every new user to `staff`, so a fresh deployment has no admin and no
way to promote one from inside the app. The first admin is created once, manually: sign up
through the app, then run a one-line `update public.profiles set role = 'admin' where id = '…'`
in the Supabase SQL editor. Every later admin is promoted in-app.

### Backups

Supabase's free tier keeps automated daily backups with limited retention, which is not a
restore plan for booking data. An admin-triggered **Export** produces a JSON dump of all tables
for off-site keeping. Restore is a deliberate, manual operation through the SQL editor — not an
in-app button, since a bad restore is unrecoverable and this app has no staging environment.

### Environments

A second Supabase project serves as staging, so migrations and destructive changes are exercised
before touching live booking data. The GitHub Actions workflow targets production only from
`main`.

---

## 13. Testing

The rules that are expensive to get wrong are the date and availability rules, and they are
almost all in SQL. Tests concentrate there rather than on UI coverage:

- **Overlap semantics** — adjacent stays (checkout day free) must *not* conflict; genuine overlaps
  must. Both directions, including exact-boundary cases.
- **Concurrency** — two overlapping inserts for one room from parallel transactions: exactly one
  must succeed, proving the §6.2 exclusion constraint, not just the `SELECT` check.
- **Capacity** — occupant count per booking type (§5) at, below, and above the rooms' capacity.
- **Extension** — extending into a taken window is rejected; extending into a free window
  recomputes the total; shortening below one night is rejected.
- **Status machine** — every disallowed transition in §6.5 is refused.
- **RLS** — a `staff` JWT cannot write the booking tables directly or read another user's profile;
  an `anon` client can read nothing except through the token function; a deactivated user is
  refused.
- **Token view** — `get_booking_by_token` never returns the excluded fields of §8.

Frontend tests cover the shared rules module (`booking-rules.ts`) and the room-number range
parser (§9.2), both pure functions with fiddly edge cases.

---

## 14. Build phases

| Phase | Scope |
|---|---|
| 1 | Supabase project, full schema incl. the exclusion constraint (§6.2), RLS policies, helper functions, audit table, first admin (§12) |
| 2 | Vite + React + Tailwind scaffold, Supabase client, auth flow, role-guarded routing, app shell |
| 3 | Masters: room types, guest houses, rooms (bulk add, §6.1 cap, §6.8 deactivation guard) |
| 4 | Booking core: create/update RPCs, availability check, booking form, repeat-guest lookup |
| 5 | Booking lifecycle: check-in/out, cancel, no-show, extend (§6.6), room change (§6.7) |
| 6 | Booking list view + calendar view |
| 7 | Dashboard |
| 8 | Guest token link + public view page |
| 9 | User management, role assignment, invites, audit log view |
| 10 | SQL test suite (§13) |
| 11 | Design pass (deferred by decision), responsive polish, empty states, dark mode |
| 12 | GitHub Actions deploy, end-to-end verification |

Lifecycle actions are their own phase rather than an afterthought on the form — they are where
the availability rules get exercised hardest, and they are what staff use daily.

---

## 15. Open decisions

Flagged rather than silently assumed:

1. **Rate overrides per booking** — rates are currently fixed per room. Negotiated or seasonal
   pricing would need an editable rate on `booking_rooms` (the column already exists as a
   snapshot, so this is a UI change, not a schema one).
2. **Partial-stay room changes** — §6.7 swaps rooms for the whole booking. Moving a guest to a
   different room mid-stay would need per-room date ranges, which is a materially bigger model.
3. **Advances and payments** — currently out of scope (§16), but `total_amount` with no record of
   what was actually collected is a half-answer if money is tracked at all.
4. **Guest-link sharing** — links are copied manually; WhatsApp or SMS delivery is the obvious
   next step and needs a provider decision.
5. **Overbooking** — the system refuses conflicts outright. Some operators want a deliberate
   override with a warning.

---

## 16. Non-goals

No payment gateway or invoicing, no OTA/channel-manager sync, no housekeeping or maintenance
workflow, no multi-tenant separation (one organisation per deployment), no guest self-service
booking (staff-entered only), no email/SMS sending in the initial build — the guest link is
copied and shared manually.
