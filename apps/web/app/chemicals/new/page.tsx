'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  GHS_PICTOGRAMS,
  GHS_PICTOGRAM_LABEL,
  GHS_SIGNAL_WORDS,
  PHYSICAL_STATES,
  isValidCas,
  type GhsPictogram,
  type GhsSignalWord,
  type PhysicalState,
} from '@soteria/core/chemicals'

// Phase A "create" form. Captures the minimum identifying + hazard
// metadata + an optional SDS PDF upload in a single flow. AI-assisted
// SDS parse will land in Phase B and pre-fill these fields from the
// PDF; the schema is the same.

export default function NewChemicalPage() {
  const router = useRouter()
  const { tenant } = useTenant()

  const [name, setName] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [productCode, setProductCode] = useState('')
  const [casRaw, setCasRaw] = useState('')
  const [synonymsRaw, setSynonymsRaw] = useState('')
  const [physicalState, setPhysicalState] = useState<PhysicalState | ''>('')
  const [signalWord, setSignalWord] = useState<GhsSignalWord | ''>('')
  const [pictograms, setPictograms] = useState<Set<GhsPictogram>>(new Set())
  const [nfpaH, setNfpaH] = useState<string>('')
  const [nfpaF, setNfpaF] = useState<string>('')
  const [nfpaI, setNfpaI] = useState<string>('')
  const [storageClass, setStorageClass] = useState('')
  const [ppeRaw, setPpeRaw] = useState('')
  const [sdsRevisionDate, setSdsRevisionDate] = useState('')
  const [sdsSourceUrl, setSdsSourceUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [sdsFile, setSdsFile] = useState<File | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function togglePicto(p: GhsPictogram) {
    setPictograms(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  function splitList(raw: string): string[] {
    return raw
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean)
  }

  function toIntInRange(s: string): number | null {
    if (!s.trim()) return null
    const n = Number.parseInt(s, 10)
    if (!Number.isInteger(n) || n < 0 || n > 4) return null
    return n
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id) return
    setError(null)

    const cas = splitList(casRaw)
    const invalidCas = cas.filter(c => !isValidCas(c))
    if (invalidCas.length > 0) {
      setError(`Invalid CAS number(s): ${invalidCas.join(', ')}`)
      return
    }
    for (const [label, val] of [['Health', nfpaH], ['Flammability', nfpaF], ['Instability', nfpaI]] as const) {
      if (val.trim() && toIntInRange(val) === null) {
        setError(`NFPA ${label} must be an integer 0..4`)
        return
      }
    }

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'x-active-tenant':  tenant.id,
        'content-type':     'application/json',
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const payload = {
        name: name.trim(),
        manufacturer: manufacturer.trim() || null,
        product_code: productCode.trim() || null,
        cas_numbers:  cas,
        synonyms:     splitList(synonymsRaw),
        physical_state: physicalState || null,
        ghs_signal_word: signalWord || null,
        ghs_pictograms: Array.from(pictograms),
        nfpa_health: toIntInRange(nfpaH),
        nfpa_flammability: toIntInRange(nfpaF),
        nfpa_instability: toIntInRange(nfpaI),
        storage_class: storageClass.trim() || null,
        ppe_required: splitList(ppeRaw),
        sds_revision_date: sdsRevisionDate || null,
        sds_source_url: sdsSourceUrl.trim() || null,
        notes: notes.trim() || null,
      }

      const res  = await fetch('/api/chemicals/products', {
        method: 'POST',
        headers,
        body:   JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      const productId: string = body.product.id

      if (sdsFile) {
        const upHeaders: Record<string, string> = { 'x-active-tenant': tenant.id }
        if (session?.access_token) upHeaders.authorization = `Bearer ${session.access_token}`
        const form = new FormData()
        form.append('file', sdsFile)
        if (sdsRevisionDate) form.append('revision_date', sdsRevisionDate)
        const upRes  = await fetch(`/api/chemicals/products/${productId}/sds`, {
          method: 'POST',
          headers: upHeaders,
          body:    form,
        })
        if (!upRes.ok) {
          const upBody = await upRes.json().catch(() => ({}))
          setError(`Chemical saved, but SDS upload failed: ${upBody.error ?? upRes.status}`)
          router.push(`/chemicals/${productId}`)
          return
        }
      }

      router.push(`/chemicals/${productId}`)
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Add chemical</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Capture identification + GHS hazard classification, and optionally attach the
          manufacturer SDS PDF. Fields marked <span className="text-rose-600">*</span> are required.
        </p>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700 dark:text-slate-300">Identification</legend>
          <Input label="Product name" required value={name} onChange={setName} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Manufacturer" value={manufacturer} onChange={setManufacturer} />
            <Input label="Product code" value={productCode} onChange={setProductCode} />
          </div>
          <Input label="CAS numbers (comma-separated)" value={casRaw} onChange={setCasRaw} placeholder="64-17-5, 7732-18-5" />
          <Input label="Synonyms (comma-separated)" value={synonymsRaw} onChange={setSynonymsRaw} />
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Physical state</span>
            <select
              value={physicalState}
              onChange={e => setPhysicalState(e.target.value as PhysicalState | '')}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">—</option>
              {PHYSICAL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700 dark:text-slate-300">GHS hazard classification</legend>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Signal word</span>
            <select
              value={signalWord}
              onChange={e => setSignalWord(e.target.value as GhsSignalWord | '')}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">—</option>
              {GHS_SIGNAL_WORDS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Pictograms</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {GHS_PICTOGRAMS.map(p => {
                const on = pictograms.has(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePicto(p)}
                    className={`px-2 py-1 text-xs font-mono rounded border ${
                      on
                        ? 'bg-rose-100 border-rose-400 text-rose-800 dark:bg-rose-950/40 dark:border-rose-700 dark:text-rose-300'
                        : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                    title={GHS_PICTOGRAM_LABEL[p]}
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="NFPA Health (0–4)" value={nfpaH} onChange={setNfpaH} />
            <Input label="NFPA Flammability (0–4)" value={nfpaF} onChange={setNfpaF} />
            <Input label="NFPA Instability (0–4)" value={nfpaI} onChange={setNfpaI} />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700 dark:text-slate-300">Storage & PPE</legend>
          <Input label="Storage class" value={storageClass} onChange={setStorageClass} placeholder="Flammable cabinet, corrosive cabinet…" />
          <Input label="Required PPE (comma-separated)" value={ppeRaw} onChange={setPpeRaw} placeholder="Nitrile gloves, safety glasses" />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700 dark:text-slate-300">SDS</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Revision date" type="date" value={sdsRevisionDate} onChange={setSdsRevisionDate} />
            <Input label="Source URL" value={sdsSourceUrl} onChange={setSdsSourceUrl} placeholder="https://…" />
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Upload SDS PDF (optional, max 25 MB)</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={e => setSdsFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-slate-700 dark:text-slate-300"
            />
            {sdsFile && (
              <div className="mt-1 text-xs text-slate-500">
                {sdsFile.name} ({(sdsFile.size / 1024 / 1024).toFixed(2)} MB)
              </div>
            )}
          </label>
        </fieldset>

        <fieldset>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </label>
        </fieldset>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link
            href="/chemicals"
            className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Saving…' : 'Save chemical'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Input(props: {
  label:        string
  value:        string
  onChange:     (v: string) => void
  placeholder?: string
  required?:    boolean
  type?:        'text' | 'date'
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {props.label}{props.required && <span className="text-rose-600 ml-0.5">*</span>}
      </span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        required={props.required}
        className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
      />
    </label>
  )
}
