import { supabase } from '../supabase'
import type { BookingStatus, BookingType } from '../types'

/* -------------------------------------------------------------- List view */

export type BookingListRow = {
  id: string
  guestHouseId: string
  guestHouseName: string
  bookingName: string
  contactNumber: string
  note: string | null
  bookingType: BookingType
  checkIn: string
  checkOut: string
  status: BookingStatus
  totalAmount: number
  publicToken: string
  roomNumbers: string[]
  guestCount: number
  occupantCount: number
  createdAt: string
}

export type BookingListResult = {
  rows: BookingListRow[]
  totalCount: number
}

export type BookingFilters = {
  guestHouseId?: string
  status?: BookingStatus[]
  from?: string
  to?: string
  search?: string
  limit?: number
  offset?: number
}

type ListRow = {
  id: string
  guest_house_id: string
  guest_house_name: string
  booking_name: string
  contact_number: string
  note: string | null
  booking_type: BookingType
  check_in: string
  check_out: string
  status: BookingStatus
  total_amount: string | number
  public_token: string
  room_numbers: string[]
  guest_count: number
  occupant_count: number
  created_at: string
  total_count: number
}

export async function listBookings(filters: BookingFilters = {}): Promise<BookingListResult> {
  const { data, error } = await supabase.rpc('list_bookings', {
    p_guest_house_id: filters.guestHouseId ?? null,
    p_status: filters.status?.length ? filters.status : null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_search: filters.search?.trim() || null,
    p_limit: filters.limit ?? 100,
    p_offset: filters.offset ?? 0,
  })

  if (error) throw error

  const rows = (data ?? []) as ListRow[]
  return {
    rows: rows.map((row) => ({
      id: row.id,
      guestHouseId: row.guest_house_id,
      guestHouseName: row.guest_house_name,
      bookingName: row.booking_name,
      contactNumber: row.contact_number,
      note: row.note,
      bookingType: row.booking_type,
      checkIn: row.check_in,
      checkOut: row.check_out,
      status: row.status,
      totalAmount: Number(row.total_amount),
      publicToken: row.public_token,
      roomNumbers: row.room_numbers ?? [],
      guestCount: row.guest_count,
      occupantCount: row.occupant_count,
      createdAt: row.created_at,
    })),
    // count(*) over () repeats on every row; zero rows means zero matches.
    totalCount: rows[0]?.total_count ?? 0,
  }
}

/* ------------------------------------------------------------------ Detail */

export type BookingRoom = {
  roomId: string
  roomNumber: string
  roomTypeName: string
  ratePerNight: number
  capacity: number
}

export type BookingGuest = {
  id?: string
  name: string
  age: number | null
  gender: string | null
  contactNumber: string | null
  idProofType: string | null
  idProofNumber: string | null
}

export type BookingDetail = {
  id: string
  guestHouseId: string
  guestHouseName: string
  guestHouseAddress: string
  bookingName: string
  contactNumber: string
  note: string | null
  bookingType: BookingType
  checkIn: string
  checkOut: string
  status: BookingStatus
  cancellationReason: string | null
  cancelledAt: string | null
  checkedInAt: string | null
  checkedOutAt: string | null
  totalAmount: number
  publicToken: string
  createdAt: string
  rooms: BookingRoom[]
  guests: BookingGuest[]
}

type DetailPayload = {
  id: string
  guest_house_id: string
  guest_house_name: string
  guest_house_address: string
  booking_name: string
  contact_number: string
  note: string | null
  booking_type: BookingType
  check_in: string
  check_out: string
  status: BookingStatus
  cancellation_reason: string | null
  cancelled_at: string | null
  checked_in_at: string | null
  checked_out_at: string | null
  total_amount: string | number
  public_token: string
  created_at: string
  rooms: {
    room_id: string
    room_number: string
    room_type_name: string
    rate_per_night: string | number
    capacity: number
  }[]
  guests: {
    id: string
    name: string
    age: number | null
    gender: string | null
    contact_number: string | null
    id_proof_type: string | null
    id_proof_number: string | null
  }[]
}

