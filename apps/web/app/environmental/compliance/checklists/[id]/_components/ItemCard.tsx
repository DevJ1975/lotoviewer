'use client'

import { AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react'
import { CitationList, StatusChip } from '@/components/environmental/badges'
import { EvidenceUpload } from '@/components/environmental/EvidenceUpload'
import { inputCls } from '@/components/environmental/form'
import type { RunItemView } from '@/lib/environmental/client'
import { limitsText, numericVerdict, type Answer } from '@/lib/environmental/runnerView'
import { cn } from '@/lib/utils'

// One question. Big targets, because this is filled in standing at an outfall in
// gloves; what the question is for (guidance, citations) is one tap away, not in
// the way.

interface Props {
  item: RunItemView
  answer: Answer
  onChange: (patch: Partial<Answer>) => void
  readOnly: boolean
  tenantId: string
  highlighted: boolean
}

const CHOICES = [
  { result: 'pass', label: 'Pass', on: 'border-emerald-600 bg-emerald-600 text-white' },
  { result: 'fail', label: 'Fail', on: 'border-rose-600 bg-rose-600 text-white' },
  { result: 'na', label: 'N/A', on: 'border-slate-600 bg-slate-600 text-white' },
] as const

const choiceCls = 'min-h-11 flex-1 rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60'

export function ItemCard({ item, answer, onChange, readOnly, tenantId, highlighted }: Props) {
  const verdict = item.item_type === 'numeric' ? numericVerdict(item, answer.value) : null
  const limits = limitsText(item)
  const failed = answer.result === 'fail' || verdict === 'fail'

  return (
    <li
      id={`item-${item.id}`}
      className={cn(
        'space-y-3 rounded-lg border bg-white p-4 dark:bg-slate-950',
        highlighted ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200 dark:border-slate-800',
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-900 dark:text-slate-100">
          {item.prompt}
          {item.required && <span className="ml-1 text-rose-600" title="Required" aria-label="required">*</span>}
        </p>
        {item.critical && <StatusChip tone="bad"><AlertTriangle className="h-3 w-3" /> Critical</StatusChip>}
        {item.clause_ref && <StatusChip tone="idle">ISO 14001 {item.clause_ref}</StatusChip>}
      </div>

      {(item.guidance || item.citations.length > 0) && (
        <details className="group rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-900">
          <summary className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" /> What to look for, and why we ask
          </summary>
          <div className="mt-2 space-y-2">
            {item.guidance && <p className="text-slate-700 dark:text-slate-300">{item.guidance}</p>}
            <CitationList citations={item.citations} />
          </div>
        </details>
      )}

      {item.item_type === 'pass_fail_na' && (
        <div role="group" aria-label={`Answer: ${item.prompt}`} className="flex gap-2">
          {CHOICES.map(c => (
            <button
              key={c.result} type="button" disabled={readOnly} aria-pressed={answer.result === c.result}
              onClick={() => onChange({ result: answer.result === c.result ? null : c.result })}
              className={cn(choiceCls, answer.result === c.result ? c.on : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200')}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {item.item_type === 'numeric' && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="number" inputMode="decimal" step="any" disabled={readOnly} aria-label={`Reading: ${item.prompt}`}
              value={answer.value} onChange={e => onChange({ value: e.target.value })} className={cn(inputCls, 'max-w-40')}
            />
            {item.unit && <span className="text-sm text-slate-600 dark:text-slate-400">{item.unit}</span>}
            {verdict === 'pass' && <StatusChip tone="good"><CheckCircle2 className="h-3 w-3" /> Within limits</StatusChip>}
            {verdict === 'fail' && <StatusChip tone="bad"><AlertTriangle className="h-3 w-3" /> Outside limits: will be recorded as a failure</StatusChip>}
          </div>
          {limits && <p className="text-xs text-slate-500">Limit: {limits}</p>}
        </div>
      )}

      {(item.item_type === 'text' || item.item_type === 'multiple_choice') && (
        <textarea
          rows={2} disabled={readOnly} aria-label={item.prompt} maxLength={2000} value={answer.value}
          onChange={e => onChange({ value: e.target.value })} className={inputCls}
        />
      )}

      {item.item_type === 'signature' && (
        <input
          disabled={readOnly} aria-label={`Typed name: ${item.prompt}`} maxLength={200} placeholder="Type your full name"
          value={answer.value} onChange={e => onChange({ value: e.target.value })} className={inputCls}
        />
      )}

      {item.item_type === 'photo' && (
        <EvidenceUpload
          tenantId={tenantId} folder="checklists" value={answer.evidencePath} disabled={readOnly} capture accept="image/*"
          label="Take or attach a photo" onChange={path => onChange({ evidencePath: path })}
        />
      )}

      {(failed || answer.note) && item.item_type !== 'photo' && (
        <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/20">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-rose-900 dark:text-rose-200">What did you see? This goes into the finding.</span>
            <textarea rows={2} disabled={readOnly} maxLength={2000} value={answer.note} onChange={e => onChange({ note: e.target.value })} className={inputCls} />
          </label>
          {item.item_type === 'pass_fail_na' && (
            <EvidenceUpload
              tenantId={tenantId} folder="checklists" value={answer.evidencePath} disabled={readOnly} capture accept="image/*"
              label="Add a photo" onChange={path => onChange({ evidencePath: path })}
            />
          )}
        </div>
      )}
    </li>
  )
}
