import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireSuperadmin } from '@/lib/auth/superadmin'

// POST   /api/support/tickets/[id]/resolve  → set resolved_at = now()
// DELETE /api/support/tickets/[id]/resolve  → clear resolved_at (re-open)
//
// Marking resolved is the only mutation we expose on tickets; all other
// fields are immutable post-creation. The conversation transcript
// remains intact so an audit trail survives.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return setResolved(req, ctx, true)
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return setResolved(req, ctx, false)
}

async function setResolved(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
  resolved: boolean,
) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  // Refuse to mutate archived tickets — those are cold storage.
  // (No application path archives a ticket; the archive cron is the
  // only writer of archived_at, so this gate doesn't fire in normal
  // use. It exists so a future endpoint that scopes the row by id
  // alone can't accidentally re-open something that's been archived.)
  const { data: existing } = await admin
    .from('support_tickets')
    .select('id, archived_at')
    .eq('id', id)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  if (existing.archived_at) {
    return NextResponse.json({ error: 'Ticket is archived (read-only).' }, { status: 409 })
  }

  const { data, error } = await admin
    .from('support_tickets')
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id, resolved_at')
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: { route: '/api/support/tickets/[id]/resolve', stage: 'update' },
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  return NextResponse.json({ id: data.id, resolved_at: data.resolved_at })
}
