import { describe, expect, it } from 'vitest'
import {
  addDays,
  canCancel,
  canExtend,
  canTransition,
  estimateTotal,
  isBlocking,
  nightsBetween,
  occupantCount,
  parseDate,
  rangesOverlap,
  requiresGuestList,
  toISODate,
  validateDraft,
  type BookingDraft,
} from './booking-rules'

describe('date handling', () => {
  it('round-trips an ISO date without shifting the day', () => {
    // The classic timezone bug: new Date('2026-03-10') is UTC midnight, which
    // displays as the 9th anywhere behind UTC.
    expect(toISODate(parseDate('2026-03-10'))).toBe('2026-03-10')
  })

  it('round-trips a date across a DST boundary', () => {
    expect(toISODate(parseDate('2026-03-29'))).toBe('2026-03-29')
    expect(toISODate(parseDate('2026-10-25'))).toBe('2026-10-25')
  })

  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02')
  })

  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('subtracts with a negative offset', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('nightsBetween', () => {
  it('counts nights, not days', () => {
    // The 10th to the 12th is two nights.
    expect(nightsBetween('2026-03-10', '2026-03-12')).toBe(2)
  })

  it('counts a single night', () => {
    expect(nightsBetween('2026-03-10', '2026-03-11')).toBe(1)
  })

  it('spans a month boundary', () => {
    expect(nightsBetween('2026-01-30', '2026-02-02')).toBe(3)
  })

  it('is unaffected by a DST transition', () => {
    // A 23- or 25-hour day must not round to the wrong night count.
    expect(nightsBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(nightsBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
})

describe('rangesOverlap', () => {
  it('treats checkout day as free for a new check-in', () => {
    // THE rule (§6.3): leaving on the 10th does not block arriving on the 10th.
    expect(rangesOverlap('2026-03-08', '2026-03-10', '2026-03-10', '2026-03-12')).toBe(false)
  })

  it('detects a one-night overlap', () => {
    expect(rangesOverlap('2026-03-08', '2026-03-11', '2026-03-10', '2026-03-12')).toBe(true)
  })

  it('detects a fully contained stay', () => {
    expect(rangesOverlap('2026-03-01', '2026-03-31', '2026-03-10', '2026-03-12')).toBe(true)
  })

  it('detects an enclosing stay', () => {
    expect(rangesOverlap('2026-03-10', '2026-03-12', '2026-03-01', '2026-03-31')).toBe(true)
  })

  it('detects identical ranges', () => {
    expect(rangesOverlap('2026-03-10', '2026-03-12', '2026-03-10', '2026-03-12')).toBe(true)
  })

  it('reports no overlap for ranges that merely touch in reverse order', () => {
    expect(rangesOverlap('2026-03-10', '2026-03-12', '2026-03-08', '2026-03-10')).toBe(false)
  })

  it('reports no overlap for clearly separate ranges', () => {
    expect(rangesOverlap('2026-03-01', '2026-03-05', '2026-03-10', '2026-03-12')).toBe(false)
  })
})

describe('occupantCount', () => {
  it('counts SELF as the booker alone, ignoring any guest rows', () => {
    expect(occupantCount('SELF', 0)).toBe(1)
    expect(occupantCount('SELF', 5)).toBe(1)
  })

  it('counts OTHER as the listed guests only — the booker is not staying', () => {
    expect(occupantCount('OTHER', 3)).toBe(3)
  })

  it('counts COMBINE as the listed guests plus the booker', () => {
    expect(occupantCount('COMBINE', 3)).toBe(4)
  })

  it('requires a guest list for OTHER and COMBINE only', () => {
    expect(requiresGuestList('SELF')).toBe(false)
    expect(requiresGuestList('OTHER')).toBe(true)
    expect(requiresGuestList('COMBINE')).toBe(true)
  })
})

describe('estimateTotal', () => {
  it('multiplies the summed nightly rates by the night count', () => {
    expect(estimateTotal([1200, 1800], 3)).toBe(9000)
  })

  it('is zero when no rooms are selected', () => {
    expect(estimateTotal([], 3)).toBe(0)
  })
})

describe('status transitions', () => {
  it('allows the documented moves out of BOOKED', () => {
    expect(canTransition('BOOKED', 'CHECKED_IN')).toBe(true)
    expect(canTransition('BOOKED', 'CANCELLED')).toBe(true)
    expect(canTransition('BOOKED', 'NO_SHOW')).toBe(true)
  })

  it('allows only check-out from CHECKED_IN', () => {
    expect(canTransition('CHECKED_IN', 'CHECKED_OUT')).toBe(true)
    expect(canTransition('CHECKED_IN', 'CANCELLED')).toBe(false)
    expect(canTransition('CHECKED_IN', 'NO_SHOW')).toBe(false)
  })

  it('treats CHECKED_OUT, CANCELLED and NO_SHOW as terminal', () => {
    expect(canTransition('CHECKED_OUT', 'CHECKED_IN')).toBe(false)
    expect(canTransition('CANCELLED', 'BOOKED')).toBe(false)
    expect(canTransition('NO_SHOW', 'CHECKED_IN')).toBe(false)
  })

  it('refuses cancellation once the guest has checked in', () => {
    // The stay happened; erasing it would remove a real occupancy (§6.5).
    expect(canCancel('BOOKED')).toBe(true)
    expect(canCancel('CHECKED_IN')).toBe(false)
  })

  it('allows extending mid-stay, but not after checkout or cancellation', () => {
    expect(canExtend('BOOKED')).toBe(true)
    expect(canExtend('CHECKED_IN')).toBe(true)
    expect(canExtend('CHECKED_OUT')).toBe(false)
    expect(canExtend('CANCELLED')).toBe(false)
  })

  it('excludes cancelled and no-show from blocking rooms', () => {
    expect(isBlocking('BOOKED')).toBe(true)
    expect(isBlocking('CHECKED_IN')).toBe(true)
    expect(isBlocking('CHECKED_OUT')).toBe(true)
    expect(isBlocking('CANCELLED')).toBe(false)
    expect(isBlocking('NO_SHOW')).toBe(false)
  })
})

describe('validateDraft', () => {
  const valid: BookingDraft = {
    guestHouseId: 'gh-1',
    bookingName: 'Arun Mehta',
    contactNumber: '+91 98765 43210',
    bookingType: 'SELF',
    checkIn: '2026-03-10',
    checkOut: '2026-03-12',
    roomIds: ['room-1'],
    guestCount: 0,
    totalCapacity: 2,
  }

  it('accepts a complete SELF booking with no guest list', () => {
    expect(validateDraft(valid)).toEqual({})
  })

  it('rejects a checkout on or before check-in', () => {
    expect(validateDraft({ ...valid, checkOut: '2026-03-10' }).checkOut).toBeDefined()
    expect(validateDraft({ ...valid, checkOut: '2026-03-09' }).checkOut).toBeDefined()
  })

  it('requires at least one room', () => {
    expect(validateDraft({ ...valid, roomIds: [] }).rooms).toBeDefined()
  })

  it('requires a guest list for OTHER', () => {
    const errors = validateDraft({ ...valid, bookingType: 'OTHER', guestCount: 0 })
    expect(errors.guests).toBeDefined()
  })

  it('requires a guest list for COMBINE', () => {
    const errors = validateDraft({ ...valid, bookingType: 'COMBINE', guestCount: 0 })
    expect(errors.guests).toBeDefined()
  })

  it('counts the booker against capacity for COMBINE', () => {
    // 2 guests + the booker = 3 people in rooms holding 2.
    const errors = validateDraft({
      ...valid,
      bookingType: 'COMBINE',
      guestCount: 2,
      totalCapacity: 2,
    })
    expect(errors.capacity).toBeDefined()
  })

  it('does not count the booker against capacity for OTHER', () => {
    // The booker is not staying, so 2 guests fit rooms holding 2.
    const errors = validateDraft({
      ...valid,
      bookingType: 'OTHER',
      guestCount: 2,
      totalCapacity: 2,
    })
    expect(errors.capacity).toBeUndefined()
  })

  it('reports every missing required field at once', () => {
    const errors = validateDraft({
      ...valid,
      guestHouseId: '',
      bookingName: '  ',
      contactNumber: '',
    })
    expect(Object.keys(errors).sort()).toEqual(['bookingName', 'contactNumber', 'guestHouseId'])
  })
})
