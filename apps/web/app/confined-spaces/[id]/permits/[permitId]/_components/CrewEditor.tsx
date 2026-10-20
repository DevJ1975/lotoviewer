'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { parseTrainingRequiredError } from '@soteria/core/permitTrainingGate'
import type { ConfinedSpaceEntry, ConfinedSpacePermit } from '@soteria/core/types'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import { validateRosterUpdate } from '@/lib/permitRoster'
import { crewNames, savePermitCrew, type CrewMember } from '@/lib/permits/permitCrew'
import { RosterPicker } from '@/components/permits/RosterPicker'

// Roster-based crew edits, before signature and mid-job. Writes the gateable
// permit_workers rows (the database refuses an untrained addition to a
// signed permit) and keeps the printed text[] rosters in sync. The
// "can't remove someone still inside the space" rule from lib/permitRoster
// still applies, checked by name against the live entries log.
export function CrewEditor({
  tenantId, permit, entries, crew, onClose, onSaved,
}: {
  tenantId: string
  permit: ConfinedSpacePermit
  entries: ConfinedSpaceEntry[]
  crew: CrewMember[]
  onClose: () => void
  onSaved: (permit: ConfinedSpacePermit, crew: CrewMember[]) => void
}) {
  const [draft, setDraft] = useState<CrewMember[]>(crew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entrants = crewNames(draft, 'entrant')
  const attendants = crewNames(draft, 'attendant')
  const issues = validateRosterUpdate({
    nextEntrants: entrants,
    nextAttendants: attendants,
    entries,
    signedAttendantName: permit.attendant_signature_name,
  })
  const hardErrors = issues.filter(e => !e.toLowerCase().startsWith('heads up'))
  const warnings = issues.filter(e => e.toLowerCase().startsWith('heads up'))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await savePermitCrew(tenantId, 'confined_space', permit.id, draft)
      const { data, error: updateError } = await supabase
        .from('loto_confined_space_permits')
        .update({ entrants, attendants, updated_at: new Date().toISOString() })
        .eq('id', permit.id)
        .select('*')
        .single()
      if (updateError || !data) throw new Error(formatSupabaseError(updateError, 'update roster'))
      onSaved(data as ConfinedSpacePermit, draft)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(parseTrainingRequiredError(message) ?? message)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <RosterPicker
        tenantId={tenantId}
        value={draft}
        onChange={setDraft}
        roles={[
          { role: 'entrant', label: 'Authorized entrants', required: true },
          { role: 'attendant', label: 'Attendant(s)', required: true },
        ]}
      />
      {hardErrors.map(e => <p key={e} className="text-xs text-rose-600">{e}</p>)}
      {warnings.map(w => <p key={w} className="text-xs text-amber-700 dark:text-amber-300">{w}</p>)}
      {error && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600">Cancel</button>
        <button type="button" onClick={save} disabled={saving || hardErrors.length > 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save crew
        </button>
      </div>
    </div>
  )
}
