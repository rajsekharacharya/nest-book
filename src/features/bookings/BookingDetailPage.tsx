import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../app/AppShell'
import { Button, Icon, cx } from '../../components/ui'
import {
  Badge,
  ConfirmDialog,
  ErrorState,
  Modal,
  Skeleton,
  useToast,
} from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import {
  STATUS_LABELS,
  STATUS_TONES,
  canCancel,
  canEdit,
  canExtend,
  canTransition,
  formatCurrency,
  nightsBetween,
  occupantCount,
  parseDate,
} from '../../lib/booking-rules'
import {
  cancelBooking,
  changeBookingStatus,
  getBookingDetail,
  type BookingDetail,
} from '../../lib/queries/bookings'
import { ExtendStayDialog } from './ExtendStayDialog'

export function BookingDetailPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [extending, setExtending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW' | null>(
    null,
  )

  const query = useQuery({
    queryKey: ['booking', id],
    queryFn: () => getBookingDetail(id),
    enabled: Boolean(id),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['booking', id] })
    void queryClient.invalidateQueries({ queryKey: ['bookings'] })
    void queryClient.invalidateQueries({ queryKey: ['calendar'] })
    void queryClient.invalidateQueries({ queryKey: ['availability'] })
  }

  const statusMutation = useMutation({
    mutationFn: (status: 'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW') =>
      changeBookingStatus(id, status),
    onSuccess: (_result, status) => {
      invalidate()
      setPendingStatus(null)
      notify(
        status === 'CHECKED_IN'
          ? 'Checked in.'
          : status === 'CHECKED_OUT'
            ? 'Checked out.'
            : 'Marked as no-show.',
      )
    },
    onError: (error) => {
      notify(friendlyError(error), 'error')
      setPendingStatus(null)
    },
  })

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="Booking" />
        <div className="card space-y-3 p-5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      </>
    )
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="Booking" />
        <div className="card">
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        </div>
      </>
    )
  }

  const booking = query.data
  const nights = nightsBetween(booking.checkIn, booking.checkOut)
  const occupants = occupantCount(booking.bookingType, booking.guests.length)

  return (
    <>
      <Link
        to="/app/bookings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <Icon name="logout" className="size-4 rotate-180" />
        All bookings
      </Link>

      <PageHeader
        title={booking.bookingName}
        description={`${booking.guestHouseName} · ${booking.contactNumber}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Only transitions the server will accept are offered (§6.5) —
                an action that always fails is worse than no action. */}
            {canTransition(booking.status, 'CHECKED_IN') && (
              <Button onClick={() => setPendingStatus('CHECKED_IN')}>Check in</Button>
            )}
            {canTransition(booking.status, 'CHECKED_OUT') && (
              <Button onClick={() => setPendingStatus('CHECKED_OUT')}>Check out</Button>
            )}
            {canExtend(booking.status) && (
              <Button variant="secondary" onClick={() => setExtending(true)}>
                Change dates
              </Button>
            )}
            {canEdit(booking.status) && (
              <Button variant="secondary">
                <Link to={`/app/bookings/${booking.id}/edit`}>Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-4">
          {/* Status banner */}
          <div className="card flex flex-wrap items-center gap-3 p-4 sm:p-5">
            <Badge tone={STATUS_TONES[booking.status]} dot>
              {STATUS_LABELS[booking.status]}
            </Badge>

            {booking.status === 'CANCELLED' && booking.cancellationReason && (
              <p className="text-sm text-[var(--text-secondary)]">
                {booking.cancellationReason}
              </p>
            )}

            <div className="ml-auto flex flex-wrap gap-2">
              {canTransition(booking.status, 'NO_SHOW') && (
                <Button variant="ghost" size="sm" onClick={() => setPendingStatus('NO_SHOW')}>
                  Mark no-show
                </Button>
              )}
              {canCancel(booking.status) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCancelling(true)}
                  className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Cancel booking
                </Button>
              )}
            </div>
          </div>

          {/* Stay */}
          <section className="card p-4 sm:p-5">
            <h2 className="mb-3 font-medium">Stay</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Detail label="Check-in" value={formatFullDate(booking.checkIn)} />
              <Detail label="Check-out" value={formatFullDate(booking.checkOut)} />
              <Detail label="Nights" value={String(nights)} />
            </div>

            {(booking.checkedInAt || booking.checkedOutAt) && (
              <div className="mt-4 grid gap-4 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-2">
                {/* Recorded, not inferred from the booked dates — a guest may
                    arrive late or leave early (§6.5). */}
                {booking.checkedInAt && (
                  <Detail label="Arrived" value={formatDateTime(booking.checkedInAt)} />
                )}
                {booking.checkedOutAt && (
                  <Detail label="Departed" value={formatDateTime(booking.checkedOutAt)} />
                )}
              </div>
            )}

            {booking.note && (
              <div className="mt-4 rounded-xl bg-[var(--surface-sunken)] p-3.5">
                <p className="text-xs font-medium text-[var(--text-muted)]">Note</p>
                <p className="mt-1 text-sm">{booking.note}</p>
              </div>
            )}
          </section>

          {/* Rooms */}
          <section className="card overflow-hidden">
            <header className="border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
              <h2 className="font-medium">Rooms</h2>
            </header>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {booking.rooms.map((room) => (
                <li
                  key={room.roomId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <span className="tabular flex min-w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] px-2.5 py-1.5 font-medium">
                    {room.roomNumber}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">
                    {room.roomTypeName} · sleeps <span className="tabular">{room.capacity}</span>
                  </span>
                  <span className="tabular text-sm">
                    <span className="font-medium">{formatCurrency(room.ratePerNight)}</span>
                    <span className="text-[var(--text-muted)]"> × {nights}</span>
                  </span>
                  <span className="tabular w-24 text-right font-medium">
                    {formatCurrency(room.ratePerNight * nights)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-3 sm:px-5">
              <span className="text-sm font-medium">Total</span>
              <span className="tabular text-lg font-semibold">
                {formatCurrency(booking.totalAmount)}
              </span>
            </div>
          </section>

          {/* Guests */}
          {booking.bookingType !== 'SELF' && (
            <section className="card overflow-hidden">
              <header className="flex items-baseline justify-between border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
                <h2 className="font-medium">Guests</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {booking.bookingType === 'COMBINE'
                    ? `${booking.guests.length} listed, plus the booker`
                    : `${booking.guests.length} staying`}
                </p>
              </header>
              <ul className="divide-y divide-[var(--border-subtle)]">
                {booking.guests.map((guest, index) => (
                  <li key={guest.id ?? index} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                    <span className="tabular w-5 shrink-0 text-sm text-[var(--text-muted)]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{guest.name}</span>
                    <span className="text-sm text-[var(--text-muted)]">
                      {[
                        guest.age !== null ? `${guest.age}` : null,
                        guest.gender ? guest.gender.toLowerCase() : null,
                        guest.idProofType && guest.idProofNumber
                          ? `${guest.idProofType} ${guest.idProofNumber}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Side panel */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="card space-y-3 p-4 sm:p-5">
            <h2 className="font-medium">At a glance</h2>
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Guest house" value={booking.guestHouseName} />
              <SummaryRow label="Contact" value={booking.contactNumber} />
              <SummaryRow
                label="Booking type"
                value={
                  booking.bookingType === 'SELF'
                    ? 'Just the booker'
                    : booking.bookingType === 'OTHER'
                      ? 'On behalf of others'
                      : 'Booker and guests'
                }
              />
              <SummaryRow label="Occupants" value={String(occupants)} />
            </dl>
          </div>

          <GuestLinkPanel token={booking.publicToken} />
        </aside>
      </div>

      <ExtendStayDialog
        open={extending}
        booking={booking}
        onClose={() => setExtending(false)}
        onDone={invalidate}
      />

      <CancelDialog
        open={cancelling}
        booking={booking}
        onClose={() => setCancelling(false)}
        onDone={() => {
          invalidate()
          setCancelling(false)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onClose={() => setPendingStatus(null)}
        onConfirm={() => pendingStatus && statusMutation.mutate(pendingStatus)}
        title={
          pendingStatus === 'CHECKED_IN'
            ? 'Check this guest in?'
            : pendingStatus === 'CHECKED_OUT'
              ? 'Check this guest out?'
              : 'Mark as no-show?'
        }
        message={
          pendingStatus === 'CHECKED_IN'
            ? `${booking.bookingName} will be recorded as arrived, from now.`
            : pendingStatus === 'CHECKED_OUT'
              ? `${booking.bookingName} will be recorded as departed, and the rooms freed.`
              : `${booking.bookingName} never arrived. The rooms are released and the booking stays in history as a no-show.`
        }
        confirmLabel={
          pendingStatus === 'CHECKED_IN'
            ? 'Check in'
            : pendingStatus === 'CHECKED_OUT'
              ? 'Check out'
              : 'Mark no-show'
        }
        loading={statusMutation.isPending}
      />
    </>
  )
}

/* ------------------------------------------------------------ Guest link */

function GuestLinkPanel({ token }: { token: string }) {
  const { notify } = useToast()
  const [copied, setCopied] = useState(false)

  const url = `${window.location.origin}${window.location.pathname}#/stay/${token}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify('Could not copy — select the link instead.', 'error')
    }
  }

  return (
    <div className="card space-y-3 p-4 sm:p-5">
      <div>
        <h2 className="font-medium">Guest link</h2>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
          Share this with the guest. It shows their booking only, with no sign-in.
        </p>
      </div>

      <p className="truncate rounded-lg bg-[var(--surface-sunken)] px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
        {url}
      </p>

      <Button
        variant="secondary"
        fullWidth
        onClick={() => void copy()}
        icon={<Icon name={copied ? 'check' : 'mail'} className="size-4" />}
      >
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  )
}

/* ---------------------------------------------------------------- Cancel */

function CancelDialog({
  open,
  booking,
  onClose,
  onDone,
}: {
  open: boolean
  booking: BookingDetail
  onClose: () => void
  onDone: () => void
}) {
  const { notify } = useToast()
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => cancelBooking(booking.id, reason),
    onSuccess: () => {
      notify('Booking cancelled. The rooms are free again.')
      setReason('')
      onDone()
    },
    onError: (error) => notify(friendlyError(error), 'error'),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel this booking?"
      description={`${booking.bookingName} · ${booking.rooms.map((r) => r.roomNumber).join(', ')}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Keep booking
          </Button>
          <Button variant="danger" onClick={() => mutation.mutate()} loading={mutation.isPending}>
            Cancel booking
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--text-secondary)]">
          The rooms are released immediately and become available to book. The booking stays in
          history — nothing is deleted.
        </p>

        <div className="space-y-1.5">
          <label
            htmlFor="cancel-reason"
            className="block text-sm font-medium text-[var(--text-secondary)]"
          >
            Reason
          </label>
          <textarea
            id="cancel-reason"
            rows={2}
            placeholder="Guest cancelled, plans changed…"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={mutation.isPending}
            className="input-base h-auto resize-y py-2.5"
          />
          <p className="text-sm text-[var(--text-muted)]">Optional, but useful later.</p>
        </div>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- Bits */

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="tabular mt-0.5 font-medium">{value}</p>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--text-secondary)]">{label}</dt>
      <dd className={cx('truncate text-right font-medium')}>{value}</dd>
    </div>
  )
}

function formatFullDate(iso: string) {
  return parseDate(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}
