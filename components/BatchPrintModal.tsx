'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Equipment, LotoEnergyStep } from '@/lib/types'

interface Props {
  open:      boolean
  onClose:   () => void
  equipment: Equipment[]
  initialDepartment?: string | null
}

export default function BatchPrintModal({ open, onClose, equipment, initialDepartment }: Props) {
  const [dept, setDept]           = useState<string>('')
  const [busy, setBusy]           = useState(false)
  const [progress, setProgress]   = useState(0)
  const [phase, setPhase]         = useState<'idle' | 'fetching' | 'rendering' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)

  // Ref keeps onClose current without forcing the keydown effect to re-bind
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Track timers so we can clear them on unmount / re-open
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current) }, [])

  const departments = useMemo(
    () => [...new Set(equipment.map(e => e.department))].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [equipment],
  )

  useEffect(() => {
    if (open) {
      if (autoCloseTimer.current) { clearTimeout(autoCloseTimer.current); autoCloseTimer.current = null }
      setDept(initialDepartment ?? '')
      setBusy(false)
      setPhase('idle')
      setProgress(0)
      setErrorMsg(null)
    }
  }, [open, initialDepartment])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, busy])

  const deptEquipment = useMemo(
    () => (dept ? equipment.filter(e => e.department === dept) : []),
    [equipment, dept],
  )
  const withPhotos = useMemo(
    () => deptEquipment.filter(e => e.has_equip_photo || e.has_iso_photo).length,
    [deptEquipment],
  )

  async function handleGenerate() {
    if (!dept || deptEquipment.length === 0) return
    setBusy(true)
    setProgress(0)
    setPhase('fetching')
    setErrorMsg(null)

    try {
      // One query for all dept equipment — previously fired N requests in parallel.
      const equipmentIds = deptEquipment.map(eq => eq.equipment_id)
      const { data: allSteps, error: stepsError } = await supabase
        .from('loto_energy_steps')
        .select('*')
        .in('equipment_id', equipmentIds)
        .order('energy_type', { ascending: true })
        .order('step_number', { ascending: true })
      if (stepsError) throw stepsError

      const stepsByEquipment = new Map<string, LotoEnergyStep[]>()
      for (const step of (allSteps as LotoEnergyStep[] | null) ?? []) {
        const list = stepsByEquipment.get(step.equipment_id) ?? []
        list.push(step)
        stepsByEquipment.set(step.equipment_id, list)
      }

      const items = deptEquipment.map(eq => ({
        equipment: eq,
        steps:     stepsByEquipment.get(eq.equipment_id) ?? [],
      }))

      setPhase('rendering')
      // Lazy-load pdf-lib here — only needed when the user actually generates.
      const [{ generateBatchPlacardPdf }, { downloadPdf }] = await Promise.all([
        import('@/lib/pdfPlacard'),
        import('@/lib/pdfUtils'),
      ])
      const bytes = await generateBatchPlacardPdf(items, (done: number, total: number) => {
        setProgress(Math.round((done / total) * 100))
      })

      downloadPdf(bytes, `${dept}_LOTO_Placards.pdf`)
      setPhase('done')
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current)
      autoCloseTimer.current = setTimeout(() => onCloseRef.current(), 900)
    } catch {
      setPhase('error')
      setErrorMsg('Could not generate batch PDF. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Batch Print by Department</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 text-xl leading-none disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="batch-dept" className="text-xs font-semibold text-slate-600">Department</label>
            <select
              id="batch-dept"
              value={dept}
              onChange={e => setDept(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
            >
              <option value="">Select a department…</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {dept && (
            <div className="bg-slate-50 rounded-lg px-4 py-3 text-sm">
              <p className="text-slate-700">
                <span className="font-semibold">{deptEquipment.length}</span> equipment items
                <span className="text-slate-400"> · </span>
                <span className="font-semibold">{withPhotos}</span> with photos
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Output: {deptEquipment.length * 2} pages (English + Spanish per item)
              </p>
            </div>
          )}

          {(phase === 'fetching' || phase === 'rendering') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">
                  {phase === 'fetching' ? 'Fetching energy steps…' : `Rendering PDF (${progress}%)`}
                </span>
                {phase === 'rendering' && <span className="text-slate-400 tabular-nums">{progress}%</span>}
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-brand-navy transition-all"
                  style={{ width: `${phase === 'rendering' ? progress : 10}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'done' && (
            <p className="text-sm font-semibold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
              ✓ PDF downloaded.
            </p>
          )}

          {phase === 'error' && errorMsg && (
            <p className="text-sm font-semibold text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}
        </div>

        <div className="px-6 pb-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 disabled:opacity-40"
          >
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy || !dept || deptEquipment.length === 0}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {busy ? 'Generating…' : 'Generate Batch PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
