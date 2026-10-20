'use client'

import { useEffect, useState } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import {
  parseTrainingRequiredError,
  type GatedPermitType,
  type PermitTrainingSummary,
  type PermitWorkerRole,
} from '@soteria/core/permitTrainingGate'
import { loadPermitCrew, savePermitCrew, type CrewMember } from '@/lib/permits/permitCrew'
import { RosterPicker } from './RosterPicker'
import { PermitTrainingPanel } from './PermitTrainingPanel'

interface PermitCrewCardProps {
  tenantId: string
  permitType: GatedPermitType
  permitId: string
  roles: { role: PermitWorkerRole; label: string; hint?: string }[]
  editable: boolean
  /** Roster members gated alongside the crew (e.g. the signing PAI). */
  extraMemberIds?: string[]
  /** Writes the printed text[] rosters after the crew changes. */
  syncLegacyNames: (crew: CrewMember[]) => Promise<void>
  onSummary: (summary: PermitTrainingSummary) => void
  refreshKey?: number
}

// Crew list + editor + training status for a permit whose people are
// otherwise plain name columns. Edits write permit_workers, which the
// database gates once the permit is issued.
export function PermitCrewCard({
  tenantId, permitType, permitId, roles, editable, extraMemberIds = [], syncLegacyNames, onSummary, refreshKey = 0,
}: PermitCrewCardProps) {
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [draft, setDraft] = useState<CrewMember[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    loadPermitCrew(tenantId, permitType, permitId).then(setCrew).catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [tenantId, permitType, permitId, version, refreshKey])

  async function save() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await savePermitCrew(tenantId, permitType, permitId, draft)
      await syncLegacyNames(draft)
      setDraft(null)
      setVersion(v => v + 1)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(parseTrainingRequiredError(message) ?? message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {draft ? (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <RosterPicker tenantId={tenantId} roles={roles} value={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setDraft(null); setError(null) }} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600">Cancel</button>
            <button type="button" onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save crew
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {roles.map(r => {
            const names = crew.filter(c => c.role === r.role).map(c => c.displayName)
            return (
              <p key={r.role} className="text-sm text-slate-700 dark:text-slate-200">
                <span className="font-semibold">{r.label}:</span> {names.length > 0 ? names.join(', ') : <span className="italic text-slate-400">none on the roster yet</span>}
              </p>
            )
          })}
          {editable && (
            <button type="button" onClick={() => setDraft(crew)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-navy hover:underline">
              <Pencil className="h-3 w-3" aria-hidden /> Edit crew
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{error}</p>}
      <PermitTrainingPanel
        tenantId={tenantId}
        permitType={permitType}
        permitId={permitId}
        extraMemberIds={extraMemberIds}
        refreshKey={version + refreshKey}
        onSummary={onSummary}
      />
    </div>
  )
}
