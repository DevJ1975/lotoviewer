import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LOTO Coach knowledge base: plain-language guidance grounded in
// 29 CFR 1910.147, ingested into the RAG corpus as global 'training'
// documents by /api/superadmin/strike/coach-kb. Read with process.cwd()
// like lib/support/kb.ts — server-only, never import from a client.

export interface CoachKbDoc {
  /** Stable key: drives the synthetic content_sha256 so re-ingest replaces, never duplicates. */
  key: string
  file: string
  title: string
  /** Lead citation, carried into chunk metadata so cite tags read "[title § section]". */
  section: string
}

export const LOTO_COACH_KB: readonly CoachKbDoc[] = [
  { key: 'loto-coach:purpose-and-scope', file: '01-purpose-and-scope.md', title: 'LOTO Coach: Purpose and scope', section: '1910.147(a)' },
  { key: 'loto-coach:energy-and-isolation', file: '02-energy-types-and-isolation-devices.md', title: 'LOTO Coach: Energy types and isolation devices', section: '1910.147(b), (d)(3)' },
  { key: 'loto-coach:roles-and-training', file: '03-roles-and-training.md', title: 'LOTO Coach: Roles and training', section: '1910.147(c)(7)' },
  { key: 'loto-coach:seven-steps', file: '04-the-seven-steps.md', title: 'LOTO Coach: The seven steps', section: '1910.147(d)' },
  { key: 'loto-coach:tagout-only', file: '05-tagout-only-conditions.md', title: 'LOTO Coach: When a tag may replace a lock', section: '1910.147(c)(3)' },
  { key: 'loto-coach:group-and-shift', file: '06-group-lockout-and-shift-change.md', title: 'LOTO Coach: Group lockout and shift change', section: '1910.147(f)(3)–(f)(4)' },
  { key: 'loto-coach:removal-and-restart', file: '07-removal-and-restart.md', title: 'LOTO Coach: Removal and restart', section: '1910.147(e)' },
  { key: 'loto-coach:periodic-inspection', file: '08-periodic-inspection.md', title: 'LOTO Coach: Periodic inspection', section: '1910.147(c)(6)' },
  { key: 'loto-coach:contractors', file: '09-contractors.md', title: 'LOTO Coach: Contractors', section: '1910.147(f)(2)' },
  { key: 'loto-coach:faq', file: '10-faq.md', title: 'LOTO Coach: Frequently asked questions', section: '1910.147' },
]

export function readCoachKbDoc(doc: CoachKbDoc): string {
  return readFileSync(join(process.cwd(), 'lib', 'strike', 'kb', 'loto', doc.file), 'utf8')
}
