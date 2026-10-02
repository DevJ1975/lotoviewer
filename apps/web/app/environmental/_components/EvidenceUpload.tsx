'use client'

import { useState } from 'react'
import {
  MAX_BODY_EVIDENCE_BYTES,
  MAX_DIRECT_EVIDENCE_BYTES,
  downloadEvidence,
  uploadEvidence,
  type EvidenceKindOption,
  type EvidenceRow,
  type EvidenceSubjectType,
} from '@/lib/environmental/client'
import { BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT } from './formStyles'

// Evidence on any record that takes it (evaluations, permits, change impacts,
// condition occurrences): the files filed so far, and a way to attach another,
// or to replace a wrong one, never delete it. The server re-reads the file's
// bytes to decide its type and records its hash, so what is checked here (the
// size) only saves a round trip.

const KINDS: readonly { value: EvidenceKindOption; label: string }[] = [
  { value: 'document', label: 'Document' }, { value: 'photo', label: 'Photo' },
  { value: 'sample_result', label: 'Sample result' }, { value: 'signature', label: 'Signature' },
]

const mb = (bytes: number) => bytes / (1024 * 1024)

export function EvidenceList({ tenantId, evidence }: { tenantId: string; evidence: readonly EvidenceRow[] }) {
  const [error, setError] = useState<string | null>(null)
  if (evidence.length === 0) return <p className="text-xs italic text-slate-500">No evidence filed.</p>
  return (
    <div className="space-y-1">
      <ul className="space-y-1 text-xs">
        {evidence.map(item => (
          <li key={item.id} className={item.superseded_by ? 'text-slate-400 line-through' : undefined}>
            <button type="button" className="text-left font-medium text-brand-navy hover:underline dark:text-brand-yellow"
              onClick={async () => {
                setError(null)
                try { await downloadEvidence(tenantId, item) }
                catch (err) { setError(err instanceof Error ? err.message : 'Could not download the file.') }
              }}>
              {item.file_name}
            </button>
            <span className="text-slate-400"> · {item.kind.replace('_', ' ')} · {item.uploaded_at.slice(0, 10)}</span>
            {item.export_controlled && <span className="font-medium text-amber-700 no-underline dark:text-amber-300"> · export-controlled</span>}
            {item.superseded_reason && <span className="no-underline"> · replaced: {item.superseded_reason}</span>}
          </li>
        ))}
      </ul>
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
    </div>
  )
}

export function EvidenceUpload({ tenantId, subjectType, subjectId, current, onUploaded }: {
  tenantId: string
  subjectType: EvidenceSubjectType
  subjectId: string
  /** The files that can still be replaced. */
  current: readonly EvidenceRow[]
  onUploaded: () => void
}) {
  const [kind, setKind] = useState<EvidenceKindOption>('document')
  const [file, setFile] = useState<File | null>(null)
  const [exportControlled, setExportControlled] = useState(false)
  const [replaces, setReplaces] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    if (file.size > MAX_DIRECT_EVIDENCE_BYTES) {
      setError(`That file is ${mb(file.size).toFixed(1)} MB; evidence files are limited to ${mb(MAX_DIRECT_EVIDENCE_BYTES)} MB.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await uploadEvidence(tenantId, {
        subjectType, subjectId, kind, file, exportControlled,
        supersedes: replaces ? { id: replaces, reason } : undefined,
      })
      setFile(null)
      setExportControlled(false)
      setReplaces('')
      setReason('')
      onUploaded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach the file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <div className="flex flex-wrap items-end gap-2">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Evidence</span>
          <select className={INPUT} value={kind} onChange={e => setKind(e.target.value as EvidenceKindOption)}>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <input type="file" aria-label="Evidence file" accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
        {current.length > 0 && (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Replaces (optional)</span>
            <select className={INPUT} value={replaces} onChange={e => setReplaces(e.target.value)}>
              <option value="">Nothing: add it</option>
              {current.map(item => <option key={item.id} value={item.id}>{item.file_name}</option>)}
            </select>
          </label>
        )}
      </div>
      {replaces && (
        <input className={INPUT} aria-label="Why the earlier file is replaced" value={reason}
          onChange={e => setReason(e.target.value)} placeholder="Why the earlier file is replaced" />
      )}
      <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={exportControlled} onChange={e => setExportControlled(e.target.checked)} />
        <span>
          Export-controlled (ITAR/EAR): only owners and admins can download it.
        </span>
      </label>
      <p className="text-[11px] text-slate-500">
        PDF, JPEG, PNG or WebP, up to {mb(MAX_DIRECT_EVIDENCE_BYTES)} MB (files over {mb(MAX_BODY_EVIDENCE_BYTES)} MB upload straight to storage).
        Files are never deleted; a wrong one is replaced, with a reason.
      </p>
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
      <button type="submit" className={BUTTON_SECONDARY} disabled={busy || !file || (replaces !== '' && reason.trim() === '')}>
        {busy ? 'Attaching…' : 'Attach'}
      </button>
    </form>
  )
}
