'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  EmsApiError,
  createInterestedParty,
  listInterestedParties,
  listObligations,
  reviewInterestedParty,
  updateInterestedParty,
  type FieldError,
  type InterestedPartyRow,
  type ObligationRow,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor, generalError } from '../../_components/formStyles'
import { ReasonPrompt } from '../../_components/ReasonPrompt'
import { TermTooltip } from '../../_components/TermTooltip'

// Clause 4.2: who has a stake in the EMS, what they need, and which of those
// needs the organization adopts as compliance obligations (4.2 c). An
// adopted need can be linked to the obligation it became.

export function PartiesTab({ tenantId, canEdit, onChanged }: { tenantId: string; canEdit: boolean; onChanged: () => void }) {
  const [parties, setParties] = useState<InterestedPartyRow[] | null>(null)
  const [obligations, setObligations] = useState<ObligationRow[]>([])
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<InterestedPartyRow | 'new' | null>(null)
  const [retiring, setRetiring] = useState<InterestedPartyRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [list, register] = await Promise.all([
        listInterestedParties(tenantId, showRetired ? 'all' : 'active'),
        listObligations(tenantId, { status: 'all' }),
      ])
      setParties(list.parties)
      setObligations(register.obligations)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the interested parties.')
    }
  }, [tenantId, showRetired])

  useEffect(() => { void load() }, [load])

  const changed = async () => {
    setEditing(null)
    setRetiring(null)
    await load()
    onChanged()
  }

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try { await action(); await changed() }
    catch (err) { setError(err instanceof Error ? err.message : 'That did not work.') }
  }

  const today = new Date().toISOString().slice(0, 10)
  const titleOf = (id: string) => obligations.find(o => o.id === id)?.title ?? 'a compliance obligation'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> Show retired
        </label>
        {canEdit && <button type="button" className={BUTTON_PRIMARY} onClick={() => setEditing('new')}>Record a party</button>}
      </div>
      {editing && (
        <PartyForm key={editing === 'new' ? 'new' : editing.id} tenantId={tenantId} initial={editing === 'new' ? null : editing} obligations={obligations}
          onSaved={() => void changed()} onCancel={() => setEditing(null)} />
      )}
      {retiring && (
        <ReasonPrompt key={retiring.id} explanation="A retired party leaves the active register but stays in its history. Say why it no longer applies."
          label="Why the party is retired" placeholder="e.g. Neighbouring site sold and demolished" confirmLabel="Retire party"
          onSubmit={async reason => { await updateInterestedParty(tenantId, retiring.id, { retired_reason: reason }); await changed() }}
          onCancel={() => setRetiring(null)} />
      )}
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
      {parties === null ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : parties.length === 0 ? (
        <p className="py-6 text-center text-sm italic text-slate-500">No <TermTooltip term="interested party">interested parties</TermTooltip> recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {parties.map(party => (
            <li key={party.id} className={`rounded-lg border border-slate-100 p-3 text-sm dark:border-slate-800 ${party.retired_at ? 'opacity-60' : ''}`}>
              <p className="font-medium text-slate-900 dark:text-slate-100">{party.name}</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{party.needs_expectations}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {party.becomes_obligation
                  ? party.obligation_id ? `Adopted as: ${titleOf(party.obligation_id)} · ` : 'Adopted as a compliance obligation · '
                  : ''}
                Next review <span className={party.next_review_due < today ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>{party.next_review_due}</span>
                {party.retired_at && ` · Retired: ${party.retired_reason}`}
              </p>
              {canEdit && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {party.retired_at ? (
                    <button type="button" className={BUTTON_SECONDARY}
                      onClick={() => void run(() => updateInterestedParty(tenantId, party.id, { retired_reason: null }))}>Reinstate</button>
                  ) : (
                    <>
                      <button type="button" className={BUTTON_SECONDARY}
                        onClick={() => void run(() => reviewInterestedParty(tenantId, party.id))}>Mark reviewed</button>
                      <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing(party)}>Edit</button>
                      <button type="button" className={BUTTON_SECONDARY} onClick={() => setRetiring(party)}>Retire</button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PartyForm({ tenantId, initial, obligations, onSaved, onCancel }: {
  tenantId: string; initial: InterestedPartyRow | null; obligations: readonly ObligationRow[]
  onSaved: () => void; onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [needs, setNeeds] = useState(initial?.needs_expectations ?? '')
  const [adopted, setAdopted] = useState(initial?.becomes_obligation ?? false)
  const [obligationId, setObligationId] = useState(initial?.obligation_id ?? '')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors([])
    const body = {
      name, needs_expectations: needs, becomes_obligation: adopted, obligation_id: adopted && obligationId ? obligationId : null,
    }
    try {
      if (initial) await updateInterestedParty(tenantId, initial.id, body)
      else await createInterestedParty(tenantId, body)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the party.')
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" noValidate>
      <label className={LABEL}>
        <span className={LABEL_TEXT}>Interested party</span>
        <input className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. County water district" />
        {errorFor(fieldErrors, 'name') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'name')}</p>}
      </label>
      <label className={LABEL}>
        <span className={LABEL_TEXT}>Their needs and expectations</span>
        <textarea className={INPUT} rows={2} value={needs} onChange={e => setNeeds(e.target.value)}
          placeholder="e.g. Stormwater discharges stay within permit limits" />
        {errorFor(fieldErrors, 'needs_expectations') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'needs_expectations')}</p>}
      </label>
      <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={adopted} onChange={e => setAdopted(e.target.checked)} />
        We adopt this need as a compliance obligation
      </label>
      {adopted && (
        <label className={LABEL}>
          <span className={LABEL_TEXT}>The obligation it became (optional)</span>
          <select className={INPUT} value={obligationId} onChange={e => setObligationId(e.target.value)}>
            <option value="">Not in the register yet</option>
            {obligations.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          {errorFor(fieldErrors, 'obligation_id') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'obligation_id')}</p>}
        </label>
      )}
      {generalError(error, fieldErrors, ['name', 'needs_expectations', 'obligation_id']) && <p className={FIELD_ERROR} role="alert">{generalError(error, fieldErrors, ['name', 'needs_expectations', 'obligation_id'])}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Record party'}</button>
      </div>
    </form>
  )
}
