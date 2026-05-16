'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

// /contractor-prequal/[token] — public no-login form for a contractor
// to fill in their prequalification answers. Same token shape and
// pattern as /review/[token] (the LOTO placard reviewer portal).
//
// The form auto-saves on every blur via POST. The contractor submits
// once with PATCH; after that the form is read-only and instructs
// them to contact the host for any corrections.

const TOKEN_RE = /^[0-9a-f]{32}$/

interface PrequalDto {
  id:                       string
  status:                   string
  q1_safety_management:     string | null
  q2_emr:                   string | null
  q3_dart:                  string | null
  q4_trir:                  string | null
  q5_iso_certs:             string | null
  q6_drug_alcohol_program:  boolean
  q7_insurance_limits:      string | null
  q8_references:            string | null
  submitted_at:             string | null
  review_notes:             string | null
}

export default function ContractorPrequalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [valid, setValid] = useState<boolean | null>(TOKEN_RE.test(token) ? null : false)
  const [prequal, setPrequal] = useState<PrequalDto | null>(null)
  const [contractorName, setName] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [q3, setQ3] = useState('')
  const [q4, setQ4] = useState('')
  const [q5, setQ5] = useState('')
  const [q6, setQ6] = useState(false)
  const [q7, setQ7] = useState('')
  const [q8, setQ8] = useState('')

  const load = useCallback(async () => {
    if (!TOKEN_RE.test(token)) { setValid(false); return }
    const res = await fetch(`/api/contractor-prequal/${token}`, { cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      setError(json?.error ?? 'This prequalification link is unavailable.')
      setValid(false)
      return
    }
    setPrequal(json.prequal as PrequalDto)
    setName(json.contractorName ?? null)
    const p = json.prequal as PrequalDto
    setQ1(p.q1_safety_management ?? '')
    setQ2(p.q2_emr ?? '')
    setQ3(p.q3_dart ?? '')
    setQ4(p.q4_trir ?? '')
    setQ5(p.q5_iso_certs ?? '')
    setQ6(p.q6_drug_alcohol_program)
    setQ7(p.q7_insurance_limits ?? '')
    setQ8(p.q8_references ?? '')
    setValid(true)
    setSubmitted(!!p.submitted_at)
  }, [token])

  useEffect(() => { void load() }, [load])

  async function save() {
    const res = await fetch(`/api/contractor-prequal/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q1_safety_management:    q1,
        q2_emr:                  q2,
        q3_dart:                 q3,
        q4_trir:                 q4,
        q5_iso_certs:            q5,
        q6_drug_alcohol_program: q6,
        q7_insurance_limits:     q7,
        q8_references:           q8,
      }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      setError(json?.error ?? `Save failed (${res.status})`)
    }
  }

  async function finalSubmit() {
    setSubmitting(true)
    setError(null)
    await save()
    const res = await fetch(`/api/contractor-prequal/${token}`, { method: 'PATCH' })
    setSubmitting(false)
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      setError(json?.error ?? `Submit failed (${res.status})`)
      return
    }
    setSubmitted(true)
  }

  if (valid === null) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!valid) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Link unavailable</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{error ?? 'This prequalification link is invalid or no longer active. Contact the host for a new one.'}</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
        <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-100">Submitted</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Thank you. Your prequalification is now with the host for review. You will hear back via the contact
          email on file.
        </p>
        {prequal?.review_notes && (
          <div className="mt-6 text-left rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Note from the host</p>
            <p className="mt-1 text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap">{prequal.review_notes}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Contractor prequalification</h1>
        {contractorName && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{contractorName}</p>}
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          Answer each item below. You can save your progress at any time; when you&apos;re done, press
          &quot;Submit for review&quot;. Once submitted, you can no longer edit — contact the host for changes.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <Item n={1} label="Describe your safety management system">
        <textarea rows={3} value={q1} onChange={e => setQ1(e.target.value)} onBlur={save} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
      </Item>
      <Item n={2} label="EMR (Experience Modification Rate) — current">
        <input type="text" value={q2} onChange={e => setQ2(e.target.value)} onBlur={save} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
      </Item>
      <Item n={3} label="DART rate">
        <input type="text" value={q3} onChange={e => setQ3(e.target.value)} onBlur={save} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
      </Item>
      <Item n={4} label="TRIR (Total Recordable Incident Rate)">
        <input type="text" value={q4} onChange={e => setQ4(e.target.value)} onBlur={save} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
      </Item>
      <Item n={5} label="ISO 45001 / VPP / other safety certifications">
        <textarea rows={2} value={q5} onChange={e => setQ5(e.target.value)} onBlur={save} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
      </Item>
      <Item n={6} label="Do you maintain a drug & alcohol program?">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={q6} onChange={e => { setQ6(e.target.checked); save() }} className="h-5 w-5" />
          <span className="text-sm text-slate-900 dark:text-slate-100">Yes</span>
        </label>
      </Item>
      <Item n={7} label="Insurance limits (GL + Workers' Comp)">
        <textarea rows={2} value={q7} onChange={e => setQ7(e.target.value)} onBlur={save} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
      </Item>
      <Item n={8} label="Past-performance references (3 minimum)">
        <textarea rows={3} value={q8} onChange={e => setQ8(e.target.value)} onBlur={save} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
      </Item>

      <button
        type="button"
        onClick={finalSubmit}
        disabled={submitting}
        className="w-full px-4 py-3 rounded-xl bg-brand-navy text-white text-base font-bold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
      >
        {submitting ? 'Submitting…' : 'Submit for review'}
      </button>
    </div>
  )
}

function Item({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        <span className="text-slate-400 dark:text-slate-500 mr-1">Q{n}.</span>
        {label}
      </label>
      {children}
    </section>
  )
}
