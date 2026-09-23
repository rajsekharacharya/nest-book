import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../app/AppShell'
import { Button, Field, Icon, cx } from '../../components/ui'
import { ErrorState, Skeleton, useToast } from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import {
  bookingNameRole,
  estimateTotal,
  formatCurrency,
  nightsBetween,
  occupantCount,
  requiresGuestList,
  todayISO,
  validateDraft,
} from '../../lib/booking-rules'
import { listGuestHouses } from '../../lib/queries/guest-houses'
import {
  createBooking,
  findPreviousGuest,
  getBookingDetail,
  updateBooking,
  type BookingGuest,
  type RoomAvailability,
} from '../../lib/queries/bookings'
import type { BookingType } from '../../lib/types'
import { GuestListEditor, emptyGuest } from './GuestListEditor'
import { RoomPicker } from './RoomPicker'

const TYPE_OPTIONS: { value: BookingType; title: string; body: string }[] = [
  { value: 'SELF', title: 'Just me', body: 'One guest — the person named above.' },
  { value: 'OTHER', title: 'For others', body: 'Booking on behalf of guests who will stay.' },
  { value: 'COMBINE', title: 'Me and others', body: 'You are staying, plus the guests you list.' },
]

export function BookingFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { notify } = useToast()
  const [searchParams] = useSearchParams()

  const [guestHouseId, setGuestHouseId] = useState(searchParams.get('guestHouse') ?? '')
  const [bookingName, setBookingName] = useState('')
  const [contactNumber, setContactNumber] = useState('')
  const [note, setNote] = useState('')
  const [bookingType, setBookingType] = useState<BookingType>('SELF')
  const [checkIn, setCheckIn] = useState(searchParams.get('from') ?? todayISO())
  const [checkOut, setCheckOut] = useState(searchParams.get('to') ?? '')
  const [selectedRooms, setSelectedRooms] = useState<RoomAvailability[]>([])
  const [guests, setGuests] = useState<BookingGuest[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [prefillOffer, setPrefillOffer] = useState<{ name: string; guests: BookingGuest[] } | null>(
    null,
  )

  const housesQuery = useQuery({ queryKey: ['guest-houses'], queryFn: listGuestHouses })

  const detailQuery = useQuery({
    queryKey: ['booking', id],
    queryFn: () => getBookingDetail(id!),
    enabled: isEdit,
  })

  // Seed the form from the booking being edited, once.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (!isEdit || seeded || !detailQuery.data) return
    const detail = detailQuery.data
    setGuestHouseId(detail.guestHouseId)
    setBookingName(detail.bookingName)
    setContactNumber(detail.contactNumber)
    setNote(detail.note ?? '')
    setBookingType(detail.bookingType)
    setCheckIn(detail.checkIn)
    setCheckOut(detail.checkOut)
    setGuests(detail.guests)
    setSelectedRooms(
      detail.rooms.map((room) => ({
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        roomTypeName: room.roomTypeName,
        ratePerNight: room.ratePerNight,
        capacity: room.capacity,
        isAvailable: true,
        blockedBy: null,
      })),
    )
    setSeeded(true)
  }, [isEdit, seeded, detailQuery.data])

  const activeHouses = useMemo(
    () => (housesQuery.data ?? []).filter((house) => house.isActive),
    [housesQuery.data],
  )

  /*
    Changing the guest house or the dates invalidates the room selection: those
    rooms may belong elsewhere, or may no longer be free. Silently keeping them
    would submit a selection the server will reject (§9.3).
  */
  function changeGuestHouse(next: string) {
    if (next !== guestHouseId) setSelectedRooms([])
    setGuestHouseId(next)
  }

  function changeCheckIn(next: string) {
    setCheckIn(next)
    setSelectedRooms([])
    // Keep the stay length rather than leaving an invalid range behind.
    if (checkOut && next >= checkOut) {
      const nights = Math.max(1, nightsBetween(checkIn, checkOut) || 1)
      const date = new Date(next)
      date.setDate(date.getDate() + nights)
      setCheckOut(date.toISOString().slice(0, 10))
    }
  }

  function changeCheckOut(next: string) {
    setCheckOut(next)
    setSelectedRooms([])
  }

  function toggleRoom(room: RoomAvailability) {
    setSelectedRooms((current) =>
      current.some((selected) => selected.roomId === room.roomId)
        ? current.filter((selected) => selected.roomId !== room.roomId)
        : [...current, room],
    )
  }

  /*
    Repeat guests (§9.3): a returning visitor's details come from their last
    booking rather than being retyped. Offered, never applied automatically —
    the operator may be booking a different person on a shared phone number.
  */
  async function lookupContact(value: string) {
    if (isEdit || value.trim().length < 6) return
    try {
      const previous = await findPreviousGuest(value)
      if (previous && !bookingName.trim()) {
        setPrefillOffer({ name: previous.bookingName, guests: previous.guests })
      }
    } catch {
      /* A failed lookup is not worth interrupting the form for. */
    }
  }

  function applyPrefill() {
    if (!prefillOffer) return
    setBookingName(prefillOffer.name)
    if (prefillOffer.guests.length > 0 && bookingType !== 'SELF') {
      setGuests(prefillOffer.guests)
    }
    setPrefillOffer(null)
  }

  const nights = checkIn && checkOut && checkOut > checkIn ? nightsBetween(checkIn, checkOut) : 0
  const totalCapacity = selectedRooms.reduce((sum, room) => sum + room.capacity, 0)
  const guestCount = requiresGuestList(bookingType)
    ? guests.filter((guest) => guest.name.trim()).length
    : 0
  const occupants = occupantCount(bookingType, guestCount)
  const estimate = estimateTotal(
    selectedRooms.map((room) => room.ratePerNight),
    nights,
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        guestHouseId,
        bookingName,
        contactNumber,
        note,
        bookingType,
        checkIn,
        checkOut,
        roomIds: selectedRooms.map((room) => room.roomId),
        guests: guests.filter((guest) => guest.name.trim()),
      }
      if (isEdit) {
        await updateBooking(id!, payload)
        return { id: id! }
      }
      return createBooking(payload)
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['bookings'] })
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      if (isEdit) void queryClient.invalidateQueries({ queryKey: ['booking', id] })
      notify(isEdit ? 'Booking updated.' : 'Booking confirmed.')
      navigate(`/app/bookings/${result.id}`)
    },
    onError: (error) => {
      const message = friendlyError(error)
      setErrors({ form: message })
      // A room taken between loading the picker and saving is the expected
      // race (§9.3): re-query so the operator sees the new state immediately
      // without losing anything else they entered.
      if (/already booked|not available/i.test(message)) {
        void queryClient.invalidateQueries({ queryKey: ['availability'] })
      }
    },
  })

  function submit() {
    const next = validateDraft({
      guestHouseId,
      bookingName,
      contactNumber,
      bookingType,
      checkIn,
      checkOut,
      roomIds: selectedRooms.map((room) => room.roomId),
      guestCount,
      totalCapacity,
    })

    if (requiresGuestList(bookingType) && guests.some((guest) => !guest.name.trim())) {
      next.guests = 'Every guest needs a name, or remove the empty row.'
    }

    setErrors(next)
    if (Object.keys(next).length > 0) {
      document.querySelector('[data-error]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    mutation.mutate()
  }

  if (isEdit && detailQuery.isError) {
    return (
      <>
        <PageHeader title="Booking" />
        <div className="card">
          <ErrorState
            message={friendlyError(detailQuery.error)}
            onRetry={() => void detailQuery.refetch()}
          />
        </div>
      </>
    )
  }

  const busy = mutation.isPending
  const pastCheckIn = checkIn && checkIn < todayISO()

  return (
    <>
      <Link
        to={isEdit ? `/app/bookings/${id}` : '/app/bookings'}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <Icon name="logout" className="size-4 rotate-180" />
        {isEdit ? 'Back to booking' : 'All bookings'}
      </Link>

      <PageHeader
        title={isEdit ? 'Edit booking' : 'New booking'}
        description={
          isEdit
            ? 'Changing dates or rooms re-checks availability.'
            : 'Pick the dates first — the room list shows what is actually free.'
        }
      />

      {isEdit && detailQuery.isLoading ? (
        <div className="card space-y-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
          <div className="space-y-4">
            {errors.form && (
              <div
                role="alert"
                data-error
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              >
                <Icon name="alert" className="mt-px size-4 shrink-0" />
                <span>{errors.form}</span>
              </div>
            )}

            {/* Where and when ------------------------------------------- */}
            <section className="card space-y-4 p-4 sm:p-5">
              <h2 className="font-medium">Where and when</h2>

              <div className="space-y-1.5">
                <label
                  htmlFor="booking-house"
                  className="block text-sm font-medium text-[var(--text-secondary)]"
                >
                  Guest house
                </label>
                <select
                  id="booking-house"
                  value={guestHouseId}
                  onChange={(event) => changeGuestHouse(event.target.value)}
                  disabled={busy || housesQuery.isLoading}
                  aria-invalid={Boolean(errors.guestHouseId)}
                  className={cx('input-base', errors.guestHouseId && 'input-error')}
                >
                  <option value="">Choose a guest house…</option>
                  {activeHouses.map((house) => (
                    <option key={house.id} value={house.id}>
                      {house.name}
                    </option>
                  ))}
                </select>
                {errors.guestHouseId && (
                  <p data-error className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                    <Icon name="alert" className="size-3.5 shrink-0" />
                    {errors.guestHouseId}
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Check-in"
                  type="date"
                  value={checkIn}
                  onChange={(event) => changeCheckIn(event.target.value)}
                  error={errors.checkIn}
                  disabled={busy}
                  // Past dates are allowed — a walk-in recorded after the fact
                  // is routine — but flagged, so a wrong year is caught (§9.3).
                  hint={pastCheckIn && !errors.checkIn ? 'This date has passed.' : undefined}
                />
                <Field
                  label="Check-out"
                  type="date"
                  value={checkOut}
                  min={checkIn || undefined}
                  onChange={(event) => changeCheckOut(event.target.value)}
                  error={errors.checkOut}
                  disabled={busy}
                  hint={
                    nights > 0 && !errors.checkOut
                      ? `${nights} night${nights === 1 ? '' : 's'}`
                      : undefined
                  }
                />
              </div>
            </section>

            {/* Who -------------------------------------------------------- */}
            <section className="card space-y-4 p-4 sm:p-5">
              <h2 className="font-medium">Who is booking</h2>

              <Field
                label="Contact number"
                type="tel"
                placeholder="+91 98765 43210"
                value={contactNumber}
                onChange={(event) => setContactNumber(event.target.value)}
                onBlur={(event) => void lookupContact(event.target.value)}
                error={errors.contactNumber}
                disabled={busy}
              />

              {prefillOffer && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-3.5 py-3 text-sm dark:border-brand-900 dark:bg-brand-950/40">
                  <span className="flex-1">
                    <span className="font-medium">{prefillOffer.name}</span> stayed before on this
                    number.
                  </span>
                  <Button size="sm" variant="secondary" onClick={applyPrefill}>
                    Use their details
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPrefillOffer(null)}
                    aria-label="Dismiss"
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <Icon name="close" className="size-4" />
                  </button>
                </div>
              )}

              <Field
                label="Booking name"
                placeholder="Arun Mehta"
                value={bookingName}
                onChange={(event) => setBookingName(event.target.value)}
                error={errors.bookingName}
                disabled={busy}
                hint={errors.bookingName ? undefined : bookingNameRole(bookingType)}
              />

              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
                  Who is staying
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {TYPE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={cx(
                        'flex cursor-pointer gap-2.5 rounded-xl border p-3 transition-colors',
                        bookingType === option.value
                          ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/40'
                          : 'border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
                      )}
                    >
                      <input
                        type="radio"
                        name="booking-type"
                        value={option.value}
                        checked={bookingType === option.value}
                        onChange={() => {
                          setBookingType(option.value)
                          // Moving to a type that needs a list should not leave
                          // an empty section with no way in.
                          if (option.value !== 'SELF' && guests.length === 0) {
                            setGuests([emptyGuest()])
                          }
                        }}
                        disabled={busy}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)]"
                      />
                      <span>
                        <span className="block text-sm font-medium">{option.title}</span>
                        <span className="block text-xs text-[var(--text-muted)]">
                          {option.body}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-1.5">
                <label
                  htmlFor="booking-note"
                  className="block text-sm font-medium text-[var(--text-secondary)]"
                >
                  Note
                </label>
                <textarea
                  id="booking-note"
                  rows={2}
                  placeholder="Late arrival, dietary needs, anything the desk should know."
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={busy}
                  className="input-base h-auto resize-y py-2.5"
                />
              </div>
            </section>

            {/* Guests ----------------------------------------------------- */}
            {requiresGuestList(bookingType) && (
              <section className="card p-4 sm:p-5" data-error={errors.guests ? '' : undefined}>
                <GuestListEditor
                  bookingType={bookingType}
                  guests={guests}
                  onChange={setGuests}
                  error={errors.guests}
                  disabled={busy}
                />
              </section>
            )}

            {/* Rooms ------------------------------------------------------ */}
            <section className="card space-y-3 p-4 sm:p-5" data-error={errors.rooms ? '' : undefined}>
              <h2 className="font-medium">Rooms</h2>
              <RoomPicker
                guestHouseId={guestHouseId}
                checkIn={checkIn}
                checkOut={checkOut}
                excludeBookingId={isEdit ? id : undefined}
                selectedIds={selectedRooms.map((room) => room.roomId)}
                onToggle={toggleRoom}
                error={errors.rooms}
              />
            </section>
          </div>

          {/* Summary ------------------------------------------------------ */}
          <aside className="lg:sticky lg:top-6">
            <div className="card space-y-3 p-4 sm:p-5">
              <h2 className="font-medium">Summary</h2>

              <dl className="space-y-2 text-sm">
                <Row label="Nights" value={nights > 0 ? String(nights) : '—'} />
                <Row
                  label="Rooms"
                  value={
                    selectedRooms.length > 0
                      ? selectedRooms.map((room) => room.roomNumber).join(', ')
                      : '—'
                  }
                />
                <Row
                  label="Guests"
                  value={selectedRooms.length > 0 ? `${occupants} of ${totalCapacity}` : String(occupants)}
                  tone={
                    selectedRooms.length > 0 && occupants > totalCapacity ? 'error' : undefined
                  }
                />
              </dl>

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">Total</span>
                  <span className="tabular text-xl font-semibold">
                    {formatCurrency(estimate)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Confirmed by the server when you save.
                </p>
              </div>

              {errors.capacity && (
                <p
                  role="alert"
                  data-error
                  className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400"
                >
                  <Icon name="alert" className="mt-px size-3.5 shrink-0" />
                  {errors.capacity}
                </p>
              )}

              <Button fullWidth size="lg" onClick={submit} loading={busy}>
                {isEdit ? 'Save changes' : 'Confirm booking'}
              </Button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'error'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--text-secondary)]">{label}</dt>
      <dd
        className={cx(
          'tabular truncate text-right font-medium',
          tone === 'error' && 'text-red-600 dark:text-red-400',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
