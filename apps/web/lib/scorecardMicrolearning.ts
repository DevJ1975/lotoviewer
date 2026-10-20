import type { MicrolearningRate, MicrolearningSummary } from '@soteria/core/strikeScorecard'

// The microlearning section's wording, shared by the PDF, the Excel workbook
// and the Word document so the three files say exactly the same thing.

export const LOCALE_NAMES: Record<string, string> = { en: 'English', es: 'Spanish' }

export function formatRate(r: MicrolearningRate): string {
  return r.percent === null ? '—' : `${r.percent}% (${r.numerator} of ${r.denominator})`
}

export interface ScorecardFact {
  label: string
  value: string
}

/** The headline facts, in reading order. */
export function microlearningFacts(s: MicrolearningSummary): ScorecardFact[] {
  const languages = s.languages.length === 0
    ? '—'
    : s.languages.map(l => `${LOCALE_NAMES[l.locale] ?? l.locale} ${l.completions}`).join(' · ')
  return [
    { label: `Completions (last ${s.windowDays} days)`, value: String(s.completions) },
    { label: 'People trained (window)', value: String(s.learners) },
    { label: 'Workforce with a current pass', value: formatRate(s.workforceTrained) },
    { label: 'Assignments complete', value: `${s.compliance.percentComplete}% (${s.compliance.complete} of ${s.compliance.assigned})` },
    { label: 'Overdue assignments', value: String(s.compliance.overdue) },
    { label: 'Due in the next 3 days', value: String(s.compliance.dueSoon) },
    { label: 'Certifications expiring in 30 days', value: String(s.expiringSoon) },
    { label: 'Certifications lapsed', value: String(s.expired) },
    { label: 'Quiz pass rate', value: formatRate(s.passRate) },
    { label: 'First-try pass rate', value: formatRate(s.firstTryPassRate) },
    { label: 'Average quiz score', value: s.averageScore === null ? '—' : `${s.averageScore}%` },
    { label: 'Practice checks solved first try', value: formatRate(s.practice.solvedFirstTry) },
    { label: 'Practice checks that needed a hint', value: formatRate(s.practice.usedHint) },
    { label: 'Supervisor-verified (ADA) completions', value: String(s.delivery.assisted) },
    { label: 'Completions by language', value: languages },
    { label: 'Workers allowed on a permit by override', value: String(s.permitOverrideWorkers) },
  ]
}

export interface ScorecardModuleRow {
  title: string
  completions: number
  learners: number
  passRate: string
  averageScore: string
  assisted: number
  languages: string
}

export function microlearningModuleRows(s: MicrolearningSummary): ScorecardModuleRow[] {
  return s.modules.map(m => ({
    title: m.title,
    completions: m.completions,
    learners: m.learners,
    passRate: formatRate(m.passRate),
    averageScore: m.averageScore === null ? '—' : `${m.averageScore}%`,
    assisted: m.assisted,
    languages: Object.entries(m.byLocale).map(([locale, n]) => `${LOCALE_NAMES[locale] ?? locale} ${n}`).join(' · ') || '—',
  }))
}

/** Plain-language notes that keep the numbers from being misread. */
export const MICROLEARNING_NOTES = [
  'Supervisor-verified (ADA) completions count as completions but have no quiz, so they are left out of pass rates and scores.',
  'A completion in Spanish counts toward the same module as its English version.',
  'Assignment, workforce and certification figures are as of today; the rest cover the selected window.',
]
