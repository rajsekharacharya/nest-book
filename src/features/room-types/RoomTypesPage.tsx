import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../app/AppShell'
import { Button, Field, Icon, cx } from '../../components/ui'
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
  createRoomType,
  listRoomTypes,
  setRoomTypeActive,
  updateRoomType,
  type RoomType,
} from '../../lib/queries/room-types'

type Filter = 'active' | 'all'

export function RoomTypesPage() {
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [filter, setFilter] = useState<Filter>('active')
  const [editing, setEditing] = useState<RoomType | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingActive, setPendingActive] = useState<RoomType | null>(null)

  const query = useQuery({ queryKey: ['room-types'], queryFn: listRoomTypes })

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setRoomTypeActive(id, isActive),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['room-types'] })
      setPendingActive(null)
      notify(variables.isActive ? 'Room type restored.' : 'Room type retired.')
    },
    onError: (error) => notify(friendlyError(error), 'error'),
  })

  const types = query.data ?? []
  const retiredCount = types.filter((type) => !type.isActive).length

  const visible = useMemo(
    () => (filter === 'active' ? types.filter((type) => type.isActive) : types),
    [types, filter],
  )

  return (
    <>
      <PageHeader
        title="Room Types"
        description="The categories your rooms are grouped into — Single, Deluxe, Suite, and so on."
        action={
          <Button
            icon={<Icon name="bed" className="size-[1.05rem]" />}
            onClick={() => setCreating(true)}
          >
            Add room type
          </Button>
        }
      />

      {retiredCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(
            [
              { value: 'active', label: 'In use' },
              { value: 'all', label: `All (${types.length})` },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={cx(
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                filter === option.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        {query.isLoading ? (
          <LoadingRows />
        ) : query.isError ? (
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="bed"
            title={types.length === 0 ? 'No room types yet' : 'Nothing in use'}
            message={
              types.length === 0
                ? 'Add a category such as Single or Deluxe. Every room you configure belongs to one.'
                : 'Every room type has been retired. Switch to All to bring one back.'
            }
            action={
              types.length === 0 ? (
                <Button onClick={() => setCreating(true)}>Add room type</Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {visible.map((type) => (
              <RoomTypeRow
                key={type.id}
                type={type}
                onEdit={() => setEditing(type)}
                onToggleActive={() => setPendingActive(type)}
              />
            ))}
          </ul>
        )}
      </div>

      <RoomTypeDialog
        open={creating || Boolean(editing)}
        type={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingActive)}
        onClose={() => setPendingActive(null)}
        onConfirm={() => {
          if (!pendingActive) return
          activeMutation.mutate({ id: pendingActive.id, isActive: !pendingActive.isActive })
        }}
        title={pendingActive?.isActive ? 'Retire this room type?' : 'Bring this back?'}
        message={
          pendingActive?.isActive
            ? pendingActive.roomCount > 0
              ? `${pendingActive.roomCount} room${pendingActive.roomCount === 1 ? '' : 's'} already use "${pendingActive.name}" and will keep it. It simply stops being offered for new rooms.`
              : `"${pendingActive.name}" will no longer be offered when configuring rooms. Nothing is deleted.`
            : `"${pendingActive?.name}" will be available again when configuring rooms.`
        }
        confirmLabel={pendingActive?.isActive ? 'Retire' : 'Restore'}
        loading={activeMutation.isPending}
      />
    </>
  )
}

/* ---------------------------------------------------------------- Row item */

function RoomTypeRow({
  type,
  onEdit,
  onToggleActive,
}: {
  type: RoomType
  onEdit: () => void
  onToggleActive: () => void
}) {
  return (
    <li
      className={cx(
        'flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 transition-colors sm:px-5',
        'hover:bg-[var(--surface-hover)]',
        !type.isActive && 'opacity-60',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        <Icon name="bed" className="size-[1.15rem]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{type.name}</p>
          {!type.isActive && (
            <Badge tone="neutral" className="shrink-0">
              Retired
            </Badge>
          )}
        </div>
        {type.description ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-[var(--text-secondary)]">
            {type.description}
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">No description</p>
        )}
      </div>

      <p className="shrink-0 text-sm text-[var(--text-muted)]">
        <span className="tabular font-medium text-[var(--text-secondary)]">{type.roomCount}</span>{' '}
        {type.roomCount === 1 ? 'room' : 'rooms'}
      </p>

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggleActive}>
          {type.isActive ? 'Retire' : 'Restore'}
        </Button>
      </div>
    </li>
  )
}

/* ------------------------------------------------------------ Create / edit */

function RoomTypeDialog({
  open,
  type,
  onClose,
}: {
  open: boolean
  type: RoomType | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Re-seed whenever a different row is opened, or the dialog switches to create.
  const key = type?.id ?? '__new__'
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (open && seededFor !== key) {
    setSeededFor(key)
    setName(type?.name ?? '')
    setDescription(type?.description ?? '')
    setErrors({})
  }

  function close() {
    setSeededFor(null)
    onClose()
  }

  const mutation = useMutation({
    mutationFn: () =>
      type
        ? updateRoomType({ id: type.id, name, description })
        : createRoomType({ name, description }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['room-types'] })
      notify(type ? 'Room type updated.' : 'Room type added.')
      close()
    },
    onError: (error) => setErrors({ form: friendlyError(error) }),
  })

  function submit() {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Give this room type a name.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={type ? 'Edit room type' : 'Add a room type'}
      description={
        type
          ? 'Renaming updates it everywhere, including on existing rooms.'
          : 'A category rooms are grouped into, shared across all your guest houses.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {type ? 'Save changes' : 'Add room type'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
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
          label="Name"
          autoFocus
          placeholder="Deluxe"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          disabled={mutation.isPending}
          maxLength={60}
        />

        <div className="space-y-1.5">
          <label
            htmlFor="room-type-description"
            className="block text-sm font-medium text-[var(--text-secondary)]"
          >
            Description
          </label>
          <textarea
            id="room-type-description"
            rows={3}
            placeholder="Air conditioned, double bed, attached bathroom."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={mutation.isPending}
            maxLength={280}
            className="input-base h-auto resize-y py-2.5"
          />
          <p className="text-sm text-[var(--text-muted)]">
            Optional — what makes this category different.
          </p>
        </div>

        {/* Submits the form on Enter without adding a second visible button. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}

/* ----------------------------------------------------------------- Loading */

function LoadingRows() {
  return (
    <ul className="divide-y divide-[var(--border-subtle)]">
      {Array.from({ length: 3 }).map((_, index) => (
        <li key={index} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-4 w-16" />
        </li>
      ))}
    </ul>
  )
}
