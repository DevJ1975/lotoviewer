// OSHA Regulatory Watch — read model + feed ordering for the home dashboard.
//
// The osha-reg-watch cron (apps/web) fetches osha.gov roughly monthly, has
// Claude extract substantive regulation updates + upcoming items, and writes
// one GLOBAL row per update into public.osha_regulation_updates. This module
// is the READ side: the row type, the category/severity vocabularies (the
// single source of truth the cron's validator also imports), a pure
// feed-ordering helper, and the RLS-scoped fetcher the panel calls.
//
// The table is global (no tenant_id) — federal OSHA regulations are identical
// for every tenant — so the fetcher is zero-arg and relies on the table's
// authenticated-read RLS policy to return the same rows to everyone.

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

export interface OshaRegulationUpdate {
  id:                 string
  title:              string
  category:           OshaUpdateCategory
  is_upcoming:        boolean
  source_url:         string
  published_date:     string | null
  effective_date:     string | null
  comment_close_date: string | null
  impact_summary:     string
  severity:           OshaUpdateSeverity | null
  fetched_at:         string
}

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
): Promise<OshaRegulationUpdate[] | null> {
  const { data, error } = await supabase
    .from('osha_regulation_updates')
    .select(
      'id, title, category, is_upcoming, source_url, published_date, effective_date, comment_close_date, impact_summary, severity, fetched_at',
    )
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
