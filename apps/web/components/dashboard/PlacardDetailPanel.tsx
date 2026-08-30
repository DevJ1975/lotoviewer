'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import PlacardView from '@/components/placard/PlacardView'
import OpsSpinner from '@/components/OpsSpinner'
import Toast from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { useTenant } from '@/components/TenantProvider'

interface Props {
  equipment: Equipment | null
  // Fires with the photo type when a slot reports a successful save — used
  // by the parent dashboard to auto-advance to the next needs-photo item.
  onPhotoSaved?: (type: 'equip' | 'iso') => void
  // Clears the selection. Only used below lg, where the panel presents as a
  // slide-over sheet (close button / scrim / Escape). Optional so existing
  // consumers and tests that render the panel alone keep compiling.
  onClose?: () => void
}

export default function PlacardDetailPanel({ equipment, onPhotoSaved, onClose }: Props) {
  const [steps, setSteps]                 = useState<LotoEnergyStep[]>([])
  const [fullEquipment, setFullEquipment] = useState<Equipment | null>(null)
  const [loading, setLoading]             = useState(false)
  const { toast, showToast, clearToast }  = useToast()
  const { tenantId }                      = useTenant()

  // Held in a ref so the sheet-behavior effect below depends only on
  // equipmentId — a changing onClose identity must not re-run it. Effect-sync
  // (not render-phase assignment) keeps react-hooks/refs happy; the ref is
  // only read from event handlers, which always fire after effects run.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

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

  // Sheet-mode behaviors — only below lg, where the panel presents as a
  // slide-over: Escape clears the selection and the body scroll locks while
  // it is open. At lg+ the panel is a persistent column, where Escape-clears-
  // selection would surprise and a scroll lock would be wrong. 1024px mirrors
  // Tailwind's `lg`; matchMedia is queried at event time, never at render, so
  // SSR/hydration never see it. Keyed on equipmentId, NOT the equipment
  // object — realtime ticks change its reference on every DB write.
  useEffect(() => {
    if (!equipmentId) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mq.matches) onCloseRef.current?.()
    }
    const syncLock = () => { document.body.style.overflow = mq.matches ? '' : 'hidden' }
    syncLock()
    mq.addEventListener('change', syncLock) // rotation: release the lock at lg+
    document.addEventListener('keydown', onKey)
    return () => {
      mq.removeEventListener('change', syncLock)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [equipmentId])

  if (!equipment) {
    // hidden below lg: with nothing selected there is no sheet to show, and
    // stacking a full-width "Standby" placeholder under the list (the old
    // behavior) just pushed dead weight onto iPad-portrait screens.
    return (
      <aside aria-label="Placard preview" className="shrink-0 w-full lg:w-[520px] bg-slate-100 dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 hidden lg:flex items-center justify-center">
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

  // Below lg the panel presents as a right-anchored slide-over sheet (the
  // max-lg:* utilities); at lg+ the class list resolves to exactly the old
  // inline column. One mounted <aside> for both modes — a portal'd
  // dialog/drawer would remount the panel across the lg boundary and re-fire
  // the fetches above (see PlacardDetailPanel.refetch.test.tsx).
  //
  // Deliberately NOT role="dialog"/aria-modal: without a real focus trap that
  // would be dishonest semantics, and a trap needs a portal — see above. It
  // stays a named complementary landmark with scrim + close + Escape.
  //
  // Tree shape is load-bearing for the animation: the no-selection branch
  // returns a bare <aside>, this one a fragment, so React remounts the aside
  // when the sheet OPENS (slide-in plays) but swaps content in place when the
  // user moves item A → item B (no re-animation, no extra refetch).
  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-label="Placard preview"
        className="shrink-0 w-full lg:w-[520px] bg-slate-100 dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex flex-col max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-50 max-lg:max-w-md max-lg:shadow-2xl max-lg:animate-in max-lg:slide-in-from-right max-lg:duration-200 motion-reduce:animate-none"
      >
        {/* Header reads like a real placard banner — hazard-yellow rail
            on the left, stencil ID, monospaced placard ID echoes the
            register's row treatment. */}
        <div className="relative px-4 py-3 pl-5 bg-white dark:bg-slate-900 border-b-2 border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 shrink-0">
          <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-1 rounded-r-sm bg-brand-yellow" />
          <div className="min-w-0 flex-1">
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
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close placard preview"
              className="lg:hidden shrink-0 -mr-2 h-11 w-11 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy dark:focus-visible:ring-brand-yellow"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <OpsSpinner size="md" label="Loading placard" />
            </div>
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
    </>
  )
}
