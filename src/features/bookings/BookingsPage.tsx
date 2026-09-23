import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../app/AppShell'
import { Button, Icon, cx } from '../../components/ui'
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import {
  STATUS_LABELS,
  STATUS_TONES,
  formatCurrency,
  nightsBetween,
  parseDate,
  todayISO,
} from '../../lib/booking-rules'
import { listBookings, type BookingListRow } from '../../lib/queries/bookings'
import { listGuestHouses } from '../../lib/queries/guest-houses'
import type { BookingStatus } from '../../lib/types'
import { CalendarView } from './CalendarView'

type View = 'list' | 'calendar'

const STATUS_FILTERS: { value: BookingStatus | 'ACTIVE'; label: string }[] = [
  { value: 'ACTIVE', label: 'Current' },
  { value: 'BOOKED', label: 'Booked' },
  { value: 'CHECKED_IN', label: 'In house' },
  { value: 'CHECKED_OUT', label: 'Checked out' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'NO_SHOW', label: 'No-show' },
]

export function BookingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = (searchParams.get('view') as View) ?? 'list'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'ACTIVE' | 'ALL'>('ACTIVE')
  const [guestHouseId, setGuestHouseId] = useState('')

  const housesQuery = useQuery({ queryKey: ['guest-houses'], queryFn: listGuestHouses })

  // "Current" is the default because a front desk cares about live bookings;
  // cancelled and checked-out history is available but should not be the
  // first thing in the way.
  const statuses = useMemo<BookingStatus[] | undefined>(() => {
    if (statusFilter === 'ALL') return undefined
    if (statusFilter === 'ACTIVE') return ['BOOKED', 'CHECKED_IN']
    return [statusFilter]
  }, [statusFilter])

  const query = useQuery({
    queryKey: ['bookings', { search, statuses, guestHouseId }],
    queryFn: () =>
      listBookings({
        search,
        status: statuses,
        guestHouseId: guestHouseId || undefined,
        limit: 200,
      }),
    enabled: view === 'list',
  })

  const rows = query.data?.rows ?? []

  function setView(next: View) {
    const params = new URLSearchParams(searchParams)
    if (next === 'list') params.delete('view')
    else params.set('view', next)
    setSearchParams(params, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Who is staying, when, and in which room."
        action={
          <Button icon={<Icon name="calendar" className="size-[1.05rem]" />}>
            <Link to="/app/bookings/new">New booking</Link>
          </Button>
        }
      />

      {/* View switch */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Booking view"
          className="inline-flex rounded-xl bg-[var(--surface-sunken)] p-1"
        >
          {(
            [
              { value: 'list', label: 'List', icon: 'dashboard' },
              { value: 'calendar', label: 'Calendar', icon: 'calendar' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              role="tab"
              aria-selected={view === option.value}
              onClick={() => setView(option.value)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                view === option.value
                  ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-[var(--shadow-soft)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              <Icon name={option.icon} className="size-4" />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'calendar' ? (
        <CalendarView guestHouseId={guestHouseId} onGuestHouseChange={setGuestHouseId} />
      ) : (
        <>
          {/* Filters */}
          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                  <Icon name="users" className="size-[1.05rem]" />
                </span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or phone"
                  aria-label="Search bookings"
                  className="input-base pl-10"
                />
              </div>

              {(housesQuery.data ?? []).length > 1 && (
                <select
                  value={guestHouseId}
                  onChange={(event) => setGuestHouseId(event.target.value)}
                  aria-label="Filter by guest house"
                  className="input-base sm:w-auto"
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

            <div className="flex flex-wrap gap-1.5">
              {[...STATUS_FILTERS, { value: 'ALL' as const, label: 'All' }].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatusFilter(option.value)}
                  className={cx(
                    'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                    statusFilter === option.value
                      ? 'bg-brand-600 text-white'
                      : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden">
            {query.isLoading ? (
              <LoadingRows />
            ) : query.isError ? (
              <ErrorState
                message={friendlyError(query.error)}
                onRetry={() => void query.refetch()}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={search || statusFilter !== 'ACTIVE' ? 'No matching bookings' : 'No bookings yet'}
                message={
                  search || statusFilter !== 'ACTIVE'
                    ? 'Try a different search or filter.'
                    : 'Take your first booking and it will appear here.'
                }
                action={
                  !search && statusFilter === 'ACTIVE' ? (
                    <Button>
                      <Link to="/app/bookings/new">New booking</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {rows.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} />
                ))}
              </ul>
            )}
          </div>

          {rows.length > 0 && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Showing <span className="tabular">{rows.length}</span> of{' '}
              <span className="tabular">{query.data?.totalCount ?? rows.length}</span>
            </p>
          )}
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------- Booking row */

function BookingRow({ booking }: { booking: BookingListRow }) {
  const today = todayISO()
  const nights = nightsBetween(booking.checkIn, booking.checkOut)

  // Arrivals and departures today are what a front desk is looking for, so
  // they are called out rather than left to be worked out from two dates.
  const arrivingToday = booking.checkIn === today && booking.status === 'BOOKED'
  const leavingToday = booking.checkOut === today && booking.status === 'CHECKED_IN'

  return (
    <li className="transition-colors hover:bg-[var(--surface-hover)]">
      <Link
        to={`/app/bookings/${booking.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{booking.bookingName}</p>
            {arrivingToday && (
              <Badge tone="brand" className="shrink-0">
                Arriving today
              </Badge>
            )}
            {leavingToday && (
              <Badge tone="amber" className="shrink-0">
                Leaving today
              </Badge>
            )}
          </div>
          <p className="truncate text-sm text-[var(--text-muted)]">
            {booking.guestHouseName}
            {booking.roomNumbers.length > 0 && (
              <>
                {' · '}
                <span className="tabular">
                  {booking.roomNumbers.length === 1 ? 'Room' : 'Rooms'}{' '}
                  {booking.roomNumbers.join(', ')}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="tabular text-sm">
          <p className="font-medium">
            {formatDayMonth(booking.checkIn)} → {formatDayMonth(booking.checkOut)}
          </p>
          <p className="text-[var(--text-muted)]">
            {nights} night{nights === 1 ? '' : 's'} ·{' '}
            {booking.occupantCount} guest{booking.occupantCount === 1 ? '' : 's'}
          </p>
        </div>

        <p className="tabular hidden w-24 text-right font-medium sm:block">
          {formatCurrency(booking.totalAmount)}
        </p>

        <Badge tone={STATUS_TONES[booking.status]} dot className="shrink-0">
          {STATUS_LABELS[booking.status]}
        </Badge>
      </Link>
    </li>
  )
}

function formatDayMonth(iso: string) {
  return parseDate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function LoadingRows() {
  return (
    <ul className="divide-y divide-[var(--border-subtle)]">
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index} className="flex items-center gap-4 px-5 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  )
}
