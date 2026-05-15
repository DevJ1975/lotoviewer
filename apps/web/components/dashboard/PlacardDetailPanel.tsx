'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PlacardView from '@/components/placard/PlacardView'
import Toast from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { useTenant } from '@/components/TenantProvider'

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
  const { tenantId }                      = useTenant()

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
    if (!equipmentId || !tenantId) {
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
        .eq('tenant_id', tenantId)
        .eq('equipment_id', equipmentId)
        .single(),
      supabase
        .from('loto_energy_steps')
        .select('*')
        .eq('tenant_id', tenantId)
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
  }, [equipmentId, tenantId])

  if (!equipment) {
    return (
      <aside className="shrink-0 w-full lg:w-[520px] bg-slate-100 dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex items-center justify-center">
        <div className="text-center px-6 max-w-xs">
          <span className="placard-label-lg text-slate-500 dark:text-slate-500">Standby</span>
          <p className="stencil-title text-base text-slate-700 dark:text-slate-300 mt-2">No item selected</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            Pick an equipment row from the register and its placard will load on this panel.
          </p>
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
    <aside className="shrink-0 w-full lg:w-[520px] bg-slate-100 dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex flex-col">
      {/* Header reads like a real placard banner — hazard-yellow rail
          on the left, stencil ID, monospaced placard ID echoes the
          register's row treatment. */}
      <div className="relative px-4 py-3 pl-5 bg-white dark:bg-slate-900 border-b-2 border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 shrink-0">
        <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-1 rounded-r-sm bg-brand-yellow" />
        <div className="min-w-0">
          <p className="placard-label text-slate-500 dark:text-slate-500">Placard Preview</p>
          <h2 className="placard-numeric text-base font-black text-slate-950 dark:text-slate-50 truncate mt-0.5">
            {equipment.equipment_id}
          </h2>
        </div>
        <Link
          href={href}
          className="placard-label rounded-sm bg-brand-navy text-white px-3 py-1.5 hover:bg-brand-navy/90 transition-colors whitespace-nowrap"
        >
          Open ›
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 dark:text-slate-500 text-sm">Loading…</div>
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
