import { supabase } from '../supabase'

const IMAGE_BUCKET = 'guest-house-images'

export type GuestHouse = {
  id: string
  name: string
  address: string
  totalRooms: number
  googleLocationUrl: string | null
  contactPersonName: string
  contactPersonPhone: string
  imagePath: string | null
  /** Derived from imagePath — the bucket is public-read. */
  imageUrl: string | null
  isActive: boolean
  createdAt: string
  /** Rooms actually configured, against totalRooms (ARCHITECTURE.md §6.1). */
  roomCount: number
}

type GuestHouseRow = {
  id: string
  name: string
  address: string
  total_rooms: number
  google_location_url: string | null
  contact_person_name: string
  contact_person_phone: string
  image_path: string | null
  is_active: boolean
  created_at: string
  rooms: { count: number }[]
}

/*
  The column stores a storage path, never a URL: a URL embeds the project
  hostname and would break on a project move or custom domain.
*/
export function imageUrlFor(path: string | null): string | null {
  if (!path) return null
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

function toGuestHouse(row: GuestHouseRow): GuestHouse {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    totalRooms: row.total_rooms,
    googleLocationUrl: row.google_location_url,
    contactPersonName: row.contact_person_name,
    contactPersonPhone: row.contact_person_phone,
    imagePath: row.image_path,
    imageUrl: imageUrlFor(row.image_path),
    isActive: row.is_active,
    createdAt: row.created_at,
    roomCount: row.rooms?.[0]?.count ?? 0,
  }
}

const COLUMNS =
  'id, name, address, total_rooms, google_location_url, contact_person_name, ' +
  'contact_person_phone, image_path, is_active, created_at, rooms(count)'

export async function listGuestHouses(): Promise<GuestHouse[]> {
  const { data, error } = await supabase
    .from('guest_houses')
    .select(COLUMNS)
    .order('is_active', { ascending: false })
    .order('name')

  if (error) throw error
  return (data ?? []).map((row) => toGuestHouse(row as unknown as GuestHouseRow))
}

export async function getGuestHouse(id: string): Promise<GuestHouse> {
  const { data, error } = await supabase
    .from('guest_houses')
    .select(COLUMNS)
    .eq('id', id)
    .single()

  if (error) throw error
  return toGuestHouse(data as unknown as GuestHouseRow)
}

export type GuestHouseInput = {
  name: string
  address: string
  totalRooms: number
  googleLocationUrl: string
  contactPersonName: string
  contactPersonPhone: string
  imagePath?: string | null
}

function toRow(input: GuestHouseInput) {
  return {
    name: input.name.trim(),
    address: input.address.trim(),
    total_rooms: input.totalRooms,
    google_location_url: input.googleLocationUrl.trim() || null,
    contact_person_name: input.contactPersonName.trim(),
    contact_person_phone: input.contactPersonPhone.trim(),
    ...(input.imagePath !== undefined ? { image_path: input.imagePath } : {}),
  }
}

export async function createGuestHouse(input: GuestHouseInput): Promise<string> {
  const { data, error } = await supabase
    .from('guest_houses')
    .insert(toRow(input))
    .select('id')
    .single()

  if (error) throw error
  return (data as { id: string }).id
}

/*
  Lowering total_rooms below the rooms already configured is refused by a
  trigger (§6.1) rather than silently accepted, so the guest house can never sit
  in a state it could not have been created in.
*/
export async function updateGuestHouse(id: string, input: GuestHouseInput): Promise<void> {
  const { error } = await supabase.from('guest_houses').update(toRow(input)).eq('id', id)
  if (error) throw error
}

export async function setGuestHouseActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('guest_houses')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw error
}

/*
  Refused by the RPC once any booking references the guest house — deleting it
  would orphan that history. Deactivation is the route for a property that has
  been used.
*/
export async function deleteGuestHouse(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_guest_house', { p_guest_house_id: id })
  if (error) throw error
}

/* ------------------------------------------------------------------ Images */

/*
  Uploaded under a random name rather than the original filename: two properties
  photographed from the same phone routinely produce the same "IMG_0042.jpg",
  and the second upload would overwrite the first.
*/
export async function uploadGuestHouseImage(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${crypto.randomUUID()}.${extension}`

  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })

  if (error) throw error
  return path
}

/*
  Best-effort: a leftover image costs a few kilobytes, whereas failing the whole
  save because cleanup failed would lose the operator's actual work.
*/
export async function removeGuestHouseImage(path: string | null): Promise<void> {
  if (!path) return
  await supabase.storage.from(IMAGE_BUCKET).remove([path])
}
