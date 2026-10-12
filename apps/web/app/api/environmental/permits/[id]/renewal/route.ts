import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  ENVIRONMENTAL_MODULE,
  UUID_RE,
  gateFailure,
  invalidInput,
  invalidJson,
  latestCalendarDate,
  notFound,
  readJsonObject,
  type RouteContext,
} from '@/lib/environmental/registerApi'
import { PERMIT_COLUMNS, renewalActionFrom } from '@/lib/environmental/permits'

// POST /api/environmental/permits/[id]/renewal   Admins only. Either
//   { action: 'submitted', submitted_on }   the renewal application went to the agency on
//                                            this date; the countdown stops (plan D7), or
//   { action: 'renewed', issued_on, expires_on?, renewal_application_due_on?, permit_number? }
//                                            the agency renewed it: the new term replaces
//                                            the old one and "submitted" is cleared, so the
//                                            next countdown starts from the new deadline.

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const { data: current, error: readError } = await gate.authedClient
    .from('environmental_permits')
    .select('id, issued_on, retired_at')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/permits/[id]/renewal/POST read')
  if (!current) return notFound()
  const permit = current as { issued_on: string | null; retired_at: string | null }
  if (permit.retired_at) {
    return NextResponse.json({ error: 'This permit is retired, so it is not renewed.' }, { status: 409 })
  }

  const parsed = renewalActionFrom(body, { issuedOn: permit.issued_on }, latestCalendarDate())
  if (!parsed.ok) return invalidInput(parsed.errors)
  const renewal = parsed.input

  const patch: Record<string, unknown> = renewal.action === 'submitted'
    ? { renewal_submitted_on: renewal.submittedOn }
    : {
        issued_on:                  renewal.term.issuedOn,
        expires_on:                 renewal.term.expiresOn,
        renewal_application_due_on: renewal.term.renewalApplicationDueOn,
        renewal_submitted_on:       null,
        ...(renewal.term.permitNumber !== null ? { permit_number: renewal.term.permitNumber } : {}),
      }

  // Matched on the term it was checked against, so a renewal recorded meanwhile is not overwritten.
  let update = gate.authedClient
    .from('environmental_permits')
    .update({ ...patch, updated_by: gate.userId })
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .is('retired_at', null)
  update = permit.issued_on === null ? update.is('issued_on', null) : update.eq('issued_on', permit.issued_on)
  const { data, error } = await update.select(PERMIT_COLUMNS).maybeSingle()
  if ((error as { code?: string } | null)?.code === '23505') {
    return NextResponse.json({ error: 'A permit with this agency and number is already in the vault.' }, { status: 409 })
  }
  if (error) return sanitizeError(error, 'environmental/permits/[id]/renewal/POST')
  if (!data) {
    return NextResponse.json({ error: 'This permit changed while you were recording its renewal. Reload and try again.' }, { status: 409 })
  }
  return NextResponse.json({ permit: data })
}
