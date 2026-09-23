import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../app/AuthProvider'
import { useTheme } from '../../app/ThemeProvider'
import { Button, Field, Icon, Logo, ThemeToggle } from '../../components/ui'
import { friendlyError } from '../../lib/errors'

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[1.15rem]" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1 .7-2.3 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  )
}

/*
  A rejected OAuth sign-in comes back as an error in the URL fragment rather
  than as a thrown error, because the redirect happens outside the app. The
  database refuses uninvited emails with a message Supabase surfaces as a
  generic server error, so it is translated into something actionable here.
*/
function readOAuthError(): string | null {
  const hash = window.location.hash
  const queryStart = hash.indexOf('?')
  const params = new URLSearchParams(
    queryStart >= 0 ? hash.slice(queryStart + 1) : window.location.search,
  )

  const code = params.get('error_code')
  const description = params.get('error_description')
  if (!code && !description) return null

  // Clear it so a refresh does not resurrect a stale error.
  window.history.replaceState(null, '', `${window.location.pathname}#/login`)

  const text = `${code ?? ''} ${description ?? ''}`
  if (/database error|unexpected_failure|saving new user/i.test(text)) {
    return 'This Google account is not registered. Ask an administrator to add you, then try again.'
  }
  if (/access_denied/i.test(text)) return 'Google sign-in was cancelled.'
  return description ? description.replace(/\+/g, ' ') : 'Google sign-in failed.'
}

const HIGHLIGHTS = [
  { icon: 'calendar', title: 'Live availability', body: 'Rooms are checked the moment you pick dates — double-bookings are impossible.' },
  { icon: 'bed', title: 'Every room, one view', body: 'See the whole month across every guest house on a single timeline.' },
  { icon: 'users', title: 'Share with guests', body: 'Send a private link so guests can see their booking without an account.' },
] as const

export function LoginPage() {
  const { session, signIn, signInWithGoogle } = useAuth()
  const { resolved, toggle } = useTheme()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  useEffect(() => {
    const oauthError = readOAuthError()
    if (oauthError) setError(oauthError)
  }, [])

  async function onGoogle() {
    setError(null)
    setGoogleLoading(true)
    try {
      await signInWithGoogle()
      // On success the browser navigates away, so nothing follows.
    } catch (caught) {
      setError(friendlyError(caught))
      setGoogleLoading(false)
    }
  }

  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/app'} replace />
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
        <header className="flex items-center justify-between p-5 lg:p-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-lg text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Logo className="size-8 lg:hidden" />
            <span className="font-semibold tracking-tight lg:hidden">NestBook</span>
            <span className="hidden lg:inline">← Back</span>
          </Link>
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

            {error && (
              <div
                role="alert"
                className="animate-fade-up mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              >
                <Icon name="alert" className="mt-px size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mb-6 space-y-5">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => void onGoogle()}
                loading={googleLoading}
                icon={googleLoading ? undefined : <GoogleMark />}
                disabled={submitting}
              >
                {googleLoading ? 'Opening Google…' : 'Continue with Google'}
              </Button>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                <span className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  or
                </span>
                <span className="h-px flex-1 bg-[var(--border-subtle)]" />
              </div>
            </div>

            <form onSubmit={onSubmit} noValidate className="space-y-5">
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
