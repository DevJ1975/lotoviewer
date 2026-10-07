'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileSearch, Loader2, UploadCloud } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { useFacility } from '@/components/FacilityProvider'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { DOCUMENT_TYPE_LABELS, type DocumentStatus, type DocumentType } from '@soteria/core/documentExtraction'
import {
  checkPdf, getDocument, listDocuments, rejectDocument, uploadDocument,
  type DocumentDetail, type DocumentListRow, type DocumentScope,
} from '@/lib/environmental/documentsClient'
import { DecidedSummary, ReviewPanel } from './_components/ReviewPanel'

// /environmental/documents — upload a permit, manifest or SWPPP and review what
// the system read from it. The reading is a proposal (deterministic pattern
// matching, OCR for scans); a tenant admin approves it, and only then does
// anything reach the compliance calendar.

const POLL_MS = 5000

const STATUS_LABEL: Record<DocumentStatus, string> = {
  processing: 'Reading…', needs_review: 'Needs review', approved: 'Approved', rejected: 'Rejected', failed: 'Could not read',
}
const STATUS_BADGE: Record<DocumentStatus, string> = {
  processing:   'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  needs_review: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  approved:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  rejected:     'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  failed:       'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
}

const typeLabel = (t: string | null) => (t && t in DOCUMENT_TYPE_LABELS ? DOCUMENT_TYPE_LABELS[t as DocumentType] : 'Reading…')

export default function EnvironmentalDocumentsPage() {
  const { profile } = useAuth()
  const { tenantId } = useTenant()
  const { facilityId } = useFacility()
  const canDecide = !!profile?.is_admin || !!profile?.is_superadmin

  const [docs, setDocs] = useState<DocumentListRow[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const scope: DocumentScope | null = tenantId ? { tenantId, facilityId } : null

  const refresh = useCallback(async () => {
    if (!tenantId) return
    try {
      setDocs(await listDocuments({ tenantId, facilityId }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load documents.')
    }
  }, [tenantId, facilityId])

  useEffect(() => { void refresh() }, [refresh])

  // Documents are read in the background; keep looking until none is waiting.
  const waiting = docs?.some(d => d.status === 'processing') ?? false
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, refresh])

  const selectedStatus = docs?.find(d => d.id === selectedId)?.status
  useEffect(() => {
    if (!selectedId || !tenantId) { setDetail(null); return }
    let current = true
    getDocument({ tenantId, facilityId }, selectedId)
      .then(d => { if (current) setDetail(d) })
      .catch(e => { if (current) setError(e instanceof Error ? e.message : 'Could not load the document.') })
    return () => { current = false }
  }, [selectedId, selectedStatus, tenantId, facilityId])

  async function onFile(file: File | undefined) {
    if (!file || !scope) return
    setError(null)
    const problem = await checkPdf(file)
    if (problem) { setError(problem); return }
    setUploading(true)
    try {
      const { id } = await uploadDocument(scope, file)
      await refresh()
      setSelectedId(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const onDecided = () => { setDetail(null); void refresh() }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <PageHeader
        icon={FileSearch}
        eyebrow="ISO 14001:2015"
        title="Permit & manifest reader"
        description="Upload a permit, manifest or stormwater plan. The system reads it and proposes the identifiers and dates it finds; you check each one against the original before anything is filed."
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput} type="file" accept="application/pdf" className="sr-only" id="document-upload"
          onChange={e => void onFile(e.target.files?.[0])}
        />
        <label
          htmlFor="document-upload" aria-disabled={uploading || !facilityId}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white dark:bg-brand-yellow dark:text-slate-900 ${uploading || !facilityId ? 'pointer-events-none opacity-50' : 'hover:opacity-90'}`}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          Upload a PDF
        </label>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {facilityId ? 'PDF, up to 25 MB. Scans are read with OCR and take a few minutes.' : 'Choose a facility to upload: each document belongs to one facility.'}
        </span>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      {!docs && !error ? (
        <div className="flex items-center justify-center py-16"><OpsSpinner /></div>
      ) : docs && docs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          No documents yet. Upload a permit or manifest to see what the system can read from it.
        </p>
      ) : docs && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ul className="space-y-2" aria-label="Documents">
            {docs.map(d => (
              <li key={d.id}>
                <button
                  type="button" onClick={() => setSelectedId(d.id)} aria-current={d.id === selectedId}
                  className={`placard-surface-interactive w-full space-y-1 p-3 text-left ${d.id === selectedId ? 'ring-2 ring-brand-navy dark:ring-brand-yellow' : ''}`}
                >
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{d.file_name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_BADGE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                    <span>{typeLabel(d.doc_type)}</span>
                    <span>{new Date(d.created_at).toLocaleDateString()}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section className="placard-surface min-h-[12rem] p-4" aria-live="polite">
            {!selectedId ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">Select a document to see what was read from it.</p>
            ) : !detail || detail.id !== selectedId ? (
              <div className="flex items-center justify-center py-10"><OpsSpinner /></div>
            ) : detail.status === 'processing' ? (
              <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading the document. A scan can take a few minutes; you can leave this page.
              </p>
            ) : detail.status === 'failed' ? (
              <div className="space-y-3">
                <p className="text-sm text-rose-700 dark:text-rose-300">{detail.error ?? 'This document could not be read.'}</p>
                {canDecide && scope && (
                  <button
                    type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => void rejectDocument(scope, detail.id).then(onDecided).catch(e => setError(e instanceof Error ? e.message : 'Could not dismiss.'))}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            ) : detail.status === 'needs_review' && scope ? (
              <ReviewPanel key={detail.id} doc={detail} scope={scope} canDecide={canDecide} onDecided={onDecided} />
            ) : (
              <DecidedSummary doc={detail} />
            )}
          </section>
        </div>
      )}
    </div>
  )
}
