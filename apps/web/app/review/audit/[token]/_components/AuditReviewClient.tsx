'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LotoAuditChange } from '@/lib/loto/audit/schemas'
import AuditSummaryHeader, { type AuditResult } from './AuditSummaryHeader'
import ChangeDiffCard from './ChangeDiffCard'
import { RegulatorReportSection, MachineRegulatorNote } from './RegulatorReport'

// Public audit-review client. Mirrors app/review/[token]'s ReviewClient: the URL
// token is the only auth, every call hits /api/review/audit/[token]. Flow:
//   1. Load run + change-set + results; post view-ack once.
//   2. Reviewer approves/rejects each staged change (decide-change). Decisions
//      flip the staged row server-side; they never touch live placards.
//   3. Reviewer signs off (signoff). After that the surface is read-only — the
//      server rejects further decisions with 409.
//
// There's no toast system on the public surface (same as ReviewClient), so
// errors surface inline.

type Decision = 'approved' | 'rejected'

interface LoadState {
  signedOffAt:     string | null
  changes:         LotoAuditChange[]
  results:         AuditResult[]
  // The Cal/OSHA inspector's program-level report (jsonb; unknown-typed —
  // RegulatorReportSection narrows it). Null on pre-regulator runs.
  regulatorReport: unknown
}

