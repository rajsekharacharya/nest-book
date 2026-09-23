// Updates a user's email or password.
//
// Both live in auth.users, which is not writable through the API, so they need
// the service role key — held here on the server, never in a browser. The
// caller's own token is used to confirm they are an active administrator first.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'NOT_AUTHORIZED: sign in first' }, 401)
  }

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData.user) {
    return json({ error: 'NOT_AUTHORIZED: your session is not valid' }, 401)
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: profile } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (!profile || profile.role !== 'admin' || !profile.is_active) {
    return json({ error: 'NOT_AUTHORIZED: only an administrator can edit accounts' }, 403)
  }

  let payload: { user_id?: string; email?: string; password?: string }
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'INVALID_REQUEST: body must be JSON' }, 400)
  }

  const userId = (payload.user_id ?? '').trim()
  if (!userId) return json({ error: 'INVALID_REQUEST: user_id is required' }, 400)

  const attributes: { email?: string; password?: string; email_confirm?: boolean } = {}

  if (payload.email !== undefined) {
    const email = payload.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'INVALID_REQUEST: enter a valid email address' }, 400)
    }
    attributes.email = email
    // Confirmed immediately: with no SMTP configured, a pending confirmation
    // would lock the user out of an address they can no longer verify.
    attributes.email_confirm = true
  }

  if (payload.password !== undefined) {
    if (payload.password.length < 8) {
      return json({ error: 'INVALID_REQUEST: password must be at least 8 characters' }, 400)
    }
    attributes.password = payload.password
  }

  if (Object.keys(attributes).length === 0) {
    return json({ error: 'INVALID_REQUEST: nothing to update' }, 400)
  }

  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
    userId,
    attributes,
  )

  if (updateError || !updated.user) {
    const message = updateError?.message ?? 'could not update the account'
    const taken = /already|registered|exists/i.test(message)
    return json(
      { error: taken ? 'INVALID_REQUEST: another account already uses that email' : `INVALID_REQUEST: ${message}` },
      taken ? 409 : 400,
    )
  }

  return json({ id: updated.user.id, email: updated.user.email })
})
