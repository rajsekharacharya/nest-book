# Project Context & Decisions

Background that isn't derivable from the code or the schema: why this project exists in this
shape, which decisions are settled, and which are still open.

`ARCHITECTURE.md` says *what* the system is. This says *why*.

---

## Origin

This is a **web** guest house management system: React + Vite + Supabase, deployed static to
GitHub Pages.

**Why this stack.** There is no server to run and no intention to run one. Supabase was chosen
over plain hosted Postgres (Neon, Render) for a specific reason: a static GitHub Pages site has
nothing to talk to a raw database with. Supabase supplies the API, auth, and row-level
authorization alongside the database, which is exactly the gap a serverless frontend leaves.

**Relationship to `D:\Project\gestHouse`.** That is a separate, superseded Flutter Android app
covering the same domain — 100% offline, SQLite, no cloud by design, biometric lock, manual JSON
backup. It was built through six phases and then set aside in favour of this web app, because an
offline mobile app cannot share a booking link with a guest, which is a core requirement here.

Its architecture must not be carried over. The offline-only constraint, `sqflite`, and the
biometric lock are answers to that project's requirements, not this one's. This project has
auth, roles, guest links, and a hosted database — all of which that project explicitly ruled out.

---

## Settled decisions

Chosen deliberately. Raise them with the project owner before contradicting any of them.

| Decision | Chosen | Why not the alternative |
|---|---|---|
| Authentication | Supabase Auth, email + password, one account per user | A shared per-role password can't attribute an action to a person |
| Guest booking links | Public unguessable UUID token, no verification step | Zero friction for the guest was preferred over the added privacy of a phone/name check |
| Room assignment | Bookings reserve **specific room numbers** | Availability is checked per physical room, not per room-type quota |
| Theming | Light **and** dark mode, both required | — |
| Visual design | Deferred until the functionality is built | Deliberate sequencing, not an oversight |

Each of these shaped the schema: roles produced `profiles` + RLS, guest tokens produced
`public_token` and the restricted projection function, and per-room booking produced
`booking_rooms` and the exclusion constraint that prevents double-booking.

---

## Design principles behind the schema

The reasoning behind decisions that look arbitrary in the DDL:

- **Rates are snapshotted onto `booking_rooms`** rather than joined from `rooms`, so that
  repricing a room never rewrites the value of bookings already taken.
- **Nothing is hard-deleted by staff.** Cancellations and no-shows keep their rows and simply
  drop out of availability, occupancy, and revenue. Masters use `is_active` so historical
  bookings never lose their references.
- **`CANCELLED` and `NO_SHOW` are distinct statuses.** They release rooms identically, but
  conflating them would hide a real operational signal.
- **Check-in/check-out timestamps are recorded, not inferred** from the booked dates. A guest may
  arrive a day late or leave early, and "who is in the building now" has to reflect reality.
- **The exclusion constraint, not the availability query, is what prevents double-booking.** The
  query exists to produce a helpful error message; only the constraint holds under concurrent
  writes.

---

## Open questions

Flagged rather than silently assumed. Listed in full at `ARCHITECTURE.md` §15; the two that most
affect scope:

1. **Per-booking rate overrides** — rates are currently fixed per room, so negotiated or seasonal
   pricing has nowhere to live. The `booking_rooms.rate_per_night` column already exists as a
   snapshot, so this is a UI change rather than a migration.
2. **Payments and advances** — currently out of scope. But recording `total_amount` with no record
   of what was actually collected is a half-answer if money is tracked at all.

---

## Working conventions

- `ARCHITECTURE.md` is the source of truth. If the implementation diverges, update it in the same
  change — a stale architecture document is worse than none.
- Design the shape of a feature before building it.
- This project's visual design is deliberately its own. Do not port the Flutter app's palette or
  screens across; shared functionality does not imply shared presentation.
