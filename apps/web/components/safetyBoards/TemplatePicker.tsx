'use client'

import { useEffect, useState } from 'react'
import { LayoutTemplate, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { listTemplates, KIND_LABEL, type ThreadTemplate } from '@/lib/safetyBoards/client'

// Template chooser shown above the new-thread form. Clicking a
// template pre-fills the parent's title/body/kind/metadata. The
// parent is responsible for actually rendering the form — this
// component is a chip strip + a couple of structured-field widgets
// for the chosen template.

interface Props {
  boardId: string
  /** Called whenever the user picks a template (or clears it). */
  onApply: (template: ThreadTemplate | null) => void
}

export default function TemplatePicker({ boardId, onApply }: Props) {
  const { tenant } = useTenant()
  const [templates, setTemplates] = useState<ThreadTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    void (async () => {
      try {
        const t = await listTemplates(tenant.id, boardId)
        if (!cancelled) setTemplates(t)
      } catch { /* swallow */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [tenant?.id, boardId])

  if (loading) return null
  if (templates.length === 0) return null

  function pick(t: ThreadTemplate) {
    setActiveId(t.id)
    onApply(t)
  }
  function clear() {
    setActiveId(null)
    onApply(null)
  }

  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
        <LayoutTemplate className="h-3.5 w-3.5" /> Quick-post templates
      </span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={clear}
          className={
            'rounded-full px-2 py-0.5 text-xs ring-1 ' +
            (activeId === null
              ? 'bg-brand-navy text-white ring-brand-navy'
              : 'ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800')
          }
        >
          Blank
        </button>
        {templates.map(t => (
          <button
            type="button"
            key={t.id}
            onClick={() => pick(t)}
            title={`${KIND_LABEL[t.kind]} template${t.description ? ' — ' + t.description : ''}`}
            className={
              'rounded-full px-2 py-0.5 text-xs ring-1 ' +
              (activeId === t.id
                ? 'bg-brand-navy text-white ring-brand-navy'
                : 'ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800')
            }
          >
            {t.name}
          </button>
        ))}
      </div>
    </div>
  )
}

// Renders a structured-fields editor for the active template's
// fields_schema. Parent owns the value state.
export function TemplateFields({ template, value, onChange }: {
  template: ThreadTemplate | null
  value: Record<string, string | number | boolean>
  onChange: (next: Record<string, string | number | boolean>) => void
}) {
  if (!template || template.fields_schema.length === 0) return null
  return (
    <div className="space-y-2 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-2">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Template fields
      </span>
      {template.fields_schema.map(f => {
        const label = f.label ?? f.key
        const v = value[f.key]
        if (f.type === 'enum') {
          return (
            <label key={f.key} className="block text-sm">
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-200">{label}{f.required && ' *'}</span>
              <select
                value={typeof v === 'string' ? v : ''}
                onChange={e => onChange({ ...value, [f.key]: e.target.value })}
                className="mt-0.5 w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
              >
                <option value="">— choose —</option>
                {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )
        }
        if (f.type === 'boolean') {
          return (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v === true}
                onChange={e => onChange({ ...value, [f.key]: e.target.checked })}
              />
              <span className="text-slate-700 dark:text-slate-200">{label}</span>
            </label>
          )
        }
        if (f.type === 'number') {
          return (
            <label key={f.key} className="block text-sm">
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-200">{label}{f.required && ' *'}</span>
              <input
                type="number"
                value={typeof v === 'number' ? v : ''}
                onChange={e => onChange({ ...value, [f.key]: e.target.value === '' ? '' : Number(e.target.value) })}
                className="mt-0.5 w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
              />
            </label>
          )
        }
        // string
        return (
          <label key={f.key} className="block text-sm">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-200">{label}{f.required && ' *'}</span>
            <input
              value={typeof v === 'string' ? v : ''}
              onChange={e => onChange({ ...value, [f.key]: e.target.value })}
              className="mt-0.5 w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
            />
          </label>
        )
      })}
    </div>
  )
}

// Helper for the parent: determine if a template is satisfied (all
// required fields populated). Used to gate submit.
export function isTemplateValid(
  template: ThreadTemplate | null,
  value: Record<string, string | number | boolean>,
): boolean {
  if (!template) return true
  for (const f of template.fields_schema) {
    if (!f.required) continue
    const v = value[f.key]
    if (v === undefined || v === '' || v === null) return false
  }
  return true
}

// Show the fix `Loader2` import in case the host needs it.
export { Loader2 }
