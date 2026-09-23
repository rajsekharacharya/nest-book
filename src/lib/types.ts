export type Role = 'admin' | 'staff'

export type Profile = {
  id: string
  full_name: string | null
  role: Role
  is_active: boolean
  created_at: string
  updated_at: string
}

export type BookingStatus =
  | 'BOOKED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW'

export type BookingType = 'SELF' | 'OTHER' | 'COMBINE'

export type RoomStatus = 'ACTIVE' | 'INACTIVE'
