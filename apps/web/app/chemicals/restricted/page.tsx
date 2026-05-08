'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  RESTRICTION_SEVERITIES,
  isValidCas,
  type RestrictionRule,
  type RestrictionSeverity,
} from '@soteria/core/chemicals'

const SEVERITY_LABEL: Record<RestrictionSeverity, string> = {
  banned:      'Banned (no override)',
  restricted:  'Restricted (override required)',
  discouraged: 'Discouraged (warn only)',
}

const SEVERITY_CLS: Record<RestrictionSeverity, string> = {
  banned:      'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  restricted:  'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  discouraged: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

export default function RestrictedListPage() {
  const { tenant } = useTenant()
  const [rules, setRules] = useState<RestrictionRule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy,  setBusy]  = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const [matchKind,    setMatchKind]    = useState<'cas' | 'name'>('cas')
  const [casNumber,    setCasNumber]    = useState('')
  const [namePattern,  setNamePattern]  = useState('')
  const [severity,     setSeverity]     = useState<RestrictionSeverity>('restricted')
  const [reason,       setReason]       = useState('')
  const [alternative,  setAlternative]  = useState('')
  const [reference,    setReference]    = useState('')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const headers = await buildHeaders()
    const res  = await fetch('/api/chemicals/restricted', { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      setRules([])
      return
    }
    setRules(body.rules ?? [])
  }, [tenant, buildHeaders])

  useEffect(() => { void load() }, [load])

  function reset() {
    setMatchKind('cas')
    setCasNumber('')
    setNamePattern('')
    setSeverity('restricted')
    setReason('')
    setAlternative('')
    setReference('')
  }

  async function add() {
    if (matchKind === 'cas' && !casNumber.trim()) {
      setError('CAS number is required')
      return
    }
    if (matchKind === 'cas' && !isValidCas(casNumber.trim())) {
      setError(`Invalid CAS: ${casNumber}`)
      return
    }
    if (matchKind === 'name' && !namePattern.trim()) {
      setError('Name pattern is required')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch('/api/chemicals/restricted', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          cas_number:   matchKind === 'cas'  ? casNumber.trim() : null,
          name_pattern: matchKind === 'name' ? namePattern.trim() : null,
          severity,
          reason:      reason.trim()      || null,
          alternative: alternative.trim() || null,
          reference:   reference.trim()   || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      reset()
      setShowAdd(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this restriction rule?')) return
    setBusy(true)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/chemicals/restricted/${id}`, { method: 'DELETE', headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6" /> Restricted chemicals
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Block dangerous or banned chemicals from being added to the catalog or inventory.
            Match by CAS number (preferred) or by name pattern (SQL ilike: <code>%</code> wildcard).
          </p>
        </div>
        <button
          onClick={() => setShowAdd(s => !s)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
        >
          <Plus className="w-4 h-4" /> Add rule
        </button>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 self-center">Match by:</span>
            {(['cas', 'name'] as const).map(k => (
              <label key={k} className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  checked={matchKind === k}
                  onChange={() => setMatchKind(k)}
                />
                {k === 'cas' ? 'CAS number' : 'Name pattern'}
              </label>
            ))}
          </div>

          {matchKind === 'cas' ? (
            <Field label="CAS number">
              <input
                type="text"
                value={casNumber}
                onChange={e => setCasNumber(e.target.value)}
                placeholder="71-43-2"
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
            </Field>
          ) : (
            <Field label="Name pattern (case-insensitive, % wildcard)">
              <input
                type="text"
                value={namePattern}
                onChange={e => setNamePattern(e.target.value)}
                placeholder="%benzene%"
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </Field>
          )}

          <Field label="Severity">
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as RestrictionSeverity)}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              {RESTRICTION_SEVERITIES.map(s => (
                <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Reason">
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Prop 65 carcinogen"
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </Field>
            <Field label="Suggested alternative">
              <input
                type="text"
                value={alternative}
                onChange={e => setAlternative(e.target.value)}
                placeholder="Use water-based degreaser"
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </Field>
          </div>
          <Field label="Reference">
            <input
              type="text"
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="Prop 65 listed 2026-01-01"
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </Field>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowAdd(false); reset() }}
              className="px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700"
            >Cancel</button>
            <button
              onClick={() => void add()}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add rule
            </button>
          </div>
        </div>
      )}

      {rules === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No restrictions configured. Add CAS numbers or name patterns above.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {rules.map(r => (
            <li key={r.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded ${SEVERITY_CLS[r.severity]}`}>
                  {r.severity.toUpperCase()}
                </span>
                {r.cas_number && (
                  <span className="font-mono text-slate-900 dark:text-slate-100">CAS {r.cas_number}</span>
                )}
                {r.name_pattern && (
                  <span className="font-mono text-slate-900 dark:text-slate-100">name like &quot;{r.name_pattern}&quot;</span>
                )}
                <button
                  onClick={() => void remove(r.id)}
                  disabled={busy}
                  className="ml-auto text-slate-400 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-3">
                {r.reason       && <span>{r.reason}</span>}
                {r.alternative  && <span>· alt: {r.alternative}</span>}
                {r.reference    && <span>· ref: {r.reference}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}
