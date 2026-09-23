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

export async function updateUserName(userId: string, fullName: string): Promise<void> {
  const { error } = await supabase.rpc('update_user_name', {
    p_user_id: userId,
    p_full_name: fullName,
  })
  if (error) throw error
}

/*
  Email and password live in auth.users, which the API cannot write, so these go
  through an edge function holding the service key. Name is a profile column and
  goes through the RPC above — hence the split.
*/
export async function updateUserCredentials(input: {
  userId: string
  email?: string
  password?: string
}): Promise<void> {
  if (!input.email && !input.password) return

  const { data, error } = await supabase.functions.invoke('update-user', {
    body: {
      user_id: input.userId,
      ...(input.email ? { email: input.email } : {}),
      ...(input.password ? { password: input.password } : {}),
    },
  })

  if (error) throw new Error(await readFunctionError(error))
  if (data?.error) throw new Error(data.error)
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

  if (error) throw new Error(await readFunctionError(error))
  if (data?.error) throw new Error(data.error)
  return data
}

/*
  An edge function's non-2xx response carries the useful message in the body;
  error.message is only ever a generic "non-2xx status code".
*/
async function readFunctionError(error: Error): Promise<string> {
  const response = (error as { context?: Response }).context
  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json()
      if (body?.error) return body.error as string
    } catch {
      /* fall through to the original message */
    }
  }
  return error.message
}
