import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon, cx } from '../../components/ui'
import { Skeleton } from '../../components/feedback'
import { formatCurrency } from '../../lib/booking-rules'
import { checkRoomAvailability, type RoomAvailability } from '../../lib/queries/bookings'

/*
  Shows only rooms genuinely free for the chosen dates (ARCHITECTURE.md §9.3).
  Taken rooms are still listed, greyed and disabled, naming who holds them —
  hiding them entirely leaves the operator wondering where room 203 went.

  Advisory only. The server re-checks on save, and the exclusion constraint is
  what makes the guarantee true under concurrent writes (§6.2).
*/
export function RoomPicker({
  guestHouseId,
  checkIn,
  checkOut,
  excludeBookingId,
  selectedIds,
  onToggle,
  error,
}: {
  guestHouseId: string
  checkIn: string
  checkOut: string
  excludeBookingId?: string
  selectedIds: string[]
  onToggle: (room: RoomAvailability) => void
  error?: string
}) {
  const ready = Boolean(guestHouseId && checkIn && checkOut && checkOut > checkIn)

  const query = useQuery({
    queryKey: ['availability', guestHouseId, checkIn, checkOut, excludeBookingId ?? null],
    queryFn: () =>
      checkRoomAvailability({ guestHouseId, checkIn, checkOut, excludeBookingId }),
    enabled: ready,
    // Someone else may take a room while this form is open. A short staleness
    // window keeps the picker close to reality without hammering the API.
    staleTime: 10_000,
  })

  const rooms = useMemo(() => query.data ?? [], [query.data])

  const grouped = useMemo(() => {
    const groups = new Map<string, RoomAvailability[]>()
    for (const room of rooms) {
      const list = groups.get(room.roomTypeName)
      if (list) list.push(room)
      else groups.set(room.roomTypeName, [room])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rooms])

  const availableCount = rooms.filter((room) => room.isAvailable).length

  if (!ready) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
        Choose a guest house and dates to see which rooms are free.
      </div>
    )
  }

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Could not check availability. Change a date to retry.
      </p>
    )
  }

  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
        This guest house has no rooms in service yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-[var(--text-secondary)]">
          <span className="tabular font-medium text-[var(--text-primary)]">{availableCount}</span>{' '}
          of <span className="tabular">{rooms.length}</span> rooms free for these dates
        </p>
        {selectedIds.length > 0 && (
          <p className="tabular text-sm text-[var(--text-muted)]">{selectedIds.length} selected</p>
        )}
      </div>

      {availableCount === 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <Icon name="alert" className="mt-px size-4 shrink-0" />
          <span>Every room is taken for these dates. Try different dates.</span>
        </p>
      )}

      {grouped.map(([typeName, typeRooms]) => (
        <fieldset key={typeName}>
          <legend className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">
            {typeName}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {typeRooms.map((room) => {
              const selected = selectedIds.includes(room.roomId)
              const disabled = !room.isAvailable && !selected

              return (
                <label
                  key={room.roomId}
                  className={cx(
                    'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                    disabled && 'cursor-not-allowed opacity-55',
                    selected
                      ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/40'
                      : disabled
                        ? 'border-[var(--border-subtle)]'
                        : 'border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => onToggle(room)}
                    className="size-4 shrink-0 accent-[var(--color-brand-600)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="tabular font-medium">{room.roomNumber}</span>
                      <span className="tabular text-sm text-[var(--text-muted)]">
                        {formatCurrency(room.ratePerNight)} · sleeps {room.capacity}
                      </span>
                    </span>
                    {!room.isAvailable && (
                      <span className="mt-0.5 block truncate text-xs text-amber-700 dark:text-amber-400">
                        Taken by {room.blockedBy}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <Icon name="alert" className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
