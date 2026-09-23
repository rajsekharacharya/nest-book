import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef, useId } from 'react'

export function cx(...parts: unknown[]) {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ')
}

/* ------------------------------------------------------------------ Button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  fullWidth?: boolean
}

const BUTTON_VARIANTS: Record<string, string> = {
  primary:
    'bg-brand-600 text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] hover:bg-brand-700 active:bg-brand-800 disabled:hover:bg-brand-600',
  secondary:
    'bg-[var(--surface-card)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-sunken)]',
  ghost:
    'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  // For placing on a dark brand surface, where the teal primary would vanish.
  inverse:
    'bg-white text-brand-800 shadow-[0_1px_2px_rgba(15,23,42,0.12)] hover:bg-brand-50 active:bg-brand-100',
}

const BUTTON_SIZES: Record<string, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[0.9375rem] gap-2',
  lg: 'h-12 px-5 text-base gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    fullWidth,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-[0.625rem] font-medium',
        'transition-[background-color,transform,box-shadow] duration-150',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
})

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/* ------------------------------------------------------------------- Input */

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | null
  hint?: string
  leading?: ReactNode
  trailing?: ReactNode
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, leading, trailing, className, id, ...rest },
  ref,
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={fieldId}
        className="block text-sm font-medium text-[var(--text-secondary)]"
      >
        {label}
      </label>
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cx(
            'input-base',
            leading && 'pl-10',
            trailing && 'pr-11',
            error && 'input-error',
            className,
          )}
          {...rest}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-2 flex items-center">{trailing}</span>
        )}
      </div>
      {error ? (
        <p id={`${fieldId}-error`} className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <Icon name="alert" className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-sm text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  )
})

/* ------------------------------------------------------------------ Avatar */

/* Deterministic colour per name, so a given person keeps the same chip everywhere. */
const AVATAR_TONES = [
  'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
]

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length]
  const sizes = {
    sm: 'size-7 text-[0.6875rem]',
    md: 'size-9 text-xs',
    lg: 'size-12 text-sm',
  }

  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none',
        sizes[size],
        tone,
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

/* ------------------------------------------------------------------- Icons */

const PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  building: (
    <>
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M16 10h3a2 2 0 0 1 2 2v9" />
      <path d="M9 7h2M9 11h2M9 15h2" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18V7M3 12h18a2 2 0 0 1 2 2v4M21 18v-2" />
      <circle cx="8" cy="10" r="2" />
      <path d="M12 12V9a1 1 0 0 1 1-1h5a2 2 0 0 1 2 2v2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0-2-5.2M18 20a5.5 5.5 0 0 0-2-4.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  logout: <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  'eye-off': <path d="M4 4l16 16M10 5.7A7.8 7.8 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4M6.5 8.3A16.6 16.6 0 0 0 2 12s3.6 6.5 10 6.5c1.2 0 2.3-.2 3.3-.6M9.6 9.8a3 3 0 0 0 4.2 4.2" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
    </>
  ),
  // A room withdrawn from service — a bed with a line through it.
  'bed-off': (
    <>
      <path d="M3 18V7M3 12h18a2 2 0 0 1 2 2v4" />
      <circle cx="8" cy="10" r="2" />
      <path d="M4 4l16 16" />
    </>
  ),
}

export function Icon({
  name,
  className = 'size-5',
}: {
  name: keyof typeof PATHS | string
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name] ?? null}
    </svg>
  )
}

/* ------------------------------------------------------------------- Brand */

export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="nb-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#43bfa4" />
          <stop offset="100%" stopColor="#116a5b" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#nb-mark)" />
      {/* A roofline over a bed — house plus stay, at favicon scale */}
      <path
        d="M9 15.5 16 10l7 5.5"
        stroke="white"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M11 17v5M11 19h10v3M21 19v-1.2a1.2 1.2 0 0 0-1.2-1.2H16V19"
        stroke="white"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.95"
      />
    </svg>
  )
}

/* ------------------------------------------------------------ Theme toggle */

export function ThemeToggle({
  resolved,
  onToggle,
  className,
}: {
  resolved: 'light' | 'dark'
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
      aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
      className={cx(
        'relative inline-flex size-9 items-center justify-center rounded-lg',
        'text-current transition-colors hover:bg-black/5 dark:hover:bg-white/10',
        className,
      )}
    >
      <span className="relative block size-5">
        <Icon
          name="sun"
          className={cx(
            'absolute inset-0 size-5 transition-all duration-300',
            resolved === 'dark'
              ? 'scale-50 rotate-90 opacity-0'
              : 'scale-100 rotate-0 opacity-100',
          )}
        />
        <Icon
          name="moon"
          className={cx(
            'absolute inset-0 size-5 transition-all duration-300',
            resolved === 'dark'
              ? 'scale-100 rotate-0 opacity-100'
              : 'scale-50 -rotate-90 opacity-0',
          )}
        />
      </span>
    </button>
  )
}
