import { supabase } from '@/lib/supabase'
import { summarizeEnvironmentalKpis, type EnvKpis } from '@soteria/core/environmental/metrics'

// The figures behind the environmental dashboard panel, read through the browser
// client so the tenant and the active site scope them (row-level security), the same
// as every other panel. Checklist cadence is not counted here: the compliance
// calendar is the authority on whether an inspection is late, and it already is one
// of the figures.

export interface EnvironmentalPanelData {
  kpis:              EnvKpis
  legalNonCompliant: number
  /** Whether anything has been set up at all; an untouched account gets an invitation instead of zeros. */
  hasData:           boolean
}

export async function fetchEnvironmentalKpis(): Promise<EnvironmentalPanelData> {
  const [obligations, permits, legal, findings] = await Promise.all([
    supabase.from('compliance_calendar_obligations').select('status, next_due_at, lead_days').eq('category', 'environmental').eq('status', 'open'),
    supabase.from('environmental_permits').select('status, expiration_date, renewal_lead_days'),
    supabase.from('legal_register').select('applicability, compliance_status, last_reviewed_at, next_review_due'),
    supabase.from('nonconformities').select('status').like('source_reference', 'env-%'),
  ])
  const failed = [obligations, permits, legal, findings].find(r => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  const o = obligations.data ?? [], p = permits.data ?? [], l = legal.data ?? [], f = findings.data ?? []
  const kpis = summarizeEnvironmentalKpis({
    obligations: o.map(r => ({ status: r.status as string, nextDueAt: r.next_due_at as string, leadDays: r.lead_days as number })),
    checklistTemplates: [],
    findings: f.map(r => ({ status: r.status as string })),
    permits: p.map(r => ({ status: r.status as string, expirationDate: r.expiration_date as string | null, renewalLeadDays: r.renewal_lead_days as number })),
    legal: l.map(r => ({ applicability: r.applicability as string, lastReviewedAt: r.last_reviewed_at as string | null, nextReviewDue: r.next_review_due as string | null })),
  })
  return {
    kpis,
    legalNonCompliant: l.filter(r => r.applicability === 'applicable' && r.compliance_status === 'non_compliant').length,
    hasData: o.length + p.length + l.length > 0,
  }
}
