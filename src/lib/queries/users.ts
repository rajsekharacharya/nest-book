import { supabase } from '../supabase'
import type { Role } from '../types'

export type UserRow = {
  id: string
  email: string
  full_name: string | null
  role: Role
  is_active: boolean
  created_at: string
  last_sign_in_at: string | null
  is_self: boolean
}

export async function listUsers(): Promise<UserRow[]> {
  const { data, error } = await supabase.rpc('list_users')
  if (error) throw error
  return (data ?? []) as UserRow[]
}

export async function updateUserAccess(input: {
  userId: string
  role?: Role
  isActive?: boolean
}): Promise<void> {
  const { error } = await supabase.rpc('update_user_access', {
    p_user_id: input.userId,
    p_role: input.role ?? null,
    p_is_active: input.isActive ?? null,
  })
  if (error) throw error
}

export async function updateMyName(fullName: string): Promise<void> {
  const { error } = await supabase.rpc('update_my_name', { p_full_name: fullName })
  if (error) throw error
}
