// Pure helpers shared by every Working at Heights inventory list page.
//
// Centralising the date math and the label maps keeps the page
// components a thin shell over data + JSX, and makes both layers
// independently testable — the helpers via a fast unit suite, the
// pages via React Testing Library when Phase 3 builds the
// create / edit / detail surfaces.
//
// All functions are pure; no I/O, no Date.now() inside render. The
// `now` argument on daysUntil is injectable so tests can pin time.

import type {
  FallProtectionComponentType,
} from '@soteria/core/workingAtHeights'

// ─── Date helpers ──────────────────────────────────────────────────────

/** Days from `now` to the given date string. Negative = past.
 *  Returns null when the input is null/undefined/empty.
 *  Returns NaN passed through when the string fails to parse — caller
 *  decides whether NaN is a valid state to render.
 */
export function daysUntil(
  date: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!date) return null
  const t = new Date(date).getTime()
  if (Number.isNaN(t)) return NaN
  return Math.ceil((t - now) / (24 * 3600 * 1000))
}

export type ExpiryBand = 'expired' | 'expiring_soon' | 'ok' | 'unknown'

/** Map a days-until value to one of four bands. `unknown` covers the
 *  null case (no expiry on file) and the NaN case (malformed input).
 *  Default `soonThresholdDays` is 90 — the industry-standard window
 *  for "renew now" reminders on training certs and equipment service
 *  life. Per-call override lets the rescue-plan drill cadence use 30.
 */
export function expiryBand(
  days: number | null,
  soonThresholdDays = 90,
): ExpiryBand {
  if (days === null || Number.isNaN(days)) return 'unknown'
  if (days < 0) return 'expired'
  if (days <= soonThresholdDays) return 'expiring_soon'
  return 'ok'
}

// Tailwind class strings keyed by band — kept here so every list
// page picks the same colour family for the same band, and a future
// theme swap touches one file. JS objects rather than a switch so the
// React Compiler treats access as a pure read.
export const EXPIRY_BAND_CLASS: Record<ExpiryBand, string> = {
  expired:        'font-semibold text-rose-700 dark:text-rose-300',
  expiring_soon:  'font-semibold text-amber-700 dark:text-amber-300',
  ok:             'text-slate-700 dark:text-slate-300',
  unknown:        'text-slate-400 dark:text-slate-500',
}

// ─── Label maps ────────────────────────────────────────────────────────

export const FALL_PROTECTION_TYPE_LABELS: Record<FallProtectionComponentType, string> = {
  harness:                'Harness',
  shock_lanyard:          'Shock lanyard',
  positioning_lanyard:    'Positioning lanyard',
  restraint_lanyard:      'Restraint lanyard',
  srl_class1:             'SRL (Class 1)',
  srl_class2:             'SRL (Class 2)',
  anchor_connector:       'Anchor connector',
  rope_grab:              'Rope grab',
  trauma_strap:           'Trauma strap',
  rescue_descent_device:  'Rescue descent device',
}

export const ANCHOR_KIND_LABELS: Record<string, string> = {
  engineered_permanent:  'Engineered (permanent)',
  engineered_portable:   'Engineered (portable)',
  horizontal_lifeline:   'Horizontal lifeline',
  improvised:            'Improvised (CP-chosen)',
}

export const INSPECTION_KIND_LABELS: Record<string, string> = {
  pre_use:     'Pre-use',
  periodic:    'Periodic',
  post_event:  'Post-event',
}

export const ROLE_LABELS: Record<'authorized' | 'competent' | 'qualified', string> = {
  authorized:  'Authorized Person',
  competent:   'Competent Person',
  qualified:   'Qualified Person',
}

// ─── Status badge classes ──────────────────────────────────────────────

export const STATUS_BADGE_CLASS: Record<string, string> = {
  in_service:       'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  quarantined:      'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  condemned:        'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  in_rescue_cache:  'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  pending_recert:   'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
}

export const OUTCOME_BADGE_CLASS: Record<string, string> = {
  pass:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  concern: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  condemn: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

// ─── Row decoration ────────────────────────────────────────────────────

/** Attach days_left to every row in a list at fetch time. The list
 *  pages do this rather than computing inside the map so React's
 *  purity rule (no Date.now() inside render) is satisfied.
 *
 *  T is intentionally unconstrained — concrete interfaces from the
 *  Supabase row types don't satisfy `Record<string, unknown>` because
 *  TS doesn't allow extra unknown keys. The `as unknown` cast at the
 *  read site is the price; the test suite covers every shape we use.
 */
export function decorateWithDaysLeft<T>(
  rows: T[],
  dateField: keyof T,
  now: number = Date.now(),
): Array<T & { days_left: number | null }> {
  return rows.map(r => ({
    ...r,
    days_left: daysUntil(r[dateField] as unknown as string | null | undefined, now),
  }))
}
