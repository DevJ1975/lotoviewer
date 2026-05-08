'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Upload, Trash2, FileText, AlertCircle, CheckCircle2, Globe, Building2 } from 'lucide-react'
import { superadminFetch, superadminJson } from '@/lib/superadminFetch'

// /superadmin/policies
//
// Knowledge-base management UI. Lets a superadmin:
//   - upload company policies (per tenant) or regulatory docs (global)
//   - browse the corpus by tenant or source type
//   - delete a document (cascades to its chunks)
//
// PR2 ships the first cut. Re-embed on existing docs (when Voyage
// updates a model) is a follow-up — operators can delete + re-upload
// for now.

interface DocRow {
  id:              string
  tenant_id:       string | null
  tenant_name:     string | null
  source_type:     string
  title:           string
  jurisdiction:    string | null
  effective_date:  string | null
  source_url:      string | null
  chunk_count:     number
  created_at:      string
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  regulation:    'OSHA / Federal Regulation',
  state_reg:     'State Regulation',
  dot:           'DOT (49 CFR)',
  epa:           'EPA (40 CFR)',
  rcra:          'RCRA / Hazardous Waste',
  company_policy:'Company Policy',
}

export default function PoliciesPage() {
  const [docs, setDocs]     = useState<DocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Upload form
  const [file, setFile]               = useState<File | null>(null)
  const [title, setTitle]             = useState('')
  const [sourceType, setSourceType]   = useState<string>('company_policy')
  const [tenantId, setTenantId]       = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [effectiveDate, setEffective] = useState('')
  const [sourceUrl, setSourceUrl]     = useState('')
  const [uploading, setUploading]     = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadOk,    setUploadOk]    = useState<{ id: string; chunkCount: number; duplicate: boolean } | null>(null)

  async function refresh() {
    setLoading(true); setLoadError(null)
    try {
      const res = await superadminFetch('/api/superadmin/policies')
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`)
      const j = await res.json()
      setDocs((j.documents ?? []) as DocRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  async function onUpload(e: FormEvent) {
    e.preventDefault()
    setUploadError(null); setUploadOk(null)
    if (!file) { setUploadError('Pick a file first.'); return }
    if (sourceType === 'company_policy' && !/^[0-9a-f-]{36}$/i.test(tenantId)) {
      setUploadError('Tenant ID is required for a company policy. Paste the tenant UUID.')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('title', title || file.name)
      fd.set('source_type', sourceType)
      if (tenantId.trim())       fd.set('tenant_id',      tenantId.trim())
      if (jurisdiction.trim())   fd.set('jurisdiction',   jurisdiction.trim())
      if (effectiveDate.trim())  fd.set('effective_date', effectiveDate.trim())
      if (sourceUrl.trim())      fd.set('source_url',     sourceUrl.trim())

      const res = await superadminFetch('/api/superadmin/policies/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status})`)
      setUploadOk({ id: j.document_id, chunkCount: j.chunk_count, duplicate: !!j.duplicate })
      // Reset only the file so operator can repeat with same metadata.
      setFile(null)
      const fileInput = document.getElementById('policy-file') as HTMLInputElement | null
      if (fileInput) fileInput.value = ''
      void refresh()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function onDelete(id: string, title: string) {
    if (!confirm(`Delete "${title}" and all its chunks? This cannot be undone.`)) return
    const r = await superadminJson(`/api/superadmin/policies/${id}`, { method: 'DELETE' })
    if (!r.ok) {
      alert(r.error ?? 'Delete failed')
      return
    }
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Policies &amp; Regulations</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Knowledge base for the home-page assistant. Global documents are visible to every tenant; company policies are
          scoped to the tenant they&apos;re uploaded under. The assistant retrieves the top-K matching chunks per query and
          cites them in its replies.
        </p>
      </header>

      {/* Upload form */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Upload className="h-4 w-4" /> Upload a document
        </h2>
        <form onSubmit={onUpload} className="space-y-4">
          <div>
            <label htmlFor="policy-file" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">File</label>
            <input
              id="policy-file"
              type="file"
              accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-700 dark:text-slate-200"
            />
            <p className="mt-1 text-[11px] text-slate-500">Markdown, plain text, or PDF (≤25MB). PDF text is extracted via Claude.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={file?.name ?? 'e.g. Acme LOTO Procedure'}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Source type</label>
              <select
                value={sourceType}
                onChange={e => setSourceType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              >
                {Object.entries(SOURCE_TYPE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">
                Tenant ID {sourceType === 'company_policy' ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}
              </label>
              <input
                type="text"
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                placeholder={sourceType === 'company_policy' ? 'UUID required' : 'Leave blank for global'}
                className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Jurisdiction (optional)</label>
              <input
                type="text"
                value={jurisdiction}
                onChange={e => setJurisdiction(e.target.value)}
                placeholder="e.g. CA, federal"
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Effective date (optional)</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={e => setEffective(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Source URL (optional)</label>
              <input
                type="url"
                value={sourceUrl}
                onChange={e => setSourceUrl(e.target.value)}
                placeholder="https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147"
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              />
            </div>
          </div>

          {uploadError && (
            <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-800 dark:text-rose-200">{uploadError}</p>
            </div>
          )}
          {uploadOk && (
            <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800 dark:text-emerald-200">
                {uploadOk.duplicate
                  ? `Document already existed (${uploadOk.chunkCount} chunks). No new ingest performed.`
                  : `Uploaded and embedded. ${uploadOk.chunkCount} chunks indexed.`}
              </p>
            </div>
          )}

          <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="submit"
              disabled={uploading || !file}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
              {uploading ? 'Uploading & embedding…' : 'Upload'}
            </button>
          </div>
        </form>
      </section>

      {/* List */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" /> Documents ({docs.length})
        </h2>
        {loading && <p className="text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Loading…</p>}
        {loadError && <p className="text-sm text-rose-600">{loadError}</p>}
        {!loading && !loadError && docs.length === 0 && (
          <p className="text-sm text-slate-500">No documents yet. Upload one above to get started.</p>
        )}
        {docs.length > 0 && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Title</th>
                  <th className="px-3 py-2 text-left font-medium">Scope</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Chunks</th>
                  <th className="px-3 py-2 text-left font-medium">Uploaded</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {docs.map(d => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                      <div className="font-medium">{d.title}</div>
                      {d.jurisdiction && <div className="text-[11px] text-slate-500">{d.jurisdiction}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {d.tenant_id == null ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300">
                          <Globe className="h-3 w-3" /> Global
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-purple-700 dark:text-purple-300">
                          <Building2 className="h-3 w-3" /> {d.tenant_name ?? d.tenant_id.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                      {SOURCE_TYPE_LABELS[d.source_type] ?? d.source_type}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                      {d.chunk_count}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onDelete(d.id, d.title)}
                        title="Delete"
                        className="p-1.5 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[11px] text-slate-400 text-center">
        Embeddings via Voyage AI <code className="font-mono">voyage-3-large</code> (1024 dims). Search via pgvector HNSW.
      </p>
    </div>
  )
}
