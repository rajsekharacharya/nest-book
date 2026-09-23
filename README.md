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
| [`docs/DESIGN.md`](docs/DESIGN.md) | The design system — colour, type, components, accessibility |
| [`CLAUDE.md`](CLAUDE.md) | Working rules, current status, environment notes |

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

Registration is closed: only an email an administrator has registered can sign in, with a password
or with Google. The first account is promoted to administrator by a migration; every later one is
managed in-app.

Edge functions (`supabase/functions/`) hold the operations that need the service key — creating an
account, changing an email or password — so that key never reaches the browser:

```bash
npx supabase functions deploy create-user --use-api
```

## Status

Under construction.

**Built:** schema, RLS and booking RPCs; auth shell with role-guarded routing and light/dark
theming; landing page; user management including account creation, editing, roles and closed
registration with Google sign-in.

**Next:** room types → guest houses with bulk room-add → bookings → calendar → dashboard →
guest link → deploy.

See `ARCHITECTURE.md` §14 for the full phase plan.
