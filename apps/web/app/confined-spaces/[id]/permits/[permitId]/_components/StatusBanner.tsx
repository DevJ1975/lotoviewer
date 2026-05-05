'use client'

import type { ConfinedSpacePermit } from '@soteria/core/types'
import { permitState } from '@soteria/core/confinedSpaceThresholds'

// Top-of-page status banner. Drives color and detail copy off the
// derived `state` (active / pending_signature / canceled / expired).
// State derivation lives in lib/confinedSpaceThresholds so the rules
// can be unit-tested without React.

export function StatusBanner({ state, permit }: {
  state:  NonNullable<ReturnType<typeof permitState>>
  permit: ConfinedSpacePermit
}) {
  const cfg = state === 'active' ? {
    label: 'ACTIVE',
    bg:    'bg-emerald-600',
    detail: `Signed ${permit.entry_supervisor_signature_at ? new Date(permit.entry_supervisor_signature_at).toLocaleString() : ''} — entry authorized`,
  } : state === 'pending_signature' ? {
    label: 'PENDING SIGNATURE',
    bg:    'bg-amber-500',
    detail: 'Take pre-entry atmospheric test below, then sign to authorize entry.',
  } : state === 'canceled' ? {
    label: 'CANCELED',
    bg:    'bg-slate-600',
    detail: `Canceled ${permit.canceled_at ? new Date(permit.canceled_at).toLocaleString() : ''} — ${permit.cancel_reason ?? ''}${permit.cancel_notes ? `: ${permit.cancel_notes}` : ''}`,
  } : {
    label: 'EXPIRED',
    bg:    'bg-rose-600',
    detail: `Expired ${new Date(permit.expires_at).toLocaleString()} without cancellation. Cancel manually if entry is complete.`,
  }
  return (
    <div className={`${cfg.bg} text-white rounded-xl px-4 py-3`}>
      <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">{cfg.label}</p>
      <p className="text-sm mt-0.5">{cfg.detail}</p>
    </div>
  )
}
