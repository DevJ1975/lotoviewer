import { apiBase, authHeaders } from '@/lib/api'
import { findingsFromDraft, type HazardousWasteFieldDraft } from '@soteria/core/hazardousWaste'

// Mobile client for submitting a completed hazardous-waste field draft to the
// server. Reuses the web endpoint (POST /api/hazardous-waste/inspections) so
// finding validation, the area_type cross-check, and tenant scoping all stay
// server-side — the app just maps its local draft onto the request body. The
// route derives area_type from the area record itself, so we only send the
// area_id plus the findings keyed to the draft's checks.

export interface SubmitHazardousWasteInspectionArgs {
  tenantId: string
  draft:    HazardousWasteFieldDraft
}

export async function submitHazardousWasteInspection(
  args: SubmitHazardousWasteInspectionArgs,
): Promise<void> {
  const { draft } = args
  if (!draft.areaId) throw new Error('Select an inspection area before submitting.')

  // The inspections table has no location column; the selected area carries
  // the location identity. Fold the free-text location note into observations
  // so nothing the inspector typed is dropped on submit.
  const location = draft.locationName.trim()
  const observations = [location ? `Location: ${location}` : '', draft.observations.trim()]
    .filter(Boolean)
    .join('\n')

  const res = await fetch(`${apiBase()}/api/hazardous-waste/inspections`, {
    method:  'POST',
    headers: await authHeaders(args.tenantId),
    body: JSON.stringify({
      area_id:           draft.areaId,
      findings:          findingsFromDraft(draft),
      container_label:   draft.containerLabel.trim() || undefined,
      waste_description: draft.wasteDescription.trim() || undefined,
      observations:      observations || undefined,
      status:            'submitted',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Submit failed (${res.status})`)
}
