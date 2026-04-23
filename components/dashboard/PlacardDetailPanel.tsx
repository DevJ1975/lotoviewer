'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PlacardView from '@/components/placard/PlacardView'
import Toast from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import type { Equipment, LotoEnergyStep } from '@/lib/types'

interface Props {
  equipment: Equipment | null
  // Fires with the photo type when a slot reports a successful save — used
  // by the parent dashboard to auto-advance to the next needs-photo item.
  onPhotoSaved?: (type: 'equip' | 'iso') => void
}

export default function PlacardDetailPanel({ equipment, onPhotoSaved }: Props) {
  const [steps, setSteps]     = useState<LotoEnergyStep[]>([])
  const [loading, setLoading] = useState(false)
  const { toast, showToast, clearToast } = useToast()

  // Depend only on the equipment_id, NOT the whole equipment object.
  // `equipment` changes reference on every realtime tick (the parent's
  // selectedEquipment useMemo re-runs whenever ANY row in the dashboard
  // updates), and the previous `[equipment]` dep re-fetched steps from
  // the DB on every such tick even though nothing about the steps
  // changed. Scoping to the id makes the effect re-fire only when the
  // user selects a different item — which is the real invalidation.
  const equipmentId = equipment?.equipment_id
  useEffect(() => {
    if (!equipmentId) { setSteps([]); return }
    setLoading(true)
    supabase
      .from('loto_energy_steps')
      .select('*')
      .eq('equipment_id', equipmentId)
      .order('energy_type', { ascending: true })
      .order('step_number', { ascending: true })
      .then(({ data, error }) => {
        // Log the fetch result so "No energy steps defined" distinguishes
        // between "query ran, returned nothing" (data mismatch — check the
        // equipment_id column in loto_energy_steps) and "query failed"
        // (RLS, auth, network).
        if (error) {
          console.error('[placard] energy-steps fetch failed', {
            equipmentId,
            error,
            message: error.message,
          })
        } else {
          console.info('[placard] energy-steps fetched', {
            equipmentId,
            count: data?.length ?? 0,
          })
        }
        if (data) setSteps(data as LotoEnergyStep[])
        setLoading(false)
      })
  }, [equipmentId])

  if (!equipment) {
    return (
      <aside className="shrink-0 w-full lg:w-[520px] bg-slate-100 border-l border-slate-200 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-2xl mx-auto mb-3">📋</div>
          <p className="text-sm font-semibold text-slate-700">Select an equipment item</p>
          <p className="text-xs text-slate-400 mt-1">Its placard will appear here.</p>
        </div>
      </aside>
    )
  }

  const href = `/equipment/${encodeURIComponent(equipment.equipment_id)}?from=${encodeURIComponent('/')}`

  return (
    <aside className="shrink-0 w-full lg:w-[520px] bg-slate-100 border-l border-slate-200 flex flex-col">
      <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Placard Preview</p>
          <h2 className="font-mono text-sm font-bold text-slate-900 truncate">{equipment.equipment_id}</h2>
        </div>
        <Link
          href={href}
          className="text-xs font-semibold bg-brand-navy text-white px-3 py-1.5 rounded-lg hover:bg-brand-navy/90 transition-colors whitespace-nowrap"
        >
          Open ›
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading…</div>
        ) : (
          <PlacardView
            equipment={equipment}
            steps={steps}
            onPhotoSuccess={msg => showToast(msg, 'success')}
            onPhotoError={msg => showToast(msg, 'error')}
            onPhotoSaved={onPhotoSaved}
          />
        )}
      </div>

      {toast && <Toast {...toast} onClose={clearToast} />}
    </aside>
  )
}
