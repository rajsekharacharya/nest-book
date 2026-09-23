// Creates a staff or admin account.
//
// Account creation needs the service role key, which grants unrestricted access
// to the database and must never reach a browser. This function runs on
// Supabase's servers where that key stays private: it verifies the caller is an
// active administrator using their own token, and only then uses the privileged
// client to create the account.

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

  // Caller-scoped client: resolves who is asking, under their own permissions.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData.user) {
    return json({ error: 'NOT_AUTHORIZED: your session is not valid' }, 401)
  }

  // Privileged client, used only after the caller is confirmed to be an admin.
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: profile } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (!profile || profile.role !== 'admin' || !profile.is_active) {
    return json({ error: 'NOT_AUTHORIZED: only an administrator can create users' }, 403)
  }

  let payload: { email?: string; password?: string; full_name?: string; role?: string }
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'INVALID_REQUEST: body must be JSON' }, 400)
  }

  const email = (payload.email ?? '').trim().toLowerCase()
  const password = payload.password ?? ''
  const fullName = (payload.full_name ?? '').trim()
  const role = payload.role === 'admin' ? 'admin' : 'staff'

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'INVALID_REQUEST: enter a valid email address' }, 400)
  }
  if (password.length < 8) {
    return json({ error: 'INVALID_REQUEST: password must be at least 8 characters' }, 400)
  }

  // Confirmed on creation: there is no SMTP configured, so an unconfirmed
  // account could never complete a confirmation email and would be unusable.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
  })

  if (createError || !created.user) {
    const message = createError?.message ?? 'could not create the account'
    const alreadyExists = /already|registered|exists/i.test(message)
    return json(
      { error: alreadyExists ? 'INVALID_REQUEST: an account with that email already exists' : `INVALID_REQUEST: ${message}` },
      alreadyExists ? 409 : 400,
    )
  }

  // The signup trigger creates the profile as staff; apply the chosen role and
  // name on top. A failure here leaves a usable staff account rather than a
  // half-created one, so it is reported but not treated as fatal.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ role, full_name: fullName || null })
    .eq('id', created.user.id)

  return json({
    id: created.user.id,
    email: created.user.email,
    role: profileError ? 'staff' : role,
    warning: profileError ? 'Account created, but the role could not be set.' : undefined,
  })
})