export default function AuditReviewClient({ token }: { token: string }) {
  const [state, setState]       = useState<LoadState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyChangeId, setBusyChangeId] = useState<string | null>(null)
  const [actionError, setActionError]   = useState<string | null>(null)

  const [reviewerName, setReviewerName] = useState('')
  const [signApproved, setSignApproved] = useState<'' | 'approved' | 'rejected'>('')
  const [signNotes, setSignNotes]       = useState('')
  const [signing, setSigning]           = useState(false)
  const [signError, setSignError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/review/audit/${token}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setState({
        signedOffAt:     body.signed_off_at ?? null,
        changes:         (body.changes ?? []) as LotoAuditChange[],
        results:         (body.results ?? []) as AuditResult[],
        regulatorReport: body.regulator_report ?? null,
      })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this review.')
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  // Stamp first view once the page loads. Fire-and-forget — a failed ack is
  // non-fatal (same posture as ReviewClient's view-ack).
  useEffect(() => {
    void fetch(`/api/review/audit/${token}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'view-ack' }),
    }).catch(() => {})
  }, [token])

  const decide = useCallback(async (changeId: string, decision: Decision, note: string) => {
    setBusyChangeId(changeId)
    setActionError(null)
    try {
      const res = await fetch(`/api/review/audit/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:        'decide-change',
          change_id:     changeId,
          decision,
          reviewer_name: reviewerName.trim() || undefined,
          note:          note.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      // Reflect the decision locally; the server is the source of truth but a
      // refetch per click would be wasteful.
      setState(prev => prev && {
        ...prev,
        changes: prev.changes.map(c => c.id === changeId
          ? { ...c, status: decision, decided_by: reviewerName.trim() || c.decided_by, decided_note: note.trim() || null }
          : c),
      })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save your decision.')
    } finally {
      setBusyChangeId(null)
    }
  }, [token, reviewerName])

  const changesByEquipment = useMemo(
    () => groupByEquipment(state?.changes ?? []),
    [state?.changes],
  )

  // Per-machine result lookup so each machine's card can show the inspector's
  // narrative + the "Regulator sharpened" badge next to its changes.
  const resultByEquipment = useMemo(
    () => new Map((state?.results ?? []).map(r => [r.equipment_id, r])),
    [state?.results],
  )

  const undecided = useMemo(
    () => (state?.changes ?? []).filter(c => c.status === 'pending').length,
    [state?.changes],
  )

  async function submitSignoff() {
    if (!reviewerName.trim() || !signApproved || signing) return
    setSigning(true)
    setSignError(null)
    try {
      const res = await fetch(`/api/review/audit/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:     'signoff',
          typed_name: reviewerName.trim(),
          approved:   signApproved === 'approved',
          notes:      signNotes.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setState(prev => prev && { ...prev, signedOffAt: new Date().toISOString() })
    } catch (err) {
      setSignError(err instanceof Error ? err.message : 'Sign-off failed.')
    } finally {
      setSigning(false)
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md space-y-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800">
            SoteriaField · LOTO audit review
          </div>
          <h1 className="text-2xl font-bold text-slate-900">This review isn&apos;t available</h1>
          <p className="text-sm text-slate-600">{loadError}</p>
        </div>
      </main>
    )
  }

  if (!state) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-sm text-slate-500">Loading…</main>
  }

  const readOnly = state.signedOffAt !== null
  // The token is tenant-scoped; we don't expose a tenant name through the public
  // audit API, so the header uses a neutral label (matches the public review
  // flow's fallback for anonymous links).
  const tenantName = 'this facility'

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <AuditSummaryHeader tenantName={tenantName} changes={state.changes} results={state.results} />

        <RegulatorReportSection report={state.regulatorReport} />

        {readOnly && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              Review submitted
            </div>
            <p className="mt-2 text-sm text-emerald-900">
              Your decisions have been recorded. You can close this tab — the admin will apply the approved changes.
            </p>
          </div>
        )}

        {actionError && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{actionError}</p>
        )}

        <section className="space-y-4">
          {state.changes.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">
              The audit staged no changes — there&apos;s nothing to review.
            </div>
          )}
          {changesByEquipment.map(([equipmentId, rows]) => (
            <article key={equipmentId} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-bold text-slate-900">{equipmentId}</span>
                <span className="text-xs text-slate-500">{rows.length} change{rows.length === 1 ? '' : 's'}</span>
              </div>
              <MachineRegulatorNote
                payload={resultByEquipment.get(equipmentId)?.regulator_payload ?? null}
                concurs={resultByEquipment.get(equipmentId)?.regulator_concurs ?? null}
              />
              <div className="mt-3 space-y-3">
                {rows.map(change => (
                  <ChangeDiffCard
                    key={change.id}
                    change={change}
                    busy={busyChangeId === change.id}
                    readOnly={readOnly}
                    onDecide={(id, decision, note) => void decide(id, decision, note)}
                  />
                ))}
              </div>
            </article>
          ))}
        </section>

        {!readOnly && state.changes.length > 0 && (
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-bold text-slate-900">Sign off on this review</h2>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Your full name</span>
              <input
                type="text"
                value={reviewerName}
                onChange={e => setReviewerName(e.target.value)}
                placeholder="Type your full name"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
              <span className="mt-1 block text-[11px] text-slate-400">Recorded against your decisions so the admin knows who reviewed.</span>
            </label>

            <fieldset>
              <legend className="text-xs font-semibold text-slate-600">Overall outcome</legend>
              <div className="mt-2 flex gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="audit-overall" checked={signApproved === 'approved'} onChange={() => setSignApproved('approved')} />
                  <span>Approve this review</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="audit-overall" checked={signApproved === 'rejected'} onChange={() => setSignApproved('rejected')} />
                  <span>Reject this review</span>
                </label>
              </div>
            </fieldset>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Overall comments (optional)</span>
              <textarea
                rows={3}
                value={signNotes}
                onChange={e => setSignNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
            </label>

            {signError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{signError}</p>}
            {undecided > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {undecided} change{undecided === 1 ? ' is' : 's are'} still pending. You can sign off now, but undecided changes won&apos;t be applied.
              </p>
            )}

            <button
              type="button"
              onClick={() => void submitSignoff()}
              disabled={!reviewerName.trim() || !signApproved || signing}
              className="w-full rounded-lg bg-brand-navy py-3 font-semibold text-white transition-colors hover:bg-brand-navy/90 disabled:opacity-40"
            >
              {signing ? 'Submitting…' : 'Submit review'}
            </button>
            <p className="text-center text-[11px] text-slate-400">
              After you submit, this review becomes read-only.
            </p>
          </section>
        )}
      </div>
    </main>
  )
}

function groupByEquipment(changes: LotoAuditChange[]): Array<[string, LotoAuditChange[]]> {
  const groups = new Map<string, LotoAuditChange[]>()
  for (const change of changes) {
    const list = groups.get(change.equipment_id) ?? []
    list.push(change)
    groups.set(change.equipment_id, list)
  }
  return [...groups.entries()]
}
