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
import { listUsers, updateMyName, updateUserAccess, type UserRow } from '../../lib/queries/users'
import type { Role } from '../../lib/types'

export function UsersPage() {
  const queryClient = useQueryClient()
  const { notify } = useToast()
  const { refreshProfile } = useAuth()

  const [search, setSearch] = useState('')
  const [pendingAccess, setPendingAccess] = useState<
    { user: UserRow; role?: Role; isActive?: boolean; title: string; message: string } | null
  >(null)
  const [renaming, setRenaming] = useState<UserRow | null>(null)
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

  const renameMutation = useMutation({
    mutationFn: updateMyName,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      await refreshProfile()
      setRenaming(null)
      notify('Name updated.')
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
                : 'Create accounts from the Supabase dashboard, then set their role here.'
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {filtered.map((user) => (
              <UserRowItem
                key={user.id}
                user={user}
                isLastAdmin={user.role === 'admin' && user.is_active && adminCount === 1}
                onRename={() => setRenaming(user)}
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

      <RenameDialog
        user={renaming}
        onClose={() => setRenaming(null)}
        onSave={(name) => renameMutation.mutate(name)}
        loading={renameMutation.isPending}
      />

      <InviteDialog open={showInvite} onClose={() => setShowInvite(false)} />
    </>
  )
}

/* ---------------------------------------------------------------- Row item */

function UserRowItem({
  user,
  isLastAdmin,
  onRename,
  onChangeRole,
  onToggleActive,
}: {
  user: UserRow
  isLastAdmin: boolean
  onRename: () => void
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
        {user.is_self && (
          <Button variant="ghost" size="sm" onClick={onRename}>
            Rename
          </Button>
        )}
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

/* ------------------------------------------------------------------ Rename */

function RenameDialog({
  user,
  onClose,
  onSave,
  loading,
}: {
  user: UserRow | null
  onClose: () => void
  onSave: (name: string) => void
  loading: boolean
}) {
  const [name, setName] = useState('')

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title="Your display name"
      description="This is how you appear across the app."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => onSave(name)} loading={loading} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <Field
        label="Full name"
        autoFocus
        placeholder={user?.email.split('@')[0] ?? ''}
        defaultValue={user?.full_name ?? ''}
        onChange={(event) => setName(event.target.value)}
      />
    </Modal>
  )
}

/* ------------------------------------------------------------------ Invite */

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectRef = (import.meta.env.VITE_SUPABASE_URL ?? '')
    .replace('https://', '')
    .replace('.supabase.co', '')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a user"
      description="New accounts are created in Supabase, then given a role here."
      footer={<Button onClick={onClose}>Got it</Button>}
    >
      <div className="space-y-4 text-sm">
        <p className="text-[var(--text-secondary)]">
          Creating a password-based account requires a privileged key that must never be
          shipped to a browser, so this step happens in the Supabase dashboard.
        </p>

        <ol className="space-y-3">
          {[
            'Open Authentication → Users in your Supabase project.',
            'Choose Add user → Create new user.',
            'Enter their email and a password, and tick Auto Confirm User.',
            'Return here — they will appear in the list as staff, and you can promote them.',
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                {index + 1}
              </span>
              <span className="pt-0.5 text-[var(--text-secondary)]">{step}</span>
            </li>
          ))}
        </ol>

        {projectRef && (
          <a
            href={`https://supabase.com/dashboard/project/${projectRef}/auth/users`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            Open Supabase users
            <Icon name="logout" className="size-4" />
          </a>
        )}
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
