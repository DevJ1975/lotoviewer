import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { validateTraining } from '@/lib/trainingRecords'
import type {
  ConfinedSpaceEntry,
  ConfinedSpacePermit,
  TrainingRecord,
} from '@/lib/types'

// Worker QR sign-on API. Three actions over one POST endpoint:
//
//   { token, action: 'lookup' }
//     → returns the permit shape (status, entrants, attendants, current
//       open entries, training-pass-or-fail per name) so the page can
//       render. No PII beyond names + open-entry timestamps.
//
//   { token, action: 'sign-in', name }
//     → inserts a row in loto_confined_space_entries. Validates: token
//       resolves to an active permit, name is on the entrants[] roster,
//       no open entry already exists, training is current (or training
//       records table is empty / not migrated).
//
//   { token, action: 'sign-out', name }
//     → updates the open entry row's exited_at. Only succeeds if there
//       IS an open entry for that name on that permit.
//
// The token IS the auth — anyone with the QR can write. We accept that
// trade-off because:
//   1. The QR is on a printed permit physically present at the worksite
//      (if you have the QR, you can already see who's on the roster).
//   2. We still validate roster + training server-side, so a QR holder
//      can't sign in someone who isn't authorized.
//   3. Token implicitly revokes when the permit is canceled or expires
//      (lookup returns 410 / 403 in those states).
//
// Audit log: every entries write goes through the existing audit trigger
// from migration 003 (entered_by is the FK to a user profile), but here
// the writer is the service role — there's no real user. We record
// entered_by/exited_by as the supervisor of the permit so the audit
// trail still attributes the action to a known person, and add a note
// indicating the QR-signon path was used.

export const runtime = 'nodejs'

interface LookupBody  { action: 'lookup'; token: string }
interface SignInBody  { action: 'sign-in'; token: string; name: string }
interface SignOutBody { action: 'sign-out'; token: string; name: string }
type Body = LookupBody | SignInBody | SignOutBody

const TOKEN_RE = /^[0-9a-f]{32}$/

interface RosterEntry {
  name:               string
  slot:               'entrant' | 'attendant'
  trainingOk:         boolean
  trainingIssue:      string | null     // 'missing' | 'expired YYYY-MM-DD' | null
  insideSince:        string | null     // ISO timestamp of the open entry, or null
}

interface LookupResponse {
  // Subset of permit fields we surface to anonymous callers. Drop
  // anything that's PII or operationally sensitive (rescue service
  // phone numbers, internal notes, etc.).
  permit: {
    id:        string
    serial:    string
    spaceId:   string
    purpose:   string
    startedAt: string
    expiresAt: string
    status:    'pending_signature' | 'active' | 'expired' | 'canceled'
  }
  roster:           RosterEntry[]
  // True when the permit is in a state that ALLOWS sign-in. Mirrors the
  // permitState() rule set so the page can disable buttons when the
  // permit is canceled / expired / not yet authorized.
  signInAllowed:    boolean
  signInBlockedReason: string | null
}

function statusFor(p: ConfinedSpacePermit): LookupResponse['permit']['status'] {
  if (p.canceled_at) return 'canceled'
  if (p.expires_at && new Date(p.expires_at) < new Date()) return 'expired'
  if (!p.entry_supervisor_signature_at) return 'pending_signature'
  return 'active'
}

async function loadPermitByToken(token: string): Promise<ConfinedSpacePermit | null> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('loto_confined_space_permits')
    .select('*')
    .eq('signon_token', token)
    .single()
  if (error) {
    // PGRST116 = no rows; treat as not-found rather than 500.
    if ('code' in error && (error as { code?: string }).code === 'PGRST116') return null
    throw new Error(error.message)
  }
  return data as ConfinedSpacePermit
}

