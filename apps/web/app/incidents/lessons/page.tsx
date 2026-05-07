'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, BookOpen, Loader2, Search, ShieldAlert } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { RCA_METHOD_LABEL, type RcaMethod } from '@soteria/core/rcaSchemas'
import { INCIDENT_TYPE_LABEL, SEVERITY_ACTUAL_LABEL,
  type IncidentType, type IncidentSeverityActual } from '@soteria/core/incident'

// /incidents/lessons — Lessons-learned library.
//
// Surfaces every published lesson on the tenant. Each row links
// back to its incident detail page. Privacy-case incidents render
// "Privacy case — description redacted" to honour 1904.29(b)(7).

interface Lesson {
  investigation_id:    string
  incident_id:         string
  lesson_summary:      string
  lesson_published_at: string
  rca_method:          RcaMethod
  scope_summary:       string | null
  root_causes:         string | null
  is_privacy_case:     boolean
  incident: {
    report_number:   string
    occurred_at:     string
    description:     string
    location_text:   string | null
    incident_type:   IncidentType
    severity_actual: IncidentSeverityActual
  }
}

export default function LessonsPage() {
  const { tenant } = useTenant()
  const [items,   setItems]   = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [search,  setSearch]  = useState('')

  const load = useCallback(async (q?: string) => {
    if (!tenant?.id) return
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const url = q ? `/api/incidents/lessons?search=${encodeURIComponent(q)}` : '/api/incidents/lessons'
      const res = await fetch(url, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setItems(body.lessons as Lesson[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/incidents" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incidents
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-brand-navy" />
          Lessons-learned library
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Closed investigations published by the lead investigator. Read what others learned so you don&apos;t relearn it the hard way.
        </p>
      </header>

      <form
        onSubmit={e => { e.preventDefault(); void load(search.trim()) }}
        className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-1.5"
      >
        <Search className="h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search lessons by keyword, root cause, report number…"
          className="flex-1 bg-transparent outline-none text-sm py-1"
        />
        <button
          type="submit"
          className="text-xs font-semibold text-brand-navy hover:underline"
        >
          Search
        </button>
      </form>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No published lessons yet.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            On a closed investigation, toggle &quot;Publish lesson&quot; to surface it here.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {items.map(l => (
          <li key={l.investigation_id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
            <header className="flex flex-wrap items-center gap-2 mb-2">
              <Link
                href={`/incidents/${l.incident_id}`}
                className="font-mono text-xs text-brand-navy hover:underline"
              >
                {l.incident.report_number}
              </Link>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {INCIDENT_TYPE_LABEL[l.incident.incident_type]}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {SEVERITY_ACTUAL_LABEL[l.incident.severity_actual]}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                · RCA: {RCA_METHOD_LABEL[l.rca_method]}
              </span>
              <span className="text-[10px] text-slate-400 ml-auto">
                Published {new Date(l.lesson_published_at).toLocaleDateString()}
              </span>
            </header>
            {l.is_privacy_case && (
              <p className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 mb-2">
                <ShieldAlert className="h-3 w-3" />
                Privacy case — description redacted per 1904.29(b)(7)
              </p>
            )}
            <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{l.lesson_summary}</p>
            {l.root_causes && (
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Root causes</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap mt-0.5">{l.root_causes}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
