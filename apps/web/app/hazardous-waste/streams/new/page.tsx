'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  HAZARDOUS_WASTE_PHYSICAL_STATES,
  HAZARDOUS_WASTE_STREAM_STATUSES,
  type HazardousWastePhysicalState,
  type HazardousWasteStreamRow,
  type HazardousWasteStreamStatus,
  type RcraGeneratorCategory,
} from '@soteria/core/hazardousWaste'

function splitTokens(value: string): string[] {
  return value.split(/[,\n]/).map(t => t.trim()).filter(Boolean)
}

export default function NewHazardousWasteStreamPage() {
  const router = useRouter()
  const { tenant } = useTenant()

  const [name, setName]                             = useState('')
  const [generatingProcess, setGeneratingProcess]   = useState('')
  const [description, setDescription]               = useState('')
  const [physicalState, setPhysicalState]           = useState<HazardousWastePhysicalState | ''>('')
  const [hazardsRaw, setHazardsRaw]                 = useState('')
  const [wasteCodesRaw, setWasteCodesRaw]           = useState('')
  const [generatorCategory, setGeneratorCategory]   = useState<RcraGeneratorCategory>('lqg')
  const [longHaul, setLongHaul]                     = useState(false)
  const [determinationBasis, setDeterminationBasis] = useState('')
  const [status, setStatus]                         = useState<HazardousWasteStreamStatus>('draft')
  const [submitting, setSubmitting]                 = useState(false)
  const [error, setError]                           = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!tenant?.id) { setError('No active tenant'); return }
    setError(null)
    setSubmitting(true)

    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'x-active-tenant': tenant.id,
      'content-type':    'application/json',
    }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const res = await fetch('/api/hazardous-waste/streams', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        generating_process:  generatingProcess || null,
        description:         description || null,
        physical_state:      physicalState || null,
        hazards:             splitTokens(hazardsRaw),
        waste_codes:         splitTokens(wasteCodesRaw),
        generator_category:  generatorCategory,
        long_haul:           longHaul && generatorCategory === 'sqg',
        determination_basis: determinationBasis || null,
        status,
      }),
    })
    const json = await res.json() as { stream?: HazardousWasteStreamRow; error?: string }
    setSubmitting(false)
    if (!res.ok || !json.stream) { setError(json.error ?? 'Failed to create'); return }
    router.push(`/hazardous-waste/streams/${json.stream.id}`)
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste/streams" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Waste streams
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New waste stream</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Describe the material clearly enough that someone outside the department can identify it.
          You can leave waste codes blank until the determination is reviewed.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name *" hint="Example: Spent acetone wipe solvent from Line 2 printhead cleaning">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={200}
            required
            className={inputCls}
          />
        </Field>

        <Field label="Generating process" hint="Where in the operation this waste is produced">
          <input
            value={generatingProcess}
            onChange={e => setGeneratingProcess(e.target.value)}
            maxLength={500}
            className={inputCls}
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            maxLength={4000}
            rows={4}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Physical state">
            <select
              value={physicalState}
              onChange={e => setPhysicalState(e.target.value as HazardousWastePhysicalState | '')}
              className={inputCls}
            >
              <option value="">(none)</option>
              {HAZARDOUS_WASTE_PHYSICAL_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>

          <Field label="Initial status">
            <select
              value={status}
              onChange={e => setStatus(e.target.value as HazardousWasteStreamStatus)}
              className={inputCls}
            >
              {HAZARDOUS_WASTE_STREAM_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Hazards" hint="Comma- or newline-separated (e.g. flammable, corrosive)">
          <textarea
            value={hazardsRaw}
            onChange={e => setHazardsRaw(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </Field>

        <Field label="Waste codes" hint="EPA / state codes; comma- or newline-separated (e.g. F003, D001)">
          <textarea
            value={wasteCodesRaw}
            onChange={e => setWasteCodesRaw(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Generator category">
            <select
              value={generatorCategory}
              onChange={e => setGeneratorCategory(e.target.value as RcraGeneratorCategory)}
              className={inputCls}
            >
              <option value="lqg">LQG — 90-day accumulation</option>
              <option value="sqg">SQG — 180-day accumulation</option>
              <option value="vsqg">VSQG — no federal limit</option>
            </select>
          </Field>

          {generatorCategory === 'sqg' && (
            <Field label="TSDF distance" hint="SQG only; >200 mi extends to 270 days">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={longHaul} onChange={e => setLongHaul(e.target.checked)} />
                Long-haul (&gt;200 mi)
              </label>
            </Field>
          )}
        </div>

        <Field label="Determination basis" hint="Generator knowledge, SDS, lab analysis, prior approved profile…">
          <textarea
            value={determinationBasis}
            onChange={e => setDeterminationBasis(e.target.value)}
            maxLength={2000}
            rows={3}
            className={inputCls}
          />
        </Field>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create stream
          </button>
          <Link
            href="/hazardous-waste/streams"
            className="text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  )
}
