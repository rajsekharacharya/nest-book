import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { PageHeader } from '../../app/AppShell'
import { useAuth } from '../../app/AuthProvider'
import { Avatar, Button, Field, Icon, cx } from '../../components/ui'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  useToast,
} from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import {
  createUser,
  listUsers,
  updateMyName,
  updateUserAccess,
  updateUserCredentials,
  updateUserName,
  type UserRow,
} from '../../lib/queries/users'
import type { Role } from '../../lib/types'

export function UsersPage() {
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [pendingAccess, setPendingAccess] = useState<
    { user: UserRow; role?: Role; isActive?: boolean; title: string; message: string } | null
  >(null)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })

  const accessMutation = useMutation({
    mutationFn: updateUserAccess,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      setPendingAccess(null)
      notify('User updated.')
    },
    onError: (error) => notify(friendlyError(error), 'error'),
  })

  const users = usersQuery.data ?? []

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter(
      (user) =>
        user.email.toLowerCase().includes(term) ||
        (user.full_name ?? '').toLowerCase().includes(term),
    )
  }, [users, search])

  const adminCount = users.filter((user) => user.role === 'admin' && user.is_active).length

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, and what they are allowed to do."
        action={
          <Button icon={<Icon name="users" className="size-[1.05rem]" />} onClick={() => setShowInvite(true)}>
            Add user
          </Button>
        }
      />

      {users.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
              <Icon name="users" className="size-[1.05rem]" />
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or email"
              aria-label="Search users"
              className="input-base pl-10"
            />
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            {filtered.length} of {users.length}
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        {usersQuery.isLoading ? (
          <LoadingRows />
        ) : usersQuery.isError ? (
          <ErrorState
            message={friendlyError(usersQuery.error)}
            onRetry={() => void usersQuery.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="users"
            title={search ? 'No matches' : 'No users yet'}
            message={
              search
                ? 'No user matches that search.'
                : 'Add an account so your staff can sign in.'
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {filtered.map((user) => (
              <UserRowItem
                key={user.id}
                user={user}
                isLastAdmin={user.role === 'admin' && user.is_active && adminCount === 1}
                onEdit={() => setEditing(user)}
                onChangeRole={(role) =>
                  setPendingAccess({
                    user,
                    role,
                    title: role === 'admin' ? 'Make administrator?' : 'Change to staff?',
                    message:
                      role === 'admin'
                        ? `${user.full_name || user.email} will be able to manage guest houses, rooms and users.`
                        : `${user.full_name || user.email} will lose access to guest houses, rooms and user management.`,
                  })
                }
                onToggleActive={() =>
                  setPendingAccess({
                    user,
                    isActive: !user.is_active,
                    title: user.is_active ? 'Deactivate this user?' : 'Reactivate this user?',
                    message: user.is_active
                      ? `${user.full_name || user.email} will be signed out and blocked from the app.`
                      : `${user.full_name || user.email} will be able to sign in again.`,
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingAccess)}
        onClose={() => setPendingAccess(null)}
        onConfirm={() => {
          if (!pendingAccess) return
          accessMutation.mutate({
            userId: pendingAccess.user.id,
            role: pendingAccess.role,
            isActive: pendingAccess.isActive,
          })
        }}
        title={pendingAccess?.title ?? ''}
        message={pendingAccess?.message ?? ''}
        confirmLabel={pendingAccess?.isActive === false ? 'Deactivate' : 'Confirm'}
        tone={pendingAccess?.isActive === false ? 'danger' : 'primary'}
        loading={accessMutation.isPending}
      />

      <EditUserDialog
        user={editing}
        isSelf={editing?.is_self ?? false}
        onClose={() => setEditing(null)}
      />

      <CreateUserDialog open={showInvite} onClose={() => setShowInvite(false)} />
    </>
  )
}

/* ---------------------------------------------------------------- Row item */

function UserRowItem({
  user,
  isLastAdmin,
  onEdit,
  onChangeRole,
  onToggleActive,
}: {
  user: UserRow
  isLastAdmin: boolean
  onEdit: () => void
  onChangeRole: (role: Role) => void
  onToggleActive: () => void
}) {
  const displayName = user.full_name?.trim() || user.email.split('@')[0]
  // The database refuses self-changes and last-admin removal; mirroring that
  // here keeps the UI honest rather than offering an action that will fail.
  const locked = user.is_self || isLastAdmin

  return (
    <li
      className={cx(
        'flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors sm:px-5',
        'hover:bg-[var(--surface-hover)]',
        !user.is_active && 'opacity-60',
      )}
    >
      <Avatar name={displayName} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{displayName}</p>
          {user.is_self && (
            <Badge tone="brand" className="shrink-0">
              You
            </Badge>
          )}
          {!user.is_active && (
            <Badge tone="red" className="shrink-0">
              Deactivated
            </Badge>
          )}
        </div>
        <p className="truncate text-sm text-[var(--text-muted)]">{user.email}</p>
      </div>

      <div className="hidden text-right text-sm text-[var(--text-muted)] lg:block">
        {user.last_sign_in_at ? (
          <>
            <p className="text-[var(--text-secondary)]">Last seen</p>
            <p className="tabular">
              {formatDistanceToNow(new Date(user.last_sign_in_at), { addSuffix: true })}
            </p>
          </>
        ) : (
          <p>Never signed in</p>
        )}
      </div>

      <Badge tone={user.role === 'admin' ? 'brand' : 'neutral'} dot className="shrink-0 capitalize">
        {user.role}
      </Badge>

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        {!locked && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChangeRole(user.role === 'admin' ? 'staff' : 'admin')}
            >
              {user.role === 'admin' ? 'Make staff' : 'Make admin'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onToggleActive}>
              {user.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </>
        )}
        {isLastAdmin && !user.is_self && (
          <span className="px-2 text-xs text-[var(--text-muted)]">Last admin</span>
        )}
      </div>
    </li>
  )
}

/* -------------------------------------------------------------- Edit user */

function EditUserDialog({
  user,
  isSelf,
  onClose,
}: {
  user: UserRow | null
  isSelf: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { notify } = useToast()
  const { refreshProfile } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [changePassword, setChangePassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Re-seed the fields whenever a different user is opened.
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (user && seededFor !== user.id) {
    setSeededFor(user.id)
    setName(user.full_name ?? '')
    setEmail(user.email)
    setPassword('')
    setChangePassword(false)
    setShowPassword(false)
    setErrors({})
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) return

      const trimmedName = name.trim()
      const trimmedEmail = email.trim().toLowerCase()

      if (trimmedName !== (user.full_name ?? '')) {
        // Renaming yourself needs no admin rights; renaming a colleague does.
        if (isSelf) await updateMyName(trimmedName)
        else await updateUserName(user.id, trimmedName)
      }

      const emailChanged = trimmedEmail !== user.email.toLowerCase()
      if (emailChanged || (changePassword && password)) {
        await updateUserCredentials({
          userId: user.id,
          email: emailChanged ? trimmedEmail : undefined,
          password: changePassword && password ? password : undefined,
        })
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      if (isSelf) await refreshProfile()
      notify('Account updated.')
      onClose()
    },
    onError: (error) => setErrors({ form: friendlyError(error) }),
  })

  function submit() {
    if (!user) return
    const next: Record<string, string> = {}

    if (!email.trim()) next.email = 'Enter an email address.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = 'That does not look like an email address.'

    if (changePassword && password.length < 8) next.password = 'Use at least 8 characters.'

    setErrors(next)
    if (Object.keys(next).length > 0) return

    mutation.mutate()
  }

  const emailChanged = Boolean(user) && email.trim().toLowerCase() !== user!.email.toLowerCase()

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title={isSelf ? 'Your account' : 'Edit user'}
      description={isSelf ? 'Update your own details.' : user?.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <Icon name="alert" className="mt-px size-4 shrink-0" />
            <span>{errors.form}</span>
          </div>
        )}

        <Field
          label="Full name"
          autoFocus
          placeholder={user?.email.split('@')[0] ?? ''}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={mutation.isPending}
        />

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
          leading={<Icon name="mail" className="size-[1.05rem]" />}
          disabled={mutation.isPending}
          hint={
            emailChanged
              ? isSelf
                ? 'You will sign in with this address from now on.'
                : 'They will sign in with this address from now on.'
              : undefined
          }
        />

        <div className="rounded-xl border border-[var(--border-subtle)] p-3.5">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={changePassword}
              onChange={(event) => {
                setChangePassword(event.target.checked)
                if (!event.target.checked) setPassword('')
              }}
              className="mt-0.5 size-4 accent-[var(--color-brand-600)]"
              disabled={mutation.isPending}
            />
            <span>
              <span className="block text-sm font-medium">Set a new password</span>
              <span className="block text-xs text-[var(--text-muted)]">
                {isSelf
                  ? 'You will stay signed in on this device.'
                  : 'Their existing password stops working immediately.'}
              </span>
            </span>
          </label>

          {changePassword && (
            <div className="mt-3.5 space-y-3">
              <Field
                label="New password"
                type={showPassword ? 'text' : 'password'}
                placeholder="At least 8 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={errors.password}
                leading={<Icon name="lock" className="size-[1.05rem]" />}
                disabled={mutation.isPending}
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
              <button
                type="button"
                onClick={() => {
                  setPassword(randomPassword())
                  setShowPassword(true)
                }}
                className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Generate a password
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------- Create user */

function randomPassword() {
  // Ambiguous characters (O/0, l/1) are left out so the password can be read
  // aloud or copied by hand without confusion.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const values = crypto.getRandomValues(new Uint32Array(14))
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setFullName('')
    setEmail('')
    setPassword('')
    setRole('staff')
    setErrors({})
    setCreated(null)
    setCopied(false)
  }

  function close() {
    reset()
    onClose()
  }

  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      if (result.warning) notify(result.warning, 'error')
      // The password is shown once, here — it is never stored or recoverable.
      setCreated({ email, password })
    },
    onError: (error) => setErrors({ form: friendlyError(error) }),
  })

  function submit() {
    const next: Record<string, string> = {}
    if (!email.trim()) next.email = 'Enter an email address.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = 'That does not look like an email address.'
    if (password.length < 8) next.password = 'Use at least 8 characters.'

    setErrors(next)
    if (Object.keys(next).length > 0) return

    mutation.mutate({ email: email.trim(), password, fullName: fullName.trim(), role })
  }

  async function copyDetails() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(
        `Email: ${created.email}\nPassword: ${created.password}`,
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify('Could not copy — select the text instead.', 'error')
    }
  }

  if (created) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="Account created"
        description="Share these details — the password cannot be shown again."
        size="sm"
        footer={<Button onClick={close}>Done</Button>}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[var(--text-muted)]">Email</dt>
                <dd className="truncate font-medium">{created.email}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[var(--text-muted)]">Password</dt>
                <dd className="font-mono font-medium tracking-tight">{created.password}</dd>
              </div>
            </dl>
          </div>

          <Button
            variant="secondary"
            fullWidth
            onClick={() => void copyDetails()}
            icon={<Icon name={copied ? 'check' : 'users'} className="size-4" />}
          >
            {copied ? 'Copied' : 'Copy details'}
          </Button>

          <p className="text-sm text-[var(--text-muted)]">
            They can change it after signing in.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a user"
      description="They can sign in as soon as you save."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Create account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <Icon name="alert" className="mt-px size-4 shrink-0" />
            <span>{errors.form}</span>
          </div>
        )}

        <Field
          label="Full name"
          placeholder="Priya Sharma"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          hint="Optional — shown across the app."
          disabled={mutation.isPending}
        />

        <Field
          label="Email"
          type="email"
          placeholder="priya@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
          leading={<Icon name="mail" className="size-[1.05rem]" />}
          disabled={mutation.isPending}
        />

        <Field
          label="Password"
          type={showPassword ? 'text' : 'password'}
          placeholder="At least 8 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          leading={<Icon name="lock" className="size-[1.05rem]" />}
          disabled={mutation.isPending}
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

        <button
          type="button"
          onClick={() => {
            setPassword(randomPassword())
            setShowPassword(true)
          }}
          className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          Generate a password
        </button>

        <fieldset className="space-y-2">
          <legend className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
            Role
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { value: 'staff', title: 'Staff', body: 'Create and manage bookings.' },
                { value: 'admin', title: 'Admin', body: 'Full access, including users.' },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={cx(
                  'flex cursor-pointer gap-2.5 rounded-xl border p-3 transition-colors',
                  role === option.value
                    ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/40'
                    : 'border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  checked={role === option.value}
                  onChange={() => setRole(option.value)}
                  className="mt-0.5 size-4 accent-[var(--color-brand-600)]"
                  disabled={mutation.isPending}
                />
                <span>
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{option.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- Loading */

function LoadingRows() {
  return (
    <ul className="divide-y divide-[var(--border-subtle)]">
      {Array.from({ length: 3 }).map((_, index) => (
        <li key={index} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </li>
      ))}
    </ul>
  )
}
