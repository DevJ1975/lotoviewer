'use client'

import { useState } from 'react'
import type { LotoAuditChange } from '@/lib/loto/audit/schemas'
import {
  AGENT_BADGE,
  AGENT_LABEL,
  CHANGE_KIND_LABEL,
  SEVERITY_BADGE,
  formatChangeValue,
} from '@/app/admin/loto/multi-agent-audit/_lib/changeDisplay'

// One staged change, as the reviewer sees it: the diff (rendered per kind) plus
// Approve / Reject controls and an optional note. The decision is lifted to the
// parent (AuditReviewClient) which owns the POST; this card is presentation +
// local note/expander state only.

type Decision = 'approved' | 'rejected'

// EHS findings stage their citation as the new_value. The engine emits a
// {code, text, severity} object; narrow it defensively so a string or partial
// object still renders.
interface EhsCitationLike {
  code?:     unknown
  text?:     unknown
  severity?: unknown
}

export default function ChangeDiffCard({
  change, busy, readOnly, onDecide,
}: {
  change:   LotoAuditChange
  busy:     boolean
  readOnly: boolean
  onDecide: (changeId: string, decision: Decision, note: string) => void
}) {
  const [note, setNote] = useState(change.decided_note ?? '')
  const decided = change.status === 'approved' || change.status === 'rejected'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">
          {CHANGE_KIND_LABEL[change.change_kind]}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${AGENT_BADGE[change.agent]}`}>
          {AGENT_LABEL[change.agent]}
        </span>
        {change.severity && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_BADGE[change.severity]}`}>
            {change.severity}
          </span>
        )}
        {change.target_column && (
          <span className="font-mono text-[11px] text-slate-500">{change.target_column}</span>
        )}
      </div>

      <ChangeBody change={change} />

      {change.rationale && (
        <p className="mt-2 text-xs text-slate-600">{change.rationale}</p>
      )}

      {readOnly ? (
        <DecisionSummary change={change} />
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note for the admin (why you approved or rejected)"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDecide(change.id, 'approved', note)}
              disabled={busy}
              className={`rounded-md border px-2.5 py-1 text-xs font-bold disabled:opacity-50 ${
                change.status === 'approved'
                  ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800'
              }`}
            >
              ✓ Approve
            </button>
            <button
              type="button"
              onClick={() => onDecide(change.id, 'rejected', note)}
              disabled={busy}
              className={`rounded-md border px-2.5 py-1 text-xs font-bold disabled:opacity-50 ${
                change.status === 'rejected'
                  ? 'border-rose-300 bg-rose-100 text-rose-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800'
              }`}
            >
              ✕ Reject
            </button>
            {decided && (
              <span className="text-[11px] font-semibold text-slate-500">
                {change.status === 'approved' ? 'Approved' : 'Rejected'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ChangeBody({ change }: { change: LotoAuditChange }) {
  if (change.change_kind === 'placeholder_photo') {
    return (
      <div className="mt-2 grid grid-cols-2 gap-2">
        <PhotoTile label="Current" url={typeof change.old_value === 'string' ? change.old_value : null} />
        <PhotoTile label="Proposed" url={change.staged_photo_url} />
      </div>
    )
  }

  if (change.change_kind === 'ehs_finding') {
    return <Citation value={change.new_value} />
  }

  // step_field_edit / equipment_field_edit / step_confidence / photo_provenance
  // all read as a text old→new.
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <ValueBlock label="Current" value={formatChangeValue(change.old_value)} tone="old" />
      <ValueBlock label="Proposed" value={formatChangeValue(change.new_value)} tone="new" />
    </div>
  )
}

function Citation({ value }: { value: unknown }) {
  const citation = (value && typeof value === 'object' ? value : {}) as EhsCitationLike
  const code = typeof citation.code === 'string' ? citation.code : ''
  const text = typeof citation.text === 'string' ? citation.text : formatChangeValue(value)
  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
      {code && <p className="font-mono text-xs font-bold text-amber-900">{code}</p>}
      <p className="mt-0.5 text-sm text-amber-900">{text}</p>
    </div>
  )
}

function ValueBlock({ label, value, tone }: { label: string; value: string; tone: 'old' | 'new' }) {
  return (
    <div className={`rounded-md px-2.5 py-1.5 ${tone === 'old' ? 'bg-rose-50' : 'bg-emerald-50'}`}>
      <p className={`text-[10px] font-bold uppercase ${tone === 'old' ? 'text-rose-700' : 'text-emerald-700'}`}>{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-800">{value}</p>
    </div>
  )
}

function PhotoTile({ label, url }: { label: string; url: string | null }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">{label}</p>
      {url ? (
        // loto-photos is a public bucket; a plain <img> avoids next/image host
        // config for staged-photo URLs.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="aspect-[4/3] w-full rounded-md object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-[11px] text-slate-400">
          No photo
        </div>
      )}
    </div>
  )
}

function DecisionSummary({ change }: { change: LotoAuditChange }) {
  if (change.status !== 'approved' && change.status !== 'rejected') {
    return <p className="mt-2 text-[11px] font-semibold text-slate-400">No decision recorded</p>
  }
  return (
    <p className="mt-2 text-[11px] text-slate-500">
      <span className={`font-bold ${change.status === 'approved' ? 'text-emerald-700' : 'text-rose-700'}`}>
        {change.status === 'approved' ? 'Approved' : 'Rejected'}
      </span>
      {change.decided_by && ` by ${change.decided_by}`}
      {change.decided_note && ` — ${change.decided_note}`}
    </p>
  )
}
