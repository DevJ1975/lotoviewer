'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertOctagon, ArrowRight } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// Surfaced on the incident detail page when the repeat-incident
// detector finds matches in the prior 90 days. Fails closed: any
// fetch failure renders nothing — the detector is "nice to have"
// rather than a blocker on the detail page.

interface Match {
  id:             string
  report_number:  string
  occurred_at:    string
  incident_type:  string
  description:    string
  location_text:  string | null
  score:          number
  reasons:        string[]
}

export default function RepeatIncidentBanner({ incidentId }: { incidentId: string }) {
  const { tenant } = useTenant()
  const [matches, setMatches] = useState<Match[]>([])
  const [loaded,  setLoaded]  = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id || !incidentId) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${incidentId}/repeats?days=90`, { headers })
      const body = await res.json()
      if (res.ok) setMatches(body.matches as Match[])
    } catch {
      // Best-effort. Hide on failure.
    } finally {
      setLoaded(true)
    }
  }, [tenant, incidentId])

  useEffect(() => { void load() }, [load])

  if (!loaded || matches.length === 0) return null

  return (
    <section className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 p-4 space-y-2">
      <header className="flex items-center gap-2">
        <AlertOctagon className="h-4 w-4 text-amber-700 dark:text-amber-300" />
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          {matches.length} similar incident{matches.length === 1 ? '' : 's'} in the last 90 days
        </h3>
      </header>
      <ul className="divide-y divide-amber-200 dark:divide-amber-900">
        {matches.map(m => (
          <li key={m.id} className="py-2">
            <Link
              href={`/incidents/${m.id}`}
              className="flex items-start gap-3 hover:bg-amber-100/40 dark:hover:bg-amber-900/30 rounded-md px-2 -mx-2 py-1"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-amber-700 dark:text-amber-300">{m.report_number}</span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {new Date(m.occurred_at).toLocaleDateString()}
                  </span>
                  <span className="inline-block rounded-full bg-amber-200 dark:bg-amber-800/60 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 dark:text-amber-100">
                    {Math.round(m.score * 100)}% match
                  </span>
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-200 truncate mt-0.5">{m.description}</p>
                <p className="text-[11px] text-amber-800 dark:text-amber-200 mt-0.5">
                  {m.reasons.join(' · ')}
                </p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300 shrink-0 mt-1" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
