'use client'

import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OwnerPicker } from '@/components/environmental/OwnerPicker'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { createLegal, errorList, updateLegal, type LegalEntry, type Scope } from '@/lib/environmental/client'
import { ownerName, programOf, REVIEW_FREQUENCY_LABELS } from '@/lib/environmental/legalView'
import { US_STATES } from '@soteria/core/environmental/jurisdiction'
import { parseReviewFrequency, REVIEW_FREQUENCIES, type ReviewFrequency } from '@soteria/core/environmental/legalRegister'
import { ENV_PROGRAM_LABELS, ENV_PROGRAMS, type EnvProgram } from '@soteria/core/environmental/siteProfile'
import { FieldGroup } from './FieldGroup'

// Add a custom requirement, or edit the description of any entry. The rating is
// not editable here: it has its own dialog, and the API ignores it in an edit.

interface Draft {
  title: string
  citation: string
  jurisdiction: string
  authority: string
  summary: string
  applicability_note: string
  source_url: string
  effective_date: string
  review_frequency: ReviewFrequency | ''
  program: EnvProgram | ''
  owner_user_id: string | null
  /** Only meaningful when adding: an edit leaves the entry on its site. */
  every_site: boolean
}

const JURISDICTIONS = [
  { code: 'federal', label: 'Federal' },
  ...Object.entries(US_STATES).map(([code, name]) => ({ code, label: `${name} (${code})` })),
]

function draftFor(entry: LegalEntry | null, scope: Scope, defaultJurisdiction: string): Draft {
  if (!entry) {
    return {
      title: '', citation: '', jurisdiction: defaultJurisdiction, authority: '', summary: '', applicability_note: '',
      source_url: '', effective_date: '', review_frequency: '', program: '', owner_user_id: null,
      // With no active site there is no single site to add it to.
      every_site: scope.facilityId === null,
    }
  }
  return {
    title: entry.title, citation: entry.citation, jurisdiction: entry.jurisdiction, authority: entry.authority ?? '',
    summary: entry.summary ?? '', applicability_note: entry.applicability_note ?? '', source_url: entry.source_url ?? '',
    effective_date: entry.effective_date ?? '', review_frequency: parseReviewFrequency(entry.review_frequency) ?? '',
    program: programOf(entry) ?? '', owner_user_id: entry.owner_user_id,
    every_site: entry.facility_id === null,
  }
}

interface Props {
  scope: Scope
  /** The entry to edit, or null to add a custom one. */
  entry: LegalEntry | null
  siteName: string | null
  defaultJurisdiction: string
  owners: ReadonlyMap<string, string>
  onClose: () => void
  onSaved: (message: string) => void
}

export function EntryFormDialog({ scope, entry, siteName, defaultJurisdiction, owners, onClose, onSaved }: Props) {
  const descriptionId = useId()
  const [draft, setDraft] = useState(() => draftFor(entry, scope, defaultJurisdiction))
  // The chosen owner is shown by name, which the draft (the request) does not carry.
  const [ownerLabel, setOwnerLabel] = useState(() => (entry ? ownerName(entry.owner_user_id, owners) : null))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }))
  const rollUp = scope.facilityId === null

  async function save() {
    setBusy(true); setErrors([])
    const { every_site, ...fields } = draft
    try {
      if (entry) {
        await updateLegal(scope, entry.id, fields)
        onSaved(`Saved changes to “${draft.title.trim()}”.`)
      } else {
        await createLegal(scope, { ...fields, facility_id: every_site ? null : scope.facilityId })
        onSaved(`Added “${draft.title.trim()}” to the register.`)
      }
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" aria-describedby={descriptionId}>
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit requirement' : 'Add a requirement'}</DialogTitle>
          <DialogDescription id={descriptionId}>
            {entry
              ? 'Changes the description only. Use Evaluate to change whether it applies or how you are doing.'
              : 'For a requirement the library does not cover, such as a local ordinance or a condition in one of your permits.'}
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Title">
                <input value={draft.title} onChange={e => set('title', e.target.value)} required maxLength={300} disabled={busy} className={inputCls} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Citation" hint="The rule or permit condition, for example 40 CFR 262.15.">
                <input value={draft.citation} onChange={e => set('citation', e.target.value)} required maxLength={300} disabled={busy} className={inputCls} />
              </Field>
            </div>
            <Field label="Jurisdiction">
              <select value={draft.jurisdiction} onChange={e => set('jurisdiction', e.target.value)} disabled={busy} className={inputCls}>
                {!JURISDICTIONS.some(j => j.code === draft.jurisdiction) && <option value={draft.jurisdiction}>{draft.jurisdiction}</option>}
                {JURISDICTIONS.map(j => <option key={j.code} value={j.code}>{j.label}</option>)}
              </select>
            </Field>
            <Field label="Program">
              <select value={draft.program} onChange={e => set('program', e.target.value as Draft['program'])} disabled={busy} className={inputCls}>
                <option value="">No program</option>
                {ENV_PROGRAMS.map(p => <option key={p} value={p}>{ENV_PROGRAM_LABELS[p]}</option>)}
              </select>
            </Field>
            <Field label="Authority" hint="The agency that enforces it.">
              <input value={draft.authority} onChange={e => set('authority', e.target.value)} maxLength={300} disabled={busy} className={inputCls} />
            </Field>
            <Field label="Source URL" hint="A link to the text, starting with http:// or https://.">
              <input type="url" value={draft.source_url} onChange={e => set('source_url', e.target.value)} maxLength={500} disabled={busy} className={inputCls} />
            </Field>
            <Field label="Effective date">
              <input type="date" value={draft.effective_date} onChange={e => set('effective_date', e.target.value)} disabled={busy} className={inputCls} />
            </Field>
            <Field label="Review frequency" hint="Left unset, it is reviewed every year.">
              <select value={draft.review_frequency} onChange={e => set('review_frequency', e.target.value as Draft['review_frequency'])} disabled={busy} className={inputCls}>
                <option value="">Not set</option>
                {REVIEW_FREQUENCIES.map(f => <option key={f} value={f}>{REVIEW_FREQUENCY_LABELS[f]}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Summary">
                <textarea value={draft.summary} onChange={e => set('summary', e.target.value)} rows={3} maxLength={4000} disabled={busy} className={inputCls} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Applicability note" hint="When this applies to a site, and when it does not.">
                <textarea value={draft.applicability_note} onChange={e => set('applicability_note', e.target.value)} rows={2} maxLength={2000} disabled={busy} className={inputCls} />
              </Field>
            </div>
            <FieldGroup label="Owner">
              <OwnerPicker
                scope={scope} value={draft.owner_user_id} valueLabel={ownerLabel} disabled={busy}
                onChange={(userId, label) => { set('owner_user_id', userId); setOwnerLabel(label) }}
              />
            </FieldGroup>
          </div>

          {!entry && (
            <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
              <input
                type="checkbox" checked={draft.every_site} disabled={busy || rollUp} className="mt-0.5 h-4 w-4"
                onChange={e => set('every_site', e.target.checked)}
              />
              <span>
                Applies to every site
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {rollUp
                    ? 'No site is selected, so this is added for every site. Pick a site first to add one for that site alone.'
                    : `Leave unchecked to add it to ${siteName ?? 'this site'} only.`}
                </span>
              </span>
            </label>
          )}
          {entry && entry.facility_id === null && (
            <p className="text-xs text-slate-500 dark:text-slate-400">This requirement covers every site, so your changes apply to all of them.</p>
          )}

          <ErrorList errors={errors} />

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonCls}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButtonCls}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {entry ? 'Save changes' : 'Add requirement'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
