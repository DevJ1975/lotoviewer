'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Award, Eye, ListChecks, Loader2, ShieldAlert, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  bandRatio,
  summarizeObservations,
  tallyBehaviorTags,
  countRapidReviews,
  RATIO_BAND_LABEL,
  BEHAVIOR_TAG_CATALOG,
  type BbsObservationV2Row,
  type BbsRatioBand,
} from '@soteria/core/bbsMetricsV2'

// /admin/observations/bbs/dashboard — leading-indicator dashboard for BBS v2.
//
// All metric sections are driven by the trailing 30-day window:
//   1. Headline tile: safe-to-unsafe ratio + band colour.
//   2. Mini-funnel: total / safe / unsafe / follow-ups due / recognized.
//   3. Rapid reviews (WLS "Hot Seat"): due / overdue tile + 24h-SLA list.
//   4. Behavior-tag trend: counts per safe-behavior checklist tag.
//   5. Recognition feed: recently recognized safe behaviors.
//   6. Follow-ups due, grouped by Safety Action Team.
// Plus admin-only inline management of Safety Action Teams.

const BAND_TILE: Record<BbsRatioBand, string> = {
  red:    'bg-rose-100    text-rose-900    dark:bg-rose-950/40    dark:text-rose-100',
  yellow: 'bg-amber-100   text-amber-900   dark:bg-amber-950/40   dark:text-amber-100',
  green:  'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
}

const UNASSIGNED = 'Unassigned'
const RAPID_REVIEW_SLA_HOURS = 24

interface ObservationDashboardRow extends BbsObservationV2Row {
  description: string
  location_text: string | null
}

interface ActionTeamRow {
  id:     string
  name:   string
  active: boolean
}

const WINDOW_DAYS = 30

