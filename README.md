# NestBook

Guest house management system — manage guest houses, rooms, and bookings, with role-based access
and a shareable read-only booking link for guests.

## Stack

React + Vite + TypeScript on GitHub Pages, backed by Supabase (Postgres, Auth, and row-level
authorization). No self-managed server.

## Documentation

| Document | Contents |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Schema, business rules, RPCs, security model, build phases |
| [`docs/CONTEXT.md`](docs/CONTEXT.md) | Why the system is shaped this way; settled and open decisions |
| [`CLAUDE.md`](CLAUDE.md) | Working rules for this repository |

## Getting started

```bash
npm install
npm run dev
```

Create a `.env.local` with your Supabase project values:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Both are safe in client code by design — all access control is enforced by row-level security
policies in the database, never by the client.

## Database

Migrations live in `supabase/migrations/`, are forward-only, and are committed.

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase migration up --linked
```

The signup trigger assigns every new user the `staff` role. The first admin is promoted once by
hand in the Supabase SQL editor; every later admin is promoted in-app.

## Status

Under construction. Schema foundation and master tables are applied; booking core is next.
See `ARCHITECTURE.md` §14 for the phase plan.
