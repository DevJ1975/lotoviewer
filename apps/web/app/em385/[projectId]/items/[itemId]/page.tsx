'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, Upload, FileText, ExternalLink } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { em385Headers, EM385_STATUS_PILL } from '../../../_components/client'
import { Field, inputCls } from '../../../_components/Field'
import {
  EM385_STATUSES,
  EM385_STATUS_LABEL,
  EM385_CATEGORY_LABEL,
  requiresJustification,
  type Em385Status,
  type Em385RegisterItemRow,
  type Em385DocumentFileRow,
} from '@soteria/core/em385'
import { em385DocumentPath } from '@soteria/core/storagePaths'
import { sha256Hex } from '@soteria/core/signedArtifactHash'

interface AuditRow {
  id: number
  event_type: string
  actor_email: string | null
  occurred_at: string
}

// Modules a register item can link to as the system-of-record. Kept short and
// explicit; the value is a FEATURES id the detail link resolves against.
const LINKABLE_MODULES: { id: string; label: string }[] = [
  { id: '',                  label: '— none —' },
  { id: 'loto',              label: 'LOTO' },
  { id: 'confined-spaces',   label: 'Confined Spaces' },
  { id: 'hot-work',          label: 'Hot Work' },
  { id: 'incidents',         label: 'Incidents' },
  { id: 'jha',               label: 'Job Hazard Analysis' },
  { id: 'working-at-heights', label: 'Working at Heights' },
  { id: 'chemicals',         label: 'Chemicals / SDS' },
  { id: 'equipment-readiness', label: 'Equipment Readiness' },
  { id: 'admin-training',    label: 'Training records' },
]

// Client-side mirror of the server cap in the files route — fail oversize
// uploads fast with a friendly message instead of a raw 400. The server stays
// the authority. ACCEPT just filters the picker; the server validates for real.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*'

