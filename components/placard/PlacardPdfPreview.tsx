'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { generatePlacardPdf } from '@/lib/pdfPlacard'
import { downloadPdf } from '@/lib/pdfUtils'
import type { Equipment, LotoEnergyStep } from '@/lib/types'

interface Props {
  open:      boolean
  onClose:   () => void
  equipment: Equipment
  steps:     LotoEnergyStep[]
  onSaved?:  (publicUrl: string) => void
  onError?:  (message: string) => void
}

type UploadState = 'idle' | 'uploading' | 'saved' | 'error'

function sanitize(id: string) { return id.replace(/[^a-zA-Z0-9_-]/g, '_') }

export default function PlacardPdfPreview({ open, onClose, equipment, steps, onSaved, onError }: Props) {
  const [pdfBytes, setPdfBytes]   = useState<Uint8Array | null>(null)
  const [pdfUrl, setPdfUrl]       = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Capture latest callbacks + data in refs so the effect only re-fires when
  // the modal opens (not on every parent render that gives us new closures).
  const onSavedRef   = useRef(onSaved)
  const onErrorRef   = useRef(onError)
  const stepsRef     = useRef(steps)
  const equipmentRef = useRef(equipment)
  onSavedRef.current   = onSaved
  onErrorRef.current   = onError
  stepsRef.current     = steps
  equipmentRef.current = equipment

  const equipmentId = equipment.equipment_id

  useEffect(() => {
    if (!open) return

    let cancelled = false
    let objUrl: string | null = null
    setGenerating(true)
    setUploadState('idle')
    setPdfBytes(null)
    setPdfUrl(null)

    ;(async () => {
      try {
        const bytes = await generatePlacardPdf({ equipment: equipmentRef.current, steps: stepsRef.current })
        if (cancelled) return

        const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
        objUrl = URL.createObjectURL(blob)
        setPdfBytes(bytes)
        setPdfUrl(objUrl)
        setGenerating(false)

        setUploadState('uploading')
        const sanitized  = sanitize(equipmentId)
        const storagePath = `${sanitized}/${sanitized}_placard.pdf`
        const { error: upErr } = await supabase.storage
          .from('loto-photos')
          .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true })
        if (cancelled) return
        if (upErr) { setUploadState('error'); onErrorRef.current?.('Could not save placard to cloud.'); return }

        const { data: { publicUrl } } = supabase.storage.from('loto-photos').getPublicUrl(storagePath)
        const { error: patchErr } = await supabase
          .from('loto_equipment')
          .update({ placard_url: publicUrl, updated_at: new Date().toISOString() })
          .eq('equipment_id', equipmentId)
        if (cancelled) return
        if (patchErr) { setUploadState('error'); onErrorRef.current?.('Placard saved but record update failed.'); return }

        setUploadState('saved')
        onSavedRef.current?.(publicUrl)
      } catch {
        if (!cancelled) {
          setGenerating(false)
          setUploadState('error')
          onErrorRef.current?.('Could not generate placard.')
        }
      }
    })()

    return () => {
      cancelled = true
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
    // Only re-run when modal opens/closes or equipment changes — NOT on every
    // render when parent passes fresh callback closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, equipmentId])

  // Escape closes the modal
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  function handleDownload() {
    if (pdfBytes) downloadPdf(pdfBytes, `${equipment.equipment_id}_LOTO_Placard.pdf`)
  }

  function handlePrint() {
    const frame = iframeRef.current
    if (!frame) return
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      // Fallback: some browsers don't allow scripted print of blob PDFs —
      // open in a new tab and let the user print from there.
      if (pdfUrl) window.open(pdfUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col">
      {/* Toolbar */}
      <div className="bg-white border-b border-slate-200 flex items-center justify-between gap-3 px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-bold text-slate-900 truncate">{equipment.equipment_id}_LOTO_Placard.pdf</h2>
          <UploadStatusBadge state={uploadState} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handlePrint}
            disabled={generating || !pdfUrl}
            className="text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
          >
            🖨 Print
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={generating || !pdfBytes}
            className="text-sm font-semibold bg-brand-navy text-white hover:bg-brand-navy/90 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
          >
            ↓ Share
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Viewer */}
      <div className="flex-1 bg-slate-800 relative">
        {generating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-sm font-medium">Generating PDF…</p>
          </div>
        ) : pdfUrl ? (
          <iframe
            ref={iframeRef}
            src={pdfUrl}
            title={`Placard preview for ${equipment.equipment_id}`}
            className="w-full h-full border-0 bg-white"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
            Could not generate placard.
          </div>
        )}
      </div>
    </div>
  )
}

function UploadStatusBadge({ state }: { state: UploadState }) {
  if (state === 'idle') return null
  if (state === 'uploading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
        <span className="w-2.5 h-2.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
        Saving to cloud…
      </span>
    )
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
        ✓ Saved to cloud
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 rounded-full px-2 py-0.5">
      ⚠ Cloud save failed
    </span>
  )
}
