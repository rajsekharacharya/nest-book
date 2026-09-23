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

/*
  Account creation needs the service role key, so it happens in an edge function
  where that key stays server-side. The function re-checks that the caller is an
  active administrator before creating anything.
*/
export async function createUser(input: {
  email: string
  password: string
  fullName: string
  role: Role
}): Promise<{ id: string; email: string; warning?: string }> {
  const { data, error } = await supabase.functions.invoke('create-user', {
    body: {
      email: input.email,
      password: input.password,
      full_name: input.fullName,
      role: input.role,
    },
  })

  if (error) {
    // Non-2xx responses carry the useful message in the body, not in error.message.
    let message = error.message
    const response = (error as { context?: Response }).context
    if (response && typeof response.json === 'function') {
      try {
        const body = await response.json()
        if (body?.error) message = body.error
      } catch {
        /* keep the original message */
      }
    }
    throw new Error(message)
  }

  if (data?.error) throw new Error(data.error)
  return data
}
