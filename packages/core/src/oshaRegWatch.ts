// Regulatory Watch — read model, feed ordering, and the forward-looking
// "Coming Up" selection for the home dashboard.
//
// The osha-reg-watch cron (apps/web) runs monthly, pulls federal rulemaking
// from the Federal Register API and Cal/OSHA rulemaking from the Standards
// Board, has Claude extract substantive updates + upcoming items, and writes
// one GLOBAL row per update into public.osha_regulation_updates. This module
// is the READ side: the row type, the category/severity/jurisdiction
// vocabularies (the single source of truth the cron's validator also
// imports), pure ordering + selection helpers, and the RLS-scoped fetchers
// the panels call.
//
// The table carries no tenant_id because the *content* of an update really is
// the same for every tenant — what differs is whether it applies. That is a
// read-time filter on jurisdiction (migration 253), not a reason to duplicate
// rows per tenant: a tenant with no California site should never see Title 8
// items, and a tenant with one should see them alongside the federal feed.

import { supabase } from './supabaseClient'

// AI-assigned bucket for an update. Stored as plain text in the DB (not an
// enum) so an unforeseen model value never fails an insert; the cron's
// normalizer maps anything off-list to 'other'.
export const OSHA_UPDATE_CATEGORIES = [
  'final_rule',
  'proposed_rule',
  'enforcement',
  'guidance',
  'upcoming',
  'other',
] as const
export type OshaUpdateCategory = (typeof OSHA_UPDATE_CATEGORIES)[number]

export const OSHA_UPDATE_SEVERITIES = ['high', 'medium', 'low'] as const
export type OshaUpdateSeverity = (typeof OSHA_UPDATE_SEVERITIES)[number]

// Which regulator issued an update. 'federal' applies to every tenant; 'CA'
// applies only to tenants operating a California site. Stored as plain text
// (same reasoning as category) with the DB check constraint as the guard.
export const REGULATION_JURISDICTIONS = ['federal', 'CA'] as const
export type RegulationJurisdiction = (typeof REGULATION_JURISDICTIONS)[number]

export const REGULATION_JURISDICTION_LABEL: Record<RegulationJurisdiction, string> = {
  federal: 'Federal OSHA',
  CA:      'Cal/OSHA',
}

export interface OshaRegulationUpdate {
  id:                 string
  title:              string
  category:           OshaUpdateCategory
  jurisdiction:       RegulationJurisdiction
  is_upcoming:        boolean
  source_url:         string
  published_date:     string | null
  effective_date:     string | null
  comment_close_date: string | null
  impact_summary:     string
  severity:           OshaUpdateSeverity | null
  fetched_at:         string
}

// Columns every read path selects. Kept in one place so a schema addition
// can't drift between the feed fetcher and the Coming Up fetcher.
const UPDATE_COLUMNS =
  'id, title, category, jurisdiction, is_upcoming, source_url, published_date, effective_date, comment_close_date, impact_summary, severity, fetched_at'

// ──────────────────────────────────────────────────────────────────────────
// Pure ordering — no DB, fully testable
// ──────────────────────────────────────────────────────────────────────────

// The date a row sorts by: its published date when present, else the fetch
// timestamp — so a freshly-ingested item without a published date still
// ranks sensibly instead of sinking to the bottom.
function feedRankDate(u: OshaRegulationUpdate): string {
  return u.published_date ?? u.fetched_at
}

/**
 * Orders updates for the dashboard feed: upcoming items first (the
 * actionable "comment period open / effective soon" signals), then
 * most-recent first within each group. Pure + stable, so the panel can
 * re-sort a DB result client-side without another round-trip.
 */
export function sortUpdatesForFeed(rows: OshaRegulationUpdate[]): OshaRegulationUpdate[] {
  return [...rows].sort((a, b) => {
    if (a.is_upcoming !== b.is_upcoming) return a.is_upcoming ? -1 : 1
    return feedRankDate(b).localeCompare(feedRankDate(a))
  })
}

// ──────────────────────────────────────────────────────────────────────────
// "Coming Up" — the forward-looking selection
// ──────────────────────────────────────────────────────────────────────────

/**
 * The date that makes an update actionable: the soonest of its comment
 * deadline and its effective date that has NOT already passed.
 *
 * Both matter and either can come first. A proposed rule's comment period
 * usually closes long before the rule takes effect, so it is the sooner
 * deadline — but a rule published with a future effective date and no open
 * comment period has only the effective date. Taking the soonest unexpired
 * one keeps the panel ordered by "what do I have to act on next".
 *
 * Returns null when neither date is in the future, which includes an item
 * with no dates at all.
 */
export function comingUpDate(u: OshaRegulationUpdate, todayIso: string): string | null {
  const future = [u.comment_close_date, u.effective_date]
    .filter((d): d is string => d != null && d > todayIso)
    .sort()
  return future[0] ?? null
}

/** Whether an item carries any date at all that could place it in time. */
function hasAnyDate(u: OshaRegulationUpdate): boolean {
  return u.comment_close_date != null || u.effective_date != null
}

