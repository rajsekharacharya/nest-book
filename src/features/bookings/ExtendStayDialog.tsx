import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Field, Icon } from '../../components/ui'
import { Modal, Skeleton, useToast } from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import { formatCurrency, nightsBetween } from '../../lib/booking-rules'
import {
  checkRoomAvailability,
  extendBooking,
  type BookingDetail,
} from '../../lib/queries/bookings'

/*
  Extending and shortening in one dialog (ARCHITECTURE.md §6.6).

  Extending can fail — a room may already be taken by someone arriving on the
  original checkout date — so the outcome is shown BEFORE committing, naming the
  room that blocks it. Shortening always succeeds while at least one night
  remains.
*/
export function ExtendStayDialog({
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
  const [newCheckOut, setNewCheckOut] = useState(booking.checkOut)
  const [error, setError] = useState<string | null>(null)

  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (open && seededFor !== booking.checkOut) {
    setSeededFor(booking.checkOut)
    setNewCheckOut(booking.checkOut)
    setError(null)
  }

  const isExtending = newCheckOut > booking.checkOut
  const isShortening = newCheckOut < booking.checkOut && newCheckOut > booking.checkIn
  const invalid = newCheckOut <= booking.checkIn

  /*
    Only the ADDED nights are checked — the booking already holds its rooms for
    the original window, so including those would report a conflict with itself.
  */
  const availabilityQuery = useQuery({
    queryKey: ['extend-availability', booking.id, booking.checkOut, newCheckOut],
    queryFn: () =>
      checkRoomAvailability({
        guestHouseId: booking.guestHouseId,
        checkIn: booking.checkOut,
        checkOut: newCheckOut,
        excludeBookingId: booking.id,
      }),
    enabled: open && isExtending,
  })

  // Of the rooms on this booking, which are free for the added nights?
  const conflicts = useMemo(() => {
    if (!isExtending || !availabilityQuery.data) return []
    const bookedRoomIds = new Set(booking.rooms.map((room) => room.roomId))
    return availabilityQuery.data.filter(
      (room) => bookedRoomIds.has(room.roomId) && !room.isAvailable,
    )
  }, [isExtending, availabilityQuery.data, booking.rooms])

  const newNights = newCheckOut > booking.checkIn ? nightsBetween(booking.checkIn, newCheckOut) : 0
  const oldNights = nightsBetween(booking.checkIn, booking.checkOut)
  const nightlyTotal = booking.rooms.reduce((sum, room) => sum + room.ratePerNight, 0)
  const newTotal = nightlyTotal * newNights

  const mutation = useMutation({
    mutationFn: () => extendBooking(booking.id, newCheckOut),
    onSuccess: () => {
      notify(isShortening ? 'Stay shortened.' : 'Stay extended.')
      onDone()
      onClose()
    },
    onError: (mutationError) => setError(friendlyError(mutationError)),
  })

  const blocked = isExtending && conflicts.length > 0
  const checking = isExtending && availabilityQuery.isLoading

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change dates"
      description={`Currently ${oldNights} night${oldNights === 1 ? '' : 's'}, leaving ${booking.checkOut}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={newCheckOut === booking.checkOut || invalid || blocked || checking}
          >
            {isShortening ? 'Shorten stay' : 'Extend stay'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <Icon name="alert" className="mt-px size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Field
          label="New check-out"
          type="date"
          value={newCheckOut}
          min={booking.checkIn}
          onChange={(event) => {
            setNewCheckOut(event.target.value)
            setError(null)
          }}
          disabled={mutation.isPending}
          error={invalid ? 'Check-out must be after check-in.' : undefined}
        />

        {checking && <Skeleton className="h-16 w-full" />}

        {isExtending && !checking && (
          <div
            className={
              blocked
                ? 'rounded-xl border border-red-200 bg-red-50 p-3.5 dark:border-red-900/60 dark:bg-red-950/40'
                : 'rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/40'
            }
          >
            {blocked ? (
              <>
                <p className="flex items-start gap-2 text-sm font-medium text-red-700 dark:text-red-300">
                  <Icon name="alert" className="mt-px size-4 shrink-0" />
                  <span>
                    {conflicts.length === 1 ? 'Room' : 'Rooms'}{' '}
                    <span className="tabular">
                      {conflicts.map((room) => room.roomNumber).join(', ')}
                    </span>{' '}
                    {conflicts.length === 1 ? 'is' : 'are'} taken for the added nights.
                  </span>
                </p>
                <p className="mt-1.5 pl-6 text-sm text-red-700 dark:text-red-300">
                  Taken by {conflicts.map((room) => room.blockedBy).filter(Boolean).join(', ')}.
                  Change rooms instead, or pick an earlier date.
                </p>
              </>
            ) : (
              <p className="flex items-start gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                <Icon name="check" className="mt-px size-4 shrink-0" />
                <span>
                  All {booking.rooms.length === 1 ? 'the room is' : 'rooms are'} free for the added
                  nights.
                </span>
              </p>
            )}
          </div>
        )}

        {isShortening && (
          <p className="flex items-start gap-2 rounded-xl bg-[var(--surface-sunken)] p-3.5 text-sm text-[var(--text-secondary)]">
            <Icon name="check" className="mt-px size-4 shrink-0" />
            <span>The released nights become bookable immediately.</span>
          </p>
        )}

        {newCheckOut !== booking.checkOut && !invalid && (
          <dl className="space-y-2 rounded-xl bg-[var(--surface-sunken)] p-3.5 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-[var(--text-secondary)]">Nights</dt>
              <dd className="tabular font-medium">
                {oldNights} → {newNights}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-[var(--text-secondary)]">New total</dt>
              <dd className="tabular font-medium">
                {formatCurrency(booking.totalAmount)} → {formatCurrency(newTotal)}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </Modal>
  )
}