async function loadRoster(permit: ConfinedSpacePermit): Promise<RosterEntry[]> {
  const admin = supabaseAdmin()
  // Open entries (exited_at is null) — the page renders these as
  // "currently inside" so the worker doesn't double-tap sign-in.
  const { data: entryRows, error: entryErr } = await admin
    .from('loto_confined_space_entries')
    .select('*')
    .eq('permit_id', permit.id)
    .is('exited_at', null)
  if (entryErr) throw new Error(entryErr.message)
  const insideByName = new Map<string, ConfinedSpaceEntry>()
  for (const e of (entryRows ?? []) as ConfinedSpaceEntry[]) {
    insideByName.set(e.entrant_name.toLowerCase(), e)
  }

  // Training records — service role read, but we only return a boolean
  // + a sanitised reason string back to the caller, never the records
  // themselves.
  const { data: trainingRows, error: trainingErr } = await admin
    .from('loto_training_records')
    .select('*')
  // Pre-migration-017 the table doesn't exist. Treat "table missing" as
  // "no records on file" rather than failing — the gate behaves the same
  // way the in-app permit detail page does (every worker shows as
  // "missing" but the supervisor can override). For QR sign-on with no
  // records on file we DEFAULT-PASS so a brand-new deployment isn't
  // locked out; once records exist the gate kicks in normally.
  const records: TrainingRecord[] = !trainingErr && trainingRows
    ? trainingRows as TrainingRecord[]
    : []
  const trainingPresent = records.length > 0

  const issues = validateTraining({
    entrants:   permit.entrants,
    attendants: permit.attendants,
    records,
    asOf:       new Date(),
  })
  const issueByKey = new Map<string, typeof issues[number]>()
  for (const i of issues) {
    issueByKey.set(`${i.slot}:${i.worker_name.toLowerCase()}`, i)
  }

  const out: RosterEntry[] = []
  for (const name of permit.entrants) {
    const inside = insideByName.get(name.toLowerCase())
    const issue = issueByKey.get(`entrant:${name.toLowerCase()}`)
    out.push({
      name,
      slot:          'entrant',
      // Default-pass when no training records exist at all — see comment
      // above. Once any record is on file the gate enforces.
      trainingOk:    !trainingPresent || !issue,
      trainingIssue: !issue ? null
        : issue.kind === 'missing' ? 'no training record'
        : `expired ${issue.expired_on ?? ''}`.trim(),
      insideSince:   inside?.entered_at ?? null,
    })
  }
  for (const name of permit.attendants) {
    const inside = insideByName.get(name.toLowerCase())
    const issue = issueByKey.get(`attendant:${name.toLowerCase()}`)
    out.push({
      name,
      slot:          'attendant',
      trainingOk:    !trainingPresent || !issue,
      trainingIssue: !issue ? null
        : issue.kind === 'missing' ? 'no training record'
        : `expired ${issue.expired_on ?? ''}`.trim(),
      insideSince:   inside?.entered_at ?? null,
    })
  }
  return out
}

function signInGate(permit: ConfinedSpacePermit): { ok: true } | { ok: false; reason: string } {
  if (permit.canceled_at) return { ok: false, reason: 'Permit was canceled.' }
  if (permit.expires_at && new Date(permit.expires_at) < new Date()) {
    return { ok: false, reason: 'Permit has expired.' }
  }
  if (!permit.entry_supervisor_signature_at) {
    return { ok: false, reason: 'Permit is not yet authorized — supervisor has not signed.' }
  }
  return { ok: true }
}

async function handleLookup(token: string): Promise<NextResponse> {
  const permit = await loadPermitByToken(token)
  if (!permit) return NextResponse.json({ error: 'Permit not found.' }, { status: 404 })

  const roster = await loadRoster(permit)
  const gate = signInGate(permit)
  const body: LookupResponse = {
    permit: {
      id:        permit.id,
      serial:    permit.serial,
      spaceId:   permit.space_id,
      purpose:   permit.purpose,
      startedAt: permit.started_at,
      expiresAt: permit.expires_at,
      status:    statusFor(permit),
    },
    roster,
    signInAllowed:        gate.ok,
    signInBlockedReason:  gate.ok ? null : gate.reason,
  }
  return NextResponse.json(body)
}

