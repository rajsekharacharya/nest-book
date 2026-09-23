import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon, Logo, cx } from '../../components/ui'
import { Badge, Skeleton } from '../../components/feedback'
import { STATUS_LABELS, formatCurrency, parseDate, todayISO } from '../../lib/booking-rules'
import { getBookingByToken } from '../../lib/queries/guest-link'

/*
  What the guest sees (ARCHITECTURE.md §8). No sign-in: the token is the
  credential, and the server returns a narrow projection — no internal notes,
  no other guests' phone numbers or ID details.

  Written for someone standing outside with a phone: the address and the
  contact number are the two things they actually need, so both are one tap.
*/
export function GuestBookingPage() {
  const { token = '' } = useParams()

  const query = useQuery({
    queryKey: ['guest-booking', token],
    queryFn: () => getBookingByToken(token),
    enabled: Boolean(token),
    retry: false,
  })

  if (query.isLoading) {
    return (
      <Shell>
        <div className="card space-y-4 p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </Shell>
    )
  }

  // A wrong or withdrawn token and a network failure are different problems,
  // but neither is the guest's to solve — so both say the same actionable
  // thing rather than exposing which it was.
  if (query.isError || !query.data) {
    return (
      <Shell>
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <Icon name="alert" className="size-6" />
          </span>
          <h1 className="mt-5 text-lg font-medium">This link is not working</h1>
          <p className="mt-2 max-w-sm text-sm text-[var(--text-secondary)]">
            It may have expired or been replaced. Ask the guest house to send you a new one.
          </p>
        </div>
      </Shell>
    )
  }

  const booking = query.data
  const today = todayISO()
  const arriving = booking.checkIn === today
  const staying = booking.checkIn <= today && booking.checkOut > today

  return (
    <Shell>
      <div className="space-y-4">
        {/* Hero */}
        <div className="card overflow-hidden">
          {booking.guestHouse.imageUrl && (
            <div className="aspect-[16/9] sm:aspect-[21/9]">
              <img
                src={booking.guestHouse.imageUrl}
                alt=""
                className="size-full object-cover"
              />
            </div>
          )}

          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  booking.cancelled
                    ? 'red'
                    : booking.status === 'CHECKED_IN'
                      ? 'brand'
                      : booking.status === 'CHECKED_OUT'
                        ? 'neutral'
                        : 'blue'
                }
                dot
              >
                {STATUS_LABELS[booking.status]}
              </Badge>
              {arriving && !booking.cancelled && (
                <Badge tone="brand">Arriving today</Badge>
              )}
              {staying && booking.status === 'CHECKED_IN' && <Badge tone="brand">In house</Badge>}
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              {booking.guestHouse.name}
            </h1>
            <p className="mt-1 text-[var(--text-secondary)]">
              Booked for <span className="font-medium">{booking.bookingName}</span>
            </p>

            {booking.cancelled && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                This booking is no longer active. Please contact the guest house if you think
                that is wrong.
              </p>
            )}
          </div>
        </div>

        {/* Dates — the thing most often checked */}
        <div className="card p-5 sm:p-6">
          <div className="flex items-stretch gap-4">
            <DateBlock label="Check-in" iso={booking.checkIn} />
            <div className="flex flex-col items-center justify-center px-1">
              <div className="h-full w-px bg-[var(--border-subtle)]" />
              <span className="tabular my-2 shrink-0 rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-xs font-medium whitespace-nowrap">
                {booking.nights} night{booking.nights === 1 ? '' : 's'}
              </span>
              <div className="h-full w-px bg-[var(--border-subtle)]" />
            </div>
            <DateBlock label="Check-out" iso={booking.checkOut} />
          </div>
        </div>

        {/* Rooms */}
        <div className="card p-5 sm:p-6">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">
            {booking.rooms.length === 1 ? 'Your room' : 'Your rooms'}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {booking.rooms.map((room) => (
              <li
                key={room.roomNumber}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3.5 py-2.5"
              >
                <span className="tabular block font-medium">{room.roomNumber}</span>
                <span className="block text-xs text-[var(--text-muted)]">{room.roomType}</span>
              </li>
            ))}
          </ul>

          {booking.guests.length > 0 && (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
              <h2 className="text-sm font-medium text-[var(--text-secondary)]">
                Guests ({booking.guests.length})
              </h2>
              <p className="mt-1.5 text-sm">
                {booking.guests.map((guest) => guest.name).join(', ')}
              </p>
            </div>
          )}

          <div className="mt-4 flex items-baseline justify-between border-t border-[var(--border-subtle)] pt-4">
            <span className="text-sm text-[var(--text-secondary)]">Total</span>
            <span className="tabular text-lg font-semibold">
              {formatCurrency(booking.totalAmount)}
            </span>
          </div>
        </div>

        {/* Getting there — the two things a guest actually needs on arrival */}
        <div className="card p-5 sm:p-6">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">Getting there</h2>

          <p className="mt-2">{booking.guestHouse.address}</p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {booking.guestHouse.locationUrl && (
              <a
                href={booking.guestHouse.locationUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={cx(
                  'inline-flex h-11 items-center justify-center gap-2 rounded-[0.625rem] px-4 font-medium',
                  'bg-brand-600 text-white transition-colors hover:bg-brand-700',
                )}
              >
                <Icon name="building" className="size-[1.05rem]" />
                Open in Maps
              </a>
            )}

            {/* A tel: link, not plain text — a guest on a phone should not have
                to copy a number across apps. */}
            <a
              href={`tel:${booking.guestHouse.contactPhone.replace(/\s/g, '')}`}
              className={cx(
                'inline-flex h-11 items-center justify-center gap-2 rounded-[0.625rem] px-4 font-medium',
                'border border-[var(--border-strong)] bg-[var(--surface-card)]',
                'transition-colors hover:bg-[var(--surface-hover)]',
              )}
            >
              <Icon name="users" className="size-[1.05rem]" />
              Call {booking.guestHouse.contactPerson}
            </a>
          </div>

          <p className="tabular mt-3 text-sm text-[var(--text-muted)]">
            {booking.guestHouse.contactPerson} · {booking.guestHouse.contactPhone}
          </p>
        </div>

        <p className="px-2 pb-4 text-center text-xs text-[var(--text-muted)]">
          Keep this link — it always shows your current booking details.
        </p>
      </div>
    </Shell>
  )
}

/* ----------------------------------------------------------------- Shell */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--surface-page)]">
      <header className="flex items-center justify-center gap-2.5 px-4 py-5">
        <Logo className="size-7" />
        <span className="font-semibold tracking-tight">NestBook</span>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 pb-8">{children}</main>
    </div>
  )
}

function DateBlock({ label, iso }: { label: string; iso: string }) {
  const date = parseDate(iso)
  return (
    <div className="flex-1">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{date.getDate()}</p>
      <p className="text-sm font-medium">
        {date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
      </p>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
        {date.toLocaleDateString('en-IN', { weekday: 'long' })}
      </p>
    </div>
  )
}
