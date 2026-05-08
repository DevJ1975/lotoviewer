'use client'

import { useEffect, useState, use } from 'react'
import { Loader2, AlertTriangle, CheckCircle2, Eye } from 'lucide-react'
import { ObservationForm, type BBSFormPayload } from '@/app/bbs/_components/ObservationForm'

// /r/bbs/[token] — Public landing for a QR scan. No login. The token
// is matched against bbs_qr_locations server-side; the API endpoint
// at /api/bbs/intake/[token] uses the service-role key to insert
// the submission.
//
// Three states: (1) verifying token, (2) submission form,
// (3) thank-you receipt.

interface VerifyResponse {
  location: {
    id:          string
    name:        string
    area:        string | null
    description: string | null
  }
  tenant: { name: string; logo_url: string | null } | null
}

export default function PublicBBSIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [verify,    setVerify]    = useState<VerifyResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ report_number: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/bbs/intake/${token}`)
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        if (!cancelled) setVerify(body)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [token])

  async function handleSubmit(payload: BBSFormPayload) {
    const res = await fetch(`/api/bbs/intake/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    setSubmitted({ report_number: body.observation.report_number })
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-md w-full rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 p-6 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto text-rose-500 mb-2" />
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">QR not recognized</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{loadError}</p>
          <p className="mt-4 text-xs text-slate-500">If you scanned a printed QR, please report the broken sticker to your supervisor.</p>
        </div>
      </div>
    )
  }

  if (!verify) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-md w-full rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 p-6 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500 mb-2" />
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Thank you</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Your observation <span className="font-mono">{submitted.report_number}</span> was received.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            EHS will review and follow up if needed. Stay safe out there.
          </p>
          <button
            type="button"
            onClick={() => setSubmitted(null)}
            className="mt-5 text-sm text-teal-600 hover:underline"
          >
            Submit another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {verify.tenant?.logo_url
            ? <img src={verify.tenant.logo_url} alt="" className="h-8 w-auto" />
            : <Eye className="w-7 h-7 text-teal-600" />}
          <div>
            <div className="text-xs text-slate-500 uppercase">{verify.tenant?.name ?? 'Behavior-Based Safety'}</div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Report at {verify.location.name}
            </h1>
            {verify.location.area && (
              <div className="text-xs text-slate-500">{verify.location.area}</div>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Spot something? Tell us about it. You can submit anonymously — no login required.
        </p>
        <ObservationForm
          anonymous={true}
          defaultLocation={verify.location.area ?? verify.location.name}
          onSubmit={handleSubmit}
        />
      </main>
    </div>
  )
}
