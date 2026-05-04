import type { HotWorkPreChecks } from './types'

// Pure validation of the hot-work pre-work checklist. Mirrors
// lib/permitRoster.ts's posture: returns an issue list, empty array =
// ready to sign. Lives separately from hotWorkPermitStatus so the
// shape can grow in v2 (more checks) without touching the lifecycle
// helper.
//
// The checks themselves come from FM Global 7-40 + Cal/OSHA Title 8
// §§4848-4853 + NFPA 51B §6:
//
//   1. Combustibles within 35 ft cleared or shielded (§4848)
//   2. Floor swept clean of combustibles (§4848)
//   3. Floor openings within 35 ft protected (§4848)
//   4. Wall openings within 35 ft protected (§4848)
//   5. Sprinklers operational (NFPA 51B §6.4.2.1) — if not, alternate
//      protection required and must be described
//   6. Ventilation adequate (§1910.252(c))
//   7. Fire extinguisher present + type identified (§1910.252(a)(2)(xi))
//   8. Fire-resistant curtains / shields in place (§4848)
//   9. Gas lines isolated (only when applicable; null = N/A)
//  10. Adjacent areas notified (§1910.252(a)(2)(viii))
//
// Any boolean left undefined or set to false is a hard block. Items 5,
// 7, and 9 have their own conditional sub-rules.

export interface ChecklistIssue {
  code:    string
  message: string
}

export function validateChecklist(c: HotWorkPreChecks): ChecklistIssue[] {
  const issues: ChecklistIssue[] = []

  // The required boolean checks. Each must be explicitly true.
  const required: Array<{ key: keyof HotWorkPreChecks; code: string; label: string }> = [
    { key: 'combustibles_cleared_35ft',    code: 'combustibles',          label: 'Combustibles cleared or shielded within 35 ft' },
    { key: 'floor_swept',                  code: 'floor_swept',           label: 'Floor swept clean for 35 ft radius' },
    { key: 'floor_openings_protected',     code: 'floor_openings',        label: 'Floor openings within 35 ft protected' },
    { key: 'wall_openings_protected',      code: 'wall_openings',         label: 'Wall openings within 35 ft protected' },
    { key: 'ventilation_adequate',         code: 'ventilation',           label: 'Ventilation adequate' },
    { key: 'fire_extinguisher_present',    code: 'extinguisher_present',  label: 'Fire extinguisher present within reach' },
    { key: 'curtains_or_shields_in_place', code: 'curtains',              label: 'Fire-resistant curtains / shields in place where needed' },
    { key: 'adjacent_areas_notified',      code: 'adjacent_notified',     label: 'Adjacent areas notified before work begins' },
  ]
  for (const r of required) {
    if (c[r.key] !== true) {
      issues.push({ code: r.code, message: `${r.label} (required pre-work check).` })
    }
  }

  // Sprinklers — boolean must be set; if false, alternate-protection
  // text is required (NFPA 51B §6.4.2.1.2).
  if (typeof c.sprinklers_operational !== 'boolean') {
    issues.push({
      code:    'sprinklers',
      message: 'Sprinkler status must be confirmed (operational or compensatory measures described).',
    })
  } else if (c.sprinklers_operational === false) {
    if (!c.alternate_protection_if_no_spr || c.alternate_protection_if_no_spr.trim().length === 0) {
      issues.push({
        code:    'sprinklers_alternate',
        message: 'Sprinklers are out of service — describe the alternate protection (extra extinguishers, dedicated watcher, etc.) per NFPA 51B §6.4.2.1.2.',
      })
    }
  }

  // Fire extinguisher type required when present is true. (The
  // extinguisher_present check above already catches absence.)
  if (c.fire_extinguisher_present === true) {
    if (!c.fire_extinguisher_type || c.fire_extinguisher_type.trim().length === 0) {
      issues.push({
        code:    'extinguisher_type',
        message: 'Specify the fire extinguisher type (ABC, CO2, dry chemical, etc.).',
      })
    }
  }

  // gas_lines_isolated: null is valid (means "no gas lines involved").
  // Only flag if the field exists and is explicitly false.
  if (c.gas_lines_isolated === false) {
    issues.push({
      code:    'gas_lines',
      message: 'Gas lines are present and not isolated — isolate or document why isolation is not feasible before signing.',
    })
  }

  return issues
}

// Convenience: a "checklist is ready" boolean. Same shape as the
// existing helpers in lib/permitRoster.ts — if you need the reasons,
// call validateChecklist instead.
export function checklistReady(c: HotWorkPreChecks): boolean {
  return validateChecklist(c).length === 0
}

// ── Helpful constants for the form UI ─────────────────────────────────────
// Common fire-extinguisher types. The form picker uses these as quick
// options; the field is still free-text so a site can type "Halotron"
// or "Class K" if their environment requires.
export const FIRE_EXTINGUISHER_TYPES = ['ABC', 'CO2', 'Dry Chemical', 'Class D', 'Class K', 'Water Mist'] as const
