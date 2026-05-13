'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { complianceFetch } from '../../_lib/api'
import {
  OBLIGATION_CATEGORIES,
  OBLIGATION_FREQUENCIES,
  CATEGORY_LABEL,
  FREQUENCY_LABEL,
  type ObligationCategory,
  type ObligationFrequency,
} from '@soteria/core/compliance'

export default function NewObligationPage() {
  const router = useRouter()
  const { tenant } = useTenant()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todayDefault = new Date().toISOString().slice(0, 10)

  const [form, setForm] = useState({
    title:             '',
    description:       '',
    category:          'inspection' as ObligationCategory,
    frequency:         'annual' as ObligationFrequency,
    frequency_days:    '',
    next_due_date:     todayDefault,
    lead_days:         '14',
    responsible_party: '',
    evidence_required: false,
  })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id) return
    setSubmitting(true); setError(null)
    try {
      const body: Record<string, unknown> = {
        title:             form.title.trim(),
        description:       form.description.trim() || null,
        category:          form.category,
        frequency:         form.frequency,
        next_due_date:     form.next_due_date,
        lead_days:         Number(form.lead_days) || 14,
        responsible_party: form.responsible_party.trim() || null,
        evidence_required: form.evidence_required,
      }
      if (form.frequency === 'custom_days') {
        body.frequency_days = Number(form.frequency_days) || null
      }
      const res = await complianceFetch<{ obligation: { id: string } }>(
        tenant.id, '/api/compliance/obligations', { method: 'POST', body: JSON.stringify(body) },
      )
      router.push(`/compliance/obligations/${res.obligation.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/compliance" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400">
        <ArrowLeft className="h-3 w-3" /> Compliance calendar
      </Link>

      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New obligation</h1>

      <form onSubmit={onSubmit} className="space-y-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5">
        <Field label="Title" required>
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            required maxLength={200}
            placeholder="Annual LOTO procedure audit"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3} maxLength={4000}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Category">
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value as ObligationCategory }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              {OBLIGATION_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Frequency">
            <select
              value={form.frequency}
              onChange={e => setForm(f => ({ ...f, frequency: e.target.value as ObligationFrequency }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              {OBLIGATION_FREQUENCIES.map(c => <option key={c} value={c}>{FREQUENCY_LABEL[c]}</option>)}
            </select>
          </Field>
        </div>
        {form.frequency === 'custom_days' && (
          <Field label="Repeat every (days)" required>
            <input
              type="number" min={1} max={3650}
              value={form.frequency_days}
              onChange={e => setForm(f => ({ ...f, frequency_days: e.target.value }))}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Next due date" required>
            <input
              type="date"
              value={form.next_due_date}
              onChange={e => setForm(f => ({ ...f, next_due_date: e.target.value }))}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </Field>
          <Field label="Lead days (warn before due)" hint="How many days before due_date a row becomes “due soon”.">
            <input
              type="number" min={0} max={365}
              value={form.lead_days}
              onChange={e => setForm(f => ({ ...f, lead_days: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </Field>
        </div>
        <Field label="Responsible party (role, not person)">
          <input
            value={form.responsible_party}
            onChange={e => setForm(f => ({ ...f, responsible_party: e.target.value }))}
            placeholder="EHS manager"
            maxLength={120}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={form.evidence_required}
            onChange={e => setForm(f => ({ ...f, evidence_required: e.target.checked }))}
          />
          Evidence URL required on completion
        </label>

        {error && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Link href="/compliance" className="text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90 disabled:opacity-50">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </main>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-bold tracking-wide uppercase text-slate-500 dark:text-slate-400">
        {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </label>
  )
}
