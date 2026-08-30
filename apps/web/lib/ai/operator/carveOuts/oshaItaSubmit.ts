import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { submitToItaForEstablishment } from '@/lib/oshaItaSubmit'
import type { OperatorToolDef, StageResult } from '../types'
import type { CarveOutApplier } from '../carveOutAppliers'

// osha_ita_submit — electronically submit a certified 300A to OSHA's Injury
// Tracking Application (ITA). This is the ONE irreversible carve-out: a
// submission to OSHA cannot be un-sent, so CARVE_OUT_ACTIONS marks it
// reversible:false and the engine refuses any rollback edge.
//
// A self-contained regulated carve-out: the `osha` sub-agent STAGES the
// submission of a certified-but-unsubmitted 300A; an owner (the executive of
// record) then approves with one tap and the engine applies it.
//
// REUSE, never reinvent: the real submission already lives in
// lib/oshaItaSubmit#submitToItaForEstablishment — the same helper the
// admin-triggered POST /api/osha/300a/submit-to-ita route and the daily
// auto-submit cron route through. It loads the establishment + certified
// summary, builds the ITA payload, performs the outbound submission, and
// persists submitted_to_ita_at / ita_submission_id / ita_response_json /
// submitted_by. apply delegates to it wholesale and records the approver as
// submitted_by. We do NOT open a new HTTP call to OSHA or invent credentials.
//
// Note on the live vs stub boundary: the helper only POSTs to OSHA when
// OSHA_ITA_BASE_URL is configured; absent that it returns ok:'stub' WITHOUT
// persisting (no row is marked submitted). apply treats stub — and every
// non-success — as a hard failure, so a deploy that is not wired to OSHA can
// never report a phantom submission.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function stageFail(error: string): StageResult {
  return { ok: false, error }
}

