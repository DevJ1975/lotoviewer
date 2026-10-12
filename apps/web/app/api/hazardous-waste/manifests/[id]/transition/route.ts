import { NextResponse } from 'next/server'
import { validateManifestTransitionInput } from '@soteria/core/hazardousWasteManifest'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import {
  HAZARDOUS_WASTE_MODULE, UUID_RE, gateFailure, invalidInput, invalidJson, loadManifest, manifestDbError, readJsonObject,
  type RouteContext,
} from '../../_shared'

// POST /api/hazardous-waste/manifests/[id]/transition   { action, on?, note? }
//
//   ship            draft -> shipped                   on = the day the transporter accepted the waste
//   receive         shipped -> completed               on = the day the signed copy came back
//   file_exception  shipped -> exception_reported      on = the day the exception report was filed
//   cancel          draft or shipped -> cancelled
//
// The manifest and its containers change together or not at all (hw_transition_shipment,
// migration 317). Repeating a move on the same date is not an error.

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, HAZARDOUS_WASTE_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  const on = textOrNull(body.on)
  const note = textOrNull(body.note)
  const errors = validateManifestTransitionInput({ action, on, note })
  if (errors.length > 0) return invalidInput(errors)

  // A member can read every manifest but move only their own; say so, rather than the database's "not found".
  const before = await loadManifest(gate, id, 'hazardous-waste/manifests/[id]/transition read')
  if (!before.ok) return before.response
  if (!before.manifest.can_modify) {
    return NextResponse.json({ error: 'Only the person who drafted this manifest, or an admin, can change it' }, { status: 403 })
  }

  const { error } = await gate.authedClient.rpc('hw_transition_shipment', { p_id: id, p_action: action, p_on: on, p_note: note })
  if (error) return manifestDbError(error, 'hazardous-waste/manifests/[id]/transition/POST')

  const after = await loadManifest(gate, id, 'hazardous-waste/manifests/[id]/transition/POST read')
  if (!after.ok) return after.response
  return NextResponse.json({ manifest: after.manifest })
}