export default function Em385ItemDetailPage({ params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  const { projectId, itemId } = use(params)
  const { tenant } = useTenant()
  const tenantId = tenant?.id
  const fileInput = useRef<HTMLInputElement>(null)

  const [item, setItem] = useState<Em385RegisterItemRow | null>(null)
  const [files, setFiles] = useState<Em385DocumentFileRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Editable form state.
  const [status, setStatus] = useState<Em385Status>('not_started')
  const [responsible, setResponsible] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [version, setVersion] = useState('')
  const [linkedModule, setLinkedModule] = useState('')
  const [linkedRecordId, setLinkedRecordId] = useState('')
  const [justification, setJustification] = useState('')
  const [notes, setNotes] = useState('')

  const hydrate = useCallback((row: Em385RegisterItemRow) => {
    setItem(row)
    setStatus(row.status)
    setResponsible(row.responsible_party ?? '')
    setDueDate(row.due_date ?? '')
    setEffectiveDate(row.effective_date ?? '')
    setExpiresAt(row.expires_at ?? '')
    setVersion(row.version ?? '')
    setLinkedModule(row.linked_module ?? '')
    setLinkedRecordId(row.linked_record_id ?? '')
    setJustification(row.not_applicable_justification ?? '')
    setNotes(row.notes ?? '')
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!tenantId) return
    setError(null)
    try {
      const headers = await em385Headers(tenantId)
      if (!headers || signal?.aborted) return
      const res = await fetch(`/api/em385/projects/${projectId}/items/${itemId}`, { headers, signal })
      const body = await res.json()
      if (signal?.aborted) return
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      hydrate(body.item as Em385RegisterItemRow)
      setFiles((body.files ?? []) as Em385DocumentFileRow[])
      setAudit((body.audit ?? []) as AuditRow[])
    } catch (e) {
      if (signal?.aborted) return
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenantId, projectId, itemId, hydrate])

  // Abort the in-flight request on unmount / param change so a late response
  // can't setState on a dead component or clobber newer data. onSave/onUpload
  // call load() without a signal — they intentionally refresh after a write.
  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  async function onSave() {
    if (!item) return
    if (requiresJustification(status) && !justification.trim()) {
      setError('A justification is required to mark this item not applicable.')
      return
    }
    setSaving(true); setError(null)
    try {
      const headers = await em385Headers(tenantId)
      if (!headers) { setSaving(false); return }
      const patch: Record<string, unknown> = {
        responsible_party:            responsible.trim() || null,
        due_date:                     dueDate || null,
        effective_date:               effectiveDate || null,
        expires_at:                   expiresAt || null,
        version:                      version.trim() || null,
        linked_module:                linkedModule || null,
        linked_record_id:             linkedRecordId.trim() || null,
        not_applicable_justification: justification.trim() || null,
        notes:                        notes.trim() || null,
      }
      // Only send status when it changed, so re-saving an accepted item doesn't
      // re-stamp its acceptance date.
      if (status !== item.status) patch.status = status

      const res = await fetch(`/api/em385/projects/${projectId}/items/${itemId}`, {
        method: 'PATCH', headers, body: JSON.stringify(patch),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      hydrate(body.item as Em385RegisterItemRow)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !tenantId) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('File must be 50 MB or smaller.')
      e.target.value = ''
      return
    }
    setUploading(true); setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const hash = await sha256Hex(bytes)
      const path = em385DocumentPath(tenantId, itemId, file.name)

      const { error: upErr } = await supabase.storage
        .from('loto-photos')
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
      if (upErr) throw new Error(upErr.message)

      const headers = await em385Headers(tenantId)
      if (!headers) throw new Error('No active tenant')
      const res = await fetch(`/api/em385/projects/${projectId}/items/${itemId}/files`, {
        method: 'POST', headers,
        body: JSON.stringify({
          storage_path:     path,
          mime_type:        file.type || null,
          file_size_bytes:  file.size,
          file_hash_sha256: hash,
          version_label:    version.trim() || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function openFile(path: string) {
    const { data, error } = await supabase.storage.from('loto-photos').createSignedUrl(path, 60)
    if (error) { setError(error.message); return }
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!item && !error) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href={`/em385/${projectId}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to register
      </Link>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {item && (
        <>
          <header>
            <p className="text-xs uppercase tracking-wide text-slate-400">{EM385_CATEGORY_LABEL[item.category]}</p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{item.title}</h1>
            <span className={`mt-2 inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${EM385_STATUS_PILL[item.status]}`}>
              {EM385_STATUS_LABEL[item.status]}
            </span>
          </header>

          <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Status">
                <select value={status} onChange={e => setStatus(e.target.value as Em385Status)} className={inputCls}>
                  {EM385_STATUSES.map(s => <option key={s} value={s}>{EM385_STATUS_LABEL[s]}</option>)}
                </select>
              </Field>
              <Field label="Responsible party">
                <input value={responsible} onChange={e => setResponsible(e.target.value)} className={inputCls} />
              </Field>
            </div>

            {requiresJustification(status) && (
              <Field label="Not-applicable justification" required>
                <textarea value={justification} onChange={e => setJustification(e.target.value)} rows={2} className={inputCls}
                  placeholder="Why does this requirement not apply to this contract?" />
              </Field>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Due date"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} /></Field>
              <Field label="Effective date"><input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className={inputCls} /></Field>
              <Field label="Expires"><input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className={inputCls} /></Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Version"><input value={version} onChange={e => setVersion(e.target.value)} className={inputCls} placeholder="Rev A" /></Field>
              <Field label="Linked module">
                <select value={linkedModule} onChange={e => setLinkedModule(e.target.value)} className={inputCls}>
                  {LINKABLE_MODULES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Linked record id"><input value={linkedRecordId} onChange={e => setLinkedRecordId(e.target.value)} className={inputCls} placeholder="Record id in that module" /></Field>
            </div>

            <Field label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
            </Field>

            <div className="flex justify-end">
              <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-5 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-60">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </button>
            </div>
          </section>

          {/* Evidence files */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Evidence files</h2>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload
                <input ref={fileInput} type="file" accept={UPLOAD_ACCEPT} className="hidden" onChange={onUpload} disabled={uploading} />
              </label>
            </div>
            {files.length === 0 ? (
              <p className="text-sm text-slate-400">No files attached.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {files.map(f => (
                  <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                    <button onClick={() => openFile(f.storage_path)} className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:underline">
                      <FileText className="h-4 w-4 text-slate-400" />
                      {f.storage_path.split('/').pop()}
                      {f.version_label ? <span className="text-[11px] text-slate-400">({f.version_label})</span> : null}
                      <ExternalLink className="h-3 w-3 text-slate-400" />
                    </button>
                    <span className="font-mono text-[10px] text-slate-400" title={f.file_hash_sha256 ?? ''}>
                      {f.file_hash_sha256 ? `sha256:${f.file_hash_sha256.slice(0, 10)}…` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Audit timeline */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">History</h2>
            {audit.length === 0 ? (
              <p className="text-sm text-slate-400">No history yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {audit.map(a => (
                  <li key={a.id} className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <span className="capitalize">{a.event_type}{a.actor_email ? ` · ${a.actor_email}` : ''}</span>
                    <span className="text-[11px] text-slate-400">{new Date(a.occurred_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
