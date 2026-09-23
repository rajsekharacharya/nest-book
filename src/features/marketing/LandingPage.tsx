import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../app/AuthProvider'
import { useTheme } from '../../app/ThemeProvider'
import { Button, Icon, Logo, ThemeToggle } from '../../components/ui'

const FEATURES = [
  {
    icon: 'calendar',
    title: 'Never double-book',
    body: 'Availability is checked the moment dates are picked, and the database itself refuses a clashing booking — not just the form.',
  },
  {
    icon: 'dashboard',
    title: 'The whole month at a glance',
    body: 'Every room across every guest house on one timeline, so you can see what is free without opening a single booking.',
  },
  {
    icon: 'building',
    title: 'Many properties, one place',
    body: 'Run several guest houses side by side, each with its own rooms, rates and contact details.',
  },
  {
    icon: 'users',
    title: 'Staff access that fits',
    body: 'Staff handle bookings and check-ins. Only administrators change rooms, rates and who can sign in.',
  },
  {
    icon: 'mail',
    title: 'A link for the guest',
    body: 'Share a private link showing their dates, rooms and address — no account needed, and nothing internal exposed.',
  },
  {
    icon: 'bed',
    title: 'Set up in minutes',
    body: 'Add a guest house, enter your room numbers in one go, and start taking bookings the same day.',
  },
] as const

const STEPS = [
  { title: 'Add your guest houses', body: 'Name, address, contact person and how many rooms it has.' },
  { title: 'Enter your rooms', body: 'Add a whole floor at once — pick the type, set the rate, list the numbers.' },
  { title: 'Take bookings', body: 'Pick dates, see exactly which rooms are free, and confirm.' },
] as const

export function LandingPage() {
  const { session, loading } = useAuth()
  const { resolved, toggle } = useTheme()

  // Someone already signed in wants the app, not the pitch.
  if (!loading && session) return <Navigate to="/app" replace />

  return (
    <div className="min-h-dvh bg-[var(--surface-page)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--surface-page)]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <Logo className="size-8" />
            <span className="font-semibold tracking-tight">NestBook</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle resolved={resolved} onToggle={toggle} />
            <Link to="/login">
              <Button size="sm">Sign in</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.55] dark:opacity-40"
            style={{
              background:
                'radial-gradient(60% 50% at 50% 0%, var(--color-brand-100) 0%, transparent 70%)',
            }}
          />
          <div className="relative mx-auto max-w-4xl px-5 pt-16 pb-14 text-center sm:px-8 sm:pt-24 sm:pb-20">
            <span className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3.5 py-1.5 text-sm text-[var(--text-secondary)]">
              <span className="size-1.5 rounded-full bg-brand-500" />
              Guest house management
            </span>

            <h1
              className="animate-fade-up mt-6 text-[2.5rem] leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl"
              style={{ animationDelay: '60ms' }}
            >
              Every room, every guest,
              <span className="block text-brand-600 dark:text-brand-400">always in order.</span>
            </h1>

            <p
              className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-balance text-[var(--text-secondary)]"
              style={{ animationDelay: '120ms' }}
            >
              Track rooms, take bookings and check guests in — without the spreadsheet,
              the double-bookings, or the phone call to find out what is free.
            </p>

            <div
              className="animate-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
              style={{ animationDelay: '180ms' }}
            >
              <Link to="/login" className="w-full sm:w-auto">
                <Button size="lg" fullWidth>
                  Sign in to your account
                </Button>
              </Link>
              <a href="#how" className="w-full sm:w-auto">
                <Button variant="secondary" size="lg" fullWidth>
                  See how it works
                </Button>
              </a>
            </div>

            <p
              className="animate-fade-up mt-4 text-sm text-[var(--text-muted)]"
              style={{ animationDelay: '220ms' }}
            >
              Accounts are created by your administrator.
            </p>
          </div>
        </section>

        {/* Preview */}
        <section className="mx-auto max-w-5xl px-5 pb-16 sm:px-8 sm:pb-24">
          <CalendarPreview />
        </section>

        {/* Features */}
        <section className="border-y border-[var(--border-subtle)] bg-[var(--surface-card)]">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Built around how a guest house actually runs
              </h2>
              <p className="mt-4 text-lg text-[var(--text-secondary)]">
                Not a hotel system with the hard parts left in.
              </p>
            </div>

            <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title}>
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                    <Icon name={feature.icon} className="size-[1.3rem]" />
                  </span>
                  <h3 className="mt-4 font-medium">{feature.title}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
                    {feature.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Running in three steps
              </h2>
              <p className="mt-4 text-lg text-[var(--text-secondary)]">
                Most properties are set up and taking bookings the same afternoon.
              </p>
            </div>

            <ol className="mt-12 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative">
                  <span className="flex size-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 font-medium">{step.title}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Close */}
        <section className="px-5 pb-16 sm:px-8 sm:pb-24">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-brand-950 px-6 py-14 text-center sm:px-12 sm:py-20">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(100% 80% at 20% 0%, #12846f 0%, transparent 60%), radial-gradient(80% 70% at 100% 100%, #0f5d51 0%, transparent 65%)',
              }}
            />
            <div className="relative">
              <h2 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
                Stop keeping the calendar in your head.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-balance text-brand-100/75">
                Sign in and see every room you have, free or taken, for any date.
              </p>
              <Link to="/login" className="mt-8 inline-block">
                <Button size="lg" className="bg-white text-brand-800 hover:bg-brand-50">
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
          <div className="flex items-center gap-2.5">
            <Logo className="size-6" />
            <span className="text-sm font-medium">NestBook</span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            © {new Date().getFullYear()} NestBook
          </p>
        </div>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ Preview */

