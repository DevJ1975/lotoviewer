'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, BarChart3, ClipboardCheck, Gauge, Mountain, ScrollText,
} from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'

// /environmental — EMS module home.
//
// The registers behind this module shipped long before it existed as a
// module (migrations 204-207) and were unreachable except by typing an
// /admin URL. This hub is the fix: one place that says how big each
// register is and routes into it, with the report card first because
// "how are we doing" is the question people actually arrive with.

interface RegisterCounts {
  aspects:        number
  significant:    number
  objectives:     number
  reviews:        number
  nonconformities: number
  openFindings:   number
}

const CARDS = [
  {
    href:  '/environmental/report-card',
    Icon:  Gauge,
    title: 'Audit readiness',
    desc:  'Clause-by-clause evidence coverage and what blocks a certification audit.',
    clause: 'Report card',
  },
  {
    href:  '/environmental/aspects',
    Icon:  Mountain,
    title: 'Aspects & impacts',
    desc:  'Activities, their environmental aspects, and significance scoring.',
    clause: 'Clause 6.1.2',
  },
  {
    href:  '/environmental/objectives',
    Icon:  BarChart3,
    title: 'Objectives & targets',
    desc:  'Measurable objectives tracked by periodic readings.',
    clause: 'Clauses 6.2 & 9.1.1',
  },
  {
    href:  '/environmental/management-review',
    Icon:  ScrollText,
    title: 'Management review',
    desc:  'Periodic EMS reviews with the standard input and output agenda.',
    clause: 'Clause 9.3',
  },
  {
    href:  '/environmental/nonconformities',
    Icon:  ClipboardCheck,
    title: 'Nonconformities & CAPA',
    desc:  'Findings and corrective actions with separation-of-duty verification.',
    clause: 'Clause 10.2',
  },
] as const

export default function EnvironmentalHomePage() {
  const { tenantId } = useTenant()
  const [counts, setCounts]       = useState<RegisterCounts | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const head = (table: string) =>
        supabase.from(table).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)

      const [aspects, significant, objectives, reviews, ncs, openNcs] = await Promise.all([
        head('environmental_aspects'),
        head('environmental_aspects').eq('is_significant', true),
        head('environmental_objectives'),
        head('management_reviews'),
        head('nonconformities'),
        head('nonconformities').in('status', ['open', 'in_progress']),
      ])

      const firstError = [aspects, significant, objectives, reviews, ncs, openNcs]
        .find(r => r.error)?.error
      if (firstError) throw new Error(formatSupabaseError(firstError, 'load EMS registers'))

      setCounts({
        aspects:         aspects.count ?? 0,
        significant:     significant.count ?? 0,
        objectives:      objectives.count ?? 0,
        reviews:         reviews.count ?? 0,
        nonconformities: ncs.count ?? 0,
        openFindings:    openNcs.count ?? 0,
      })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the EMS registers.')
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const countFor = (href: string): string | null => {
    if (!counts) return null
    switch (href) {
      case '/environmental/aspects':
        return `${counts.aspects} recorded · ${counts.significant} significant`
      case '/environmental/objectives':
        return `${counts.objectives} objectives`
      case '/environmental/management-review':
        return `${counts.reviews} reviews`
      case '/environmental/nonconformities':
        return `${counts.nonconformities} findings · ${counts.openFindings} open`
      default:
        return null
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <PageHeader
        icon={Mountain}
        eyebrow="ISO 14001:2015"
        title="Environmental Management"
        description="The EMS registers the standard requires, and a report card that says how ready they are for an audit."
      />

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{loadError}</span>
        </div>
      )}

      {!counts && !loadError ? (
        <div className="flex items-center justify-center py-16"><OpsSpinner /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map(({ href, Icon, title, desc, clause }) => (
            <Link
              key={href}
              href={href}
              className="placard-surface-interactive motion-press group flex flex-col gap-2 p-4"
            >
              <span className="flex items-center gap-2">
                <span className="module-icon-tile">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="placard-label text-slate-500 dark:text-slate-400">{clause}</span>
              </span>
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{desc}</span>
              {countFor(href) && (
                <span className="placard-numeric mt-auto pt-1 text-xs text-brand-navy dark:text-brand-yellow">
                  {countFor(href)}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
