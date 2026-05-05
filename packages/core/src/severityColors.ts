// Severity color tokens — shared between web (Tailwind class strings),
// mobile (raw hex for inline RN style props), and server-side
// generators (PDF, email HTML). The 4-band scheme is identical
// across the Risk / Near-Miss / JHA modules so the same map works
// for all three.
//
// If a tenant ever asks for a custom palette, override at the
// consumer level — but the default lives here so a tweak to one
// band tints every surface in lockstep.

// Lowest-common-denominator key. Matches Band (risk.ts),
// NearMissSeverity (nearMiss.ts), and JhaSeverity (jha.ts).
export type SeverityKey = 'low' | 'moderate' | 'high' | 'extreme'

// Background hex. Matches Tailwind defaults so Tailwind / hex
// surfaces stay visually identical.
//   extreme  → rose-600     (#DC2626)
//   high     → orange-500   (#F97316)
//   moderate → amber-400    (#FBBF24)
//   low      → emerald-500  (#10B981)
export const SEVERITY_HEX: Record<SeverityKey, string> = {
  extreme:  '#DC2626',
  high:     '#F97316',
  moderate: '#FBBF24',
  low:      '#10B981',
}

// Foreground hex used on top of SEVERITY_HEX. Amber-400 is the only
// band light enough to need dark text for WCAG AA.
export const SEVERITY_FG_HEX: Record<SeverityKey, string> = {
  extreme:  '#FFFFFF',
  high:     '#FFFFFF',
  moderate: '#0F172A',  // slate-900
  low:      '#FFFFFF',
}

// Tailwind class strings — combined `bg-* text-*` so a single
// `className={SEVERITY_TW[band]}` paints both. Used by every web
// surface that puts a colored pill on a severity (KPI panels, list
// rows, detail pages, heat map cells).
export const SEVERITY_TW: Record<SeverityKey, string> = {
  extreme:  'bg-rose-600 text-white',
  high:     'bg-orange-500 text-white',
  moderate: 'bg-amber-400 text-slate-900',
  low:      'bg-emerald-500 text-white',
}

// Border-only Tailwind variant for outlined pills.
export const SEVERITY_TW_BORDER: Record<SeverityKey, string> = {
  extreme:  'border-rose-600 text-rose-700 dark:text-rose-400',
  high:     'border-orange-500 text-orange-700 dark:text-orange-400',
  moderate: 'border-amber-400 text-amber-700 dark:text-amber-400',
  low:      'border-emerald-500 text-emerald-700 dark:text-emerald-400',
}

// Sort rank (extreme first → low last). Used by `compareForTriage`-
// style helpers across the three modules.
export const SEVERITY_RANK: Record<SeverityKey, number> = {
  extreme: 0, high: 1, moderate: 2, low: 3,
}
