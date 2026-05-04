import { needsPhoto } from '@/lib/photoStatus'
import type { Equipment } from '@/lib/types'

// Pure helpers extracted from app/loto/page.tsx so the URL-builder and
// auto-advance logic can be unit-tested without React. Both functions
// were previously inline in `setUrlState` and `handlePhotoSaved` and had
// no test coverage — moving them here lets the dashboard stay thin while
// the edge cases (decommissioned rows, missing selection, dept-scope
// mismatch, wrap-around) get pinned by tests.

// The LOTO dashboard moved from `/` to `/loto` when the home screen
// launched. Previously the URL builder hard-coded `/`; centralizing the
// path here means the next move (if any) is one constant edit.
export const LOTO_PATH = '/loto'

// Build the LOTO dashboard URL given the current search params and a
// partial update. Three-state semantics on each field:
//   undefined → leave the existing value alone
//   null      → delete the param
//   string    → set the param
// Empty string is treated like null (deletes) so callers can pass the
// raw value of an input element without having to normalize first.
export function buildLotoUrl(
  current: URLSearchParams,
  next:    { dept?: string | null; eq?: string | null },
): string {
  const params = new URLSearchParams(current)
  applyParam(params, 'dept', next.dept)
  applyParam(params, 'eq',   next.eq)
  const qs = params.toString()
  return qs ? `${LOTO_PATH}?${qs}` : LOTO_PATH
}

function applyParam(params: URLSearchParams, key: string, value: string | null | undefined): void {
  if (value === undefined) return
  if (value === null || value === '') params.delete(key)
  else params.set(key, value)
}

// Find the next equipment row that still needs a photo, scoped to the
// active dept (or globally when null), starting AFTER the current row
// and wrapping around. Returns null when no candidate exists.
//
//   - Excludes decommissioned items (a retired row isn't a valid target).
//   - Sort order matches EquipmentListPanel (equipment_id ASC) so the
//     advance feels predictable to a user reading the list.
//   - When the current row isn't in scope (e.g., the user changed dept
//     between save and advance), we search from the start rather than
//     freezing on a stale position.
export function findNextNeedsPhoto(
  equipment:      Equipment[],
  currentId:      string,
  dept:           string | null,
  decommissioned: Set<string>,
): Equipment | null {
  const scope = dept ? equipment.filter(e => e.department === dept) : equipment
  if (scope.length === 0) return null
  const sorted = [...scope].sort((a, b) => a.equipment_id.localeCompare(b.equipment_id))
  const idx = sorted.findIndex(e => e.equipment_id === currentId)
  const rotated = idx >= 0
    ? [...sorted.slice(idx + 1), ...sorted.slice(0, idx)]
    : sorted
  const next = rotated.find(e =>
    !decommissioned.has(e.equipment_id) && needsPhoto(e),
  )
  return next ?? null
}
