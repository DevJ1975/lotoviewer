'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, ExternalLink, FileText, Loader2, Sparkles, Upload } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { PictogramBadges, SignalWordBadge } from '../_components/PictogramBadges'
import PrintLabelPanel from './_components/PrintLabelPanel'

interface Product {
  id:                string
  name:              string
  manufacturer:      string | null
  product_code:      string | null
  cas_numbers:       string[] | null
  synonyms:          string[] | null
  physical_state:    string | null
  ghs_pictograms:    string[] | null
  ghs_signal_word:   string | null
  hazard_statements: { code: string; text: string }[] | null
  precautionary_statements: { code: string; text: string }[] | null
  nfpa_health:        number | null
  nfpa_flammability:  number | null
  nfpa_instability:   number | null
  nfpa_special:       string | null
  ppe_required:       string[] | null
  flash_point_c:      number | null
  boiling_point_c:    number | null
  storage_class:      string | null
  incompatibilities:  string[] | null
  sds_revision_date:  string | null
  sds_source_url:     string | null
  active_sds_id:      string | null
  notes:              string | null
  archived_at:        string | null
}

interface Revision {
  id:             string
  revision_date:  string | null
  language:       string
  storage_path:   string
  file_bytes:     number | null
  source:         string
  parse_review_status: 'pending' | 'approved' | 'rejected'
  parse_model:    string | null
  parse_confidence: number | null
  superseded_at:  string | null
  created_at:     string
}

