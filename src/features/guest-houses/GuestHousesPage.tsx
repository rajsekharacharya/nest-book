import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../app/AppShell'
import { Button, Icon, cx } from '../../components/ui'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import {
  deleteGuestHouse,
  listGuestHouses,
  setGuestHouseActive,
  type GuestHouse,
} from '../../lib/queries/guest-houses'
import { GuestHouseDialog } from './GuestHouseDialog'

export function GuestHousesPage() {
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [editing, setEditing] = useState<GuestHouse | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingActive, setPendingActive] = useState<GuestHouse | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GuestHouse | null>(null)

  const query = useQuery({ queryKey: ['guest-houses'], queryFn: listGuestHouses })

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setGuestHouseActive(id, isActive),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['guest-houses'] })
      setPendingActive(null)
      notify(variables.isActive ? 'Guest house reopened.' : 'Guest house closed.')
    },
    onError: (error) => notify(friendlyError(error), 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteGuestHouse,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['guest-houses'] })
      setPendingDelete(null)
      notify('Guest house deleted.')
    },
    onError: (error) => {
      notify(friendlyError(error), 'error')
      setPendingDelete(null)
    },
  })

  const houses = query.data ?? []

  return (
    <>
      <PageHeader
        title="Guest Houses"
        description="Your properties, and the rooms configured in each."
        action={
          <Button
            icon={<Icon name="building" className="size-[1.05rem]" />}
            onClick={() => setCreating(true)}
          >
            Add guest house
          </Button>
        }
      />

      {query.isLoading ? (
        <LoadingCards />
      ) : query.isError ? (
        <div className="card">
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        </div>
      ) : houses.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="building"
            title="No guest houses yet"
            message="Add your first property, then configure its rooms."
            action={<Button onClick={() => setCreating(true)}>Add guest house</Button>}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {houses.map((house) => (
            <GuestHouseCard
              key={house.id}
              house={house}
              onEdit={() => setEditing(house)}
              onToggleActive={() => setPendingActive(house)}
              onDelete={() => setPendingDelete(house)}
            />
          ))}
        </div>
      )}

      <GuestHouseDialog
        open={creating || Boolean(editing)}
        house={editing}
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
        title={pendingActive?.isActive ? 'Close this guest house?' : 'Reopen this guest house?'}
        message={
          pendingActive?.isActive
            ? `New bookings cannot be made at ${pendingActive.name}. Existing bookings are unaffected.`
            : `${pendingActive?.name} will accept new bookings again.`
        }
        confirmLabel={pendingActive?.isActive ? 'Close' : 'Reopen'}
        loading={activeMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        title="Delete this guest house?"
        message={
          pendingDelete
            ? `${pendingDelete.name} and its ${pendingDelete.roomCount} configured room${
                pendingDelete.roomCount === 1 ? '' : 's'
              } will be permanently removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        tone="danger"
        loading={deleteMutation.isPending}
      />
    </>
  )
}

/* -------------------------------------------------------------------- Card */

function GuestHouseCard({
  house,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  house: GuestHouse
  onEdit: () => void
  onToggleActive: () => void
  onDelete: () => void
}) {
  const configured = house.roomCount
  const remaining = house.totalRooms - configured
  const percent = house.totalRooms > 0 ? (configured / house.totalRooms) * 100 : 0

  return (
    <article
      className={cx(
        'card flex flex-col overflow-hidden transition-shadow hover:shadow-[var(--shadow-lift)]',
        !house.isActive && 'opacity-70',
      )}
    >
      <div className="relative aspect-[16/9] shrink-0 bg-[var(--surface-sunken)]">
        {house.imageUrl ? (
          <img
            src={house.imageUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[var(--text-muted)]">
            <Icon name="building" className="size-8" />
          </div>
        )}

        {!house.isActive && (
          <span className="absolute top-3 left-3">
            <Badge tone="neutral">Closed</Badge>
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h2 className="font-medium">
          <Link
            to={`/app/guest-houses/${house.id}`}
            className="transition-colors hover:text-brand-700 dark:hover:text-brand-300"
          >
            {house.name}
          </Link>
        </h2>
        <p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{house.address}</p>

        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Icon name="users" className="size-4 shrink-0 text-[var(--text-muted)]" />
            <dt className="sr-only">Contact</dt>
            <dd className="truncate">
              {house.contactPersonName} · <span className="tabular">{house.contactPersonPhone}</span>
            </dd>
          </div>
          {house.googleLocationUrl && (
            <div className="flex items-center gap-2">
              <Icon name="building" className="size-4 shrink-0 text-[var(--text-muted)]" />
              <dt className="sr-only">Map</dt>
              <dd>
                <a
                  href={house.googleLocationUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand-700 hover:underline dark:text-brand-300"
                >
                  View on map
                </a>
              </dd>
            </div>
          )}
        </dl>

        {/* Configured against declared (§6.1) — the number that says whether
            setup is finished. */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-[var(--text-secondary)]">Rooms configured</span>
            <span className="tabular font-medium">
              {configured} / {house.totalRooms}
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
            role="progressbar"
            aria-valuenow={configured}
            aria-valuemin={0}
            aria-valuemax={house.totalRooms}
            aria-label="Rooms configured"
          >
            <div
              className={cx(
                'h-full rounded-full transition-[width] duration-500',
                remaining === 0 ? 'bg-emerald-500' : 'bg-brand-500',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          {remaining > 0 && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              {remaining} room{remaining === 1 ? '' : 's'} still to add
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-[var(--border-subtle)] pt-3">
          {/* A real anchor, not a Button wrapping a Link — nesting <a> inside
              <button> is invalid and breaks keyboard and screen-reader use. */}
          <Link
            to={`/app/guest-houses/${house.id}`}
            className={cx(
              'mr-auto inline-flex h-9 items-center justify-center rounded-[0.625rem] px-3 text-sm font-medium',
              'border border-[var(--border-strong)] bg-[var(--surface-card)] text-[var(--text-primary)]',
              'transition-colors hover:bg-[var(--surface-hover)] active:bg-[var(--surface-sunken)]',
            )}
          >
            {configured === 0 ? 'Add rooms' : 'Manage rooms'}
          </Link>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggleActive}>
            {house.isActive ? 'Close' : 'Reopen'}
          </Button>
          {/* Deleting is refused server-side once bookings exist; offered here
              because a property typed in wrongly during setup should be removable. */}
          <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Delete ${house.name}`}>
            <Icon name="close" className="size-4" />
          </Button>
        </div>
      </div>
    </article>
  )
}

/* ----------------------------------------------------------------- Loading */

function LoadingCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="card overflow-hidden">
          <Skeleton className="aspect-[16/9] rounded-none" />
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
