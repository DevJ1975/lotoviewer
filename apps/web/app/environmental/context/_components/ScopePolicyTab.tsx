'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import {
  EmsApiError,
  getPolicy,
  getScope,
  recordPolicyCommunication,
  savePolicy,
  saveScope,
  type FieldError,
  type PolicyCommitmentOption,
  type PolicyCommunicationRow,
  type PolicyRow,
  type ScopeRow,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor, generalError } from '../../_components/formStyles'

// Clauses 4.3 and 5.2: the EMS scope and the environmental policy. Both are
// numbered versions that are never edited: a change is a new version, so
// the record shows what was in force when. The policy must state every
// commitment clause 5.2 requires before it can be saved, and is then
// communicated within the organization and made available outside it: the
// communications are recorded here, and both documents download as one PDF
// for interested parties.

const AUDIENCE_LABELS: Record<PolicyCommunicationRow['audience'], string> = {
  internal: 'Within the organization',
  external: 'To interested parties outside it',
}

const NOTICE = 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'

type PolicyState = Awaited<ReturnType<typeof getPolicy>>

export function ScopePolicyTab({ tenantId, canEdit, onChanged }: { tenantId: string; canEdit: boolean; onChanged: () => void }) {
  const [scope, setScope] = useState<{ current: ScopeRow | null; versions: ScopeRow[] } | null>(null)
  const [policy, setPolicy] = useState<PolicyState | null>(null)
  const [editing, setEditing] = useState<'scope' | 'policy' | 'communication' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [scopeState, policyState] = await Promise.all([getScope(tenantId), getPolicy(tenantId)])
      setScope(scopeState)
      setPolicy(policyState)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the scope and policy.')
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const saved = async () => {
    setEditing(null)
    await load()
    onChanged()
  }

  async function exportStatement(current: { scope: ScopeRow; policy: PolicyRow }, commitments: readonly PolicyCommitmentOption[]) {
    setExporting(true)
    setExportError(null)
    try {
      const { generatePolicyScopeStatement } = await import('@/lib/pdfEmsPolicyScope')
      const issuedOn = new Date().toISOString().slice(0, 10)
      const bytes = await generatePolicyScopeStatement({ ...current, commitments, issuedOn })
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `environmental-policy-and-scope-${issuedOn}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not create the PDF.')
    } finally {
      setExporting(false)
    }
  }

  if (error) return <p className={FIELD_ERROR} role="alert">{error}</p>
  if (!scope || !policy) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>

  const shareable = scope.current && policy.current ? { scope: scope.current, policy: policy.current } : null

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-xs text-slate-500">
          ISO 14001 asks for the policy and the scope to be available to interested parties. Download both as one PDF to share.
        </p>
        <button type="button" className={BUTTON_SECONDARY} disabled={!shareable || exporting}
          onClick={() => shareable && void exportStatement(shareable, policy.requiredCommitments)}>
          {exporting ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1 inline h-3.5 w-3.5" />}
          Download for interested parties
        </button>
        {!shareable && <p className="w-full text-[11px] text-slate-500">Available once both a scope and a policy are on record.</p>}
        {exportError && <p className={`w-full ${FIELD_ERROR}`} role="alert">{exportError}</p>}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Scope of the EMS{scope.current ? ` · version ${scope.current.version}` : ''}</h3>
          {canEdit && editing !== 'scope' && (
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing('scope')}>
              {scope.current ? 'Save a new version' : 'Document the scope'}
            </button>
          )}
        </div>
        {editing === 'scope' ? (
          <ScopeForm tenantId={tenantId} current={scope.current} onSaved={() => void saved()} onCancel={() => setEditing(null)} />
        ) : scope.current ? (
          <>
            {scope.current.control_and_influence === null && (
              <p className={NOTICE}>
                This version does not say what the organization can control and what it can only influence (clause 4.3 e). Save a new version that does.
              </p>
            )}
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Entry term="Legal entity" value={scope.current.legal_entity} />
              <Entry term="In force from" value={scope.current.effective_from} />
              <Entry term="Physical boundary" value={scope.current.physical_boundary} />
              <Entry term="Activities" value={scope.current.activities} />
              <Entry term="Products and services" value={scope.current.products_services} />
              <Entry term="What we control and what we can only influence" value={scope.current.control_and_influence ?? 'Not stated'} />
              <Entry term="Exclusions" value={scope.current.exclusions ?? 'None'} />
              <Entry term="Next review" value={scope.current.next_review_due} />
            </dl>
          </>
        ) : (
          <p className="text-sm italic text-slate-500">The scope has not been documented.</p>
        )}
        <History items={scope.versions.map(v => `v${v.version} · ${v.legal_entity} · from ${v.effective_from}`)} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Environmental policy{policy.current ? ` · version ${policy.current.version}` : ''}</h3>
          {canEdit && editing !== 'policy' && (
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing('policy')}>
              {policy.current ? 'Save a new version' : 'Record the policy'}
            </button>
          )}
        </div>
        {policy.signatoryStale && (
          <p className={NOTICE}>
            The legal entity in the scope changed after this policy was signed, so it carries a prior owner&apos;s signature. Have the current top management sign a new version.
          </p>
        )}
        {editing === 'policy' ? (
          <PolicyForm tenantId={tenantId} current={policy.current} required={policy.requiredCommitments}
            onSaved={() => void saved()} onCancel={() => setEditing(null)} />
        ) : policy.current ? (
          <div className="space-y-2 text-sm">
            <p className="whitespace-pre-line text-slate-800 dark:text-slate-100">{policy.current.body}</p>
            <ul className="space-y-1 text-xs">
              {policy.requiredCommitments.map(c => (
                <li key={c.key}>{policy.current!.commitments[c.key] ? '✓' : '✗'} {c.label}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              Signed by {policy.current.signatory_name}{policy.current.signatory_title ? `, ${policy.current.signatory_title}` : ''} on {policy.current.signed_at} · next review {policy.current.next_review_due}
            </p>
          </div>
        ) : (
          <p className="text-sm italic text-slate-500">No environmental policy is on record.</p>
        )}
        <History items={policy.versions.map(v => `v${v.version} · signed ${v.signed_at} by ${v.signatory_name}`)} />
      </section>

      {policy.current && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Communication of the policy</h3>
            {canEdit && editing !== 'communication' && (
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing('communication')}>Record a communication</button>
            )}
          </div>
          {!policy.communicatedInternally && (
            <p className={NOTICE}>
              Version {policy.current.version} has no record of being communicated within the organization, as clause 5.2 requires.
            </p>
          )}
          {editing === 'communication' && (
            <CommunicationForm tenantId={tenantId} policyId={policy.current.id}
              onSaved={() => void saved()} onCancel={() => setEditing(null)} />
          )}
          {policy.communications.length > 0 ? (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {policy.communications.map(c => (
                <li key={c.id} className="py-2">
                  <p className="text-xs text-slate-500">{c.communicated_on} · {AUDIENCE_LABELS[c.audience]}</p>
                  <p className="text-slate-800 dark:text-slate-100">{c.method}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm italic text-slate-500">No communication of this version is recorded.</p>
          )}
        </section>
      )}
    </div>
  )
}

function Entry({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{term}</dt>
      <dd className="text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  )
}

function History({ items }: { items: string[] }) {
  if (items.length < 2) return null
  return (
    <details className="text-xs text-slate-500">
      <summary className="cursor-pointer">Earlier versions</summary>
      <ul className="mt-1 list-disc pl-5">{items.slice(1).map(item => <li key={item}>{item}</li>)}</ul>
    </details>
  )
}

function useSaving() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const run = async (action: () => Promise<unknown>, onDone: () => void) => {
    setSaving(true)
    setError(null)
    setFieldErrors([])
    try { await action(); onDone() }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally {
      setSaving(false)
    }
  }
  return { saving, error, fieldErrors, run }
}

function ScopeForm({ tenantId, current, onSaved, onCancel }: {
  tenantId: string; current: ScopeRow | null; onSaved: () => void; onCancel: () => void
}) {
  const [form, setForm] = useState({
    legal_entity:      current?.legal_entity ?? '',
    physical_boundary: current?.physical_boundary ?? '',
    activities:        current?.activities ?? '',
    products_services: current?.products_services ?? '',
    control_and_influence: current?.control_and_influence ?? '',
    exclusions:        current?.exclusions ?? '',
    effective_from:    new Date().toISOString().slice(0, 10),
  })
  const { saving, error, fieldErrors, run } = useSaving()
  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }))
  const field = (key: keyof typeof form, label: string, rows = 2) => (
    <label className={LABEL}>
      <span className={LABEL_TEXT}>{label}</span>
      {rows > 1
        ? <textarea className={INPUT} rows={rows} value={form[key]} onChange={e => set(key, e.target.value)} />
        : <input className={INPUT} type={key === 'effective_from' ? 'date' : 'text'} value={form[key]} onChange={e => set(key, e.target.value)} />}
      {errorFor(fieldErrors, key) && <p className={FIELD_ERROR}>{errorFor(fieldErrors, key)}</p>}
    </label>
  )
  return (
    <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" noValidate
      onSubmit={e => {
        e.preventDefault()
        void run(() => saveScope(tenantId, { ...form, exclusions: form.exclusions.trim() || null }), onSaved)
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('legal_entity', 'Legal entity', 1)}
        {field('effective_from', 'In force from', 1)}
        {field('physical_boundary', 'Physical boundary')}
        {field('activities', 'Activities')}
        {field('products_services', 'Products and services')}
        {field('control_and_influence', 'What we control, and what we can only influence')}
        {field('exclusions', 'Exclusions, and why (optional)')}
      </div>
      {generalError(error, fieldErrors, SCOPE_FIELDS) && <p className={FIELD_ERROR} role="alert">{generalError(error, fieldErrors, SCOPE_FIELDS)}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>{saving ? 'Saving…' : 'Save version'}</button>
      </div>
    </form>
  )
}

const SCOPE_FIELDS = [
  'legal_entity', 'physical_boundary', 'activities', 'products_services', 'control_and_influence', 'exclusions', 'effective_from',
]

function CommunicationForm({ tenantId, policyId, onSaved, onCancel }: {
  tenantId: string; policyId: string; onSaved: () => void; onCancel: () => void
}) {
  const [audience, setAudience] = useState<PolicyCommunicationRow['audience']>('internal')
  const [method, setMethod] = useState('')
  const [communicatedOn, setCommunicatedOn] = useState(new Date().toISOString().slice(0, 10))
  const { saving, error, fieldErrors, run } = useSaving()
  const shown = ['audience', 'method', 'communicated_on']

  return (
    <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" noValidate
      onSubmit={e => {
        e.preventDefault()
        void run(() => recordPolicyCommunication(tenantId, {
          policy_id: policyId, audience, method, communicated_on: communicatedOn,
        }), onSaved)
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Communicated</span>
          <select className={INPUT} value={audience} onChange={e => setAudience(e.target.value as PolicyCommunicationRow['audience'])}>
            {Object.entries(AUDIENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>On</span>
          <input className={INPUT} type="date" value={communicatedOn} onChange={e => setCommunicatedOn(e.target.value)} />
          {errorFor(fieldErrors, 'communicated_on') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'communicated_on')}</p>}
        </label>
      </div>
      <label className={LABEL}>
        <span className={LABEL_TEXT}>How, and to whom</span>
        <textarea className={INPUT} rows={2} value={method} onChange={e => setMethod(e.target.value)}
          placeholder="Posted at both entrances; read out at the all-hands meeting" />
        {errorFor(fieldErrors, 'method') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'method')}</p>}
      </label>
      {generalError(error, fieldErrors, shown) && <p className={FIELD_ERROR} role="alert">{generalError(error, fieldErrors, shown)}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>{saving ? 'Saving…' : 'Record'}</button>
      </div>
    </form>
  )
}

function PolicyForm({ tenantId, current, required, onSaved, onCancel }: {
  tenantId: string; current: PolicyRow | null; required: readonly PolicyCommitmentOption[]
  onSaved: () => void; onCancel: () => void
}) {
  const [body, setBody] = useState(current?.body ?? '')
  const [commitments, setCommitments] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(required.map(c => [c.key, current?.commitments[c.key] === true])))
  const [signatoryName, setSignatoryName] = useState('')
  const [signatoryTitle, setSignatoryTitle] = useState('')
  const [signedAt, setSignedAt] = useState(new Date().toISOString().slice(0, 10))
  const { saving, error, fieldErrors, run } = useSaving()
  const allStated = required.every(c => commitments[c.key])

  return (
    <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" noValidate
      onSubmit={e => {
        e.preventDefault()
        void run(() => savePolicy(tenantId, {
          body, commitments, signatory_name: signatoryName, signatory_title: signatoryTitle || null, signed_at: signedAt,
        }), onSaved)
      }}>
      <label className={LABEL}>
        <span className={LABEL_TEXT}>Policy text</span>
        <textarea className={INPUT} rows={6} value={body} onChange={e => setBody(e.target.value)} />
        {errorFor(fieldErrors, 'body') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'body')}</p>}
      </label>
      <fieldset className="space-y-1">
        <legend className={LABEL_TEXT}>The policy text commits to</legend>
        {required.map(c => (
          <label key={c.key} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={commitments[c.key] ?? false}
              onChange={e => setCommitments(previous => ({ ...previous, [c.key]: e.target.checked }))} />
            {c.label}
          </label>
        ))}
        {!allStated && (
          <p className="text-[11px] text-slate-500">
            ISO 14001 clause 5.2 requires the policy to make every one of these commitments, so tick each one its text states before saving.
          </p>
        )}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Signed by</span>
          <input className={INPUT} value={signatoryName} onChange={e => setSignatoryName(e.target.value)} placeholder="Top management" />
          {errorFor(fieldErrors, 'signatory_name') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'signatory_name')}</p>}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Title (optional)</span>
          <input className={INPUT} value={signatoryTitle} onChange={e => setSignatoryTitle(e.target.value)} />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Signed on</span>
          <input className={INPUT} type="date" value={signedAt} onChange={e => setSignedAt(e.target.value)} />
          {errorFor(fieldErrors, 'signed_at') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'signed_at')}</p>}
        </label>
      </div>
      {generalError(error, fieldErrors, ['body', 'signatory_name', 'signed_at']) && <p className={FIELD_ERROR} role="alert">{generalError(error, fieldErrors, ['body', 'signatory_name', 'signed_at'])}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving || !allStated}>{saving ? 'Saving…' : 'Save version'}</button>
      </div>
    </form>
  )
}
