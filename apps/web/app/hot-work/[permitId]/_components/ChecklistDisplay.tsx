'use client'

import type { HotWorkPreChecks } from '@soteria/core/types'
import { validateChecklist } from '@soteria/core/hotWorkChecklist'

// Read-only render of the FM Global 7-40 / NFPA 51B pre-work checklist.
// Failure highlighting comes from validateChecklist (lib/hotWorkChecklist)
// so the rules can be unit-tested without React.

export function ChecklistDisplay({ checks }: { checks: HotWorkPreChecks }) {
  const issues = validateChecklist(checks)
  const failedCodes = new Set(issues.map(i => i.code))
  // Static rendering so the printed-permit format and the on-screen
  // detail page stay in lockstep. Each row shows the question and the
  // current answer. Failures get a rose pill so the supervisor sees
  // gaps at a glance.
  const rows: Array<{ key: keyof HotWorkPreChecks; label: string; code?: string; format?: 'tri' }> = [
    { key: 'combustibles_cleared_35ft',    label: 'Combustibles cleared / shielded within 35 ft',  code: 'combustibles' },
    { key: 'floor_swept',                  label: 'Floor swept clean for 35 ft radius',             code: 'floor_swept' },
    { key: 'floor_openings_protected',     label: 'Floor openings within 35 ft protected',          code: 'floor_openings' },
    { key: 'wall_openings_protected',      label: 'Wall openings within 35 ft protected',           code: 'wall_openings' },
    { key: 'sprinklers_operational',       label: 'Sprinklers operational',                         code: 'sprinklers' },
    { key: 'ventilation_adequate',         label: 'Ventilation adequate',                           code: 'ventilation' },
    { key: 'fire_extinguisher_present',    label: 'Fire extinguisher present within reach',         code: 'extinguisher_present' },
    { key: 'curtains_or_shields_in_place', label: 'Curtains / shields in place where needed',       code: 'curtains' },
    { key: 'gas_lines_isolated',           label: 'Gas lines isolated (or N/A)',                    format: 'tri', code: 'gas_lines' },
    { key: 'adjacent_areas_notified',      label: 'Adjacent areas notified before work begins',     code: 'adjacent_notified' },
    { key: 'confined_space',               label: 'Hot work performed inside a confined space' },
    { key: 'elevated_work',                label: 'Elevated work (>4 ft / fall protection req.)' },
  ]
  return (
    <ul className="text-xs space-y-0.5">
      {rows.map(r => {
        const v = checks[r.key]
        const isFailed = r.code != null && failedCodes.has(r.code)
        return (
          <li key={String(r.key)} className="flex items-baseline justify-between gap-3 py-0.5 border-t border-slate-100 dark:border-slate-800 first:border-t-0">
            <span className="text-slate-700 dark:text-slate-300">{r.label}</span>
            <AnswerBadge value={v} format={r.format} failed={isFailed} />
          </li>
        )
      })}
      {checks.sprinklers_operational === false && checks.alternate_protection_if_no_spr && (
        <li className="text-[11px] text-slate-500 dark:text-slate-400 pt-1.5">
          <span className="font-semibold">Alternate protection:</span> {checks.alternate_protection_if_no_spr}
        </li>
      )}
      {checks.fire_extinguisher_present === true && checks.fire_extinguisher_type && (
        <li className="text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold">Extinguisher type:</span> {checks.fire_extinguisher_type}
        </li>
      )}
    </ul>
  )
}

function AnswerBadge({ value, format, failed }: {
  value:  HotWorkPreChecks[keyof HotWorkPreChecks]
  format?: 'tri'
  failed?: boolean
}) {
  if (value === undefined) {
    return <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">unanswered</span>
  }
  if (format === 'tri' && value === null) {
    return <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">N/A</span>
  }
  const cls = failed
    ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200'
    : value === true  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
    : value === false ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200'
    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>
      {value === true ? 'Yes' : value === false ? 'No' : String(value)}
    </span>
  )
}
