import { supabase } from '../supabase'
import type { BookingStatus } from '../types'

export type DashboardMovement = {
  id: string
  bookingName: string
  contactNumber: string
  status: BookingStatus
  guestHouseName: string
  roomNumbers: string[] | null
}

export type DashboardStats = {
  today: string
  counts: {
    guestHouses: number
    rooms: number
    roomsOutOfService: number
    activeBookings: number
    guestsInHouse: number
  }
  occupancy: { occupied: number; total: number; percent: number }
  todayCounts: { arrivalsDue: number; departuresDue: number; arrived: number }
  revenue: { monthTotal: number; monthLabel: string }
  arrivals: DashboardMovement[]
  departures: DashboardMovement[]
  recent: {
    id: string
    bookingName: string
    status: BookingStatus
    checkIn: string
    checkOut: string
    totalAmount: number
    createdAt: string
    guestHouseName: string
  }[]
  trend: { date: string; occupied: number }[]
}

type RawMovement = {
  id: string
  booking_name: string
  contact_number: string
  status: BookingStatus
  guest_house_name: string
  room_numbers: string[] | null
}

function toMovement(row: RawMovement): DashboardMovement {
  return {
    id: row.id,
    bookingName: row.booking_name,
    contactNumber: row.contact_number,
    status: row.status,
    guestHouseName: row.guest_house_name,
    roomNumbers: row.room_numbers,
  }
}

/*
  One round trip (ARCHITECTURE.md §9.1). The dashboard is opened constantly, and
  assembling it from eight queries would make the first screen the slowest one.
*/
export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('get_dashboard_stats')
  if (error) throw error

  const raw = data as {
    today: string
    counts: {
      guest_houses: number
      rooms: number
      rooms_out_of_service: number
      active_bookings: number
      guests_in_house: number
    }
    occupancy: { occupied: number; total: number; percent: number }
    today_counts: { arrivals_due: number; departures_due: number; arrived: number }
    revenue: { month_total: string | number; month_label: string }
    arrivals: RawMovement[]
    departures: RawMovement[]
    recent: {
      id: string
      booking_name: string
      status: BookingStatus
      check_in: string
      check_out: string
      total_amount: string | number
      created_at: string
      guest_house_name: string
    }[]
    trend: { date: string; occupied: number }[]
  }

  return {
    today: raw.today,
    counts: {
      guestHouses: raw.counts.guest_houses,
      rooms: raw.counts.rooms,
      roomsOutOfService: raw.counts.rooms_out_of_service,
      activeBookings: raw.counts.active_bookings,
      guestsInHouse: raw.counts.guests_in_house,
    },
    occupancy: raw.occupancy,
    todayCounts: {
      arrivalsDue: raw.today_counts.arrivals_due,
      departuresDue: raw.today_counts.departures_due,
      arrived: raw.today_counts.arrived,
    },
    revenue: {
      monthTotal: Number(raw.revenue.month_total),
      monthLabel: raw.revenue.month_label,
    },
    arrivals: (raw.arrivals ?? []).map(toMovement),
    departures: (raw.departures ?? []).map(toMovement),
    recent: (raw.recent ?? []).map((row) => ({
      id: row.id,
      bookingName: row.booking_name,
      status: row.status,
      checkIn: row.check_in,
      checkOut: row.check_out,
      totalAmount: Number(row.total_amount),
      createdAt: row.created_at,
      guestHouseName: row.guest_house_name,
    })),
    trend: raw.trend ?? [],
  }
}