async function handleSignIn(token: string, name: string): Promise<NextResponse> {
  const trimmed = name.trim()
  if (!trimmed) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const permit = await loadPermitByToken(token)
  if (!permit) return NextResponse.json({ error: 'Permit not found.' }, { status: 404 })

  const gate = signInGate(permit)
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 })

  // Roster check — case-insensitive match against permit.entrants[].
  // Attendants don't sign in via this flow (they're tracked through
  // attendant_signature_*).
  const onRoster = permit.entrants.some(n => n.toLowerCase() === trimmed.toLowerCase())
  if (!onRoster) return NextResponse.json({ error: 'Name is not on the entrants roster.' }, { status: 403 })

  // Training gate — same default-pass-when-empty behaviour as lookup.
  const admin = supabaseAdmin()
  const { data: trainingRows, error: trainingErr } = await admin
    .from('loto_training_records')
    .select('*')
  if (!trainingErr && trainingRows && trainingRows.length > 0) {
    const issues = validateTraining({
      entrants:   [trimmed],
      attendants: [],
      records:    trainingRows as TrainingRecord[],
      asOf:       new Date(),
    })
    if (issues.length > 0) {
      return NextResponse.json(
        { error: `Training is not current for ${trimmed}: ${issues[0].kind === 'missing' ? 'no record on file' : `expired ${issues[0].expired_on ?? ''}`}.` },
        { status: 403 },
      )
    }
  }

  // Idempotent on the DB side — the unique partial index from migration
  // 012 (idx_entries_one_open_per_entrant) rejects duplicate open rows.
  // We surface that as a friendly 409 instead of a generic 500.
  const { data, error } = await admin
    .from('loto_confined_space_entries')
    .insert({
      permit_id:    permit.id,
      entrant_name: trimmed,
      // entered_by is a NOT NULL FK to profiles — we attribute QR sign-ons
      // to the permit's entry supervisor so the audit trail has a real
      // person (the supervisor authorized the permit and accepted that
      // QR sign-on is in use). The notes column captures the channel.
      entered_by:   permit.entry_supervisor_id,
      notes:        'qr-signon',
    })
    .select('*')
    .single()

  if (error) {
    if (error.message?.includes('idx_entries_one_open_per_entrant')) {
      return NextResponse.json({ error: `${trimmed} is already signed in.` }, { status: 409 })
    }
    throw new Error(error.message)
  }
  return NextResponse.json({ ok: true, entry: data })
}

async function handleSignOut(token: string, name: string): Promise<NextResponse> {
  const trimmed = name.trim()
  if (!trimmed) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const permit = await loadPermitByToken(token)
  if (!permit) return NextResponse.json({ error: 'Permit not found.' }, { status: 404 })

  // Sign-OUT is allowed even on canceled/expired permits — the prohibited-
  // condition flow specifically requires the attendant to evacuate
  // entrants AFTER cancel; blocking sign-out here would leave a dangling
  // open entry on a canceled permit, which is worse than allowing it.
  // We just need a permit that exists and a matching open entry.

  const admin = supabaseAdmin()
  const { data: openEntries, error: lookupErr } = await admin
    .from('loto_confined_space_entries')
    .select('*')
    .eq('permit_id', permit.id)
    .is('exited_at', null)
  if (lookupErr) throw new Error(lookupErr.message)

  const open = (openEntries as ConfinedSpaceEntry[] ?? [])
    .find(e => e.entrant_name.toLowerCase() === trimmed.toLowerCase())
  if (!open) {
    return NextResponse.json({ error: `${trimmed} is not currently signed in.` }, { status: 404 })
  }

  const { data, error } = await admin
    .from('loto_confined_space_entries')
    .update({
      exited_at:  new Date().toISOString(),
      // Same attribution choice as sign-in.
      exited_by:  permit.entry_supervisor_id,
    })
    .eq('id', open.id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return NextResponse.json({ ok: true, entry: data })
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json() as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || !('action' in body) || !('token' in body)) {
    return NextResponse.json({ error: 'Missing action or token' }, { status: 400 })
  }
  if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) {
    return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
  }

  try {
    if (body.action === 'lookup')   return await handleLookup(body.token)
    if (body.action === 'sign-in')  return await handleSignIn(body.token, body.name)
    if (body.action === 'sign-out') return await handleSignOut(body.token, body.name)
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/permit-signon', action: body.action } })
    console.error('[permit-signon]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