export async function getBookingDetail(id: string): Promise<BookingDetail> {
  const { data, error } = await supabase.rpc('get_booking_detail', { p_booking_id: id })
  if (error) throw error
  if (!data) throw new Error('NOT_FOUND: that booking no longer exists')

  const payload = data as DetailPayload
  return {
    id: payload.id,
    guestHouseId: payload.guest_house_id,
    guestHouseName: payload.guest_house_name,
    guestHouseAddress: payload.guest_house_address,
    bookingName: payload.booking_name,
    contactNumber: payload.contact_number,
    note: payload.note,
    bookingType: payload.booking_type,
    checkIn: payload.check_in,
    checkOut: payload.check_out,
    status: payload.status,
    cancellationReason: payload.cancellation_reason,
    cancelledAt: payload.cancelled_at,
    checkedInAt: payload.checked_in_at,
    checkedOutAt: payload.checked_out_at,
    totalAmount: Number(payload.total_amount),
    publicToken: payload.public_token,
    createdAt: payload.created_at,
    rooms: payload.rooms.map((room) => ({
      roomId: room.room_id,
      roomNumber: room.room_number,
      roomTypeName: room.room_type_name,
      ratePerNight: Number(room.rate_per_night),
      capacity: room.capacity,
    })),
    guests: payload.guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      age: guest.age,
      gender: guest.gender,
      contactNumber: guest.contact_number,
      idProofType: guest.id_proof_type,
      idProofNumber: guest.id_proof_number,
    })),
  }
}

/* ------------------------------------------------------------ Availability */

export type RoomAvailability = {
  roomId: string
  roomNumber: string
  roomTypeName: string
  ratePerNight: number
  capacity: number
  isAvailable: boolean
  blockedBy: string | null
}

/*
  Powers the room picker. This is advisory: the same check runs again inside the
  booking transaction, and the exclusion constraint on booking_rooms is what
  actually prevents a double booking under concurrent writes (§6.2).
*/
export async function checkRoomAvailability(input: {
  guestHouseId: string
  checkIn: string
  checkOut: string
  excludeBookingId?: string
}): Promise<RoomAvailability[]> {
  const { data, error } = await supabase.rpc('check_room_availability', {
    p_guest_house_id: input.guestHouseId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_exclude_booking: input.excludeBookingId ?? null,
  })

  if (error) throw error

  return (
    (data ?? []) as {
      room_id: string
      room_number: string
      room_type_name: string
      rate_per_night: string | number
      capacity: number
      is_available: boolean
      blocked_by: string | null
    }[]
  ).map((row) => ({
    roomId: row.room_id,
    roomNumber: row.room_number,
    roomTypeName: row.room_type_name,
    ratePerNight: Number(row.rate_per_night),
    capacity: row.capacity,
    isAvailable: row.is_available,
    blockedBy: row.blocked_by,
  }))
}

/* ------------------------------------------------------------------ Writes */

export type BookingPayload = {
  guestHouseId: string
  bookingName: string
  contactNumber: string
  note: string
  bookingType: BookingType
  checkIn: string
  checkOut: string
  roomIds: string[]
  guests: BookingGuest[]
}

/*
  Every booking write goes through an RPC that validates inside one transaction
  (CLAUDE.md rule 1). No role holds insert or update grants on bookings,
  booking_rooms or booking_guests, so there is no way to skip these checks.
*/
function toPayload(input: BookingPayload) {
  return {
    guest_house_id: input.guestHouseId,
    booking_name: input.bookingName.trim(),
    contact_number: input.contactNumber.trim(),
    note: input.note.trim(),
    booking_type: input.bookingType,
    check_in: input.checkIn,
    check_out: input.checkOut,
    room_ids: input.roomIds,
    // SELF carries no guest list (§5); sending one anyway would be ignored, but
    // dropping it here keeps the payload honest about what was captured.
    guests:
      input.bookingType === 'SELF'
        ? []
        : input.guests.map((guest) => ({
            name: guest.name.trim(),
            age: guest.age ?? '',
            gender: guest.gender ?? '',
            contact_number: guest.contactNumber ?? '',
            id_proof_type: guest.idProofType ?? '',
            id_proof_number: guest.idProofNumber ?? '',
          })),
  }
}

