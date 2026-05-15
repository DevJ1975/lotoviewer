'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertTriangle, FileText, Users, Calendar, Sparkles, Archive, Search } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// /toolbox-talks — landing page
//
// Sections rendered:
//   1. Today's talk — the row whose talk_date = today, prominently
//      featured because that's the talk the foreman delivers this
//      morning.
//   2. Upcoming — today + 13 days. Workers can preview two weeks.
//   3. Recent — most recent 30 talks (loaded with the default view).
//   4. Archive — full historical library, lazy-loaded behind a "View
//      archive" toggle. Includes a client-side search across title +
//      date so a supervisor can find a specific talk for an audit
//      response without scrolling. The archive request hits the API
//      with `?archive=1` which widens the past limit from 30 to 365.
//
// There is no "Generate" button. Generation is the cron's job — the
// abuse-prevention posture the operator asked for.

interface TalkSummary {
  id:           string
  talk_date:    string
  title:        string
  topic_id:     string
  generated_at: string
}

interface PastTalkSummary extends TalkSummary {
  toolbox_talk_signatures: Array<{ count: number }>
}

interface ListResponse {
  today_str: string
  upcoming:  TalkSummary[]
  past:      PastTalkSummary[]
  archive?:  boolean
}

export default function ToolboxTalksListPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? null
  const requestSeq = useRef(0)
  const [data,           setData]           = useState<ListResponse | null>(null)
  const [error,          setError]          = useState<string | null>(null)
  const [archiveOpen,    setArchiveOpen]    = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveQuery,   setArchiveQuery]   = useState('')

  const fetchTalks = useCallback(async (mode: 'default' | 'archive') => {
    if (!tenantId) return null
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenantId }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const path = mode === 'archive' ? '/api/toolbox-talks?archive=1' : '/api/toolbox-talks'
    const res  = await fetch(path, { headers })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    return body as ListResponse
  }, [tenantId])

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setError(null)
    try {
      const body = await fetchTalks('default')
      if (body && seq === requestSeq.current) setData(body)
    } catch (e) {
      if (seq === requestSeq.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [fetchTalks])

  const openArchive = useCallback(async () => {
    if (archiveOpen) { setArchiveOpen(false); return }
    setArchiveOpen(true)
    // Only refetch if we don't already have the full archive (the
    // default fetch caps at 30 — if the user has more than 30 past
    // talks, we need the wider response).
    if (!data?.archive) {
      setArchiveLoading(true)
      const seq = ++requestSeq.current
      try {
        const body = await fetchTalks('archive')
        if (body && seq === requestSeq.current) setData(body)
      } catch (e) {
        if (seq === requestSeq.current) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (seq === requestSeq.current) setArchiveLoading(false)
      }
    }
  }, [archiveOpen, data, fetchTalks])

  useEffect(() => {
    requestSeq.current += 1
    setData(null)
    setError(null)
    setArchiveOpen(false)
    setArchiveLoading(false)
    setArchiveQuery('')
    void load()
  }, [tenantId, load])

  const filteredArchive = useMemo(() => {
    if (!data?.past) return [] as PastTalkSummary[]
    const q = archiveQuery.trim().toLowerCase()
    if (!q) return data.past
    return data.past.filter(t =>
      t.title.toLowerCase().includes(q) || t.talk_date.includes(q)
    )
  }, [data, archiveQuery])

  const todayTalk = data?.upcoming.find(t => t.talk_date === data.today_str) ?? null
  const upcoming  = data?.upcoming.filter(t => t.talk_date !== data.today_str) ?? []

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Toolbox Talks</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Daily pre-shift safety briefings. A new talk lands every day; sign in
          when you&apos;ve attended.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data === null && !error && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {data && (
        <>
          {/* Today's talk — featured. Empty state covers the case where
              the cron hasn't run yet for this tenant or the module was
              just enabled. */}
          <section className="rounded-xl border-2 border-brand-navy/20 bg-gradient-to-br from-brand-navy/5 to-transparent dark:from-brand-navy/20 p-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-navy dark:text-blue-300">
              <Sparkles className="h-3.5 w-3.5" />
              Today&apos;s Talk
            </div>
            {todayTalk ? (
              <div className="mt-2">
                <Link
                  href={`/toolbox-talks/${todayTalk.id}`}
                  className="text-xl font-semibold text-slate-900 dark:text-slate-100 hover:underline"
                >
                  {todayTalk.title}
                </Link>
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(todayTalk.talk_date)}
                  </span>
                </div>
                <Link
                  href={`/toolbox-talks/${todayTalk.id}`}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
                >
                  Open and sign in →
                </Link>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                No talk scheduled for today yet. Check back after the next
                generation run, or contact your administrator.
              </p>
            )}
          </section>

          {/* Upcoming two-week schedule */}
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                Coming up
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {upcoming.map(t => (
                  <Link
                    key={t.id}
                    href={`/toolbox-talks/${t.id}`}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:border-brand-navy hover:shadow-sm transition-all"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDate(t.talk_date)}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                      {t.title}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Past — recent 30 by default, full archive when toggled. */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {archiveOpen ? `Archive (${filteredArchive.length}${archiveQuery ? ` of ${data.past.length}` : ''})` : `Recent (${data.past.length})`}
              </h2>
              {data.past.length > 0 && (
                <button
                  onClick={() => void openArchive()}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-navy dark:text-blue-300 hover:underline"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {archiveOpen ? 'Hide archive' : 'View archive'}
                </button>
              )}
            </div>

            {archiveOpen && (
              <div className="mb-3 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={archiveQuery}
                  onChange={e => setArchiveQuery(e.target.value)}
                  placeholder="Search title or date (e.g. 'PPE' or '2026-05')"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-navy"
                />
              </div>
            )}

            {archiveLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading full archive…
              </div>
            )}

            {data.past.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center">
                <FileText className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600" />
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  No past talks yet. They&apos;ll appear here as the days roll on.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Title</th>
                      <th className="px-3 py-2 text-left">Signed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
                    {(archiveOpen ? filteredArchive : data.past.slice(0, 30)).map(t => {
                      const signCount = t.toolbox_talk_signatures?.[0]?.count ?? 0
                      return (
                        <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {formatDate(t.talk_date)}
                          </td>
                          <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                            <Link href={`/toolbox-talks/${t.id}`} className="hover:underline">
                              {t.title}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {signCount}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    {archiveOpen && filteredArchive.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                          No talks match &ldquo;{archiveQuery}&rdquo;.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function formatDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString(undefined, {
    weekday: 'short', month:   'short', day:     'numeric', year:    'numeric',
  })
}
