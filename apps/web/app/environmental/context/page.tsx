'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Compass, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { getRegistersHealth, type RegistersHealth } from '@/lib/environmental/client'
import { useCanEditRegisters } from '../_components/access'
import { RegisterHealthStrip } from '../_components/RegisterHealthStrip'
import { IssuesTab } from './_components/IssuesTab'
import { PartiesTab } from './_components/PartiesTab'
import { ScopePolicyTab } from './_components/ScopePolicyTab'

// /environmental/context — clauses 4.1, 4.2, 4.3 and 5.2 in three tabs:
// the issues that shape the EMS (climate change included), the interested
// parties and their needs, and the scope and policy. The tab lives in the
// URL (?tab=parties, ?tab=scope or ?tab=policy) so the report card can link
// straight to the gap it names.

type Tab = 'issues' | 'parties' | 'scope'

const TABS: { id: Tab; label: string; clause: string }[] = [
  { id: 'issues',  label: 'Issues',              clause: '4.1' },
  { id: 'parties', label: 'Interested parties',  clause: '4.2' },
  { id: 'scope',   label: 'Scope & policy',      clause: '4.3 & 5.2' },
]

function tabFrom(param: string | null): Tab {
  if (param === 'parties') return 'parties'
  if (param === 'scope' || param === 'policy') return 'scope'
  return 'issues'
}

function ContextRegisters() {
  const { tenantId } = useTenant()
  const canEdit = useCanEditRegisters()
  const router = useRouter()
  const tab = tabFrom(useSearchParams().get('tab'))
  const [health, setHealth] = useState<RegistersHealth | null>(null)

  const loadHealth = useCallback(async () => {
    if (!tenantId) return
    try { setHealth(await getRegistersHealth(tenantId)) }
    catch { setHealth(null) }   // the tabs report their own load errors; the strip just stays empty
  }, [tenantId])

  useEffect(() => { void loadHealth() }, [loadHealth])

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <Link href="/environmental" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Environmental
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          <Compass className="h-6 w-6 text-brand-navy" />
          Context, scope &amp; policy
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          ISO 14001:2015 clauses 4.1-4.3 and 5.2: what shapes the EMS, who has a stake in it, where it applies,
          and what top management commits it to.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <RegisterHealthStrip title="Context" health={health?.context.health ?? null} facts={health ? [
          { label: 'issues', value: health.context.active },
          { label: 'review overdue', value: health.context.reviewOverdue, warn: health.context.reviewOverdue > 0 },
          { label: 'climate decision', value: health.context.climateRecorded ? 'recorded' : 'missing', warn: !health.context.climateRecorded },
        ] : []} />
        <RegisterHealthStrip title="Scope & policy" health={health?.scopeAndPolicy.health ?? null} facts={health ? [
          { label: 'scope', value: health.scopeAndPolicy.scopeVersion ? `v${health.scopeAndPolicy.scopeVersion}` : 'none', warn: !health.scopeAndPolicy.scopeVersion },
          { label: 'policy', value: health.scopeAndPolicy.policyVersion ? `v${health.scopeAndPolicy.policyVersion}` : 'none', warn: !health.scopeAndPolicy.policyVersion },
        ] : []} />
      </div>

      <div role="tablist" aria-label="Context registers" className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            onClick={() => router.replace(t.id === 'issues' ? '/environmental/context' : `/environmental/context?tab=${t.id}`)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id
              ? 'border-brand-navy text-brand-navy dark:border-brand-yellow dark:text-brand-yellow'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
            {t.label} <span className="text-[10px] text-slate-400">{t.clause}</span>
          </button>
        ))}
      </div>

      {tenantId && (
        <div role="tabpanel">
          {tab === 'issues' && <IssuesTab tenantId={tenantId} canEdit={canEdit} onChanged={() => void loadHealth()} />}
          {tab === 'parties' && <PartiesTab tenantId={tenantId} canEdit={canEdit} onChanged={() => void loadHealth()} />}
          {tab === 'scope' && <ScopePolicyTab tenantId={tenantId} canEdit={canEdit} onChanged={() => void loadHealth()} />}
        </div>
      )}
    </div>
  )
}

export default function EnvironmentalContextPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
      <ContextRegisters />
    </Suspense>
  )
}
