import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../app/AuthProvider'
import { useTheme } from '../../app/ThemeProvider'
import { Button, Field, Icon, Logo, ThemeToggle } from '../../components/ui'
import { friendlyError } from '../../lib/errors'

const HIGHLIGHTS = [
  { icon: 'calendar', title: 'Live availability', body: 'Rooms are checked the moment you pick dates — double-bookings are impossible.' },
  { icon: 'bed', title: 'Every room, one view', body: 'See the whole month across every guest house on a single timeline.' },
  { icon: 'users', title: 'Share with guests', body: 'Send a private link so guests can see their booking without an account.' },
] as const

export function LoginPage() {
  const { session, signIn } = useAuth()
  const { resolved, toggle } = useTheme()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/'} replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }

    setSubmitting(true)
    try {
      await signIn(email, password)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Brand panel — hidden on small screens, where it would push the form below the fold */}
      <aside className="relative hidden overflow-hidden bg-brand-950 lg:flex lg:w-[46%] lg:flex-col lg:justify-between xl:w-1/2">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(120% 90% at 8% 0%, #12846f 0%, transparent 55%), radial-gradient(90% 70% at 100% 100%, #0f5d51 0%, transparent 60%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            color: '#ffffff',
          }}
        />

        <div className="relative flex items-center gap-3 p-10">
          <Logo className="size-9" />
          <span className="text-lg font-semibold tracking-tight text-white">NestBook</span>
        </div>

        <div className="relative px-10 pb-4">
          <h1 className="max-w-lg text-[2.75rem] leading-[1.1] font-semibold tracking-tight text-white">
            Every room, every guest, always in order.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-brand-100/80">
            Guest house management that keeps your calendar honest.
          </p>

          <ul className="mt-12 max-w-md space-y-6">
            {HIGHLIGHTS.map((item, index) => (
              <li
                key={item.title}
                className="animate-fade-up flex gap-4"
                style={{ animationDelay: `${120 * index}ms` }}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-100 ring-1 ring-white/15">
                  <Icon name={item.icon} className="size-[1.15rem]" />
                </span>
                <div>
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-brand-100/65">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative p-10 text-sm text-brand-100/45">
          © {new Date().getFullYear()} NestBook
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 flex-col bg-[var(--surface-page)]">
        <header className="flex items-center justify-between p-5 lg:justify-end lg:p-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <Logo className="size-8" />
            <span className="font-semibold tracking-tight">NestBook</span>
          </div>
          <ThemeToggle resolved={resolved} onToggle={toggle} />
        </header>

        <div className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-8">
          <div className="animate-fade-up w-full max-w-[25rem]">
            <div className="mb-8">
              <h2 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
                Welcome back
              </h2>
              <p className="mt-2 text-[var(--text-secondary)]">
                Sign in to manage your bookings.
              </p>
            </div>

            <form onSubmit={onSubmit} noValidate className="space-y-5">
              {error && (
                <div
                  role="alert"
                  className="animate-fade-up flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                >
                  <Icon name="alert" className="mt-px size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Field
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                leading={<Icon name="mail" className="size-[1.05rem]" />}
                disabled={submitting}
              />

              <Field
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                leading={<Icon name="lock" className="size-[1.05rem]" />}
                disabled={submitting}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="flex size-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} className="size-[1.05rem]" />
                  </button>
                }
              />

              <Button type="submit" size="lg" fullWidth loading={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <p className="mt-8 text-center text-sm text-[var(--text-muted)]">
              Accounts are created by an administrator.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
