'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import {
  clearSubscription, getSubscription, setSubscription,
  type SubscriptionState,
} from '@/lib/safetyBoards/client'

// Small follow / mute toggle. Three states cycle:
//   null   → click → 'follow'
//   follow → click → 'mute'
//   mute   → click → null
// The cycle is what users intuitively want from a single button:
// "I'm not interested" → "I want updates" → "stop pinging me even
// though I posted" → back to default.

interface Props {
  targetType: 'board' | 'thread'
  targetId:   string
  className?: string
}

export default function SubscribeButton({ targetType, targetId, className }: Props) {
  const { tenant } = useTenant()
  const [state, setState] = useState<SubscriptionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    void (async () => {
      try {
        const s = await getSubscription(tenant.id, targetType, targetId)
        if (!cancelled) setState(s)
      } catch { /* keep null */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [tenant?.id, targetType, targetId])

  async function cycle() {
    if (!tenant?.id) return
    setBusy(true)
    try {
      let next: SubscriptionState | null
      if (state === null)        next = 'follow'
      else if (state === 'follow') next = 'mute'
      else                          next = null
      if (next === null) {
        await clearSubscription(tenant.id, targetType, targetId)
      } else {
        await setSubscription(tenant.id, targetType, targetId, next)
      }
      setState(next)
    } catch { /* leave state untouched */ }
    finally { setBusy(false) }
  }

  if (loading) return null

  const label =
    state === 'follow' ? 'Following' :
    state === 'mute'   ? 'Muted'     :
                         'Follow'
  const Icon = state === 'mute' ? BellOff : Bell
  const cls = state === 'follow'
    ? 'bg-brand-navy/10 dark:bg-brand-yellow/15 text-brand-navy dark:text-brand-yellow ring-brand-navy/30'
    : state === 'mute'
      ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 ring-slate-300 dark:ring-slate-700'
      : 'text-slate-600 dark:text-slate-300 ring-slate-300 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'

  return (
    <button
      type="button"
      onClick={() => void cycle()}
      disabled={busy}
      className={'inline-flex items-center gap-1 rounded-full ring-1 px-2 py-1 text-xs font-medium ' + cls + ' ' + (className ?? '')}
      title={state === 'follow' ? 'Click to mute' : state === 'mute' ? 'Click to unsubscribe' : 'Click to follow'}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {label}
    </button>
  )
}
