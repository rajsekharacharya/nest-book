import { supabase } from '../supabase'
import type { BookingStatus, BookingType } from '../types'
import { imageUrlFor } from './guest-houses'

export type GuestBooking = {
  bookingName: string
  status: BookingStatus
  bookingType: BookingType
  checkIn: string
  checkOut: string
  nights: number
  totalAmount: number
  cancelled: boolean
  guestHouse: {
    name: string
    address: string
    locationUrl: string | null
    contactPerson: string
    contactPhone: string
    imageUrl: string | null
  }
  rooms: { roomNumber: string; roomType: string }[]
  guests: { name: string }[]
}

/*
  The only anonymous read path in the system (ARCHITECTURE.md §8).

  The token IS the credential, so the projection is deliberately narrow — it is
  enforced server-side in get_booking_by_token, not here. This function cannot
  widen it; a client asking for more gets nothing more.
*/
export async function getBookingByToken(token: string): Promise<GuestBooking | null> {
  const { data, error } = await supabase.rpc('get_booking_by_token', { p_token: token })

  if (error) throw error
  if (!data) return null

  const payload = data as {
    booking_name: string
    status: BookingStatus
    booking_type: BookingType
    check_in: string
    check_out: string
    nights: number
    total_amount: string | number
    cancelled: boolean
    guest_house: {
      name: string
      address: string
      location_url: string | null
      contact_person: string
      contact_phone: string
      image_path: string | null
    }
    rooms: { room_number: string; room_type: string }[]
    guests: { name: string }[]
  }

  return {
    bookingName: payload.booking_name,
    status: payload.status,
    bookingType: payload.booking_type,
    checkIn: payload.check_in,
    checkOut: payload.check_out,
    nights: payload.nights,
    totalAmount: Number(payload.total_amount),
    cancelled: payload.cancelled,
    guestHouse: {
      name: payload.guest_house.name,
      address: payload.guest_house.address,
      locationUrl: payload.guest_house.location_url,
      contactPerson: payload.guest_house.contact_person,
      contactPhone: payload.guest_house.contact_phone,
      imageUrl: imageUrlFor(payload.guest_house.image_path),
    },
    rooms: (payload.rooms ?? []).map((room) => ({
      roomNumber: room.room_number,
      roomType: room.room_type,
    })),
    guests: payload.guests ?? [],
  }
}
