'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { em385Headers } from '../_components/client'
import {
  EM385_EDITIONS,
  validateCreateProjectInput,
  type Em385Edition,
} from '@soteria/core/em385'

// /em385/new — Register a USACE contract. On submit the API seeds the
// register from the requirements catalog for the chosen edition, then we land
// on the contract's compliance dashboard.

export default function NewEm385ProjectPage() {
  const router = useRouter()
  const { tenant } = useTenant()

  const [contractNumber, setContractNumber] = useState('')
  const [title,          setTitle]          = useState('')
  const [edition,        setEdition]        = useState<Em385Edition>('2024')
  const [gda,            setGda]            = useState('')
  const [prime,          setPrime]          = useState('')
  const [location,       setLocation]       = useState('')
  const [startDate,      setStartDate]      = useState('')
  const [endDate,        setEndDate]        = useState('')
  const [ssho,           setSsho]           = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validateCreateProjectInput({
      contract_number: contractNumber,
      title,
      edition,
      start_date: startDate || null,
      end_date:   endDate || null,
    })
    if (validationError) { setError(validationError); return }

    setSubmitting(true); setError(null)
    try {
      const headers = await em385Headers(tenant?.id)
      if (!headers) { setError('No active tenant — refresh and try again.'); setSubmitting(false); return }

      const res = await fetch('/api/em385/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contract_number: contractNumber.trim(),
          title:           title.trim(),
          edition,
          gda:              gda.trim() || null,
          prime_contractor: prime.trim() || null,
          location:         location.trim() || null,
          start_date:       startDate || null,
          end_date:         endDate || null,
          ssho_name:        ssho.trim() || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push(`/em385/${body.project.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/em385" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to contracts
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New Contract</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Register a USACE contract. Its EM-385 requirements register seeds automatically from the edition you pick.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Contract number" required>
            <input value={contractNumber} onChange={e => setContractNumber(e.target.value)} required placeholder="W912xx-25-C-0001" className={inputCls} />
          </Field>
          <Field label="EM-385 edition" required>
            <select value={edition} onChange={e => setEdition(e.target.value as Em385Edition)} className={inputCls}>
              {EM385_EDITIONS.map(ed => <option key={ed} value={ed}>{ed}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Project title" required>
          <input value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. Levee Rehabilitation, Reach 4" className={inputCls} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Government Designated Authority (GDA)">
            <input value={gda} onChange={e => setGda(e.target.value)} placeholder="Contracting officer / GDA" className={inputCls} />
          </Field>
          <Field label="Prime contractor">
            <input value={prime} onChange={e => setPrime(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="Location">
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Site / district" className={inputCls} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Start date">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="End date">
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="Site Safety and Health Officer (SSHO)">
          <input value={ssho} onChange={e => setSsho(e.target.value)} className={inputCls} />
        </Field>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href="/em385" className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-5 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-60">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create contract
          </button>
        </div>
      </form>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