export async function createBooking(input: BookingPayload): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('create_booking', { payload: toPayload(input) })
  if (error) throw error
  return data as { id: string }
}

export async function updateBooking(id: string, input: BookingPayload): Promise<void> {
  const { error } = await supabase.rpc('update_booking', {
    p_booking_id: id,
    payload: toPayload(input),
  })
  if (error) throw error
}

export async function changeBookingStatus(id: string, status: BookingStatus): Promise<void> {
  const { error } = await supabase.rpc('change_booking_status', {
    p_booking_id: id,
    p_new_status: status,
  })
  if (error) throw error
}

export async function cancelBooking(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_booking', {
    p_booking_id: id,
    p_reason: reason.trim() || null,
  })
  if (error) throw error
}

/** Handles both directions — shortening is always allowed, extending can fail (§6.6). */
export async function extendBooking(id: string, newCheckOut: string): Promise<void> {
  const { error } = await supabase.rpc('extend_booking', {
    p_booking_id: id,
    p_new_check_out: newCheckOut,
  })
  if (error) throw error
}

export async function changeBookingRooms(id: string, roomIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('change_booking_rooms', {
    p_booking_id: id,
    p_room_ids: roomIds,
  })
  if (error) throw error
}

/* ---------------------------------------------------------------- Calendar */

export type CalendarRoom = {
  guestHouseId: string
  guestHouseName: string
  roomId: string
  roomNumber: string
  roomTypeName: string
  roomStatus: string
  bookings: {
    id: string
    bookingName: string
    checkIn: string
    checkOut: string
    status: BookingStatus
    bookingType: BookingType
  }[]
}

export async function getCalendar(input: {
  from: string
  to: string
  guestHouseId?: string
}): Promise<CalendarRoom[]> {
  const { data, error } = await supabase.rpc('get_calendar', {
    p_from: input.from,
    p_to: input.to,
    p_guest_house_id: input.guestHouseId ?? null,
  })

  if (error) throw error

  return (
    (data ?? []) as {
      guest_house_id: string
      guest_house_name: string
      room_id: string
      room_number: string
      room_type_name: string
      room_status: string
      bookings: {
        id: string
        booking_name: string
        check_in: string
        check_out: string
        status: BookingStatus
        booking_type: BookingType
      }[]
    }[]
  ).map((row) => ({
    guestHouseId: row.guest_house_id,
    guestHouseName: row.guest_house_name,
    roomId: row.room_id,
    roomNumber: row.room_number,
    roomTypeName: row.room_type_name,
    roomStatus: row.room_status,
    bookings: (row.bookings ?? []).map((booking) => ({
      id: booking.id,
      bookingName: booking.booking_name,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      status: booking.status,
      bookingType: booking.booking_type,
    })),
  }))
}

/* --------------------------------------------------------- Repeat guests */

export type PreviousGuest = {
  bookingName: string
  bookingType: BookingType
  lastStay: string
  guests: BookingGuest[]
}

/** Past bookings are the guest master; there is no separate table (§9.3). */
export async function findPreviousGuest(contactNumber: string): Promise<PreviousGuest | null> {
  if (contactNumber.trim().length < 6) return null

  const { data, error } = await supabase.rpc('find_previous_guest', {
    p_contact_number: contactNumber.trim(),
  })

  if (error) throw error
  if (!data) return null

  const payload = data as {
    booking_name: string
    booking_type: BookingType
    last_stay: string
    guests: {
      name: string
      age: number | null
      gender: string | null
      contact_number: string | null
      id_proof_type: string | null
      id_proof_number: string | null
    }[]
  }

  return {
    bookingName: payload.booking_name,
    bookingType: payload.booking_type,
    lastStay: payload.last_stay,
    guests: (payload.guests ?? []).map((guest) => ({
      name: guest.name,
      age: guest.age,
      gender: guest.gender,
      contactNumber: guest.contact_number,
      idProofType: guest.id_proof_type,
      idProofNumber: guest.id_proof_number,
    })),
  }
}
