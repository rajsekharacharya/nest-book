import { supabase } from '../supabase'

export type RoomType = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  /** How many rooms across all guest houses use this type. */
  roomCount: number
}

type RoomTypeRow = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  rooms: { count: number }[]
}

/*
  Unlike bookings, room_types carries an ordinary RLS write policy (admins only),
  so these go through PostgREST directly rather than a SECURITY DEFINER RPC.
  There is no cross-row invariant here that a transaction would need to protect.
*/
export async function listRoomTypes(): Promise<RoomType[]> {
  const { data, error } = await supabase
    .from('room_types')
    // An embedded aggregate rather than a second query: the count decides
    // whether deactivating is safe, so it must arrive with the row.
    .select('id, name, description, is_active, created_at, rooms(count)')
    .order('is_active', { ascending: false })
    .order('name')

  if (error) throw error

  return (data ?? []).map((row) => toRoomType(row as RoomTypeRow))
}

function toRoomType(row: RoomTypeRow): RoomType {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    roomCount: row.rooms?.[0]?.count ?? 0,
  }
}

export async function createRoomType(input: {
  name: string
  description: string
}): Promise<void> {
  const { error } = await supabase.from('room_types').insert({
    name: input.name.trim(),
    description: input.description.trim() || null,
  })
  if (error) throw error
}

export async function updateRoomType(input: {
  id: string
  name: string
  description: string
}): Promise<void> {
  const { error } = await supabase
    .from('room_types')
    .update({
      name: input.name.trim(),
      description: input.description.trim() || null,
    })
    .eq('id', input.id)
  if (error) throw error
}

/*
  Soft delete only (ARCHITECTURE.md §9.2). A hard delete is blocked by the
  ON DELETE RESTRICT on rooms.room_type_id anyway, and would break the naming of
  historical bookings even where no rooms remain.
*/
export async function setRoomTypeActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('room_types')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw error
}
