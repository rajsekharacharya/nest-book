import { supabase } from '../supabase'
import type { RoomStatus } from '../types'

export type Room = {
  id: string
  guestHouseId: string
  roomTypeId: string
  roomTypeName: string
  roomNumber: string
  ratePerNight: number
  capacity: number
  status: RoomStatus
}

type RoomRow = {
  id: string
  guest_house_id: string
  room_type_id: string
  room_number: string
  rate_per_night: string | number
  capacity: number
  status: RoomStatus
  room_types: { name: string } | null
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    guestHouseId: row.guest_house_id,
    roomTypeId: row.room_type_id,
    roomTypeName: row.room_types?.name ?? 'Unknown',
    roomNumber: row.room_number,
    // numeric(10,2) arrives as a string from PostgREST — JS numbers cannot
    // represent arbitrary precision, so the wire format is text.
    ratePerNight: Number(row.rate_per_night),
    capacity: row.capacity,
    status: row.status,
  }
}

export async function listRooms(guestHouseId: string): Promise<Room[]> {
  const { data, error } = await supabase
    .from('rooms')
    .select(
      'id, guest_house_id, room_type_id, room_number, rate_per_night, capacity, status, room_types(name)',
    )
    .eq('guest_house_id', guestHouseId)
    .order('room_number')

  if (error) throw error
  return (data ?? []).map((row) => toRoom(row as unknown as RoomRow))
}

export type BulkCreateResult = {
  created: number
  numbers: string[]
  configured: number
  declared: number
}

/*
  One transaction for the whole batch. The room-cap trigger (§6.1) fires per
  row, so inserting these individually could leave a guest house half-filled
  before failing — and the RPC reports every duplicate at once rather than
  making the operator resubmit to find the next one.
*/
export async function createRoomsBulk(input: {
  guestHouseId: string
  roomTypeId: string
  roomNumbers: string[]
  rate: number
  capacity: number
}): Promise<BulkCreateResult> {
  const { data, error } = await supabase.rpc('create_rooms_bulk', {
    p_guest_house_id: input.guestHouseId,
    p_room_type_id: input.roomTypeId,
    p_room_numbers: input.roomNumbers,
    p_rate: input.rate,
    p_capacity: input.capacity,
  })

  if (error) throw error
  return data as BulkCreateResult
}

export async function updateRoom(input: {
  id: string
  roomTypeId: string
  roomNumber: string
  rate: number
  capacity: number
}): Promise<void> {
  const { error } = await supabase.rpc('update_room', {
    p_room_id: input.id,
    p_room_type_id: input.roomTypeId,
    p_room_number: input.roomNumber,
    p_rate: input.rate,
    p_capacity: input.capacity,
  })
  if (error) throw error
}

/*
  Refused while current or future bookings use the room (§6.8): taking it out of
  service would hide a real clash, since it stops appearing in new bookings but
  silently keeps its existing ones.
*/
export async function setRoomStatus(id: string, status: RoomStatus): Promise<void> {
  const { error } = await supabase.rpc('set_room_status', { p_room_id: id, p_status: status })
  if (error) throw error
}

/** Refused once the room appears on any booking — deactivate those instead. */
export async function deleteRoom(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_room', { p_room_id: id })
  if (error) throw error
}