/** Trim a free-text field for inclusion in the one-line approval summary. */
function clip(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function asUuid(value: unknown): string {
  return typeof value === 'string' && UUID_RE.test(value) ? value : ''
}

function requireSubmitKey(payload: Record<string, unknown>): { establishment_id: string; year: number } {
  const establishment_id = asUuid(payload.establishment_id)
  const year = typeof payload.year === 'number' ? payload.year : NaN
  if (!establishment_id) throw new Error('payload is missing a valid establishment_id.')
  if (!Number.isInteger(year)) throw new Error('payload is missing a valid year.')
  return { establishment_id, year }
}

// submit_osha_ita → osha_ita_submit. Keyed to the certified 300A by
// (establishment_id, year) — the same key submitToItaForEstablishment loads on,
// and the unique key of osha_annual_summaries.
export const submitOshaIta: OperatorToolDef = {
  agent: 'osha',
  // Federal recordkeeping — and this one is irreversible. Initiating it requires
  // admin (the engine still requires OWNER approval to apply); a line member can
  // never even stage a submission to OSHA.
  minRole: 'admin',
  scope: { kind: 'regulated', action: 'osha_ita_submit' },
  definition: {
    name: 'submit_osha_ita',
    description:
      "Electronically submit a certified OSHA 300A annual summary to OSHA's Injury Tracking Application (ITA). " +
      'This is a regulated, IRREVERSIBLE action: you do NOT apply it — it is staged for a company owner to approve ' +
      'with one tap, and once sent it CANNOT be un-sent. The 300A must already be certified by a company executive ' +
      'and not already submitted. Provide the establishment id and the reporting year.',
    input_schema: {
      type: 'object',
      properties: {
        establishment_id: { type: 'string', description: 'The OSHA establishment id (uuid) whose 300A to submit.' },
        year: { type: 'integer', description: 'The reporting year of the 300A annual summary (e.g. 2025).' },
      },
      required: ['establishment_id', 'year'],
    },
  },
  async stage(input, ctx) {
    const establishment_id = asUuid((input as { establishment_id?: unknown })?.establishment_id)
    const yearRaw = (input as { year?: unknown })?.year
    const year = typeof yearRaw === 'number' ? yearRaw : Number(yearRaw)
    if (!establishment_id) return stageFail('establishment_id is required and must be a valid establishment id.')
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return stageFail('year is required (int 2000-2100).')

    // One tenant-scoped read of the establishment + its 300A for this year. We
    // mirror the certified / not-already-submitted preconditions the submission
    // helper enforces, so the approval card never proposes a submission the
    // apply step would reject.
    const admin = supabaseAdmin()

    const { data: est, error: estErr } = await admin
      .from('osha_establishments')
      .select('id, establishment_name')
      .eq('id', establishment_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (estErr) return stageFail(estErr.message)
    if (!est) return stageFail('No OSHA establishment with that id exists in this tenant.')

    const { data: summary, error: sErr } = await admin
      .from('osha_annual_summaries')
      .select('certified_at, submitted_to_ita_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('establishment_id', establishment_id)
      .eq('year', year)
      .maybeSingle()
    if (sErr) return stageFail(sErr.message)
    if (!summary) return stageFail(`No 300A annual summary on file for ${clip(est.establishment_name, 80)} ${year}. Certify it first.`)
    if (!summary.certified_at)
      return stageFail(`The ${year} 300A for ${clip(est.establishment_name, 80)} must be certified by a company executive before it can be submitted to OSHA.`)
    if (summary.submitted_to_ita_at)
      return stageFail(`The ${year} 300A for ${clip(est.establishment_name, 80)} was already submitted to OSHA on ${new Date(summary.submitted_to_ita_at).toLocaleDateString()}.`)

    const summaryText =
      `Submit 300A data to OSHA's ITA portal for ${clip(est.establishment_name, 80)} ${year} — final, cannot be undone`
    return { ok: true, payload: { establishment_id, year }, summary: summaryText }
  },
}

export const oshaItaSubmitApplier: CarveOutApplier = {
  async apply(ctx, payload, approverUserId) {
    const { establishment_id, year } = requireSubmitKey(payload)

    // Belt-and-suspenders no-double-submit guard, ahead of the real submission:
    // atomically CLAIM this 300A only if it is certified AND not yet submitted.
    // A 0-row result means another submitter won the race (or it was never
    // certified), so we throw rather than re-send. The helper below performs the
    // authoritative submission + persistence; this guard exists so the applier
    // itself can never trigger a duplicate outbound send under contention.
    const admin = supabaseAdmin()
    const { data: claimed, error: claimErr } = await admin
      .from('osha_annual_summaries')
      .update({ submitted_by: approverUserId })
      .eq('tenant_id', ctx.tenantId)
      .eq('establishment_id', establishment_id)
      .eq('year', year)
      .not('certified_at', 'is', null)
      .is('submitted_to_ita_at', null)
      .select('id')
    if (claimErr) throw new Error(claimErr.message)
    if (!claimed || claimed.length === 0)
      throw new Error('This 300A is not in a submittable state (uncertified, already submitted, or it changed before approval). Re-check and re-stage.')

    // Authoritative submission via the EXISTING mechanism — the same helper the
    // admin route and auto-submit cron use. It re-loads the establishment +
    // certified summary, builds the ITA payload, performs the outbound
    // submission, and stamps submitted_to_ita_at / ita_submission_id /
    // ita_response_json / submitted_by(=approver) on success.
    const result = await submitToItaForEstablishment({
      tenant_id: ctx.tenantId,
      establishment_id,
      year,
      submitted_by: approverUserId,
    })

    // Anything other than a real, persisted submission is a hard failure. In
    // particular ok:'stub' (no OSHA endpoint configured) does NOT mark the row
    // submitted — so we must not report success. The claim above only set
    // submitted_by; submitted_to_ita_at stays null, leaving the 300A submittable.
    if (result.ok !== true) {
      const reason = result.ok === 'stub'
        ? 'OSHA ITA submission is not configured on this deploy (no live endpoint).'
        : result.ok === 'dry'
          ? 'The submission ran in dry-run mode and was not sent.'
          : result.error
      throw new Error(`OSHA ITA submission did not complete: ${reason}`)
    }

    return {
      summary:
        `Submitted the ${year} 300A to OSHA's ITA portal` +
        (result.submission_id ? ` (tracking id ${result.submission_id})` : '') +
        ' — this is final and cannot be undone.',
      // No prior-state snapshot: an ITA submission is irreversible, so there is
      // nothing a rollback could restore.
      prevState: {},
    }
  },

  // Required by the CarveOutApplier interface but intentionally unreachable: the
  // engine already forbids a rollback edge for an irreversible action
  // (canTransition with reversible:false). This is belt-and-suspenders — if it
  // is ever called, fail loudly rather than pretend to undo an OSHA submission.
  async rollback() {
    throw new Error('An OSHA ITA submission cannot be undone.')
  },
}
