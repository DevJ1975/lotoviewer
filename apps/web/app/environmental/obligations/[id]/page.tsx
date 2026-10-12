'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Scale } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useCanEditRegisters } from '../../_components/access'
import { ObligationDetail } from '../_components/ObligationDetail'

// /environmental/obligations/[id] — one obligation as a page: where the
// "compliance evaluations to complete" email links, so an evaluator lands on
// the evidence upload and the result form.

export default function ObligationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { tenantId } = useTenant()
  const canEdit = useCanEditRegisters()

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <Link href="/environmental/obligations" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Compliance obligations
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-slate-100">
          <Scale className="h-5 w-5 text-brand-navy" />
          Compliance obligation
        </h1>
      </div>
      {tenantId && <ObligationDetail tenantId={tenantId} obligationId={id} canEdit={canEdit} />}
    </div>
  )
}
