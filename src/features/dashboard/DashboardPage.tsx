import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/AuthProvider'
import { Button, Icon, cx } from '../../components/ui'
import { Badge, ErrorState, Skeleton, useToast } from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import {
  STATUS_LABELS,
  STATUS_TONES,
  formatCurrency,
  parseDate,
} from '../../lib/booking-rules'
import { changeBookingStatus } from '../../lib/queries/bookings'
import {
  getDashboardExtras,
  getDashboardStats,
  type DashboardExtras,
  type DashboardMovement,
  type DashboardStats,
} from '../../lib/queries/dashboard'
import { BarList, OccupancyRing, RevenueChart } from './charts'

export function DashboardPage() {
  const { profile } = useAuth()

  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboardStats,
    // The front desk's view of "now" should not be minutes stale.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  // Separate query so the actionable numbers paint without waiting on the
  // analysis behind them.
  const extrasQuery = useQuery({
    queryKey: ['dashboard-extras'],
    queryFn: getDashboardExtras,
    staleTime: 60_000,
  })

  const firstName = profile?.full_name?.trim().split(/\s+/)[0]

  if (query.isError) {
    return (
      <div className="card">
        <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
      </div>
    )
  }

  const stats = query.data

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-[var(--text-secondary)]">{longToday()}</p>
        </div>
        <Button icon={<Icon name="calendar" className="size-[1.05rem]" />}>
          <Link to="/app/bookings/new">New booking</Link>
        </Button>
      </div>

      {query.isLoading || !stats ? (
        <LoadingState />
      ) : (
        <div className="space-y-4">
          {/* A guest whose checkout has passed is still in a room, silently
              holding it. Nothing else on the page would show that. */}
          {stats.todayCounts.overdue > 0 && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/40"
            >
              <Icon name="alert" className="size-[1.05rem] shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="flex-1 text-amber-900 dark:text-amber-200">
                <span className="tabular font-medium">{stats.todayCounts.overdue}</span>{' '}
                {stats.todayCounts.overdue === 1 ? 'guest is' : 'guests are'} past their
                check-out date and still holding a room.
              </span>
              <Link
                to="/app/bookings?view=list"
                className="font-medium text-amber-900 underline dark:text-amber-200"
              >
                Review
              </Link>
            </div>
          )}

          <StatRow stats={stats} />

          {/* Today's movements lead: they are the work, not the context. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <MovementPanel
              title="Arriving today"
              emptyMessage="No arrivals today."
              movements={stats.arrivals}
              action="CHECK_IN"
            />
            <MovementPanel
              title="Departing today"
              emptyMessage="No departures today."
              movements={stats.departures}
              action="CHECK_OUT"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
            <OccupancyPanel stats={stats} />
            <TodayRingPanel stats={stats} extras={extrasQuery.data} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
            <RevenuePanel stats={stats} extras={extrasQuery.data} />
            <RecentPanel stats={stats} />
          </div>

          {extrasQuery.data && <BreakdownPanels extras={extrasQuery.data} />}
        </div>
      )}
    </>
  )
}

/* -------------------------------------------------- Ring + status mix */

function TodayRingPanel({
  stats,
  extras,
}: {
  stats: DashboardStats
  extras?: DashboardExtras
}) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="font-medium">Right now</h2>

      <div className="mt-3 flex justify-center">
        <OccupancyRing
          percent={stats.occupancy.percent}
          occupied={stats.occupancy.occupied}
          total={stats.occupancy.total}
        />
      </div>

      {extras && (
        <dl className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-4 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-[var(--text-secondary)]">In house</dt>
            <dd className="tabular font-medium">{extras.statusMix.checkedIn}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[var(--text-secondary)]">Booked ahead</dt>
            <dd className="tabular font-medium">{extras.statusMix.booked}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[var(--text-secondary)]">Arriving this week</dt>
            <dd className="tabular font-medium">{extras.statusMix.upcomingWeek}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

/* ------------------------------------------------------------ Revenue */

function RevenuePanel({
  stats,
  extras,
}: {
  stats: DashboardStats
  extras?: DashboardExtras
}) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Revenue</h2>
        {extras && extras.avgRate > 0 && (
          <p className="text-sm text-[var(--text-muted)]">
            Average rate{' '}
            <span className="tabular font-medium text-[var(--text-secondary)]">
              {formatCurrency(extras.avgRate)}
            </span>{' '}
            a night
          </p>
        )}
      </div>

      <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
        {formatCurrency(stats.revenue.monthTotal)}
        <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
          {stats.revenue.monthLabel}
        </span>
      </p>

      <div className="mt-4">
        {extras ? (
          <RevenueChart data={extras.revenueMonths} format={formatCurrency} />
        ) : (
          <Skeleton className="h-36 w-full" />
        )}
      </div>

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Counted by check-in date. Cancelled and no-show bookings are excluded.
      </p>
    </section>
  )
}

/* -------------------------------------------------------- Breakdowns */

function BreakdownPanels({ extras }: { extras: DashboardExtras }) {
  // A single blended percentage hides a half-empty property, so these are
  // shown apart whenever there is more than one.
  const showHouses = extras.houses.length > 1

  return (
    <div className={cx('grid gap-4', showHouses ? 'lg:grid-cols-2' : '')}>
      {showHouses && (
        <section className="card p-4 sm:p-5">
          <h2 className="font-medium">Occupancy by property</h2>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Rooms filled today</p>
          <div className="mt-4">
            <BarList
              items={extras.houses.map((house) => ({
                label: house.name,
                value: house.occupied,
                total: house.rooms,
                note: `${house.percent}% · ${house.occupied}/${house.rooms}`,
              }))}
              emptyMessage="No active guest houses."
            />
          </div>
        </section>
      )}

      <section className="card p-4 sm:p-5">
        <h2 className="font-medium">Room types</h2>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">What is filled today</p>
        <div className="mt-4">
          <BarList
            items={extras.roomTypes.map((type) => ({
              label: type.name,
              value: type.occupied,
              total: type.rooms,
            }))}
            emptyMessage="No rooms configured yet."
          />
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------- Stat cards */

function StatRow({ stats }: { stats: DashboardStats }) {
  const { occupancy, counts, todayCounts, revenue } = stats

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Occupancy today"
        value={`${occupancy.percent}%`}
        note={`${occupancy.occupied} of ${occupancy.total} rooms`}
        accent
        progress={occupancy.percent}
      />
      <StatCard
        label="Guests in house"
        value={String(counts.guestsInHouse)}
        note={
          counts.activeBookings > 0
            ? `${counts.activeBookings} active booking${counts.activeBookings === 1 ? '' : 's'}`
            : 'No active bookings'
        }
        icon="users"
      />
      <StatCard
        label="Today"
        value={`${todayCounts.arrivalsDue} in · ${todayCounts.departuresDue} out`}
        note={
          todayCounts.arrivalsDue + todayCounts.departuresDue === 0
            ? 'Nothing due'
            : `${todayCounts.arrived} already arrived`
        }
        icon="calendar"
      />
      <StatCard
        label={`Revenue · ${revenue.monthLabel}`}
        value={formatCurrency(revenue.monthTotal)}
        note="Confirmed bookings only"
        icon="building"
      />
    </div>
  )
}

function StatCard({
  label,
  value,
  note,
  icon,
  accent,
  progress,
}: {
  label: string
  value: string
  note: string
  icon?: string
  accent?: boolean
  progress?: number
}) {
  return (
    <div
      className={cx(
        'card p-4',
        accent && 'bg-gradient-to-br from-brand-600 to-brand-800 text-white',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cx('text-sm', accent ? 'text-white/75' : 'text-[var(--text-secondary)]')}>
          {label}
        </p>
        {icon && (
          <Icon
            name={icon}
            className={cx('size-[1.05rem] shrink-0', accent ? 'text-white/70' : 'text-[var(--text-muted)]')}
          />
        )}
      </div>

      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>

      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-700"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}

      <p className={cx('mt-1.5 text-sm', accent ? 'text-white/70' : 'text-[var(--text-muted)]')}>
        {note}
      </p>
    </div>
  )
}

/* ---------------------------------------------------------- Movements */

/*
  Check-in and check-out happen here rather than only on the detail page. The
  arrival queue is exactly where someone is standing at the desk, and making
  them open a booking first adds a step to the most repeated action in the app.
*/
function MovementPanel({
  title,
  emptyMessage,
  movements,
  action,
}: {
  title: string
  emptyMessage: string
  movements: DashboardMovement[]
  action: 'CHECK_IN' | 'CHECK_OUT'
}) {
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const mutation = useMutation({
    mutationFn: (id: string) =>
      changeBookingStatus(id, action === 'CHECK_IN' ? 'CHECKED_IN' : 'CHECKED_OUT'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['bookings'] })
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      notify(action === 'CHECK_IN' ? 'Checked in.' : 'Checked out.')
    },
    onError: (error) => notify(friendlyError(error), 'error'),
  })

  const pending = movements.filter((movement) =>
    action === 'CHECK_IN' ? movement.status === 'BOOKED' : movement.status === 'CHECKED_IN',
  )

  return (
    <section className="card overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
        <h2 className="font-medium">{title}</h2>
        {movements.length > 0 && (
          <p className="tabular text-sm text-[var(--text-muted)]">
            {pending.length > 0 ? `${pending.length} to go` : 'All done'}
          </p>
        )}
      </header>

      {movements.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{emptyMessage}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {movements.map((movement) => {
            const done =
              action === 'CHECK_IN'
                ? movement.status !== 'BOOKED'
                : movement.status !== 'CHECKED_IN'

            return (
              <li
                key={movement.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/app/bookings/${movement.id}`}
                    className="truncate font-medium hover:text-brand-700 dark:hover:text-brand-300"
                  >
                    {movement.bookingName}
                  </Link>
                  <p className="tabular truncate text-sm text-[var(--text-muted)]">
                    {movement.roomNumbers?.length
                      ? `Room ${movement.roomNumbers.join(', ')}`
                      : movement.guestHouseName}
                  </p>
                </div>

                {done ? (
                  <Badge tone="green" dot className="shrink-0">
                    {action === 'CHECK_IN' ? 'Arrived' : 'Departed'}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => mutation.mutate(movement.id)}
                    loading={mutation.isPending && mutation.variables === movement.id}
                  >
                    {action === 'CHECK_IN' ? 'Check in' : 'Check out'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ---------------------------------------------------------- Occupancy */

function OccupancyPanel({ stats }: { stats: DashboardStats }) {
  // The server's idea of today, in the property's time zone — not the
  // browser's, which can be a day off near midnight.
  const today = stats.today
  const max = useMemo(
    () => Math.max(stats.occupancy.total, ...stats.trend.map((point) => point.occupied), 1),
    [stats],
  )

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Occupancy trend</h2>
        <p className="text-sm text-[var(--text-muted)]">Past week and the fortnight ahead</p>
      </div>

      {/* Forward-looking on purpose: what is coming is what can still be acted
          on. Today is marked so the split reads at a glance. */}
      <div className="mt-4 flex items-end gap-[3px] sm:gap-1" style={{ height: 120 }}>
        {stats.trend.map((point) => {
          const height = max > 0 ? (point.occupied / max) * 100 : 0
          const isToday = point.date === today
          const isPast = point.date < today

          return (
            <div
              key={point.date}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${formatShort(point.date)} · ${point.occupied} of ${stats.occupancy.total} rooms`}
            >
              <div
                className={cx(
                  'w-full rounded-t-[3px] transition-all duration-500',
                  isToday
                    ? 'bg-brand-600'
                    : isPast
                      ? 'bg-[var(--border-strong)]'
                      : 'bg-brand-300 dark:bg-brand-800',
                )}
                style={{ height: `${Math.max(height, point.occupied > 0 ? 6 : 2)}%` }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{formatShort(stats.trend[0]?.date ?? today)}</span>
        <span className="font-medium text-brand-700 dark:text-brand-300">Today</span>
        <span>{formatShort(stats.trend[stats.trend.length - 1]?.date ?? today)}</span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--border-subtle)] pt-4 text-sm">
        <MiniStat label="Guest houses" value={String(stats.counts.guestHouses)} />
        <MiniStat label="Rooms" value={String(stats.counts.rooms)} />
        <MiniStat
          label="Out of service"
          value={String(stats.counts.roomsOutOfService)}
          tone={stats.counts.roomsOutOfService > 0 ? 'warn' : undefined}
        />
      </dl>
    </section>
  )
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'warn'
}) {
  return (
    <div>
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd
        className={cx(
          'tabular mt-0.5 text-lg font-semibold',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/* ------------------------------------------------------------- Recent */

function RecentPanel({ stats }: { stats: DashboardStats }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-baseline justify-between border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
        <h2 className="font-medium">Latest bookings</h2>
        <Link
          to="/app/bookings"
          className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          All
        </Link>
      </header>

      {stats.recent.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">No bookings yet.</p>
          <Button size="sm" variant="secondary" className="mt-3">
            <Link to="/app/bookings/new">Take one</Link>
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {stats.recent.map((booking) => (
            <li key={booking.id}>
              <Link
                to={`/app/bookings/${booking.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{booking.bookingName}</p>
                  <p className="tabular truncate text-xs text-[var(--text-muted)]">
                    {formatShort(booking.checkIn)} → {formatShort(booking.checkOut)}
                  </p>
                </div>
                <Badge tone={STATUS_TONES[booking.status]} className="shrink-0">
                  {STATUS_LABELS[booking.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- Bits */

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function longToday() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatShort(iso: string) {
  return parseDate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  )
}
