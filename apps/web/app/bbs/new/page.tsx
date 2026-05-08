'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { ObservationForm, type BBSFormPayload } from '../_components/ObservationForm'

export default function NewBBSObservationPage() {
  const router = useRouter()
  const { tenant } = useTenant()

  async function handleSubmit(payload: BBSFormPayload) {
    if (!tenant?.id) throw new Error('No active tenant — refresh and try again.')
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant.id,
    }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const res = await fetch('/api/bbs/observations', {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    router.push(`/bbs/${body.observation.id}`)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div>
        <Link href="/bbs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="w-4 h-4" />
          Back to BBS
        </Link>
      </div>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New observation</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Filing as you. You&apos;ll earn points on the leaderboard.
        </p>
      </header>
      <ObservationForm anonymous={false} onSubmit={handleSubmit} />
    </div>
  )
}
