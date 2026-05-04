'use client'

import { useState } from 'react'
import { Loader2, AlertCircle, RotateCcw } from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import { Section } from './Section'

interface ResetResult {
  wiped:       Record<string, number>
  skipped:     string[]
  seed:        string | null
  seedSkipped: boolean
}

interface Props {
  tenantNumber: string
  tenantName:   string
  reload:       () => Promise<void>
}

export function ResetDemoSection({ tenantNumber, tenantName, reload }: Props) {
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const [result, setResult] = useState<ResetResult | null>(null)

  async function onReset() {
    const phrase = `RESET ${tenantNumber}`
    const got = prompt(
      `Wipe ALL domain data for ${tenantName} (#${tenantNumber}) and re-seed canonical demo data.\n\n` +
      `Equipment, permits, training records, audit log — all replaced with the demo set defined in migration 030.\n\n` +
      `Type "${phrase}" to confirm.`,
    )
    if (got !== phrase) {
      if (got !== null) alert('Confirmation phrase did not match. Nothing was changed.')
      return
    }

    setBusy(true); setError(null); setResult(null)
    const apiResult = await superadminJson<ResetResult>(
      `/api/superadmin/tenants/${tenantNumber}/reset-demo`,
      { method: 'POST' },
    )
    if (!apiResult.ok || !apiResult.body) {
      setError(apiResult.error ?? 'Reset failed')
    } else {
      setResult({
        wiped:       apiResult.body.wiped ?? {},
        skipped:     apiResult.body.skipped ?? [],
        seed:        apiResult.body.seed ?? null,
        seedSkipped: !!apiResult.body.seedSkipped,
      })
      await reload()
    }
    setBusy(false)
  }

  const totalWiped = result ? Object.values(result.wiped).reduce((a, b) => a + b, 0) : 0

  return (
    <Section title="Reset demo data">
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Wipes every domain row in this tenant, then re-seeds canonical demo data
        from <span className="font-mono">migration 030</span>. Use this between
        client demos to restore a known-good state.
      </p>

      <button
        type="button"
        onClick={onReset}
        disabled={busy}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-60 transition-colors"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        {busy ? 'Resetting…' : 'Wipe & re-seed demo'}
      </button>

      {error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      {result && (
        <div className="mt-4 p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm">
          <p className="font-medium text-emerald-900 dark:text-emerald-100 mb-2">
            Wiped {totalWiped.toLocaleString()} row{totalWiped === 1 ? '' : 's'}.
          </p>
          {Object.entries(result.wiped).filter(([, n]) => n > 0).length > 0 && (
            <ul className="text-xs text-emerald-800 dark:text-emerald-200 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
              {Object.entries(result.wiped)
                .filter(([, n]) => n > 0)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([t, n]) => <li key={t}>{t}: {n}</li>)}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300/70">
              Skipped (table not in this DB): {result.skipped.join(', ')}
            </p>
          )}
          {result.seed && (
            <p className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800 text-xs font-mono text-emerald-800 dark:text-emerald-200">
              {result.seed}
            </p>
          )}
          {result.seedSkipped && (
            <p className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300/70">
              No seed function for this tenant — only the wipe ran.
            </p>
          )}
        </div>
      )}
    </Section>
  )
}
