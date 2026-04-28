'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import Toast from '@/components/Toast'
import PlacardView from '@/components/placard/PlacardView'
import PlacardPdfPreview from '@/components/placard/PlacardPdfPreview'
import PlacardDetailsSheet from '@/components/placard/PlacardDetailsSheet'
import EditStepsSheet from '@/components/placard/EditStepsSheet'
import SpanishTranslationSheet from '@/components/SpanishTranslationSheet'
import { useSession } from '@/components/SessionProvider'
import { useToast } from '@/hooks/useToast'
import type { Equipment, LotoEnergyStep } from '@/lib/types'
import { AnnotatedPhoto } from '@/components/AnnotatedPhoto'
import { parseAnnotations, type Annotation } from '@/lib/photoAnnotations'

export default function EquipmentDetailPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-48 text-slate-400 dark:text-slate-500 text-sm">Loading…</div>}>
      <EquipmentDetail />
    </Suspense>
  )
}

function EquipmentDetail() {
  const { id }       = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const equipmentId  = decodeURIComponent(id)
  // Default back-link target is the LOTO dashboard, not '/' — the root
  // path is now the home screen, which would be a confusing destination
  // if a user arrived here via direct URL.
  const fromUrl      = searchParams.get('from') ?? '/loto'

  const [equipment, setEquipment]   = useState<Equipment | null>(null)
  const [steps, setSteps]           = useState<LotoEnergyStep[]>([])
  const [loading, setLoading]       = useState(true)
  const [notFound, setNotFound]     = useState(false)
  const [prevId, setPrevId]         = useState<string | null>(null)
  const [nextId, setNextId]         = useState<string | null>(null)

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [stepsOpen, setStepsOpen]     = useState(false)
  const [spanishOpen, setSpanishOpen] = useState(false)
  const [pdfOpen, setPdfOpen]         = useState(false)

  const { toast, showToast, clearToast } = useToast()
  const { recordVisit } = useSession()

  useEffect(() => { if (equipmentId) recordVisit(equipmentId) }, [equipmentId, recordVisit])

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('loto_equipment')
      .select('*')
      .eq('equipment_id', equipmentId)
      .single()

    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const eq = data as Equipment
    setEquipment(eq)

    const { data: stepRows, error: stepErr } = await supabase
      .from('loto_energy_steps')
      .select('*')
      .eq('equipment_id', equipmentId)
      .order('energy_type', { ascending: true })
      .order('step_number', { ascending: true })
    // Surface fetch failures so "No energy steps defined" can be traced
    // back to auth / RLS / network rather than looking like empty data.
    if (stepErr) {
      console.error('[equipment] energy-steps fetch failed', {
        equipmentId,
        error:   stepErr,
        message: stepErr.message,
      })
    } else {
      console.info('[equipment] energy-steps fetched', {
        equipmentId,
        count: stepRows?.length ?? 0,
      })
    }
    if (stepRows) setSteps(stepRows as LotoEnergyStep[])

    const { data: siblings } = await supabase
      .from('loto_equipment')
      .select('equipment_id')
      .eq('department', eq.department)
      .order('equipment_id', { ascending: true })
    if (siblings) {
      const ids = siblings.map((r: { equipment_id: string }) => r.equipment_id)
      const idx = ids.indexOf(equipmentId)
      setPrevId(idx > 0 ? ids[idx - 1] : null)
      setNextId(idx < ids.length - 1 ? ids[idx + 1] : null)
    }

    setLoading(false)
  }, [equipmentId])

  useEffect(() => { load() }, [load])

  function navTo(targetId: string) {
    router.push(`/equipment/${encodeURIComponent(targetId)}?from=${encodeURIComponent(fromUrl)}`)
  }

  async function handlePhotoUploaded(/* url */) {
    // Re-load equipment to pick up URL + photo_status changes from hook's DB patch
    const { data } = await supabase.from('loto_equipment').select('*').eq('equipment_id', equipmentId).single()
    if (data) setEquipment(data as Equipment)
  }

  function handleOpenPdf() {
    setPdfOpen(true)
  }

  if (loading) {
    return <div className="max-w-5xl mx-auto px-4 py-12 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">Loading…</div>
  }

  if (notFound || !equipment) {
    return (
      <div className="text-center py-24">
        <p className="text-slate-500 dark:text-slate-400 text-lg font-medium mb-4">Equipment not found</p>
        <Link href="/loto" className="text-brand-navy text-sm font-semibold hover:underline">← Back to LOTO Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Link
            href={fromUrl}
            className="flex items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Back"
          >
            ← Back
          </Link>
          <div className="hidden sm:block text-slate-300">|</div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">{equipment.equipment_id}</h1>
            {equipment.verified && <span className="text-emerald-500 text-sm" title="Verified">✓</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <ToolbarButton onClick={() => setDetailsOpen(true)}>✎ Edit Details</ToolbarButton>
          <ToolbarButton onClick={() => setStepsOpen(true)}>
            ⚡ {steps.length === 0 ? 'Add Steps' : 'Edit Steps'}
          </ToolbarButton>
          <ToolbarButton onClick={() => setSpanishOpen(true)}>
            {equipment.spanish_reviewed ? <><span className="text-emerald-500">✓</span> Español</> : 'Español'}
          </ToolbarButton>
          <ToolbarButton onClick={handleOpenPdf} primary>
            📄 Generate PDF
          </ToolbarButton>

          <div className="flex items-center gap-1 ml-1">
            <ArrowButton onClick={() => prevId && navTo(prevId)} disabled={!prevId} title={prevId ? `Previous: ${prevId}` : 'No previous'}>
              ←
            </ArrowButton>
            <ArrowButton onClick={() => nextId && navTo(nextId)} disabled={!nextId} title={nextId ? `Next: ${nextId}` : 'No next'}>
              →
            </ArrowButton>
          </div>
        </div>
      </div>

      {/* Placard */}
      <PlacardView
        equipment={equipment}
        steps={steps}
        onPhotoSuccess={msg => { showToast(msg, 'success'); handlePhotoUploaded() }}
        onPhotoError={msg => showToast(msg, 'error')}
      />

      {/* Photo annotations — overlay arrows + labels onto the equipment
          photo to call out disconnects, valves, and isolation points.
          Read-only when there's no equip photo yet (the editor opens on
          a non-existent image otherwise). */}
      {equipment.equip_photo_url && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
          <header className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Annotated equipment photo</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Tap "Annotate" to add arrows + labels pointing at isolation points.
            </p>
          </header>
          <div className="relative aspect-video bg-slate-50 dark:bg-slate-900/40 rounded-lg overflow-hidden">
            <AnnotatedPhoto
              src={equipment.equip_photo_url}
              alt={`${equipment.equipment_id} equipment photo`}
              annotations={parseAnnotations(equipment.annotations)}
              editable
              onSave={async (next: Annotation[]) => {
                const { data, error } = await supabase
                  .from('loto_equipment')
                  .update({ annotations: next, updated_at: new Date().toISOString() })
                  .eq('equipment_id', equipmentId)
                  .select('*')
                  .single()
                if (error) {
                  console.error('[equipment] save annotations failed', { equipmentId, error })
                  showToast(`Could not save: ${error.code ?? ''} ${error.message}`, 'error')
                  // Re-throw so AnnotatedPhoto keeps the editor open and
                  // the user's work isn't silently discarded.
                  throw error
                }
                if (data) setEquipment(data as Equipment)
                showToast('Annotations saved', 'success')
              }}
            />
          </div>
        </section>
      )}

      {/* Same overlay UX for the isolation photo, with red arrows so the
          two layers read as distinct. Persists to iso_annotations
          (migration 022) instead of annotations. */}
      {equipment.iso_photo_url && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
          <header className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Annotated isolation photo</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Tap "Annotate" to add red arrows + labels naming each isolation point.
            </p>
          </header>
          <div className="relative aspect-video bg-slate-50 dark:bg-slate-900/40 rounded-lg overflow-hidden">
            <AnnotatedPhoto
              src={equipment.iso_photo_url}
              alt={`${equipment.equipment_id} isolation photo`}
              annotations={parseAnnotations(equipment.iso_annotations)}
              color="#BF1414"
              editable
              onSave={async (next: Annotation[]) => {
                const { data, error } = await supabase
                  .from('loto_equipment')
                  .update({ iso_annotations: next, updated_at: new Date().toISOString() })
                  .eq('equipment_id', equipmentId)
                  .select('*')
                  .single()
                if (error) {
                  console.error('[equipment] save iso_annotations failed', { equipmentId, error })
                  showToast(`Could not save: ${error.code ?? ''} ${error.message}`, 'error')
                  throw error
                }
                if (data) setEquipment(data as Equipment)
                showToast('Annotations saved', 'success')
              }}
            />
          </div>
        </section>
      )}

      {/* Sheets */}
      <PlacardDetailsSheet
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        equipment={equipment}
        onSaved={patch => setEquipment(prev => prev ? { ...prev, ...patch } : prev)}
        onToast={showToast}
      />

      <EditStepsSheet
        open={stepsOpen}
        onClose={() => setStepsOpen(false)}
        equipment={equipment}
        steps={steps}
        onSaved={setSteps}
        onToast={showToast}
      />

      <SpanishTranslationSheet
        open={spanishOpen}
        onClose={() => setSpanishOpen(false)}
        equipmentId={equipmentId}
        notesEs={equipment.notes_es ?? ''}
        reviewed={equipment.spanish_reviewed ?? false}
        steps={steps}
        onSaved={(notesEs, reviewed, updatedSteps) => {
          setSteps(updatedSteps)
          setEquipment(prev => prev ? { ...prev, notes_es: notesEs, spanish_reviewed: reviewed } : prev)
        }}
        onToast={showToast}
      />

      <PlacardPdfPreview
        open={pdfOpen}
        onClose={() => setPdfOpen(false)}
        equipment={equipment}
        steps={steps}
        onSaved={publicUrl => setEquipment(prev => prev ? { ...prev, placard_url: publicUrl } : prev)}
        onError={msg => showToast(msg, 'error')}
      />

      {toast && <Toast {...toast} onClose={clearToast} />}
    </div>
  )
}

function ToolbarButton({ onClick, disabled, primary, children }: { onClick: () => void; disabled?: boolean; primary?: boolean; children: React.ReactNode }) {
  const base = 'flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap'
  const style = primary
    ? 'bg-brand-navy text-white hover:bg-brand-navy/90'
    : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/40'
  return <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${style}`}>{children}</button>
}

function ArrowButton({ onClick, disabled, title, children }: { onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center w-8 h-8 rounded-lg border border-emerald-600 bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}
