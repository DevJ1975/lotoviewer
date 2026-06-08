import type { AuditChangeKind, AuditSeverity, LotoAuditChange } from '@/lib/loto/audit/schemas'

// Presentation metadata for staged audit changes. Shared by the admin detail
// page and the public reviewer surface so a change reads the same on both —
// the engine speaks in change_kind / agent / severity; humans need labels,
// badge colors, and a readable old→new rendering of unknown-typed values.

export const CHANGE_KIND_LABEL: Record<AuditChangeKind, string> = {
  step_field_edit:      'Energy-step edit',
  step_confidence:      'Step confidence',
  equipment_field_edit: 'Equipment edit',
  photo_provenance:     'Photo provenance',
  placeholder_photo:    'Reference photo',
  ehs_finding:          'EHS finding',
}

export const AGENT_LABEL: Record<LotoAuditChange['agent'], string> = {
  FPE: 'Vision',
  DS:  'Consistency',
  EHS: 'EHS',
  SSD: 'System',
}

export const AGENT_BADGE: Record<LotoAuditChange['agent'], string> = {
  FPE: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  DS:  'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  EHS: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  SSD: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
}

export const SEVERITY_BADGE: Record<AuditSeverity, string> = {
  info:     'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  low:      'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  medium:   'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200',
  critical: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
}

// old_value / new_value are unknown — the agents stage strings for field edits,
// but provenance/EHS rows can carry objects. Render scalars verbatim and fall
// back to compact JSON so nothing renders "[object Object]".
export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value.trim() || '—'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}
