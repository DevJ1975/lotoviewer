import type { EvaluationResult } from '@soteria/core/complianceEvaluation'

// An evaluation result in the app's safety-tag vocabulary. "Not evaluated"
// is said plainly rather than shown as an empty cell.

const LOOK: Record<EvaluationResult, { label: string; className: string }> = {
  compliant:      { label: 'Compliant',      className: 'safety-tag-cleared' },
  noncompliant:   { label: 'Noncompliant',   className: 'safety-tag-danger' },
  not_applicable: { label: 'Not applicable', className: 'safety-tag-caution' },
  undetermined:   { label: 'Undetermined',   className: 'safety-tag-caution' },
}

export function ResultBadge({ result }: { result: EvaluationResult | null }) {
  if (!result) return <span className="text-xs italic text-slate-500">Not evaluated</span>
  const { label, className } = LOOK[result]
  return <span className={`safety-tag ${className}`}>{label}</span>
}
