import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Icon, cx } from '../../components/ui'
import { EmptyState, ErrorState, Skeleton } from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import { STATUS_LABELS, addDays, parseDate, toISODate, todayISO } from '../../lib/booking-rules'
import { getCalendar, type CalendarRoom } from '../../lib/queries/bookings'
import { listGuestHouses } from '../../lib/queries/guest-houses'
import type { BookingStatus } from '../../lib/types'

const DAY_WIDTH = 40 // px — a bar must stay readable at one day wide
const ROOM_COL = 128

/*
  Month grid: Y = rooms grouped by guest house, X = days (ARCHITECTURE.md §9.4).

  Rooms rather than guests, deliberately. A guest-per-row grid cannot show which
  rooms are free, which is most of what an occupancy view is for. Guest names go
  inside the bars.
*/
export function CalendarView({
  guestHouseId,
  onGuestHouseChange,
}: {
  guestHouseId: string
  onGuestHouseChange: (id: string) => void
}) {
  const [monthStart, setMonthStart] = useState(() => {
    const now = new Date()
    return toISODate(new Date(now.getFullYear(), now.getMonth(), 1))
  })

  const days = useMemo(() => {
    const start = parseDate(monthStart)
    const count = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
    return Array.from({ length: count }, (_, index) => addDays(monthStart, index))
  }, [monthStart])

  // The exclusive end of the window: a stay checking out on the 1st of next
  // month still occupies nights in this one.
  const windowEnd = addDays(monthStart, days.length)

  const housesQuery = useQuery({ queryKey: ['guest-houses'], queryFn: listGuestHouses })

  const query = useQuery({
    queryKey: ['calendar', monthStart, guestHouseId || null],
    queryFn: () =>
      getCalendar({ from: monthStart, to: windowEnd, guestHouseId: guestHouseId || undefined }),
  })

  const rooms = query.data ?? []

  const grouped = useMemo(() => {
    const groups = new Map<string, CalendarRoom[]>()
    for (const room of rooms) {
      const list = groups.get(room.guestHouseName)
      if (list) list.push(room)
      else groups.set(room.guestHouseName, [room])
    }
    return [...groups.entries()]
  }, [rooms])

  const monthLabel = parseDate(monthStart).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  })

  function shiftMonth(delta: number) {
    const date = parseDate(monthStart)
    setMonthStart(toISODate(new Date(date.getFullYear(), date.getMonth() + delta, 1)))
  }

  function goToday() {
    const now = new Date()
    setMonthStart(toISODate(new Date(now.getFullYear(), now.getMonth(), 1)))
  }

  const today = todayISO()

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            <Icon name="logout" className="size-4 rotate-180" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
          >
            <Icon name="logout" className="size-4" />
          </Button>
        </div>

        <h2 className="min-w-40 font-medium">{monthLabel}</h2>

        <Button variant="ghost" size="sm" onClick={goToday}>
          Today
        </Button>

        {(housesQuery.data ?? []).length > 1 && (
          <select
            value={guestHouseId}
            onChange={(event) => onGuestHouseChange(event.target.value)}
            aria-label="Filter by guest house"
            className="input-base ml-auto w-auto"
          >
            <option value="">All guest houses</option>
            {(housesQuery.data ?? []).map((house) => (
              <option key={house.id} value={house.id}>
                {house.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {query.isLoading ? (
        <div className="card p-4">
          <Skeleton className="h-64 w-full" />
        </div>
      ) : query.isError ? (
        <div className="card">
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        </div>
      ) : rooms.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="bed"
            title="No rooms to show"
            message="Configure rooms in a guest house and they will appear here."
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: ROOM_COL + days.length * DAY_WIDTH }}>
              {/* Day header */}
              <div className="flex border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
                <div
                  className="sticky left-0 z-20 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
                  style={{ width: ROOM_COL }}
                >
                  Room
                </div>
                {days.map((day) => {
                  const date = parseDate(day)
                  const weekend = date.getDay() === 0 || date.getDay() === 6
                  return (
                    <div
                      key={day}
                      className={cx(
                        'shrink-0 border-r border-[var(--border-subtle)] py-1.5 text-center last:border-r-0',
                        weekend && 'bg-[var(--surface-hover)]',
                        day === today && 'bg-brand-50 dark:bg-brand-950/60',
                      )}
                      style={{ width: DAY_WIDTH }}
                    >
                      <div className="text-[0.625rem] text-[var(--text-muted)]">
                        {date.toLocaleDateString('en-IN', { weekday: 'narrow' })}
                      </div>
                      <div
                        className={cx(
                          'tabular text-xs font-medium',
                          day === today && 'text-brand-700 dark:text-brand-300',
                        )}
                      >
                        {date.getDate()}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Rows */}
              {grouped.map(([houseName, houseRooms]) => (
                <div key={houseName}>
                  {grouped.length > 1 && (
                    <div
                      className="sticky left-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase"
                      style={{ width: ROOM_COL + days.length * DAY_WIDTH }}
                    >
                      {houseName}
                    </div>
                  )}

                  {houseRooms.map((room) => (
                    <CalendarRow
                      key={room.roomId}
                      room={room}
                      days={days}
                      windowStart={monthStart}
                      windowEnd={windowEnd}
                      today={today}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Legend />
    </div>
  )
}

/* ------------------------------------------------------------------- Row */

function CalendarRow({
  room,
  days,
  windowStart,
  windowEnd,
  today,
}: {
  room: CalendarRoom
  days: string[]
  windowStart: string
  windowEnd: string
  today: string
}) {
  return (
    <div className="relative flex border-b border-[var(--border-subtle)] last:border-b-0">
      <div
        className={cx(
          'sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2',
          room.roomStatus === 'INACTIVE' && 'opacity-60',
        )}
        style={{ width: ROOM_COL }}
      >
        <span className="tabular text-sm font-medium">{room.roomNumber}</span>
        <span className="truncate text-xs text-[var(--text-muted)]">{room.roomTypeName}</span>
      </div>

      {/* Day cells, as the grid backdrop */}
      <div className="relative flex" style={{ height: 40 }}>
        {days.map((day) => {
          const date = parseDate(day)
          const weekend = date.getDay() === 0 || date.getDay() === 6
          return (
            <div
              key={day}
              className={cx(
                'shrink-0 border-r border-[var(--border-subtle)] last:border-r-0',
                weekend && 'bg-[var(--surface-hover)]',
                day === today && 'bg-brand-50/70 dark:bg-brand-950/40',
              )}
              style={{ width: DAY_WIDTH }}
            />
          )
        })}

        {/* Booking bars, absolutely placed over the grid */}
        {room.bookings.map((booking) => {
          // Clamp to the visible window: a stay starting last month still shows
          // its remaining nights here.
          const start = booking.checkIn < windowStart ? windowStart : booking.checkIn
          const end = booking.checkOut > windowEnd ? windowEnd : booking.checkOut

          const offsetDays = days.indexOf(start)
          if (offsetDays < 0) return null

          const spanDays = Math.max(
            1,
            Math.round(
              (parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000,
            ),
          )

          const clippedStart = booking.checkIn < windowStart
          const clippedEnd = booking.checkOut > windowEnd

          return (
            <Link
              key={booking.id}
              to={`/app/bookings/${booking.id}`}
              title={`${booking.bookingName} · ${booking.checkIn} → ${booking.checkOut} · ${STATUS_LABELS[booking.status]}`}
              className={cx(
                'absolute top-1.5 flex items-center overflow-hidden px-2 text-xs font-medium text-white',
                'transition-transform hover:z-10 hover:scale-[1.02]',
                BAR_TONES[booking.status],
                clippedStart ? 'rounded-l-none' : 'rounded-l-md',
                clippedEnd ? 'rounded-r-none' : 'rounded-r-md',
              )}
              style={{
                left: offsetDays * DAY_WIDTH + 2,
                width: spanDays * DAY_WIDTH - 4,
                height: 28,
              }}
            >
              <span className="truncate">{booking.bookingName}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

/* Colour plus the label in the tooltip and legend — never colour alone. */
const BAR_TONES: Record<BookingStatus, string> = {
  BOOKED: 'bg-sky-600 hover:bg-sky-700',
  CHECKED_IN: 'bg-brand-600 hover:bg-brand-700',
  CHECKED_OUT: 'bg-slate-500 hover:bg-slate-600',
  CANCELLED: 'bg-red-500',
  NO_SHOW: 'bg-amber-500',
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--text-secondary)]">
      {(['BOOKED', 'CHECKED_IN', 'CHECKED_OUT'] as BookingStatus[]).map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span className={cx('size-2.5 rounded-sm', BAR_TONES[status].split(' ')[0])} />
          {STATUS_LABELS[status]}
        </span>
      ))}
      <span className="text-[var(--text-muted)]">
        Cancelled and no-show bookings release their rooms and are not shown.
      </span>
    </div>
  )
}
