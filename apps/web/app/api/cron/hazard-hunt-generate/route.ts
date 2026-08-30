import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { isHazardHuntDueOn, type HazardHuntCadence } from '@soteria/core/hazardHunt'

// Cron: generate due Hazard Hunt inspection runs from active schedules.
//
// Each active hazard_hunt_schedules row says "run this template daily / weekly
// (on day_of_week) / monthly (on day_of_month)". When today is an occurrence and
// a run hasn't already been generated today (last_generated_on watermark), this
// creates an `inspections` run from the template — the same run the engine's UI
// creates, just on a schedule. Idempotent per day.
//
// Schedule (vercel.json): daily. Auth: Bearer CRON_SECRET OR x-internal-secret
// INTERNAL_PUSH_SECRET — the same pattern as the other crons.

export const runtime     = 'nodejs'
export const maxDuration = 60

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth     = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer   = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  return false
}

interface ScheduleRow {
  id:                       string
  tenant_id:                string
  template_id:              string
  cadence:                  HazardHuntCadence
  day_of_week:              number | null
  day_of_month:             number | null
  default_assignee_user_id: string | null
  last_generated_on:        string | null
  inspection_templates:     { version: number; name: string; active: boolean } | null
}

async function handler(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)

  const { data: schedules, error } = await admin
    .from('hazard_hunt_schedules')
    .select('id, tenant_id, template_id, cadence, day_of_week, day_of_month, default_assignee_user_id, last_generated_on, inspection_templates!inner(version, name, active)')
    .eq('active', true)
  if (error) {
    Sentry.captureException(error, { tags: { source: 'cron.hazard-hunt-generate.pick' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const generated: string[] = []
  const skipped: string[] = []

  for (const s of (schedules ?? []) as unknown as ScheduleRow[]) {
    const tmpl = s.inspection_templates
    const anchor = { dayOfWeek: s.day_of_week, dayOfMonth: s.day_of_month }
    if (!tmpl || tmpl.active === false || s.last_generated_on === today || !isHazardHuntDueOn(s.cadence, anchor, today)) {
      skipped.push(s.id)
      continue
    }

    const { data: run, error: insErr } = await admin
      .from('inspections')
      .insert({
        tenant_id:        s.tenant_id,
        template_id:      s.template_id,
        template_version: tmpl.version,
        title:            `${tmpl.name} — ${today}`,
        assignee_user_id: s.default_assignee_user_id,
        due_at:           today,
        status:           'in_progress',
        created_by:       null,
      })
      .select('id')
      .single()
    if (insErr) {
      Sentry.captureException(insErr, { tags: { source: 'cron.hazard-hunt-generate.insert' }, extra: { scheduleId: s.id } })
      skipped.push(s.id)
      continue
    }

    // Watermark so a second tick today is a no-op.
    await admin.from('hazard_hunt_schedules').update({ last_generated_on: today }).eq('id', s.id)
    generated.push(run.id as string)
  }

  return NextResponse.json({ ok: true, schedules: (schedules ?? []).length, generated, skipped })
}

export async function POST(req: Request) { return withCronLogging(req, () => handler(req)) }
export async function GET(req: Request)  { return withCronLogging(req, () => handler(req)) }
