'use client'

import { useEffect, useRef, useState } from 'react'
import { Eraser, FileText, Loader2, PenLine, Save } from 'lucide-react'
import SignaturePad, { type SignaturePadRef } from '@/components/SignaturePad'
import { superadminFetch, superadminJson } from '@/lib/superadminFetch'

interface Signatory {
  signer_name: string
  signer_title: string
  issuer: string
  has_signature: boolean
}

const input = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900'

// The signature stamped on every STRIKE completion certificate. Drawn once
// here, with a finger or a mouse; Preview renders a real certificate with it.
export function CertificateSignatoryCard() {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [issuer, setIssuer] = useState('')
  const [hasSaved, setHasSaved] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const [busy, setBusy] = useState<'load' | 'save' | 'preview' | null>('load')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const padRef = useRef<SignaturePadRef>(null)

  useEffect(() => {
    void (async () => {
      const res = await superadminJson<{ signatory: Signatory | null }>('/api/superadmin/strike/certificate-signatory', { method: 'GET' })
      const saved = res.body?.signatory
      if (saved) {
        setName(saved.signer_name)
        setTitle(saved.signer_title)
        setIssuer(saved.issuer)
        setHasSaved(saved.has_signature)
      }
      if (res.error) setMessage({ kind: 'error', text: res.error })
      setBusy(null)
    })()
  }, [])

  async function save() {
    setBusy('save')
    setMessage(null)
    const res = await superadminJson<{ signatory: Signatory }>('/api/superadmin/strike/certificate-signatory', {
      method: 'PUT',
      body: JSON.stringify({ signer_name: name, signer_title: title, issuer, signature_png: drawn ? padRef.current?.toDataURL() : null }),
    })
    setBusy(null)
    if (!res.ok) { setMessage({ kind: 'error', text: res.error ?? 'Save failed' }); return }
    setHasSaved(true)
    setDrawn(false)
    padRef.current?.clear()
    setMessage({ kind: 'ok', text: 'Saved. New certificates carry this signature.' })
  }

  async function preview() {
    setBusy('preview')
    setMessage(null)
    try {
      const res = await superadminFetch('/api/superadmin/strike/certificate-signatory?preview=1')
      if (!res.ok) throw new Error('Preview failed')
      window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener')
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <PenLine className="h-4 w-4" aria-hidden /> Certificate signature
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Printed on every STRIKE certificate of completion, in English and Spanish.
          {hasSaved ? ' A signature is saved; draw below only to replace it.' : ' Draw your signature below.'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Name
          <input className={input} value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Title
          <input className={input} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Founder" />
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Issuer
          <input className={input} value={issuer} onChange={e => setIssuer(e.target.value)} placeholder="e.g. Trainovations" />
        </label>
      </div>
      <div className="space-y-2">
        <SignaturePad ref={padRef} onChange={empty => setDrawn(!empty)} />
        <button type="button" onClick={() => padRef.current?.clear()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
          <Eraser className="h-4 w-4" aria-hidden /> Clear
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy !== null || !name.trim() || !issuer.trim() || (!drawn && !hasSaved)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save
        </button>
        <button type="button" onClick={() => void preview()} disabled={busy !== null}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
          {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />} Preview certificate
        </button>
        {message && <span role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300'}`}>{message.text}</span>}
      </div>
    </section>
  )
}
