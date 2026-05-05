'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import {
  bandFor,
  HIERARCHY_LABELS,
  type Band,
  type HierarchyLevel,
} from '@soteria/core/risk'

// /risk/export/iipp — printable Cal/OSHA IIPP-formatted layout.
//
// Renders the active tenant's risk register as a printer-friendly
// HTML document. Cmd-P → Save as PDF gives auditors a paper trail
// covering the §3203 IIPP elements that touch hazard ID +
// evaluation + correction.
//
// Print styles are inlined in a <style jsx global> block at the
// bottom — every browser's print preview honors them, no extra
// CSS file needed.

interface ExportEnvelope {
  schema:       string
  generated_at: string
  tenant: {
    id:            string
    name:          string | null
    tenant_number: string | null
    slug:          string | null
  }
  counts: { risks: number; controls: number; reviews: number; audit: number }
  risks: ExportedRisk[]
}

interface ExportedRisk {
  id:                    string
  risk_number:           string
  title:                 string
  description:           string
  status:                string
  hazard_category:       string
  source:                string
  location:              string | null
  process:               string | null
  activity_type:         string
  exposure_frequency:    string
  affected_personnel:    Record<string, boolean>
  inherent_severity:     number
  inherent_likelihood:   number
  inherent_score:        number
  inherent_band:         Band
  residual_severity:     number | null
  residual_likelihood:   number | null
  residual_score:        number | null
  residual_band:         Band | null
  ppe_only_justification: string | null
  next_review_date:      string | null
  controls: Array<{
    hierarchy_level: HierarchyLevel
    library_name:    string | null
    custom_name:     string | null
    status:          string
    notes:           string | null
  }>
  reviews: Array<{
    reviewed_at: string
    trigger:     string
    outcome:     string
    notes:       string | null
  }>
}

export default function IippExportPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner />
    </Suspense>
  )
}

function Inner() {
  const { tenant } = useTenant()
  const [data,    setData]    = useState<ExportEnvelope | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      if (tenant?.id)            headers['x-active-tenant'] = tenant.id
      const res = await fetch('/api/risk/export?format=json', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setData(body as ExportEnvelope)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant?.id])

  useEffect(() => { void load() }, [load])

  if (error) {
    return <main className="max-w-3xl mx-auto py-12 text-center text-rose-700">{error}</main>
  }
  if (!data) return <Spinner />

  const generatedDate = new Date(data.generated_at).toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  return (
    <main className="iipp max-w-[850px] mx-auto p-8">
      <div className="iipp__toolbar print:hidden flex items-center justify-between mb-6">
        <p className="text-xs text-slate-500">
          Use your browser's print dialog (Cmd/Ctrl + P) → Save as PDF for an audit-ready paper copy.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="text-sm font-bold inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90"
        >
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>

      <header className="iipp__header">
        <div className="iipp__eyebrow">
          Cal/OSHA T8 §3203 — Injury &amp; Illness Prevention Program
          <br />
          ISO 45001:2018 6.1 — Risk Assessment Register
        </div>
        <h1 className="iipp__title">{data.tenant.name ?? 'Tenant'} — Risk Register</h1>
        <div className="iipp__meta">
          {data.tenant.tenant_number && <>Tenant #{data.tenant.tenant_number} · </>}
          Generated {generatedDate} · {data.counts.risks} risks · {data.counts.controls} controls
        </div>
      </header>

      <section className="iipp__summary">
        <h2 className="iipp__h2">Summary</h2>
        <dl className="iipp__dl">
          <dt>Total active risks</dt><dd>{data.risks.length}</dd>
          <dt>Documented controls</dt><dd>{data.counts.controls}</dd>
          <dt>Recorded reviews</dt><dd>{data.counts.reviews}</dd>
          <dt>Audit log entries</dt><dd>{data.counts.audit}</dd>
        </dl>
        <p className="iipp__notice">
          This export is a snapshot of the risk register at the time of generation.
          The append-only audit log inside the Soteria FIELD database is the source
          of truth (DB-enforced; see migration 038).
        </p>
      </section>

      <section className="iipp__risks">
        <h2 className="iipp__h2">Risk register</h2>
        {data.risks.length === 0 ? (
          <p>No risks recorded for this tenant.</p>
        ) : (
          data.risks.map(r => <RiskCard key={r.id} risk={r} />)
        )}
      </section>

      <footer className="iipp__footer">
        Soteria FIELD · soteriafield.app · {generatedDate}
      </footer>

      {/* Print-friendly styling. The page reads cleanly on screen and
          collapses to A4/Letter cleanly when printed. */}
      <style jsx global>{`
        .iipp {
          font-family: 'Times New Roman', Times, serif;
          color: #0f172a;
          background: white;
        }
        .iipp__header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }
        .iipp__eyebrow {
          font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700;
          color: #475569; margin-bottom: 6px;
        }
        .iipp__title { font-size: 24px; font-weight: 700; margin: 0; }
        .iipp__meta { font-size: 11px; color: #64748b; margin-top: 4px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .iipp__h2 { font-size: 16px; font-weight: 700; margin: 24px 0 8px;
          border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
        .iipp__dl { display: grid; grid-template-columns: 200px 1fr; gap: 4px 12px; font-size: 12px; }
        .iipp__dl dt { font-weight: 600; color: #475569; }
        .iipp__dl dd { margin: 0; }
        .iipp__notice { font-size: 10px; color: #64748b; margin-top: 12px; font-style: italic; }

        .iipp__risk { margin: 16px 0; padding: 10px 12px;
          border: 1px solid #cbd5e1; border-radius: 6px;
          page-break-inside: avoid; break-inside: avoid; }
        .iipp__risk-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .iipp__risk-num { font-family: ui-monospace, Menlo, Consolas, monospace;
          font-size: 11px; color: #475569; }
        .iipp__risk-title { font-weight: 700; font-size: 14px; flex: 1; padding: 0 8px; }
        .iipp__band { display: inline-block; font-size: 10px; font-weight: 700;
          padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .iipp__band--low      { background: #16A34A; color: white; }
        .iipp__band--moderate { background: #EAB308; color: #1f2937; }
        .iipp__band--high     { background: #EA580C; color: white; }
        .iipp__band--extreme  { background: #DC2626; color: white; }
        .iipp__risk-meta { font-size: 11px; color: #475569; margin-top: 4px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .iipp__risk-desc { font-size: 12px; line-height: 1.5; margin-top: 8px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .iipp__h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
          color: #64748b; margin: 10px 0 4px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .iipp__controls, .iipp__reviews { font-size: 11px; line-height: 1.45;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .iipp__control { display: flex; gap: 8px; padding: 2px 0; }
        .iipp__control-level { font-weight: 700; width: 110px; flex-shrink: 0;
          text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
        .iipp__ppe-justification { background: #fef3c7; border-left: 3px solid #d97706;
          padding: 6px 8px; margin-top: 6px; font-size: 11px; color: #78350f;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif; }

        .iipp__footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #cbd5e1;
          font-size: 10px; color: #64748b; text-align: center;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif; }

        @media print {
          .iipp { padding: 0; max-width: 100%; }
          .iipp__risk { box-shadow: none; }
          @page { margin: 0.6in; }
        }
      `}</style>
    </main>
  )
}

