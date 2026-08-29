'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Upload, Trash2, FileText, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import Dropzone from '@/components/ui/Dropzone'
import { inferUploadHint } from '@/lib/policyUploadHints'

// /admin/platform/knowledge
//
// Tenant self-service knowledge base. Lets an org's own admin/owner upload
// their company policies & procedures so the safety assistant can retrieve
// and cite them. Everything is auto-scoped to the caller's tenant — no tenant
// UUID, no source-type picker (always a company policy). The superadmin
// equivalent (/superadmin/policies) additionally handles global regulations.
//
// Upload is a two-step staged flow to dodge Vercel's 4.5MB request-body cap
// and the superadmin-only RLS on the policy-uploads bucket:
//   1. POST /api/admin/policies/upload-url → service-role signed upload token
//      for a path under this tenant's prefix.
//   2. Browser uploads the file via uploadToSignedUrl.
//   3. POST /api/admin/policies { storage_path } → server validates the
//      prefix, then runs the shared extract → chunk → embed pipeline.

interface DocRow {
  id:             string
  title:          string
  jurisdiction:   string | null
  effective_date: string | null
  source_url:     string | null
  chunk_count:    number
  created_at:     string
}

export default function TenantKnowledgePage() {
  const { tenant, loading: tenantLoading } = useTenant()
  const { profile, loading: authLoading } = useAuth()
  const canEdit = !!profile?.is_admin || !!profile?.is_superadmin

  const [docs, setDocs]           = useState<DocRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [file, setFile]                 = useState<File | null>(null)
  const [title, setTitle]               = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [effectiveDate, setEffective]   = useState('')
  const [sourceUrl, setSourceUrl]       = useState('')
  const [uploading, setUploading]       = useState(false)
  const [uploadError, setUploadError]   = useState<string | null>(null)
  const [uploadOk, setUploadOk]         = useState<{ chunkCount: number; duplicate: boolean } | null>(null)

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const refresh = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true); setLoadError(null)
    try {
      const res = await fetch('/api/admin/policies', { headers: await authHeaders() })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Failed to load (${res.status})`)
      setDocs((j.documents ?? []) as DocRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [tenant, authHeaders])

  useEffect(() => { if (canEdit) void refresh() }, [canEdit, refresh])

  async function onUpload(e: FormEvent) {
    e.preventDefault()
    setUploadError(null); setUploadOk(null)
    if (!file) { setUploadError('Pick a file first.'); return }
    setUploading(true)
    try {
      const mime = file.type || 'application/octet-stream'

      // 1. Get a signed upload URL scoped to this tenant's staging prefix.
      const urlRes = await fetch('/api/admin/policies/upload-url', {
        method:  'POST',
        headers: { ...(await authHeaders()), 'content-type': 'application/json' },
        body:    JSON.stringify({ mime }),
      })
      const urlJson = await urlRes.json().catch(() => ({}))
      if (!urlRes.ok) throw new Error(urlJson.error ?? `Could not start upload (${urlRes.status})`)

      // 2. Upload the bytes straight to storage via the signed token.
      const { error: upErr } = await supabase.storage
        .from('policy-uploads')
        .uploadToSignedUrl(urlJson.path, urlJson.token, file)
      if (upErr) throw new Error(`Upload to storage failed: ${upErr.message}`)

      // 3. Kick off ingestion. On failure, clean up the staged orphan.
      const res = await fetch('/api/admin/policies', {
        method:  'POST',
        headers: { ...(await authHeaders()), 'content-type': 'application/json' },
        body: JSON.stringify({
          storage_path:   urlJson.path,
          title:          title || file.name,
          jurisdiction:   jurisdiction.trim()  || undefined,
          effective_date: effectiveDate.trim() || undefined,
          source_url:     sourceUrl.trim()     || undefined,
          mime,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        void supabase.storage.from('policy-uploads').remove([urlJson.path])
        throw new Error(j.error ?? `Upload failed (${res.status})`)
      }
      setUploadOk({ chunkCount: j.chunk_count, duplicate: !!j.duplicate })
      setFile(null); setTitle(''); setJurisdiction(''); setEffective(''); setSourceUrl('')
      void refresh()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function onDelete(id: string, docTitle: string) {
    if (!confirm(`Delete "${docTitle}" and all its chunks? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/policies/${id}`, { method: 'DELETE', headers: await authHeaders() })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error ?? 'Delete failed')
      return
    }
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  if (authLoading || tenantLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!canEdit) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500">Admins only.</div>
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Assistant knowledge
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Upload your company policies &amp; procedures so the safety assistant can cite them in its answers. Documents are
          scoped to your organization and only visible to your members. The assistant retrieves the most relevant passages
          per question and links back to the source.
        </p>
      </header>

      {/* Upload form */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Upload className="h-4 w-4" /> Upload a document
        </h2>
        <form onSubmit={onUpload} className="space-y-4">
          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">File</span>
            <Dropzone
              file={file}
              onFileSelected={f => { setUploadOk(null); setUploadError(null); setFile(f) }}
              onValidationError={r => { setUploadOk(null); setUploadError(r); setFile(null) }}
              inputId="knowledge-file"
              helpText="Markdown, plain text, or PDF (≤25MB). PDF text is extracted automatically."
              disabled={uploading}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={file?.name ?? 'e.g. Lockout/Tagout Procedure'}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Jurisdiction (optional)</label>
              <input
                type="text"
                value={jurisdiction}
                onChange={e => setJurisdiction(e.target.value)}
                placeholder="e.g. CA, site-wide"
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
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Source URL (optional)</label>
              <input
                type="url"
                value={sourceUrl}
                onChange={e => setSourceUrl(e.target.value)}
                placeholder="https://intranet.example.com/policies/loto"
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              />
            </div>
          </div>

          {uploadError && (
            <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm text-rose-800 dark:text-rose-200">{uploadError}</p>
                {(() => {
                  const hint = inferUploadHint(uploadError)
                  return hint ? (
                    <p className="text-xs text-rose-700/80 dark:text-rose-300/80">
                      <span className="font-medium">Try:</span> {hint}
                    </p>
                  ) : null
                })()}
              </div>
            </div>
          )}
          {uploadOk && (
            <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800 dark:text-emerald-200">
                {uploadOk.duplicate
                  ? `This document was already uploaded (${uploadOk.chunkCount} chunks). No new ingest performed.`
                  : `Uploaded and indexed. ${uploadOk.chunkCount} passages are now searchable by the assistant.`}
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
              {uploading ? 'Uploading & indexing…' : 'Upload'}
            </button>
          </div>
        </form>
      </section>

      {/* List */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" /> Your documents ({docs.length})
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
                  <th className="px-3 py-2 text-right font-medium">Passages</th>
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
        Indexed with Voyage AI embeddings + pgvector search. Only your organization&apos;s members can see these documents.
      </p>
    </div>
  )
}