export default function ChemicalDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { tenant } = useTenant()

  const [product,    setProduct]   = useState<Product | null>(null)
  const [revisions,  setRevisions] = useState<Revision[]>([])
  const [error,      setError]     = useState<string | null>(null)
  const [loading,    setLoading]   = useState(true)
  const [uploading,  setUploading] = useState(false)
  const [parsingId,  setParsingId]  = useState<string | null>(null)
  const [revisionDate, setRevisionDate] = useState('')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    setLoading(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res  = await fetch(`/api/chemicals/products/${id}`, { headers })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        setProduct(null)
        return
      }
      setProduct(body.product)
      setRevisions(body.revisions ?? [])
    } finally {
      setLoading(false)
    }
  }, [tenant, id, buildHeaders])

  useEffect(() => { void load() }, [load])

  async function viewSds(sdsId: string) {
    if (!id) return
    const headers = await buildHeaders()
    const res  = await fetch(`/api/chemicals/products/${id}/sds/${sdsId}/url`, { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    window.open(body.url, '_blank', 'noopener,noreferrer')
  }

  async function parseSds(sdsId: string) {
    if (!id) return
    setParsingId(sdsId)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res  = await fetch(`/api/chemicals/products/${id}/sds/${sdsId}/parse`, {
        method:  'POST',
        headers,
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      router.push('/chemicals/review')
    } finally {
      setParsingId(null)
    }
  }

  async function uploadSds(file: File) {
    if (!id) return
    setUploading(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const form = new FormData()
      form.append('file', file)
      if (revisionDate) form.append('revision_date', revisionDate)
      const res  = await fetch(`/api/chemicals/products/${id}/sds`, {
        method:  'POST',
        headers,
        body:    form,
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setRevisionDate('')
      await load()
    } finally {
      setUploading(false)
    }
  }

  async function archive() {
    if (!id) return
    if (!confirm('Archive this chemical? It will be hidden from the catalog but its SDS history is retained.')) return
    const headers = await buildHeaders()
    const res = await fetch(`/api/chemicals/products/${id}`, { method: 'DELETE', headers })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    router.push('/chemicals')
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !product) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to catalog
        </Link>
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error ?? 'Chemical not found.'}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to catalog
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{product.name}</h1>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-3">
            {product.manufacturer && <span>{product.manufacturer}</span>}
            {product.product_code && <span>· {product.product_code}</span>}
            {product.physical_state && <span>· {product.physical_state}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SignalWordBadge word={product.ghs_signal_word} />
            <PictogramBadges pictograms={product.ghs_pictograms ?? []} showLabel />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={archive}
            className="px-3 py-2 text-sm rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            Archive
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Identification">
          <Field label="CAS numbers" value={product.cas_numbers?.join(', ')} />
          <Field label="Synonyms" value={product.synonyms?.join(', ')} />
        </Card>
        <Card title="NFPA 704">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <NfpaTile label="Health" value={product.nfpa_health} bg="bg-sky-100 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300" />
            <NfpaTile label="Flammability" value={product.nfpa_flammability} bg="bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300" />
            <NfpaTile label="Instability" value={product.nfpa_instability} bg="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300" />
            <NfpaTile label="Special" value={product.nfpa_special} bg="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200" />
          </div>
        </Card>
        <Card title="Storage & physical">
          <Field label="Storage class" value={product.storage_class} />
          <Field label="Flash point" value={product.flash_point_c !== null && product.flash_point_c !== undefined ? `${product.flash_point_c} °C` : null} />
          <Field label="Boiling point" value={product.boiling_point_c !== null && product.boiling_point_c !== undefined ? `${product.boiling_point_c} °C` : null} />
          <Field label="Incompatible with" value={product.incompatibilities?.join(', ')} />
        </Card>
        <Card title="PPE">
          <Field label="Required PPE" value={product.ppe_required?.join(', ')} />
        </Card>
      </section>

      {(product.hazard_statements?.length || product.precautionary_statements?.length) ? (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {product.hazard_statements && product.hazard_statements.length > 0 && (
            <Card title="Hazard statements (H-codes)">
              <ul className="text-sm space-y-1">
                {product.hazard_statements.map(h => (
                  <li key={h.code}><span className="font-mono text-xs mr-1">{h.code}</span>{h.text}</li>
                ))}
              </ul>
            </Card>
          )}
          {product.precautionary_statements && product.precautionary_statements.length > 0 && (
            <Card title="Precautionary statements (P-codes)">
              <ul className="text-sm space-y-1">
                {product.precautionary_statements.map(p => (
                  <li key={p.code}><span className="font-mono text-xs mr-1">{p.code}</span>{p.text}</li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      ) : null}

      <PrintLabelPanel productId={product.id} />

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        {revisions.some(r => r.parse_review_status === 'pending') && (
          <Link
            href="/chemicals/review"
            className="block mb-3 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2 text-sm text-indigo-800 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
          >
            <Sparkles className="inline w-4 h-4 mr-1" />
            An SDS parse is awaiting review — click to approve or reject the AI-proposed fields.
          </Link>
        )}
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Safety Data Sheets
          </h2>
          {product.sds_source_url && (
            <a
              href={product.sds_source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
            >
              Manufacturer source <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <label className="block mb-3">
          <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Upload a new SDS revision (PDF, max 25 MB). Becomes the active SDS for this chemical.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={revisionDate}
              onChange={e => setRevisionDate(e.target.value)}
              className="px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              placeholder="Revision date"
              title="Revision date (optional)"
            />
            <label className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded border cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : 'border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/30'}`}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Choose PDF'}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) void uploadSds(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </label>

        {revisions.length === 0 ? (
          <div className="text-sm text-slate-500 italic">No SDS uploaded yet.</div>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
            {revisions.map(rev => {
              const isActive = rev.id === product.active_sds_id
              return (
                <li key={rev.id} className="px-3 py-2 flex flex-wrap items-center gap-3 text-sm">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span className="font-mono text-xs">
                    {rev.revision_date ?? new Date(rev.created_at).toISOString().slice(0, 10)}
                  </span>
                  <span className="text-xs text-slate-500 uppercase">{rev.language}</span>
                  <span className="text-xs text-slate-500">{formatBytes(rev.file_bytes)}</span>
                  <span className="text-xs text-slate-500">via {rev.source}</span>
                  {isActive && (
                    <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      ACTIVE
                    </span>
                  )}
                  {rev.superseded_at && !isActive && (
                    <span className="text-[11px] text-slate-500">superseded {new Date(rev.superseded_at).toISOString().slice(0, 10)}</span>
                  )}
                  {rev.parse_review_status === 'pending' && (
                    <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                      AWAITING REVIEW
                    </span>
                  )}
                  <button
                    onClick={() => void parseSds(rev.id)}
                    disabled={parsingId === rev.id}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Send this SDS to Claude for structured extraction"
                  >
                    {parsingId === rev.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Sparkles className="w-3 h-3" />}
                    {parsingId === rev.id ? 'Parsing…' : 'Parse with AI'}
                  </button>
                  <button
                    onClick={() => void viewSds(rev.id)}
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                  >
                    <Download className="w-3 h-3" /> View
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {product.notes && (
        <Card title="Notes">
          <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">{product.notes}</p>
        </Card>
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="text-sm flex gap-2">
      <span className="text-slate-500 min-w-[110px]">{label}</span>
      <span className="text-slate-800 dark:text-slate-200">{value && value.trim() ? value : <span className="italic text-slate-400">—</span>}</span>
    </div>
  )
}

function NfpaTile({ label, value, bg }: { label: string; value: number | string | null | undefined; bg: string }) {
  return (
    <div className={`flex flex-col items-center justify-center w-16 h-16 rounded font-bold text-2xl ${bg}`}>
      <span>{value === null || value === undefined || value === '' ? '–' : value}</span>
      <span className="text-[9px] uppercase font-medium opacity-70">{label}</span>
    </div>
  )
}

function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
