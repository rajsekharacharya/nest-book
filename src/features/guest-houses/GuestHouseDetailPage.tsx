import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import { getGuestHouse } from '../../lib/queries/guest-houses'
import {
  deleteRoom,
  listRooms,
  setRoomStatus,
  type Room,
} from '../../lib/queries/rooms'
import { BulkAddRoomsDialog } from './BulkAddRoomsDialog'
import { EditRoomDialog } from './EditRoomDialog'

export function GuestHouseDetailPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Room | null>(null)
  const [pendingStatus, setPendingStatus] = useState<Room | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Room | null>(null)

  const houseQuery = useQuery({
    queryKey: ['guest-house', id],
    queryFn: () => getGuestHouse(id),
    enabled: Boolean(id),
  })

  const roomsQuery = useQuery({
    queryKey: ['rooms', id],
    queryFn: () => listRooms(id),
    enabled: Boolean(id),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['rooms', id] })
    void queryClient.invalidateQueries({ queryKey: ['guest-house', id] })
    void queryClient.invalidateQueries({ queryKey: ['guest-houses'] })
  }

  const statusMutation = useMutation({
    mutationFn: ({ room, status }: { room: Room; status: 'ACTIVE' | 'INACTIVE' }) =>
      setRoomStatus(room.id, status),
    onSuccess: (_r, variables) => {
      invalidate()
      setPendingStatus(null)
      notify(
        variables.status === 'ACTIVE'
          ? 'Room back in service.'
          : 'Room taken out of service.',
      )
    },
    onError: (error) => {
      notify(friendlyError(error), 'error')
      setPendingStatus(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteRoom,
    onSuccess: () => {
      invalidate()
      setPendingDelete(null)
      notify('Room deleted.')
    },
    onError: (error) => {
      notify(friendlyError(error), 'error')
      setPendingDelete(null)
    },
  })

  const house = houseQuery.data
  const rooms = useMemo(() => roomsQuery.data ?? [], [roomsQuery.data])

  // Grouped by type, as the spec asks (§9.2): a guest house is understood as
  // "four singles and five doubles", not as a flat list of twelve numbers.
  const grouped = useMemo(() => {
    const groups = new Map<string, Room[]>()
    for (const room of rooms) {
      const existing = groups.get(room.roomTypeName)
      if (existing) existing.push(room)
      else groups.set(room.roomTypeName, [room])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rooms])

  const configured = rooms.length
  const declared = house?.totalRooms ?? 0
  const remaining = declared - configured

  if (houseQuery.isError) {
    return (
      <>
        <PageHeader title="Guest house" />
        <div className="card">
          <ErrorState
            message={friendlyError(houseQuery.error)}
            onRetry={() => void houseQuery.refetch()}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <Link
        to="/app/guest-houses"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <Icon name="logout" className="size-4 rotate-180" />
        All guest houses
      </Link>

      {houseQuery.isLoading || !house ? (
        <Skeleton className="mb-6 h-9 w-64" />
      ) : (
        <PageHeader
          title={house.name}
          description={house.address}
          action={
            <Button
              icon={<Icon name="bed" className="size-[1.05rem]" />}
              onClick={() => setAdding(true)}
              disabled={remaining <= 0}
            >
              Add rooms
            </Button>
          }
        />
      )}

      {house && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Rooms configured"
            value={`${configured} / ${declared}`}
            tone={remaining === 0 ? 'done' : 'pending'}
            note={
              remaining > 0
                ? `${remaining} still to add`
                : 'Every declared room is configured'
            }
          />
          <StatCard
            label="In service"
            value={String(rooms.filter((room) => room.status === 'ACTIVE').length)}
            note={
              rooms.some((room) => room.status === 'INACTIVE')
                ? `${rooms.filter((r) => r.status === 'INACTIVE').length} out of service`
                : 'All rooms available'
            }
          />
          <StatCard
            label="Contact"
            value={house.contactPersonName}
            note={house.contactPersonPhone}
          />
        </div>
      )}

      {roomsQuery.isLoading ? (
        <div className="card p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : roomsQuery.isError ? (
        <div className="card">
          <ErrorState
            message={friendlyError(roomsQuery.error)}
            onRetry={() => void roomsQuery.refetch()}
          />
        </div>
      ) : rooms.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="bed"
            title="No rooms configured yet"
            message={`This guest house declares ${declared} rooms. Add them in batches — pick a type, set the rate once, then list the numbers.`}
            action={<Button onClick={() => setAdding(true)}>Add rooms</Button>}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([typeName, typeRooms]) => (
            <section key={typeName} className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-3 sm:px-5">
                <h2 className="font-medium">{typeName}</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  <span className="tabular">{typeRooms.length}</span>{' '}
                  {typeRooms.length === 1 ? 'room' : 'rooms'}
                </p>
              </header>

              <ul className="divide-y divide-[var(--border-subtle)]">
                {typeRooms.map((room) => (
                  <RoomRow
                    key={room.id}
                    room={room}
                    onEdit={() => setEditing(room)}
                    onToggleStatus={() => setPendingStatus(room)}
                    onDelete={() => setPendingDelete(room)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {house && (
        <BulkAddRoomsDialog
          open={adding}
          guestHouseId={house.id}
          existingNumbers={rooms.map((room) => room.roomNumber)}
          remainingSlots={remaining}
          onClose={() => setAdding(false)}
        />
      )}

      <EditRoomDialog room={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onClose={() => setPendingStatus(null)}
        onConfirm={() => {
          if (!pendingStatus) return
          statusMutation.mutate({
            room: pendingStatus,
            status: pendingStatus.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
          })
        }}
        title={
          pendingStatus?.status === 'ACTIVE'
            ? 'Take this room out of service?'
            : 'Put this room back in service?'
        }
        message={
          pendingStatus?.status === 'ACTIVE'
            ? `Room ${pendingStatus.roomNumber} will not be offered for new bookings. If it has current or future bookings, this will be refused — move those guests first.`
            : `Room ${pendingStatus?.roomNumber} will be available for booking again.`
        }
        confirmLabel={pendingStatus?.status === 'ACTIVE' ? 'Take out of service' : 'Restore'}
        loading={statusMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        title="Delete this room?"
        message={`Room ${pendingDelete?.roomNumber} will be permanently removed. If it appears on any booking this will be refused — take it out of service instead.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteMutation.isPending}
      />
    </>
  )
}

/* --------------------------------------------------------------- Stat card */

function StatCard({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: 'done' | 'pending'
}) {
  return (
    <div className="card p-4">
      <p className="text-sm text-[var(--text-secondary)]">{label}</p>
      <p
        className={cx(
          'tabular mt-1 text-xl font-semibold',
          tone === 'done' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'pending' && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-sm text-[var(--text-muted)]">{note}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- Room row */

function RoomRow({
  room,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  room: Room
  onEdit: () => void
  onToggleStatus: () => void
  onDelete: () => void
}) {
  return (
    <li
      className={cx(
        'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors sm:px-5',
        'hover:bg-[var(--surface-hover)]',
      )}
    >
      {/* Only the room's own details dim when it is withdrawn. Fading the whole
          row would mute the badge and the button that undoes it — the two
          things you most need on exactly that row. */}
      <span
        className={cx(
          'tabular flex min-w-14 shrink-0 items-center justify-center rounded-lg px-2.5 py-1.5 font-medium',
          room.status === 'ACTIVE'
            ? 'bg-[var(--surface-sunken)]'
            : 'bg-[var(--surface-sunken)] text-[var(--text-muted)] line-through decoration-1',
        )}
      >
        {room.roomNumber}
      </span>

      <div className={cx('min-w-0 flex-1', room.status === 'INACTIVE' && 'opacity-55')}>
        <p className="tabular text-sm">
          <span className="font-medium">₹{room.ratePerNight.toLocaleString('en-IN')}</span>
          <span className="text-[var(--text-muted)]"> / night</span>
        </p>
        <p className="text-sm text-[var(--text-muted)]">
          Sleeps <span className="tabular">{room.capacity}</span>
        </p>
      </div>

      {/* Shown for both states. A badge only on the bad one makes every healthy
          row look unlabelled, and leaves "in service" to be inferred. */}
      {room.status === 'ACTIVE' ? (
        <Badge tone="green" dot className="shrink-0">
          In service
        </Badge>
      ) : (
        <Badge tone="amber" dot className="shrink-0">
          Out of service
        </Badge>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        {/* Named for the action, not the destination state: "Out of service"
            beside a working room reads as a label saying it is broken. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleStatus}
          icon={
            <Icon
              name={room.status === 'ACTIVE' ? 'bed-off' : 'bed'}
              className="size-4"
            />
          }
        >
          <span className="hidden sm:inline">
            {room.status === 'ACTIVE' ? 'Take out of service' : 'Put back in service'}
          </span>
          <span className="sr-only sm:hidden">
            {room.status === 'ACTIVE'
              ? `Take room ${room.roomNumber} out of service`
              : `Put room ${room.roomNumber} back in service`}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={`Delete room ${room.roomNumber}`}
          className="text-[var(--text-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <Icon name="trash" className="size-4" />
        </Button>
      </div>
    </li>
  )
}
