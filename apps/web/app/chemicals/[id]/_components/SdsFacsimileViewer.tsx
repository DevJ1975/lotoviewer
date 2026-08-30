'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, Loader2, X } from 'lucide-react'
import {
  SDS_FACSIMILE_DISCLAIMER,
  SDS_FACSIMILE_EMPTY_SECTION_NOTE,
  type SdsFacsimileModel,
} from '@soteria/core/sdsFacsimile'
import { PictogramBadges, SignalWordBadge } from '../../_components/PictogramBadges'

// On-screen 16-section SDS facsimile. This is a DERIVED, reformatted view of
// the parsed SDS — the manufacturer original (linked via "View original PDF")
// remains the OSHA HazCom document of record, so the disclaimer banner +
// provenance are rendered unconditionally. Both this viewer and the PDF
// generator consume the same SdsFacsimileModel, so they can't drift apart.

interface Props {
  productId:    string
  sdsId:        string
  buildHeaders: () => Promise<Record<string, string>>
  onClose:      () => void
}

export default function SdsFacsimileViewer({ productId, sdsId, buildHeaders, onClose }: Props) {
  const [model,       setModel]       = useState<SdsFacsimileModel | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const headers = await buildHeaders()
        const res  = await fetch(`/api/chemicals/products/${productId}/sds/${sdsId}/facsimile`, { headers })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(body.error ?? `HTTP ${res.status}`); return }
        setModel(body.model as SdsFacsimileModel)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [productId, sdsId, buildHeaders])

  const download = useCallback(async () => {
    if (!model) return
    setDownloading(true)
    try {
      // Lazy-load pdf-lib + the generator so it stays out of the page bundle.
      const [{ generateSdsFacsimilePdf }, { downloadPdf }] = await Promise.all([
        import('@/lib/pdfSdsFacsimile'),
        import('@/lib/pdfUtils'),
      ])
      const bytes = await generateSdsFacsimilePdf({ model, viewUrl: window.location.href })
      const safe  = (model.productName || 'SDS').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80)
      downloadPdf(bytes, `${safe || 'SDS'}_facsimile.pdf`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(false)
    }
  }, [model])

  const viewOriginal = useCallback(async () => {
    try {
      const headers = await buildHeaders()
      const res  = await fetch(`/api/chemicals/products/${productId}/sds/${sdsId}/url`, { headers })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? `HTTP ${res.status}`); return }
      window.open(body.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [productId, sdsId, buildHeaders])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="my-4 w-full max-w-3xl rounded-lg bg-white dark:bg-slate-900 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <FileText className="w-4 h-4" /> SDS facsimile
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void viewOriginal()}
              className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <ExternalLink className="w-3.5 h-3.5" /> View original PDF
            </button>
            <button
              onClick={() => void download()}
              disabled={!model || downloading}
              className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
            <button onClick={onClose} aria-label="Close" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 py-12 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          )}
          {error && (
            <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
              {error}
            </div>
          )}
          {model && !loading && (
            <article className="space-y-4">
              {/* Mandatory "not the original" banner. */}
              <div className="rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-800 dark:text-rose-200">
                {SDS_FACSIMILE_DISCLAIMER}
              </div>

              <header className="space-y-2">
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{model.productName || 'Safety Data Sheet'}</h1>
                <div className="flex flex-wrap items-center gap-2">
                  <SignalWordBadge word={model.signalWord} />
                  <PictogramBadges pictograms={model.pictograms} showLabel />
                </div>
                <Provenance model={model} />
              </header>

              <div className="space-y-3">
                {model.sections.map(section => (
                  <section key={section.number} className="rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <h3 className="bg-[#214488] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white">
                      {section.number}. {section.title}
                    </h3>
                    <div className="px-3 py-2">
                      {section.fields.length === 0 ? (
                        <p className="text-xs italic text-slate-400">{SDS_FACSIMILE_EMPTY_SECTION_NOTE}</p>
                      ) : (
                        <dl className="space-y-1.5">
                          {section.fields.map((f, i) => (
                            <div key={`${f.label}-${i}`} className="flex gap-2 text-sm">
                              <dt className="min-w-[140px] shrink-0 font-medium text-slate-500 dark:text-slate-400">{f.label}</dt>
                              <dd className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{f.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}

function Provenance({ model }: { model: SdsFacsimileModel }) {
  const p = model.provenance
  return (
    <div className="rounded bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
      <div>
        Source:{' '}
        {p.sourceUrl
          ? <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline break-all">{p.sourceUrl}</a>
          : <span className="italic text-slate-400">not recorded</span>}
      </div>
      <div className="flex flex-wrap gap-x-4">
        {p.revisionDate && <span>SDS revision: {p.revisionDate}</span>}
        {p.parsedDate && <span>Parsed: {p.parsedDate.slice(0, 10)}</span>}
        {p.parseModel && <span>By: {p.parseModel}</span>}
        {p.parseConfidence && <span>Confidence: {p.parseConfidence}</span>}
      </div>
    </div>
  )
}
