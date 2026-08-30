import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { OperatorToolDef, StageResult } from '../types'
import type { ApplyContext, CarveOutApplier } from '../carveOutAppliers'

// osha_300a_cert — certify the OSHA 1904.32 300A annual summary.
//
// A self-contained regulated carve-out: the `osha` sub-agent STAGES a proposal
// to certify a posted-ready 300A annual summary; a company executive (owner or
// higher — 1904.32(b)(4) requires a company executive's signature) then approves
// with one tap and becomes the certifying signer of record.
//
// A 300A is keyed by (establishment_id, year) — the unique key on
// osha_annual_summaries (migration 065). It is the regulatory document posted
// publicly Feb 1 – Apr 30, so certification LOCKS it: once certified_at +
// certified_by are set, the form is frozen. This mirrors the certify half of the
// POST /api/osha/300a route, but as a guarded UPDATE (the route upserts): the
// summary row must already exist and be uncertified to be certifiable, which
// keeps apply's inverse — clearing the cert stamps — exact and total.

const YEAR_MIN = 2000
const YEAR_MAX = 2100

function stageFail(error: string): StageResult {
  return { ok: false, error }
}

interface SummaryKey {
  establishment_id: string
  year: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pull a valid (establishment_id, year) key from a payload, or null if absent. */
function readSummaryKey(payload: Record<string, unknown>): SummaryKey | null {
  const establishment_id = typeof payload.establishment_id === 'string' ? payload.establishment_id.trim() : ''
  const year = typeof payload.year === 'number' ? payload.year : NaN
  if (!UUID_RE.test(establishment_id)) return null
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) return null
  return { establishment_id, year }
}

function requireSummaryKey(payload: Record<string, unknown>): SummaryKey {
  const key = readSummaryKey(payload)
  if (!key) throw new Error('payload is missing a valid establishment_id + year.')
  return key
}

/** The certifying executive's typed name for the 300A signature block. Prefer the
 *  approver's profile name, fall back to email — never blank, since the form's
 *  signature line is a regulatory field. */
async function certifierDisplayName(approverUserId: string): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('profiles')
    .select('full_name, email')
    .eq('id', approverUserId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const profile = (data ?? null) as { full_name: string | null; email: string | null } | null
  return profile?.full_name?.trim() || profile?.email?.trim() || 'Authorized executive'
}

// certify_osha_300a → osha_300a_cert (OSHA 1904.32).
export const certifyOsha300a: OperatorToolDef = {
  agent: 'osha',
  // OSHA recordkeeping is an executive domain (the agent's read tool is already
  // admin-gated). A line member should not even initiate a 300A certification —
  // staging requires admin; the engine still requires OWNER approval to apply.
  minRole: 'admin',
  scope: { kind: 'regulated', action: 'osha_300a_cert' },
  definition: {
    name: 'certify_osha_300a',
    description:
      'Certify the OSHA 300A annual summary for an establishment + year so it can be posted. This is a regulated ' +
      'action: you do NOT apply it — OSHA 1904.32 requires a COMPANY EXECUTIVE to sign, so it is staged for a ' +
      'tenant owner to approve with one tap, who becomes the certifying signer of record. The 300A must already ' +
      'exist (generate/lock it first) and not already be certified. Provide the establishment id and the year.',
    input_schema: {
      type: 'object',
      properties: {
        establishment_id: { type: 'string', description: 'The OSHA establishment id (uuid) the 300A belongs to.' },
        year: { type: 'integer', description: 'The calendar year of the 300A annual summary (e.g. 2025).' },
      },
      required: ['establishment_id', 'year'],
    },
  },
  async stage(input, ctx) {
    const raw = (input ?? {}) as Record<string, unknown>
    const key = readSummaryKey(raw)
    if (!key) return stageFail('establishment_id (uuid) and a valid year are both required.')

    // One tenant-scoped read gives us the cert state + the establishment name for
    // the summary line. PostgREST embeds the parent under the FK relationship name
    // (establishment_id → osha_establishments).
    const { data: summary, error } = await supabaseAdmin()
      .from('osha_annual_summaries')
      .select('id, certified_at, osha_establishments:establishment_id ( establishment_name )')
      .eq('tenant_id', ctx.tenantId)
      .eq('establishment_id', key.establishment_id)
      .eq('year', key.year)
      .maybeSingle()
    if (error) return stageFail(error.message)
    if (!summary) return stageFail(`No 300A annual summary exists for that establishment and ${key.year}. Generate and lock it first.`)
    if (summary.certified_at) return stageFail(`The ${key.year} 300A for this establishment is already certified.`)

    const establishment = (summary.osha_establishments ?? null) as unknown as { establishment_name: string | null } | null
    const name = establishment?.establishment_name?.trim() || 'this establishment'
    const summaryLine = `Certify the OSHA 300A annual summary for ${name} ${key.year}`
    return { ok: true, payload: { establishment_id: key.establishment_id, year: key.year }, summary: summaryLine }
  },
}

