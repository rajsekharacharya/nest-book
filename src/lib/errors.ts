/*
  Maps the typed error codes raised by the database functions (ARCHITECTURE.md §7)
  to sentences a person can act on. A raw Postgres error must never reach the UI.
*/
const MESSAGES: Record<string, string> = {
  INVALID_DATES: 'Check-out must be after check-in.',
  GUEST_HOUSE_INACTIVE: 'That guest house is no longer active.',
  NO_ROOMS_SELECTED: 'Select at least one room.',
  ROOM_NOT_AVAILABLE: 'That room is already booked for these dates.',
  ROOM_INACTIVE: 'One of the selected rooms is out of service.',
  ROOM_WRONG_GUEST_HOUSE: 'A selected room belongs to a different guest house.',
  CAPACITY_EXCEEDED: 'Too many guests for the rooms selected.',
  GUEST_LIST_REQUIRED: 'Add at least one guest for this booking type.',
  INVALID_STATUS_TRANSITION: 'That status change is not allowed.',
  ROOM_HAS_BOOKINGS: 'This room has current or future bookings.',
  DUPLICATE_ROOM_NUMBER: 'That room number already exists in this guest house.',
  ROOM_CAP_EXCEEDED: 'This guest house has no room slots left.',
  NOT_AUTHORIZED: 'You do not have permission to do that.',
  NOT_FOUND: 'That record no longer exists.',
}

/** Postgres errors arrive as `CODE: detail`; the detail is usually more specific. */
export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong.'

  const raw =
    typeof error === 'string'
      ? error
      : ((error as { message?: string }).message ?? String(error))

  const match = raw.match(/^([A-Z_]+):\s*(.*)$/)
  if (match) {
    const [, code, detail] = match
    return detail?.trim() || MESSAGES[code] || 'Something went wrong.'
  }

  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return message
  }

  if (/Invalid login credentials/i.test(raw)) {
    return 'That email or password is not correct.'
  }
  if (/Email not confirmed/i.test(raw)) {
    return 'This account has not been confirmed yet.'
  }
  if (/Failed to fetch|NetworkError/i.test(raw)) {
    return 'Cannot reach the server. Check your connection and try again.'
  }

  return raw
}
