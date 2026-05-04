'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, Loader2, LogIn, LogOut, ShieldAlert, XCircle } from 'lucide-react'

// Worker-facing self-service sign-on page. Reached by scanning the QR
// printed on a permit. Auth is the token in the URL path — anyone
// holding the QR can write to this permit's entries, BUT the API still
// enforces:
//   - the permit is active (not canceled, not expired, supervisor signed)
//   - the named entrant is on the roster
//   - training records are current (when the records table has any data)
//
// No app login required. Designed for a worker holding a phone at a
// confined-space entry point — single-tap-to-sign-in, single-tap-to-
// sign-out, big targets, friendly errors.

interface RosterEntry {
  name:               string
  slot:               'entrant' | 'attendant'
  trainingOk:         boolean
  trainingIssue:      string | null
  insideSince:        string | null
}

interface LookupResponse {
  permit: {
    id:        string
    serial:    string
    spaceId:   string
    purpose:   string
    startedAt: string
    expiresAt: string
    status:    'pending_signature' | 'active' | 'expired' | 'canceled'
  }
  roster:               RosterEntry[]
  signInAllowed:        boolean
  signInBlockedReason:  string | null
}

const STATUS_LABEL: Record<LookupResponse['permit']['status'], string> = {
  pending_signature: 'Pending signature',
  active:            'Active',
  expired:           'Expired',
  canceled:          'Canceled',
}

const STATUS_BG: Record<LookupResponse['permit']['status'], string> = {
  pending_signature: 'bg-amber-500',
  active:            'bg-emerald-600',
  expired:           'bg-rose-600',
  canceled:          'bg-slate-600',
}

export default function PermitSignonPage() {
  const params = useParams<{ token: string }>()
  const token  = params.token
  const [data, setData]       = useState<LookupResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyName, setBusyName]   = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionToast, setActionToast] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/permit-signon', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'lookup', token }),
      })
      const json = await res.json()
      if (!res.ok) {
        setLoadError(json.error ?? `Lookup failed (${res.status})`)
        setData(null)
        return
      }
      setData(json as LookupResponse)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load permit')
    }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  // Auto-refresh every 30s so the page stays fresh if e.g. the
  // supervisor cancels the permit while a worker is on the page —
  // the buttons should disable without requiring a manual reload.
  useEffect(() => {
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  async function act(name: string, action: 'sign-in' | 'sign-out') {
    setBusyName(name)
    setActionError(null)
    setActionToast(null)
    try {
      const res = await fetch('/api/permit-signon', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, token, name }),
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json.error ?? `${action} failed (${res.status})`)
      } else {
        setActionToast(action === 'sign-in' ? `Signed in as ${name}.` : `Signed out ${name}.`)
        await refresh()
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `${action} failed`)
    } finally {
      setBusyName(null)
    }
  }

  // Token format check upfront — invalid path → friendly 404 instead
  // of a confusing API error. Lookup will also reject but bouncing
  // before the network call saves a roundtrip.
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-3">
        <ShieldAlert className="h-12 w-12 text-rose-500 mx-auto" />
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Invalid sign-on link</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The link you scanned doesn&apos;t look like a valid Soteria FIELD permit QR.
          Make sure you scanned the QR from the printed permit at the work site.
        </p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-3">
        <XCircle className="h-12 w-12 text-rose-500 mx-auto" />
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Could not load permit</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{loadError}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-2 px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }

  const entrants = data.roster.filter(r => r.slot === 'entrant')

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      {/* Permit header */}
      <header className="space-y-2">
        <span className={`inline-block ${STATUS_BG[data.permit.status]} text-white text-[11px] font-bold uppercase tracking-widest px-2 py-1 rounded`}>
          {STATUS_LABEL[data.permit.status]}
        </span>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
          {data.permit.spaceId}
        </h1>
        <p className="text-xs font-mono font-semibold tracking-wider text-slate-500 dark:text-slate-400">
          {data.permit.serial}
        </p>
        <p className="text-sm text-slate-700 dark:text-slate-300">{data.permit.purpose}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Expires {new Date(data.permit.expiresAt).toLocaleString()}
        </p>
      </header>

      {/* Sign-in disabled banner */}
      {!data.signInAllowed && data.signInBlockedReason && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          <p className="font-semibold">Sign-in not available</p>
          <p>{data.signInBlockedReason}</p>
          <p className="mt-1 opacity-80">Sign-out is still available so anyone currently inside can be logged out.</p>
        </div>
      )}

      {/* Action results */}
      {actionToast && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{actionToast}</span>
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100 flex items-start gap-2">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Roster — one big tappable card per entrant */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Authorized entrants ({entrants.length})
        </h2>
        {entrants.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic py-4 text-center">
            No entrants on the roster yet. The supervisor must add one before sign-on works.
          </p>
        )}
        <ul className="space-y-2">
          {entrants.map(r => {
            const inside = r.insideSince != null
            const blocked = !r.trainingOk
            const busy = busyName === r.name
            // Sign-out is permitted even when sign-in is not (e.g. permit
            // canceled while someone was inside — they still need to log
            // out so the count is correct).
            const canSignIn  = !inside && !blocked && data.signInAllowed
            const canSignOut = inside
            return (
              <li
                key={r.name}
                className={`rounded-xl border ${
                  inside
                    ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/40/60'
                    : blocked
                    ? 'border-rose-200 bg-rose-50/40 dark:bg-rose-950/40/40'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                } px-4 py-3 space-y-2`}
              >
                <div>
                  <p className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">{r.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {inside
                      ? <>Inside since {new Date(r.insideSince!).toLocaleTimeString()}</>
                      : blocked
                      ? <>Training {r.trainingIssue ?? 'gap'}</>
                      : 'Not signed in'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!canSignIn || busy}
                    onClick={() => act(r.name, 'sign-in')}
                    className="flex-1 px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:bg-slate-200 disabled:dark:bg-slate-800 disabled:text-slate-400 disabled:dark:text-slate-500 hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                  >
                    {busy && !inside ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    Sign in
                  </button>
                  <button
                    type="button"
                    disabled={!canSignOut || busy}
                    onClick={() => act(r.name, 'sign-out')}
                    className="flex-1 px-4 py-3 rounded-lg bg-slate-700 text-white text-sm font-bold disabled:bg-slate-200 disabled:dark:bg-slate-800 disabled:text-slate-400 disabled:dark:text-slate-500 hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                  >
                    {busy && inside ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    Sign out
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 pt-2">
        Self-service sign-on. The attendant remains responsible under §1910.146(i).
      </p>
    </div>
  )
}
