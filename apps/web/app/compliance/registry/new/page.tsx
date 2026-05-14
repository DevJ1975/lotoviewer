'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { complianceFetch } from '../../_lib/api'

// /compliance/registry/new — manual citation creation. Once saved the
// detail page (/compliance/registry/[id]) offers the AI summarize +
// suggest-obligations buttons.

export default function NewRegistryEntryPage() {
  const router = useRouter()
  const { tenant } = useTenant()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    citation:     '',
    title:        '',
    jurisdiction: '',
    authority:    '',
    source_url:   '',
    applicability_note: '',
  })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id) return
    setSubmitting(true); setError(null)
    try {
      const body = await complianceFetch<{ entry: { id: string } }>(tenant.id, '/api/compliance/registry', {
        method: 'POST',
        body:   JSON.stringify({
          citation:     form.citation.trim(),
          title:        form.title.trim(),
          jurisdiction: form.jurisdiction.trim(),
          authority:    form.authority.trim() || null,
          source_url:   form.source_url.trim() || null,
          applicability_note: form.applicability_note.trim() || null,
        }),
      })
      router.push(`/compliance/registry/${body.entry.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/compliance/registry" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400">
        <ArrowLeft className="h-3 w-3" /> Legal registry
      </Link>

      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New citation</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Add it manually here; on the next screen Claude can summarize and propose obligations from it.
      </p>

      <form onSubmit={onSubmit} className="space-y-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5">
        <Field label="Citation" required>
          <input
            value={form.citation}
            onChange={e => setForm(f => ({ ...f, citation: e.target.value }))}
            placeholder="e.g. 29 CFR 1910.147"
            required
            maxLength={120}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </Field>
        <Field label="Title" required>
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Control of Hazardous Energy (Lockout/Tagout)"
            required
            maxLength={300}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Jurisdiction" required>
            <input
              value={form.jurisdiction}
              onChange={e => setForm(f => ({ ...f, jurisdiction: e.target.value }))}
              placeholder="Federal / California / ISO"
              required
              maxLength={60}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </Field>
          <Field label="Issuing authority">
            <input
              value={form.authority}
              onChange={e => setForm(f => ({ ...f, authority: e.target.value }))}
              placeholder="OSHA, EPA, Cal/OSHA, ISO…"
              maxLength={120}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </Field>
        </div>
        <Field label="Source URL">
          <input
            type="url"
            value={form.source_url}
            onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))}
            placeholder="https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147"
            maxLength={500}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </Field>
        <Field label="Applicability note" hint="Why this applies to your operation. Helps the AI summary be specific.">
          <textarea
            value={form.applicability_note}
            onChange={e => setForm(f => ({ ...f, applicability_note: e.target.value }))}
            rows={3}
            maxLength={4000}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </Field>

        {error && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Link href="/compliance/registry" className="text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90 disabled:opacity-50"
          >
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
