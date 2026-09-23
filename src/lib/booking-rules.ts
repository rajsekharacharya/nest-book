import type { BookingStatus, BookingType } from './types'

/*
  The shared derivations for bookings (ARCHITECTURE.md §5, §6.3, §6.4).

  These exist in SQL as the authority. This module mirrors them for fast
  feedback in the form, and is the ONLY place the client expresses them — the
  rules are reused by the form, the list, the calendar and the dashboard rather
  than re-derived inline at each call site, which is how two copies drift apart.
*/

/* ------------------------------------------------------------------ Dates */

/*
  A stay date is a calendar day, never an instant. `new Date('2026-03-10')`
  parses as UTC midnight and then displays in local time, which in any timezone
  behind UTC silently shows the 9th. So dates are handled as 'YYYY-MM-DD'
  strings and only turned into a Date at local noon, far from either boundary.
*/
export function parseDate(iso: string): Date {
  // Tolerate a full timestamp by taking only the date part. The API returns
  // plain dates, but a single missing ::date cast upstream would otherwise
  // surface as "Invalid Date" in the UI rather than as an obvious failure.
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export function toISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function addDays(iso: string, days: number): string {
  const date = parseDate(iso)
  date.setDate(date.getDate() + days)
  return toISODate(date)
}

/** Nights, not days: 10th → 12th is two nights (§6.4). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = parseDate(checkOut).getTime() - parseDate(checkIn).getTime()
  return Math.round(ms / 86_400_000)
}

/*
  THE overlap definition (§6.3). Half-open: checkout day is free for a new
  check-in, so a guest leaving on the 10th does not block an arrival on the
  10th. Mirrors ranges_overlap() in SQL exactly.
*/
export function rangesOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string,
): boolean {
  return aFrom < bTo && aTo > bFrom
}

/* -------------------------------------------------------------- Occupancy */

/*
  §5. SELF is the booker alone. OTHER is the listed guests only — the booker is
  arranging the stay, not taking part in it. COMBINE is the booker plus the
  listed guests.
*/
export function occupantCount(bookingType: BookingType, guestCount: number): number {
  switch (bookingType) {
    case 'SELF':
      return 1
    case 'OTHER':
      return guestCount
    case 'COMBINE':
      return guestCount + 1
  }
}

export function requiresGuestList(bookingType: BookingType): boolean {
  return bookingType !== 'SELF'
}

/** What the booking name means depends on the type, so the form must say so. */
export function bookingNameRole(bookingType: BookingType): string {
  switch (bookingType) {
    case 'SELF':
      return 'The guest staying.'
    case 'OTHER':
      return 'Who is arranging the booking — not counted as staying.'
    case 'COMBINE':
      return 'The booker, who is also staying.'
  }
}

/* ------------------------------------------------------------------ Money */

/** §6.4. Recomputed server-side from snapshotted rates; this is a preview. */
export function estimateTotal(ratesPerNight: number[], nights: number): number {
  return ratesPerNight.reduce((sum, rate) => sum + rate, 0) * nights
}

export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/* ----------------------------------------------------------------- Status */

/*
  §6.5. Mirrors the transition table in change_booking_status so the UI offers
  only what the server will accept — an action that always fails is worse than
  no action at all.
*/
const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  BOOKED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
  CANCELLED: [],
  NO_SHOW: [],
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/*
  Cancellation applies only before check-in (§6.5). Once a guest has physically
  arrived the stay happened, and erasing it would remove a real occupancy from
  history; leaving early is an early check-out, not a cancellation.
*/
export function canCancel(status: BookingStatus): boolean {
  return canTransition(status, 'CANCELLED')
}

/** Extending is allowed mid-stay — the common case at a front desk (§6.6). */
export function canExtend(status: BookingStatus): boolean {
  return status === 'BOOKED' || status === 'CHECKED_IN'
}

export function canChangeRooms(status: BookingStatus): boolean {
  return status === 'BOOKED' || status === 'CHECKED_IN'
}

export function canEdit(status: BookingStatus): boolean {
  return status === 'BOOKED' || status === 'CHECKED_IN'
}

/** Cancelled and no-show release their rooms and leave every calculation (§6.3). */
export function isBlocking(status: BookingStatus): boolean {
  return status !== 'CANCELLED' && status !== 'NO_SHOW'
}

export const STATUS_LABELS: Record<BookingStatus, string> = {
  BOOKED: 'Booked',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
}

/* Paired with the label everywhere — colour alone is not a status (DESIGN.md). */
export const STATUS_TONES: Record<BookingStatus, 'blue' | 'brand' | 'neutral' | 'red' | 'amber'> = {
  BOOKED: 'blue',
  CHECKED_IN: 'brand',
  CHECKED_OUT: 'neutral',
  CANCELLED: 'red',
  NO_SHOW: 'amber',
}

/* ------------------------------------------------------------- Validation */

export type BookingDraft = {
  guestHouseId: string
  bookingName: string
  contactNumber: string
  bookingType: BookingType
  checkIn: string
  checkOut: string
  roomIds: string[]
  guestCount: number
  totalCapacity: number
}

/*
  Mirrors §6.2 for fast feedback. Never the authority — the server re-runs all
  of it inside one transaction, and only the exclusion constraint makes the
  no-double-booking guarantee true under concurrent writes.
*/
export function validateDraft(draft: BookingDraft): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!draft.guestHouseId) errors.guestHouseId = 'Choose a guest house.'
  if (!draft.bookingName.trim()) errors.bookingName = 'Enter a name for the booking.'
  if (!draft.contactNumber.trim()) errors.contactNumber = 'Enter a contact number.'

  if (!draft.checkIn) errors.checkIn = 'Choose a check-in date.'
  if (!draft.checkOut) errors.checkOut = 'Choose a check-out date.'
  if (draft.checkIn && draft.checkOut && draft.checkOut <= draft.checkIn) {
    errors.checkOut = 'Check-out must be after check-in.'
  }

  if (draft.roomIds.length === 0) errors.rooms = 'Select at least one room.'

  if (requiresGuestList(draft.bookingType) && draft.guestCount === 0) {
    errors.guests =
      draft.bookingType === 'OTHER'
        ? 'Add the guests who will be staying.'
        : 'Add the other guests staying with you.'
  }

  const occupants = occupantCount(draft.bookingType, draft.guestCount)
  if (draft.roomIds.length > 0 && occupants > draft.totalCapacity) {
    errors.capacity = `${occupants} guests exceed the ${draft.totalCapacity} the selected rooms hold.`
  }

  return errors
}