function RiskCard({ risk }: { risk: ExportedRisk }) {
  const bandClass = `iipp__band iipp__band--${risk.residual_band ?? risk.inherent_band}`
  const score     = risk.residual_score ?? risk.inherent_score
  const band      = risk.residual_band  ?? risk.inherent_band

  const affected = Object.entries(risk.affected_personnel)
    .filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'

  return (
    <article className="iipp__risk">
      <div className="iipp__risk-head">
        <span className="iipp__risk-num">{risk.risk_number}</span>
        <span className="iipp__risk-title">{risk.title}</span>
        <span className={bandClass}>{band} · {score}</span>
      </div>
      <div className="iipp__risk-meta">
        {risk.hazard_category} · {risk.activity_type} · {risk.exposure_frequency}
        {risk.location && ` · ${risk.location}`}
        {risk.process && ` · ${risk.process}`}
        {' · status: '}{risk.status}
        {risk.next_review_date && ` · next review ${risk.next_review_date}`}
      </div>
      <p className="iipp__risk-desc">{risk.description}</p>

      <div className="iipp__risk-meta">
        <strong>Inherent:</strong> {risk.inherent_severity}×{risk.inherent_likelihood}={risk.inherent_score} ({risk.inherent_band})
        {' · '}
        <strong>Residual:</strong>{' '}
        {risk.residual_score != null
          ? `${risk.residual_severity}×${risk.residual_likelihood}=${risk.residual_score} (${risk.residual_band})`
          : 'not yet scored'}
        {' · Affected: '}{affected}
      </div>

      {risk.controls.length > 0 && (
        <>
          <h3 className="iipp__h3">Controls (Hierarchy of Controls — ISO 45001 8.1.2)</h3>
          <div className="iipp__controls">
            {risk.controls.map((c, i) => (
              <div key={i} className="iipp__control">
                <span className="iipp__control-level">{HIERARCHY_LABELS[c.hierarchy_level]}</span>
                <span>
                  {c.library_name ?? c.custom_name}
                  {c.status !== 'planned' && ` · ${c.status}`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {risk.ppe_only_justification && (
        <div className="iipp__ppe-justification">
          <strong>PPE-alone justification (ISO 45001 8.1.2):</strong>{' '}
          {risk.ppe_only_justification}
        </div>
      )}

      {risk.reviews.length > 0 && (
        <>
          <h3 className="iipp__h3">Review history</h3>
          <div className="iipp__reviews">
            {risk.reviews.slice(0, 5).map((rv, i) => (
              <div key={i}>
                {new Date(rv.reviewed_at).toLocaleDateString()} —
                {' '}{rv.trigger} · {rv.outcome}
                {rv.notes && <> — {rv.notes}</>}
              </div>
            ))}
          </div>
        </>
      )}
    </article>
  )
}

function Spinner() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  )
}
