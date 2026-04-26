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
  const [steps, setSteps]                 = useState<LotoEnergyStep[]>([])
  const [fullEquipment, setFullEquipment] = useState<Equipment | null>(null)
  const [loading, setLoading]             = useState(false)
  const { toast, showToast, clearToast }  = useToast()

  // Depend only on the equipment_id, NOT the whole equipment object.
  // `equipment` changes reference on every realtime tick (the parent's
  // selectedEquipment useMemo re-runs whenever ANY row in the dashboard
  // updates). Scoping to the id makes the effect re-fire only when the
  // user selects a different item — which is the real invalidation.
  //
  // We also re-fetch the FULL equipment row here because the dashboard list
  // omits large text fields (notes, notes_es, internal_notes) from its SELECT
  // for bandwidth reasons. The placard view needs notes to render the red
  // warning block correctly, so it's owned here not inherited.
  const equipmentId = equipment?.equipment_id
  useEffect(() => {
    if (!equipmentId) {
      setSteps([])
      setFullEquipment(null)
      return
    }
    setLoading(true)
    let cancelled = false
    Promise.all([
      supabase
        .from('loto_equipment')
        .select('*')
        .eq('equipment_id', equipmentId)
        .single(),
      supabase
        .from('loto_energy_steps')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('energy_type', { ascending: true })
        .order('step_number', { ascending: true }),
    ]).then(([eqRes, stepRes]) => {
      if (cancelled) return
      if (eqRes.error) {
        console.error('[placard] equipment fetch failed', {
          equipmentId,
          error:   eqRes.error,
          message: eqRes.error.message,
        })
      } else if (eqRes.data) {
        setFullEquipment(eqRes.data as Equipment)
      }
      if (stepRes.error) {
        console.error('[placard] energy-steps fetch failed', {
          equipmentId,
          error:   stepRes.error,
          message: stepRes.error.message,
        })
      } else {
        console.info('[placard] energy-steps fetched', {
          equipmentId,
          count: stepRes.data?.length ?? 0,
        })
      }
      if (stepRes.data) setSteps(stepRes.data as LotoEnergyStep[])
      setLoading(false)
    })
    return () => { cancelled = true }
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

  // Back-link target is /loto with the user's dept + selection
  // preserved as query params. Without this, returning from the
  // equipment detail page dropped the user on the LOTO dashboard's
  // first dept with nothing selected — losing the row they were
  // editing.
  const back = `/loto?dept=${encodeURIComponent(equipment.department)}&eq=${encodeURIComponent(equipment.equipment_id)}`
  const href = `/equipment/${encodeURIComponent(equipment.equipment_id)}?from=${encodeURIComponent(back)}`

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
            equipment={fullEquipment ?? equipment}
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
