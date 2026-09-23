# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Start of session

Read `ARCHITECTURE.md` first — the source of truth for schema, business rules, and build phases.
If the implementation diverges from it, update it in the same change; a stale architecture doc is
worse than none.

Then read `docs/CONTEXT.md` for the reasoning behind the design: why this stack, which decisions
are settled, and what is still open. Keep it current as decisions are made — it is where project
memory lives, in the repo rather than in any one person's or tool's local state.

## Project

**Guest House Management System** — a web app for managing guest houses, rooms, and bookings,
with role-based access and a shareable read-only booking link for guests.

- Frontend: React + Vite + TypeScript + Tailwind, deployed static to GitHub Pages
- Backend: Supabase (Postgres + PostgREST + Auth). There is no self-managed server
- Authorization: Postgres Row Level Security, not client-side checks

## Non-negotiable rules

These encode decisions that are expensive to reverse. Do not work around them.

1. **Business rules live in the database, not the client.** Every booking write goes through a
   `SECURITY DEFINER` RPC (`ARCHITECTURE.md` §7) that validates inside one transaction. No role
   holds direct insert/update grants on `bookings`, `booking_rooms`, or `booking_guests` —
   granting them would let a client skip every check. Client-side validation exists for fast
   feedback only and is never the authority.

2. **Date-overlap logic has exactly one definition.** `existing.check_in < new.check_out AND
   existing.check_out > new.check_in` — checkout day is free for a new check-in. It lives in
   `ranges_overlap()` in SQL and `booking-rules.ts` on the client. Never reimplement it inline;
   every availability, calendar, and occupancy query reuses it.

3. **The exclusion constraint on `booking_rooms` is the real double-booking guard.** The explicit
   availability check exists to produce a friendly error message; the constraint is what makes the
   guarantee true under concurrent writes. Never drop it, and never rely on the `SELECT` check
   alone.

4. **Rates are snapshotted onto `booking_rooms` at booking time.** Never join to `rooms.rate` to
   value a past booking — editing a room's price must not rewrite history.

5. **Cancelled and no-show bookings are excluded from every availability, occupancy, and revenue
   calculation.** Rows are never hard-deleted by staff; history is preserved.

6. **The service role key never appears in frontend code.** Only `VITE_SUPABASE_ANON_KEY`. Admin
   operations needing elevated rights go through an Edge Function.

7. **`SECURITY DEFINER` functions always set `search_path = public`** explicitly.

## Architecture

Strict layering — components never call Supabase directly:

```
src/features/*        screens
   → src/lib/queries/*   the ONLY place the Supabase client is called
      → Supabase RPC / PostgREST
         → Postgres (RLS + constraints + validation functions)
```

Shared derivations (occupant count per booking type, nights, overlap) live in
`src/lib/booking-rules.ts` and are reused by both the form and display code.

## Commands

```
npm run dev        # local dev server
npm run build      # production build to dist/
npm run typecheck  # tsc --noEmit
npm run lint
npm test
```

Migrations live in `supabase/migrations/*.sql`, are forward-only, and are committed. Apply through
the Supabase SQL editor or CLI.

## Conventions

- TypeScript strict mode. No `any` in committed code.
- Database identifiers are `snake_case`; TypeScript is `camelCase`. Map at the query layer, not
  throughout the UI.
- Errors surface as the typed codes in `ARCHITECTURE.md` §7, mapped to plain-language messages.
  A raw Postgres error must never reach the user.
- Dates for stays are `date`, never `timestamptz`. "Today" resolves in the property's configured
  time zone, not the browser's and not UTC.

  **Use `public.property_today()` in SQL, never bare `current_date`.** The database runs in UTC
  and the properties are in India (+05:30), so between local midnight and 05:30 IST `current_date`
  returns *yesterday* — an in-house guest then reports as not yet arrived. The zone lives in
  `app_settings.time_zone` (default `Asia/Kolkata`); change it with an UPDATE, not a migration.

  On the client, prefer a date the server sent (for example `stats.today`) over `todayISO()`
  wherever the two could disagree near midnight.

## Testing

Concentrate on the SQL rules — overlap semantics, concurrency, capacity, status transitions, and
RLS — per `ARCHITECTURE.md` §13. These are the expensive things to get wrong. Frontend tests cover
the pure functions in `booking-rules.ts` and the room-number range parser.

Vitest runs with `npm test`. `src/lib/room-numbers.test.ts` covers the range parser, including the
cases that quietly go wrong: inclusive range ends, preserved leading zeros (`008-010`), and a
hyphen that belongs to a name (`G-2`) rather than marking a range.

## Current status

**Built:** every screen. Full schema and RLS, booking RPCs, auth shell, landing page, user
management, the masters (room types; guest houses with photo upload and bulk room-add), bookings
(form with availability-checked room picker, list, month calendar, detail with the full
lifecycle), the public guest link page, and the dashboard.

**Next:** GitHub Pages deploy. Outstanding on the owner's side: repo Settings → Pages → Source:
GitHub Actions.

Phases are listed in `ARCHITECTURE.md` §14. The visual design pass is deliberately deferred.

## Working agreements

Established during the build; they exist because ignoring them wasted time before.

- **Design before building.** Settle the shape of a feature first. Do not scaffold code to show
  progress.
- **Recommend, do not interrogate.** Lead with a concrete proposal and the tradeoff. Reserve
  questions for forks that genuinely change the schema or architecture.
- **Never send someone to an external dashboard for a routine task.** When something appears to
  need a privileged key, find the server-side path (an edge function) instead. Dashboard steps are
  only for genuine one-time setup: creating the project, enabling an OAuth provider.
- **Keep the dev server running** so changes can be seen as they land, and say what to look at
  after each one.
- **Once an approach is agreed, carry it through** and report at the end rather than confirming
  each step.
- **Audits should find real faults**, including in work already delivered — not just additions.
- **Instructions for external tools name the exact clicks**, action first and reasoning after.
- **This project's visual design is its own.** Do not port anything from the superseded Flutter
  app; shared functionality does not imply shared presentation.

## Environment notes

Docker is not installed on the developer's machine, so `supabase db dump`, `db diff` and
`supabase start` all fail. Migrations apply straight to the linked remote; edge functions deploy
with `--use-api`.

To verify SQL behaviour, apply a temporary migration that runs inside `begin`/`rollback` and ends
by raising a sentinel exception — the CLI does not print `RAISE NOTICE`. Afterwards delete the
file and run `npx supabase migration repair --status reverted <version>`, or the phantom entry
confuses later migrations.
