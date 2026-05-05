'use client'

import { useTenant } from '@/components/TenantProvider'
import { RiskBandPill } from '@/components/ui/RiskBandPill'
import {
  bandFor,
  HIERARCHY_LABELS,
  readRiskConfig,
  scoreRisk,
  SEVERITY_LABELS,
  LIKELIHOOD_LABELS,
} from '@soteria/core/risk'
import type { WizardState } from '@/lib/risk-wizard'

// Wizard step 8 — Read-only summary before submit. Re-renders every
// previous step's data so the user can verify before posting.

interface Props {
  state: WizardState
}

export default function StepConfirm({ state }: Props) {
  const { tenant } = useTenant()
  const { bandScheme } = readRiskConfig(tenant?.settings ?? null)

  const inherentScore = scoreRisk(state.inherent_severity, state.inherent_likelihood)
  const inherentBand  = bandFor(inherentScore, bandScheme)
  const residualSet   = state.residual_severity > 0 && state.residual_likelihood > 0
  const residualScore = residualSet ? scoreRisk(state.residual_severity, state.residual_likelihood) : null
  const residualBand  = residualScore != null ? bandFor(residualScore, bandScheme) : null

  const affected = (Object.entries(state.affected_personnel)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ') || 'none')

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
        Review the summary below. When you click <strong>Submit risk</strong>, the
        risk + selected controls land in the database in a single transaction; the audit log captures the create event with your user as actor.
      </div>

      <Section title="Identification">
        <Field label="Title">{state.title}</Field>
        <Field label="Description"><span className="whitespace-pre-wrap">{state.description}</span></Field>
        <Field label="Source">{state.source}{state.source_ref_id && <span className="ml-1 text-slate-400 font-mono text-[11px]">· ref {state.source_ref_id}</span>}</Field>
      </Section>

      <Section title="Categorization">
        <Field label="Hazard category">{state.hazard_category || '—'}</Field>
        <Field label="Location">{state.location || '—'}</Field>
        <Field label="Process">{state.process  || '—'}</Field>
        <Field label="Activity">{state.activity_type}</Field>
        <Field label="Frequency">{state.exposure_frequency}</Field>
        <Field label="Affected">{affected}</Field>
      </Section>

      <Section title="Scoring">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ScoreBlock
            label="Inherent (no controls)"
            severity={state.inherent_severity}
            likelihood={state.inherent_likelihood}
            score={inherentScore}
            band={inherentBand}
          />
          {residualSet && residualScore != null && residualBand
            ? <ScoreBlock
                label="Residual (with controls)"
                severity={state.residual_severity}
                likelihood={state.residual_likelihood}
                score={residualScore}
                band={residualBand}
              />
            : <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 text-center text-xs text-slate-400 italic">
                Residual not yet scored. Score after controls are documented.
              </div>}
        </div>
      </Section>

      <Section title={`Controls (${state.controls.length})`}>
        {state.controls.length === 0 ? (
          <div className="text-xs text-slate-400 italic">No controls selected. Add them in step 4 or after the risk is created.</div>
        ) : (
          <ul className="text-sm space-y-1">
            {state.controls.map(c => (
              <li key={c.localId} className="flex items-start gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0 w-24">
                  {HIERARCHY_LABELS[c.hierarchy_level]}
                </span>
                <span>{c.display_name}{c.control_id == null && <span className="text-[10px] text-slate-400 ml-1">(custom)</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {state.ppe_only_justification && (
          <div className="mt-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-1.5 text-[12px] text-amber-900 dark:text-amber-200">
            <strong>PPE-alone justification:</strong> {state.ppe_only_justification}
          </div>
        )}
      </Section>

      <Section title="Assignment">
        <Field label="Owner">    {state.assigned_to || '—'}</Field>
        <Field label="Reviewer"> {state.reviewer    || '—'}</Field>
        <Field label="Approver"> {state.approver    || '—'}</Field>
      </Section>

      <Section title="Review schedule">
        <Field label="Next review">{state.next_review_date || '—'}</Field>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">{title}</div>
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
        {children}
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide pt-0.5">{label}</div>
      <div className="text-slate-800 dark:text-slate-200 break-words">{children}</div>
    </div>
  )
}

function ScoreBlock({
  label, severity, likelihood, score, band,
}: {
  label: string
  severity: number
  likelihood: number
  score: number
  band: ReturnType<typeof bandFor>
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</div>
      <div className="font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
        {severity} × {likelihood} = {score}
      </div>
      <RiskBandPill band={band} score={score} />
      <div className="text-[11px] text-slate-500 dark:text-slate-400">
        {SEVERITY_LABELS[severity - 1]} · {LIKELIHOOD_LABELS[likelihood - 1]}
      </div>
    </div>
  )
}