/**
 * Pick the updates worth showing in the Coming Up box, soonest deadline first.
 *
 * Qualifying rule, and the asymmetry in it is deliberate:
 *
 *   - An item WITH dates qualifies only when one of them is still in the
 *     future. `is_upcoming` is a judgement the model made when the row was
 *     written and it goes stale — a rule that took effect last quarter is in
 *     force, not coming up, and its flag says otherwise forever. The dates
 *     are evidence; the flag is an opinion, so the dates win.
 *
 *   - An item with NO dates qualifies on the flag alone. That is the common
 *     shape for early-stage rulemaking ("an NPRM is expected"), and dropping
 *     it would hide exactly the items with the most lead time to prepare for.
 *     Here there is no evidence to contradict the flag.
 *
 * Dated items sort first by soonest deadline; undated flagged items trail
 * them, newest first.
 *
 * `jurisdictions` is the set the tenant operates in. It is applied here
 * rather than in SQL so the caller can fetch once and re-filter without a
 * round-trip, and so this stays testable without a database.
 */
export function selectComingUp(
  rows: readonly OshaRegulationUpdate[],
  opts: { jurisdictions: readonly RegulationJurisdiction[]; todayIso: string; limit?: number },
): OshaRegulationUpdate[] {
  const allowed = new Set(opts.jurisdictions)

  const scored = rows
    .filter(u => allowed.has(u.jurisdiction))
    .map(u => ({ u, due: comingUpDate(u, opts.todayIso) }))
    .filter(({ u, due }) => (hasAnyDate(u) ? due !== null : u.is_upcoming))

  scored.sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due)
    if (a.due) return -1          // dated items outrank undated ones
    if (b.due) return 1
    return b.u.fetched_at.localeCompare(a.u.fetched_at)   // newest first
  })

  const picked = scored.map(s => s.u)
  return opts.limit == null ? picked : picked.slice(0, opts.limit)
}

// ──────────────────────────────────────────────────────────────────────────
// DB fetcher — reads the global feed via the registered (RLS-scoped) client
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pulls the latest `limit` updates for the dashboard panel, upcoming first
 * then newest. Returns null on a query error (the panel hides itself) and
 * [] when the feed is simply empty (the panel shows its empty state) — the
 * same contract as fetchRiskMetrics / fetchNearMissMetrics.
 */
export async function fetchOshaRegulationUpdates(
  limit = 5,
  jurisdictions: readonly RegulationJurisdiction[] = ['federal'],
): Promise<OshaRegulationUpdate[] | null> {
  const { data, error } = await supabase
    .from('osha_regulation_updates')
    .select(UPDATE_COLUMNS)
    .in('jurisdiction', [...jurisdictions])
    .order('is_upcoming', { ascending: false })
    .order('published_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[oshaRegWatch] fetch failed', error)
    return null
  }
  return (data ?? []) as unknown as OshaRegulationUpdate[]
}

/**
 * Which regulators' rules bind the active tenant.
 *
 * Federal always applies. California is added when the tenant has at least
 * one facility or OSHA establishment with state 'CA'. Both tables are
 * RLS-scoped to the caller's tenant, so this needs no tenant argument — the
 * same posture as fetchOshaRegulationUpdates.
 *
 * On a query error we return federal only. That is the conservative
 * direction: showing a Californian employer one fewer panel is a degraded
 * experience, whereas showing Title 8 items to a Texas plant is misinformation.
 */
export async function fetchTenantJurisdictions(): Promise<RegulationJurisdiction[]> {
  const [facilities, establishments] = await Promise.all([
    supabase.from('facilities').select('id').eq('state', 'CA').limit(1),
    supabase.from('osha_establishments').select('id').eq('state', 'CA').limit(1),
  ])

  if (facilities.error || establishments.error) {
    console.warn('[oshaRegWatch] jurisdiction lookup failed', facilities.error ?? establishments.error)
    return ['federal']
  }

  const inCalifornia = (facilities.data?.length ?? 0) > 0 || (establishments.data?.length ?? 0) > 0
  return inCalifornia ? ['federal', 'CA'] : ['federal']
}

/**
 * Rows for the Coming Up panel. Over-fetches (the DB can't express
 * selectComingUp's "future date OR flagged upcoming" rule cheaply) and lets
 * the pure selector do the final filter and ordering.
 */
export async function fetchComingUpUpdates(
  jurisdictions: readonly RegulationJurisdiction[],
  limit = 5,
): Promise<OshaRegulationUpdate[] | null> {
  const { data, error } = await supabase
    .from('osha_regulation_updates')
    .select(UPDATE_COLUMNS)
    .in('jurisdiction', [...jurisdictions])
    .or('is_upcoming.eq.true,effective_date.not.is.null,comment_close_date.not.is.null')
    .order('fetched_at', { ascending: false })
    .limit(Math.max(limit * 8, 40))

  if (error) {
    console.warn('[oshaRegWatch] coming-up fetch failed', error)
    return null
  }
  return (data ?? []) as unknown as OshaRegulationUpdate[]
}
