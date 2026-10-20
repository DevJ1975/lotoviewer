import { summarizeMicrolearning, type MicrolearningSummary } from '@soteria/core/strikeScorecard'

// A small, realistic microlearning summary built through the real summarizer,
// for the export builders' tests. One module title is hostile: a formula
// prefix for the spreadsheet and a control character that pdf-lib and Word
// both reject.
export const HOSTILE_MODULE_TITLE = '=HYPERLINK("http://evil")\u0007 Confined Space'

export function microlearningFixture(): MicrolearningSummary {
  return summarizeMicrolearning({
    windowDays: 30,
    now: new Date('2026-11-10T12:00:00Z'),
    modules: [{ id: 'loto', title: 'LOTO 101: Control of Hazardous Energy' }, { id: 'cs', title: HOSTILE_MODULE_TITLE }],
    versions: [
      { id: 'loto-en', moduleId: 'loto', locale: 'en', versionNumber: 1, supersedesCompletions: false },
      { id: 'loto-es', moduleId: 'loto', locale: 'es', versionNumber: 2, supersedesCompletions: false },
      { id: 'cs-en', moduleId: 'cs', locale: 'en', versionNumber: 1, supersedesCompletions: false },
    ],
    completions: [
      { moduleId: 'loto', moduleVersionId: 'loto-en', memberId: 'm1', userId: null, completedAt: '2026-11-05T10:00:00Z', expiresAt: '2027-11-05T10:00:00Z', assisted: false },
      { moduleId: 'loto', moduleVersionId: 'loto-es', memberId: 'm2', userId: null, completedAt: '2026-11-06T10:00:00Z', expiresAt: '2027-11-06T10:00:00Z', assisted: false },
      { moduleId: 'cs', moduleVersionId: 'cs-en', memberId: 'm3', userId: null, completedAt: '2026-11-07T10:00:00Z', expiresAt: '2027-11-07T10:00:00Z', assisted: true },
    ],
    attempts: [
      { moduleId: 'loto', memberId: 'm1', userId: null, submittedAt: '2026-11-05T10:00:00Z', passed: true, scorePercent: 90 },
      { moduleId: 'loto', memberId: 'm2', userId: null, submittedAt: '2026-11-06T10:00:00Z', passed: true, scorePercent: 100 },
    ],
    practice: [{ correct: true, hintsUsed: 0 }, { correct: false, hintsUsed: 1 }],
    members: [
      { id: 'm1', displayName: 'Ana', profileId: null, role: null, department: null, site: null },
      { id: 'm2', displayName: 'Luis', profileId: null, role: null, department: null, site: null },
      { id: 'm3', displayName: 'Ben', profileId: null, role: null, department: null, site: null },
    ],
    assignments: [{ id: 'a1', moduleId: 'loto', targetType: 'tenant', targetId: null, startsAt: null, dueAt: '2026-12-01T00:00:00Z' }],
    permitOverrideWorkers: 1,
  })
}
