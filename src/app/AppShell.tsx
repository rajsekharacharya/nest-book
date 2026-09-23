import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { useTheme } from './ThemeProvider'
import { Avatar, Button, Icon, Logo, ThemeToggle, cx } from '../components/ui'

type NavItem = {
  to: string
  label: string
  icon: string
  adminOnly?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/bookings', label: 'Bookings', icon: 'calendar' },
  { to: '/guest-houses', label: 'Guest Houses', icon: 'building', adminOnly: true },
  { to: '/room-types', label: 'Room Types', icon: 'bed', adminOnly: true },
  { to: '/users', label: 'Users', icon: 'users', adminOnly: true },
]

export function AppShell() {
  const { profile, signOut, isAdmin } = useAuth()
  const { resolved, toggle } = useTheme()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  // A tap that navigates should also dismiss the drawer.
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Prevent the page behind the drawer from scrolling on touch devices.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const items = NAV.filter((item) => !item.adminOnly || isAdmin)
  const displayName = profile?.full_name?.trim() || 'Account'

  return (
    <div className="min-h-dvh lg:flex">
      {/* Scrim */}
      <div
        onClick={() => setMobileOpen(false)}
        className={cx(
          'fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden
      />

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col',
          'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          'lg:static lg:z-auto lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ backgroundColor: 'var(--sidebar-bg)' }}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <Logo className="size-8" />
            <span className="font-semibold tracking-tight text-white">NestBook</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="flex size-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <Icon name="close" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'text-white' : 'hover:text-white',
                )
              }
              style={({ isActive }) => ({
                backgroundColor: isActive ? 'var(--sidebar-active)' : undefined,
                color: isActive ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
              })}
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      'absolute top-1/2 left-0 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 transition-all',
                      isActive ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Icon name={item.icon} className="size-[1.15rem] shrink-0" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <Avatar name={displayName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{displayName}</p>
              <p className="text-xs capitalize" style={{ color: 'var(--sidebar-text)' }}>
                {profile?.role ?? '—'}
              </p>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1">
            <div className="text-white/70">
              <ThemeToggle resolved={resolved} onToggle={toggle} />
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex h-9 flex-1 items-center gap-2 rounded-lg px-2.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon name="logout" className="size-[1.05rem]" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-card)]/85 px-4 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex size-10 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
            aria-label="Open menu"
          >
            <Icon name="menu" />
          </button>
          <div className="flex items-center gap-2">
            <Logo className="size-7" />
            <span className="font-semibold tracking-tight">NestBook</span>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ Page heading */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-[var(--text-secondary)]">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

/* ----------------------------------------------------------- Placeholder */

export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="card flex flex-col items-center justify-center px-6 py-20 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
          <Icon name="bed" className="size-6" />
        </span>
        <h2 className="mt-5 text-lg font-medium">Not built yet</h2>
        <p className="mt-2 max-w-sm text-sm text-[var(--text-secondary)]">{note}</p>
      </div>
    </>
  )
}

export { Button }