export const osha300aCertApplier: CarveOutApplier = {
  async apply(ctx: ApplyContext, payload, approverUserId) {
    const key = requireSummaryKey(payload)
    const admin = supabaseAdmin()

    const { data: summary, error } = await admin
      .from('osha_annual_summaries')
      .select('id, year, certified_at, certified_by, certified_typed_name, osha_establishments:establishment_id ( establishment_name )')
      .eq('tenant_id', ctx.tenantId)
      .eq('establishment_id', key.establishment_id)
      .eq('year', key.year)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!summary) throw new Error('300A annual summary not found in this tenant.')
    if (summary.certified_at) throw new Error(`The ${key.year} 300A is already certified.`)

    const certifiedTypedName = await certifierDisplayName(approverUserId)

    // Snapshot the exact prior (uncertified) state a rollback restores. All three
    // cert fields move together to satisfy the (certified_at is null) =
    // (certified_by is null) CHECK on either edge.
    const prevState = {
      certified_by: summary.certified_by as string | null,
      certified_at: summary.certified_at as string | null,
      certified_typed_name: summary.certified_typed_name as string | null,
    }

    // Guarded update: the WHERE re-asserts uncertified + tenant so a concurrent
    // certification can't be clobbered. Empty result = a lost race; the summary's
    // live state wins and we surface a re-stage instruction.
    const { data: updated, error: upErr } = await admin
      .from('osha_annual_summaries')
      .update({
        certified_by: approverUserId,
        certified_at: new Date().toISOString(),
        certified_typed_name: certifiedTypedName,
      })
      .eq('tenant_id', ctx.tenantId)
      .eq('establishment_id', key.establishment_id)
      .eq('year', key.year)
      .is('certified_at', null)
      .select('id, year, osha_establishments:establishment_id ( establishment_name )')
    if (upErr) throw new Error(upErr.message)
    if (!updated || updated.length === 0) {
      throw new Error('The 300A changed before it could be certified (it was certified by someone else). Re-check and re-stage.')
    }

    const establishment = (updated[0].osha_establishments ?? null) as unknown as { establishment_name: string | null } | null
    const name = establishment?.establishment_name?.trim() || 'the establishment'
    return {
      summary: `Certified the OSHA 300A annual summary for ${name} ${key.year} — signed as the certifying executive.`,
      prevState,
    }
  },

  async rollback(ctx: ApplyContext, payload) {
    const key = requireSummaryKey(payload)
    const admin = supabaseAdmin()

    // Restore the exact prior (uncertified) state: clear all three cert fields.
    // Guard on currently-certified + tenant so we never double-undo or touch
    // another tenant's row. prevState is unused — un-certifying is a full clear,
    // not a restore of a specific prior signer (an uncertified 300A has none).
    const { data: updated, error } = await admin
      .from('osha_annual_summaries')
      .update({ certified_by: null, certified_at: null, certified_typed_name: null })
      .eq('tenant_id', ctx.tenantId)
      .eq('establishment_id', key.establishment_id)
      .eq('year', key.year)
      .not('certified_at', 'is', null)
      .select('id, year, osha_establishments:establishment_id ( establishment_name )')
    if (error) throw new Error(error.message)
    if (!updated || updated.length === 0) {
      throw new Error('The 300A is no longer in a certified state; nothing to roll back.')
    }

    const establishment = (updated[0].osha_establishments ?? null) as unknown as { establishment_name: string | null } | null
    const name = establishment?.establishment_name?.trim() || 'the establishment'
    return { summary: `Rolled back the certification on the OSHA 300A for ${name} ${key.year} — it is uncertified again.` }
  },
}