export default function BbsDashboardPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [rows, setRows]   = useState<ObservationDashboardRow[] | null>(null)
  const [teams, setTeams] = useState<ActionTeamRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const [newTeamName, setNewTeamName] = useState('')
  const [teamBusy, setTeamBusy]       = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
    const { data, error: err } = await supabase
      .from('bbs_observations_v2')
      .select('id, category, severity, follow_up_required, follow_up_completed_at, feedback_given_at, behavior_tags, recognized, rapid_review_required, rapid_review_completed_at, action_team_id, description, location_text, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (err) { setError(formatSupabaseError(err, 'load observations')); return }
    setRows((data ?? []) as ObservationDashboardRow[])
  }, [tenantId])

  const loadTeams = useCallback(async () => {
    if (!tenantId) return
    const { data } = await supabase
      .from('bbs_action_teams')
      .select('id, name, active')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .limit(200)
    setTeams((data ?? []) as ActionTeamRow[])
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) { void load(); void loadTeams() }
  }, [authLoading, profile, load, loadTeams])

  const summary = useMemo(() => summarizeObservations(rows ?? []), [rows])
  const band = bandRatio(summary.safeToUnsafeRatio)
  const tagTally = useMemo(() => tallyBehaviorTags(rows ?? []), [rows])
  const rapidReviews = useMemo(() => countRapidReviews(rows ?? [], new Date(), RAPID_REVIEW_SLA_HOURS), [rows])
  const teamNameById = useMemo(() => new Map(teams.map(t => [t.id, t.name])), [teams])

  async function addTeam() {
    const name = newTeamName.trim()
    if (!tenantId || !name || teamBusy) return
    setTeamBusy(true)
    const { error: err } = await supabase.from('bbs_action_teams').insert({ tenant_id: tenantId, name })
    setTeamBusy(false)
    if (err) { setError(formatSupabaseError(err, 'add action team')); return }
    setNewTeamName('')
    void loadTeams()
  }

  async function toggleTeam(id: string, active: boolean) {
    if (teamBusy) return
    setTeamBusy(true)
    const { error: err } = await supabase.from('bbs_action_teams').update({ active: !active }).eq('id', id)
    setTeamBusy(false)
    if (err) { setError(formatSupabaseError(err, 'update action team')); return }
    void loadTeams()
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  const all = rows ?? []
  const rapidReviewRows = all
    .filter(r => r.rapid_review_required && !r.rapid_review_completed_at)
    .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)) // oldest first — most overdue at top
    .slice(0, 10)
  const recognizedRows = all.filter(r => r.recognized).slice(0, 10)
  const followUpGroups = groupFollowUpsByTeam(all, teamNameById)
  const maxTag = Math.max(1, ...BEHAVIOR_TAG_CATALOG.map(t => tagTally[t.key]))
  const slaCutoff = Date.now() - RAPID_REVIEW_SLA_HOURS * 3_600_000

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <div className="mt-2 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Eye className="h-6 w-6 text-brand-navy" />
              BBS leading indicators
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Trailing {WINDOW_DAYS}-day window. Safe-to-unsafe ratio is the leading
              indicator: ≥4:1 is the industry-healthy band.
            </p>
          </div>
          <Link
            href="/bbs/observe"
            className="px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            New observation
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      {rows === null ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : (
        <>
          <section className={`rounded-2xl p-6 ${BAND_TILE[band]}`}>
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">Safe : Unsafe ratio</p>
            <p className="mt-1 text-5xl font-black tabular-nums">
              {summary.safeToUnsafeRatio === null ? '—' : `${summary.safeToUnsafeRatio.toFixed(2)} : 1`}
            </p>
            <p className="mt-2 text-sm font-semibold">{RATIO_BAND_LABEL[band]}</p>
          </section>

          <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Tile label="Total" value={summary.total} />
            <Tile label="Safe behaviors" value={summary.safeBehaviorCount} tone="emerald" />
            <Tile label="Unsafe (acts + conditions)" value={summary.unsafeCount} tone="rose" />
            <Tile label="Follow-ups due" value={summary.followUpsDue} tone="amber" />
            <Tile label="Recognized" value={summary.recognizedCount} tone="emerald" />
          </section>

          {/* Rapid reviews — WLS "Hot Seat" 24h SLA on critical observations. */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Rapid reviews ({RAPID_REVIEW_SLA_HOURS}h)</h2>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {rapidReviews.due} due · <span className={rapidReviews.overdue > 0 ? 'font-bold text-rose-600 dark:text-rose-400' : ''}>{rapidReviews.overdue} overdue</span>
              </p>
            </header>
            {rapidReviewRows.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No rapid reviews outstanding. Learn fast, fix fast.</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {rapidReviewRows.map(r => {
                  const overdue = +new Date(r.created_at) < slaCutoff
                  return (
                    <li key={r.id} className="px-5 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{r.description.slice(0, 120)}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {r.location_text ?? '—'} · {r.severity} · {new Date(r.created_at).toLocaleString()}
                        </p>
                      </div>
                      {overdue && (
                        <span className="shrink-0 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-[10px] font-bold uppercase tracking-wider px-2 py-1">Overdue</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Behavior-tag trend — which safe behaviors are we catching. */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-brand-navy" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Safe-behavior trend</h2>
            </header>
            {summary.safeBehaviorCount === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No tagged safe behaviors yet.</div>
            ) : (
              <ul className="px-5 py-3 space-y-2">
                {BEHAVIOR_TAG_CATALOG.map(t => {
                  const count = tagTally[t.key]
                  return (
                    <li key={t.key} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 text-xs font-medium text-slate-600 dark:text-slate-300">{t.label}</span>
                      <span className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <span className="block h-full bg-emerald-400 dark:bg-emerald-500" style={{ width: `${(count / maxTag) * 100}%` }} />
                      </span>
                      <span className="w-8 text-right text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{count}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Recognition feed — celebrate safe behaviors (WLS positive coaching). */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <Award className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recognition feed</h2>
            </header>
            {recognizedRows.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No recognized safe behaviors yet. Catch someone doing it right.</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {recognizedRows.map(r => (
                  <li key={r.id} className="px-5 py-3">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{r.description.slice(0, 120)}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {r.location_text ?? '—'} · {new Date(r.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Follow-ups due, grouped by Safety Action Team. */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Follow-ups due by team</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{summary.followUpsDue} outstanding</p>
            </header>
            {followUpGroups.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No outstanding follow-ups. Great job.</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {followUpGroups.map(g => (
                  <div key={g.team} className="px-5 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Users className="h-3 w-3" /> {g.team} · {g.rows.length}
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {g.rows.slice(0, 8).map(r => (
                        <li key={r.id}>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.description.slice(0, 120)}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {r.location_text ?? '—'} · {r.severity} · {new Date(r.created_at).toLocaleString()}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Inline Safety Action Team management (admin-only — page is already gated). */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <Users className="h-4 w-4 text-brand-navy" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Safety Action Teams</h2>
        </header>
        <div className="px-5 py-3 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTeamName}
              onChange={e => setNewTeamName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addTeam() }}
              placeholder="New team name"
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            />
            <button
              type="button"
              onClick={() => void addTeam()}
              disabled={teamBusy || newTeamName.trim().length === 0}
              className="px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
            >
              Add
            </button>
          </div>
          {teams.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No teams yet. Add one to assign follow-ups.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {teams.map(t => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                  <span className={`text-sm ${t.active ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500 line-through'}`}>{t.name}</span>
                  <button
                    type="button"
                    onClick={() => void toggleTeam(t.id, t.active)}
                    disabled={teamBusy}
                    className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-40"
                  >
                    {t.active ? 'Disable' : 'Enable'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

interface FollowUpGroup {
  team: string
  rows: ObservationDashboardRow[]
}

// Group outstanding follow-ups by their action team, resolving names from
// the team map. Null team → "Unassigned", always sorted last.
function groupFollowUpsByTeam(
  rows: readonly ObservationDashboardRow[],
  teamNameById: Map<string, string>,
): FollowUpGroup[] {
  const due = rows.filter(r => r.follow_up_required && !r.follow_up_completed_at)
  const byTeam = new Map<string, ObservationDashboardRow[]>()
  for (const r of due) {
    const team = (r.action_team_id && teamNameById.get(r.action_team_id)) || UNASSIGNED
    const bucket = byTeam.get(team)
    if (bucket) bucket.push(r)
    else byTeam.set(team, [r])
  }
  return [...byTeam.entries()]
    .map(([team, teamRows]) => ({ team, rows: teamRows }))
    .sort((a, b) => {
      if (a.team === UNASSIGNED) return 1
      if (b.team === UNASSIGNED) return -1
      return a.team.localeCompare(b.team)
    })
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'rose' | 'amber' }) {
  const bg = tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100'
           : tone === 'rose'    ? 'bg-rose-50    dark:bg-rose-950/40    text-rose-900    dark:text-rose-100'
           : tone === 'amber'   ? 'bg-amber-50   dark:bg-amber-950/40   text-amber-900   dark:text-amber-100'
           :                      'bg-slate-50   dark:bg-slate-900/40   text-slate-900   dark:text-slate-100'
  return (
    <div className={`rounded-xl px-4 py-3 ${bg}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-3xl font-black tabular-nums mt-1">{value}</p>
    </div>
  )
}
