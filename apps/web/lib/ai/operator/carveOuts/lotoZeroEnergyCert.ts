import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { OperatorToolDef, StageResult } from '../types'
import type { ApplyContext, CarveOutApplier } from '../carveOutAppliers'

// loto_zero_energy_cert — certify a machine's hazardous energy is isolated
// (OSHA 29 CFR 1910.147(d)(6) zero-energy verification).
//
// A self-contained regulated carve-out: the `loto` sub-agent STAGES a proposal to
// certify a machine as zero-energy verified; a tenant admin (or higher) then
// approves with one tap and becomes the certifier of record, inserting a row in
// loto_zero_energy_certifications (migration 239).
//
// Unlike the permit carve-outs (which SIGN an existing row), this one CREATES the
// attestation: there is no pre-existing cert row to mutate. So `apply` inserts and
// returns prevState = { cert_id } — the only handle a rollback needs to find and
// SOFT-REVOKE exactly that row. We never hard-delete: revoking stamps
// revoked_at/revoked_by and keeps the §147 audit trail intact.
//
// Equipment is keyed by its natural TEXT equipment_id (NOT a uuid), so we validate
// "trimmed + non-empty" rather than uuid-shaped. The DB's partial unique index
// (one active cert per tenant+equipment) is the real guard against a duplicate
// active cert; the pre-checks here turn the common cases into clean, actionable
// refusals before we ever hit it.

const UNIQUE_VIOLATION = '23505'

function stageFail(error: string): StageResult {
  return { ok: false, error }
}

/** Pull the trimmed natural-key equipment_id from a payload, or '' if absent. */
function readEquipmentId(payload: Record<string, unknown>): string {
  return typeof payload.equipment_id === 'string' ? payload.equipment_id.trim() : ''
}

function requireEquipmentId(payload: Record<string, unknown>): string {
  const equipment_id = readEquipmentId(payload)
  if (!equipment_id) throw new Error('payload is missing a valid equipment_id.')
  return equipment_id
}

/** An optional free-text field, trimmed; null when blank so the column stays NULL
 *  rather than holding an empty string. */
function optionalText(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length > 0 ? s : null
}

// certify_loto_zero_energy → loto_zero_energy_cert (OSHA 1910.147(d)(6)).
export const certifyLotoZeroEnergy: OperatorToolDef = {
  agent: 'loto',
  minRole: 'member',
  scope: { kind: 'regulated', action: 'loto_zero_energy_cert' },
  definition: {
    name: 'certify_loto_zero_energy',
    description:
      'Certify that a machine\'s hazardous energy is isolated and zero-energy verified (OSHA 1910.147). This is a ' +
      'regulated, life-safety action: you do NOT apply it — it is staged for a qualified human (a tenant admin or ' +
      'owner) to approve with one tap, who becomes the certifier of record. Provide the equipment id (the natural ' +
      'equipment identifier, e.g. "EQ-123"); the equipment must exist in this tenant and not already hold an active ' +
      '(non-revoked) certification.',
    input_schema: {
      type: 'object',
      properties: {
        equipment_id: { type: 'string', description: 'The equipment identifier to certify (natural key, e.g. "EQ-123").' },
      },
      required: ['equipment_id'],
    },
  },
  async stage(input, ctx) {
    const equipment_id = readEquipmentId((input ?? {}) as Record<string, unknown>)
    if (!equipment_id) return stageFail('equipment_id is required and must be a non-empty equipment identifier.')

    const admin = supabaseAdmin()

    // The equipment must exist in THIS tenant. loto_equipment is keyed by the
    // natural text equipment_id and carries tenant_id since migration 027.
    const { data: equipment, error } = await admin
      .from('loto_equipment')
      .select('equipment_id')
      .eq('equipment_id', equipment_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (error) return stageFail(error.message)
    if (!equipment) return stageFail(`No equipment with id '${equipment_id}' exists in this tenant.`)

    // Refuse early if an active cert already exists — the same invariant the
    // partial unique index enforces, surfaced as an actionable refusal.
    const { data: existing, error: existErr } = await admin
      .from('loto_zero_energy_certifications')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('equipment_id', equipment_id)
      .is('revoked_at', null)
      .maybeSingle()
    if (existErr) return stageFail(existErr.message)
    if (existing) return stageFail(`Equipment ${equipment_id} already holds an active zero-energy certification.`)

    const summary = `Certify zero-energy isolation (LOTO, 1910.147) for equipment ${equipment_id}`
    return { ok: true, payload: { equipment_id }, summary }
  },
}

export const lotoZeroEnergyCertApplier: CarveOutApplier = {
  async apply(ctx: ApplyContext, payload, approverUserId) {
    const equipment_id = requireEquipmentId(payload)
    const admin = supabaseAdmin()

    // Pre-check: refuse a duplicate active cert before the insert. The partial
    // unique index is the authoritative guard (and the race-safe one), but
    // pre-checking turns the common case into a clear message rather than a raw
    // constraint error.
    const { data: existing, error: existErr } = await admin
      .from('loto_zero_energy_certifications')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('equipment_id', equipment_id)
      .is('revoked_at', null)
      .maybeSingle()
    if (existErr) throw new Error(existErr.message)
    if (existing) throw new Error(`Equipment ${equipment_id} already holds an active zero-energy certification.`)

    const { data: inserted, error: insErr } = await admin
      .from('loto_zero_energy_certifications')
      .insert({
        tenant_id: ctx.tenantId,
        equipment_id,
        certified_by: approverUserId,
        method: optionalText(payload.method),
        notes: optionalText(payload.notes),
      })
      .select('id')
      .single()
    if (insErr) {
      // A concurrent certification slipped in between the pre-check and the
      // insert; the partial unique index caught it. Translate to a clean message.
      if ((insErr as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new Error(`Equipment ${equipment_id} was certified by someone else before this could be applied. Re-check and re-stage.`)
      }
      throw new Error(insErr.message)
    }

    const cert_id = (inserted as { id: string }).id
    return {
      summary: `Certified zero-energy isolation for equipment ${equipment_id} (LOTO, 1910.147) — signed as the certifier of record.`,
      prevState: { cert_id },
    }
  },

  async rollback(ctx: ApplyContext, payload, prevState) {
    const equipment_id = requireEquipmentId(payload)
    const cert_id = typeof prevState.cert_id === 'string' ? prevState.cert_id : null
    if (!cert_id) throw new Error('Cannot roll back: the certification id was not recorded.')
    const admin = supabaseAdmin()

    // Soft-revoke exactly the row apply inserted. revoked_by is ctx.userId — the
    // engine runs rollback under the reversing human's ApplyContext, so that is
    // the revoker of record. The WHERE re-asserts tenant + not-yet-revoked so we
    // never double-undo or touch another tenant's row; empty result = it was
    // already revoked (or never existed).
    const { data: updated, error } = await admin
      .from('loto_zero_energy_certifications')
      .update({ revoked_at: new Date().toISOString(), revoked_by: ctx.userId })
      .eq('id', cert_id)
      .eq('tenant_id', ctx.tenantId)
      .is('revoked_at', null)
      .select('id')
    if (error) throw new Error(error.message)
    if (!updated || updated.length === 0) {
      throw new Error('The certification is no longer active; nothing to roll back.')
    }
    return { summary: `Revoked the zero-energy certification for equipment ${equipment_id} — it is no longer active.` }
  },
}
