import { NextResponse } from 'next/server'
import { changeImpacts, type ChangeKind, type FanOutContext } from '@soteria/core/managementOfChange'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  EMS_DISCIPLINES,
  ENVIRONMENTAL_MODULE,
  gateFailure,
  invalidInput,
  invalidJson,
  readJsonObject,
} from '@/lib/environmental/registerApi'
import { CHANGE_COLUMNS, changeInputFrom, impactRows } from '@/lib/environmental/changes'

// GET  /api/environmental/changes   Management of change (clauses 6.1.4, 8.1): each change with
//                                   how many of its impacts are resolved, newest first.
//   ?status=open (default) | closed | cancelled | all
// POST /api/environmental/changes   Open a change. Admins only.
//   { kind, title, description, process_area?, new_legal_entity?, effective_on?, discipline? }
//
// Opening works out which records the change touches (changeImpacts) and stores the change and
// its impacts in one transaction, through ms_open_change(): no change is ever left without its
// checklist. The records are read through the caller's own client, so the change sees what the
// caller sees. A change opens at the selected site, or covers the whole organization when no
// site is selected; a change of owner or legal name always covers every site, so it opens only
// from the all-facilities view.

const PAGE_SIZE = 200
const STATUSES = ['open', 'closed', 'cancelled', 'all'] as const
/** The kinds whose fan-out reads aspects, and the one that also reads obligations. */
const READS_ASPECTS: readonly ChangeKind[] = ['equipment', 'process', 'chemical']

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const status = new URL(req.url).searchParams.get('status') ?? 'open'
  if (!(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'status must be open, closed, cancelled, or all' }, { status: 400 })
  }

  let query = gate.authedClient.from('ms_changes').select(CHANGE_COLUMNS)
    .eq('tenant_id', gate.tenantId).in('discipline', EMS_DISCIPLINES)
  if (status !== 'all') query = query.eq('status', status)
  const { data, error } = await query.order('opened_at', { ascending: false }).order('id').limit(PAGE_SIZE)
  if (error) return sanitizeError(error, 'environmental/changes/GET')
  const changes = (data ?? []) as unknown as { id: string }[]

  const progress = new Map<string, { total: number; resolved: number }>()
  if (changes.length > 0) {
    const { data: impacts, error: impactError } = await gate.authedClient
      .from('ms_change_impacts')
      .select('change_id, resolved_at')
      .eq('tenant_id', gate.tenantId)
      .in('change_id', changes.map(change => change.id))
      .limit(50_000)
    if (impactError) return sanitizeError(impactError, 'environmental/changes/GET impacts')
    for (const impact of (impacts ?? []) as { change_id: string; resolved_at: string | null }[]) {
      const entry = progress.get(impact.change_id) ?? { total: 0, resolved: 0 }
      entry.total += 1
      if (impact.resolved_at !== null) entry.resolved += 1
      progress.set(impact.change_id, entry)
    }
  }

  return NextResponse.json({
    changes: changes.map(change => ({
      ...change,
      impacts_total:    progress.get(change.id)?.total ?? 0,
      impacts_resolved: progress.get(change.id)?.resolved ?? 0,
    })),
  })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const parsed = changeInputFrom(body)
  if (!parsed.ok) return invalidInput(parsed.errors)
  const change = parsed.input

  // The legal entity belongs to the organization, so its change covers every site; and a
  // site-limited read would miss the permits at the others.
  if (change.kind === 'ownership_name' && gate.facilityId !== null) {
    return NextResponse.json({
      error: 'A change of owner or legal name covers every site. Switch to all facilities and try again.',
    }, { status: 400 })
  }

  const db = gate.authedClient
  const readsAspects = READS_ASPECTS.includes(change.kind)
  const [permits, scope, policy, aspects, obligations] = await Promise.all([
    change.kind === 'ownership_name'
      ? db.from('environmental_permits').select('id, title, agency, facility_id, retired_at')
          .eq('tenant_id', gate.tenantId).is('retired_at', null).order('title').order('id').limit(5000)
      : Promise.resolve({ data: [], error: null }),
    change.kind === 'ownership_name'
      ? db.from('ms_scope_statements').select('id').eq('tenant_id', gate.tenantId).eq('discipline', change.discipline)
          .order('version', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    change.kind === 'ownership_name'
      ? db.from('ms_policies').select('id').eq('tenant_id', gate.tenantId).eq('discipline', change.discipline)
          .order('version', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    readsAspects
      ? db.from('environmental_aspects').select('id, aspect, process_area, facility_id, obsolete_at')
          .eq('tenant_id', gate.tenantId).is('obsolete_at', null).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    change.kind === 'chemical'
      ? db.from('compliance_calendar_obligations').select('id, title, category, status, facility_id')
          .eq('tenant_id', gate.tenantId).in('discipline', EMS_DISCIPLINES).eq('status', 'open').limit(5000)
      : Promise.resolve({ data: [], error: null }),
  ])
  const failed = permits.error ?? scope.error ?? policy.error ?? aspects.error ?? obligations.error
  if (failed) return sanitizeError(failed, 'environmental/changes/POST context')

  const context: FanOutContext = {
    permits: ((permits.data ?? []) as { id: string; title: string; agency: string; facility_id: string; retired_at: string | null }[])
      .map(p => ({ id: p.id, title: p.title, agency: p.agency, facilityId: p.facility_id, retiredAt: p.retired_at })),
    scope:  (scope.data as { id: string } | null) ?? null,
    policy: (policy.data as { id: string } | null) ?? null,
    aspects: ((aspects.data ?? []) as { id: string; aspect: string; process_area: string | null; facility_id: string | null; obsolete_at: string | null }[])
      .map(a => ({ id: a.id, aspect: a.aspect, processArea: a.process_area, facilityId: a.facility_id, obsoleteAt: a.obsolete_at })),
    obligations: ((obligations.data ?? []) as { id: string; title: string; category: string | null; status: string; facility_id: string | null }[])
      .map(o => ({ id: o.id, title: o.title, category: o.category, status: o.status, facilityId: o.facility_id })),
  }
  const impacts = changeImpacts({
    discipline: change.discipline, kind: change.kind, facilityId: gate.facilityId,
    processArea: change.processArea, newLegalEntity: change.newLegalEntity,
  }, context)

  const { data: changeId, error } = await db.rpc('ms_open_change', {
    p_change: {
      tenant_id:        gate.tenantId,
      facility_id:      gate.facilityId,
      discipline:       change.discipline,
      kind:             change.kind,
      title:            change.title,
      description:      change.description,
      process_area:     change.processArea,
      new_legal_entity: change.newLegalEntity,
      effective_on:     change.effectiveOn,
    },
    p_impacts: impactRows(impacts),
  })
  const code = (error as { code?: string } | null)?.code
  // A record this change touches was removed between reading it and opening the change.
  if (code === '23503') {
    return NextResponse.json({ error: 'A record this change touches changed while it was opening. Try again.' }, { status: 409 })
  }
  if (error) return sanitizeError(error, 'environmental/changes/POST')

  const { data: opened, error: readError } = await db.from('ms_changes').select(CHANGE_COLUMNS)
    .eq('id', changeId as string).eq('tenant_id', gate.tenantId).maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/changes/POST read')
  return NextResponse.json({ change: opened ?? { id: changeId }, impacts: impacts.length }, { status: 201 })
}