/* A still of the occupancy grid, so the landing page shows the actual product
   rather than a stock illustration. Static by design — no data is fetched. */
function CalendarPreview() {
  const rooms = [
    { number: '101', type: 'Single', bars: [{ start: 0, span: 4, name: 'R. Mehta', tone: 'booked' }, { start: 6, span: 3, name: 'A. Khan', tone: 'in' }] },
    { number: '102', type: 'Single', bars: [{ start: 2, span: 5, name: 'S. Iyer', tone: 'in' }] },
    { number: '201', type: 'Double', bars: [{ start: 0, span: 3, name: 'D. Roy', tone: 'out' }, { start: 4, span: 6, name: 'P. Nair', tone: 'booked' }] },
    { number: '202', type: 'Double', bars: [{ start: 5, span: 4, name: 'K. Bose', tone: 'booked' }] },
    { number: '301', type: 'Deluxe', bars: [{ start: 1, span: 6, name: 'M. Gupta', tone: 'in' }] },
  ]

  const tones: Record<string, string> = {
    booked: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800',
    in: 'bg-brand-100 text-brand-800 border-brand-300 dark:bg-brand-950 dark:text-brand-200 dark:border-brand-700',
    out: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
  }

  const days = 12

  return (
    <div className="animate-fade-up card overflow-hidden" style={{ animationDelay: '260ms' }}>
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="calendar" className="size-4 text-[var(--text-muted)]" />
          <span className="text-sm font-medium">March 2026</span>
        </div>
        <div className="flex gap-1.5">
          {[
            ['Booked', 'bg-sky-400'],
            ['In-house', 'bg-brand-500'],
            ['Checked out', 'bg-slate-400'],
          ].map(([label, dot]) => (
            <span
              key={label}
              className="hidden items-center gap-1.5 text-xs text-[var(--text-muted)] sm:inline-flex"
            >
              <span className={`size-2 rounded-full ${dot}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[36rem]">
          <div className="flex border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
            <div className="w-28 shrink-0 px-3 py-2 text-xs font-medium text-[var(--text-muted)]">
              Room
            </div>
            {Array.from({ length: days }, (_, index) => (
              <div
                key={index}
                className="tabular flex-1 py-2 text-center text-xs text-[var(--text-muted)]"
              >
                {10 + index}
              </div>
            ))}
          </div>

          {rooms.map((room) => (
            <div key={room.number} className="flex border-b border-[var(--border-subtle)] last:border-0">
              <div className="w-28 shrink-0 px-3 py-2.5">
                <div className="tabular text-sm font-medium">{room.number}</div>
                <div className="text-xs text-[var(--text-muted)]">{room.type}</div>
              </div>
              <div className="relative flex-1">
                <div className="absolute inset-0 flex">
                  {Array.from({ length: days }, (_, index) => (
                    <div
                      key={index}
                      className="flex-1 border-l border-[var(--border-subtle)] first:border-0"
                    />
                  ))}
                </div>
                <div className="relative h-full py-2">
                  {room.bars.map((bar) => (
                    <div
                      key={bar.name}
                      className={`absolute flex h-7 items-center truncate rounded-md border px-2 text-xs font-medium ${tones[bar.tone]}`}
                      style={{
                        left: `${(bar.start / days) * 100}%`,
                        width: `calc(${(bar.span / days) * 100}% - 3px)`,
                      }}
                    >
                      {bar.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
