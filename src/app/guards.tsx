import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { Icon, Logo } from '../components/ui'

export function FullPageLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--surface-page)]">
      <Logo className="size-11 animate-pulse" />
      <p className="text-sm text-[var(--text-muted)]">Loading…</p>
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageLoader />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  // A deactivated account keeps a valid JWT until it expires, so the client must
  // stop it too — the database already refuses every query from such a user.
  if (profile && !profile.is_active) {
    return <AccessDenied title="Account deactivated" message="Your access has been turned off. Contact an administrator." />
  }

  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth()

  if (loading) return <FullPageLoader />

  if (profile?.role !== 'admin') {
    return (
      <AccessDenied
        title="Administrators only"
        message="This section is limited to administrator accounts."
        inline
      />
    )
  }

  return <>{children}</>
}

function AccessDenied({
  title,
  message,
  inline = false,
}: {
  title: string
  message: string
  inline?: boolean
}) {
  const content = (
    <div className="card mx-auto flex max-w-md flex-col items-center px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
        <Icon name="lock" className="size-6" />
      </span>
      <h2 className="mt-5 text-lg font-medium">{title}</h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">{message}</p>
    </div>
  )

  if (inline) return content

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--surface-page)] px-4">
      {content}
    </div>
  )
}
