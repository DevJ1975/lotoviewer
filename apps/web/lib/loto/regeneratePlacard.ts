import type { SupabaseClient } from '@supabase/supabase-js'
import { generatePlacardPdf } from '@/lib/pdfPlacard'
import { placardPdfPath } from '@soteria/core/storagePaths'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'

// Server-side placard regenerator. After a public reviewer replaces a
// photo, we want the placard PDF in storage to match the new photo
// immediately — otherwise a printed placard on a panel would still
// show the stale image until an admin manually re-rendered. The
// supervisor flow specifies inline regen (chosen over lazy regen) so
// the next admin viewer sees the new placard without extra steps.
//
// The function is intentionally narrow: it does NOT mint signed URLs,
// it does NOT update review-link state, it does NOT re-seal a signed
// artifact. Those concerns stay in the caller. This is just:
//
//   1. Load equipment + energy steps (service role; tenant-scoped read).
//   2. Render the PDF bytes via the shared pdfPlacard helper.
//   3. Upsert into the canonical placard path in the loto-photos bucket.
//   4. Patch loto_equipment.placard_url + null signed_placard_url so a
//      stale signed copy doesn't shadow the fresh placard.
//   5. Return the new public URL.
//
// Failures throw — the public review route wraps the call in a try /
// catch so the photo upload itself isn't rolled back if rendering or
// uploading the PDF fails. The placard_url just stays null and the
// next viewer triggers a regen attempt.

const BUCKET = 'loto-photos'

export interface RegenerateResult {
  placardUrl: string
}

export async function regenerateAndUploadPlacard(
  admin: SupabaseClient,
  tenantId:   string,
  equipmentId: string,
): Promise<RegenerateResult> {
  const [eqRes, stepsRes] = await Promise.all([
    admin.from('loto_equipment')
         .select('*')
         .eq('tenant_id', tenantId)
         .eq('equipment_id', equipmentId)
         .maybeSingle<Equipment>(),
    admin.from('loto_steps')
         .select('*')
         .eq('tenant_id', tenantId)
         .eq('equipment_id', equipmentId)
         .order('step_number', { ascending: true }),
  ])

  if (eqRes.error)    throw new Error(`load equipment: ${eqRes.error.message}`)
  if (stepsRes.error) throw new Error(`load steps: ${stepsRes.error.message}`)
  if (!eqRes.data)    throw new Error(`equipment not found: ${equipmentId}`)

  const equipment = eqRes.data
  const steps     = (stepsRes.data ?? []) as LotoEnergyStep[]

  const bytes = await generatePlacardPdf({ equipment, steps })
  const path  = placardPdfPath(tenantId, equipmentId)

  const bucket = admin.storage.from(BUCKET)
  const { error: uploadErr } = await bucket.upload(path, bytes, {
    contentType: 'application/pdf',
    upsert:      true,
  })
  if (uploadErr) throw new Error(`upload placard: ${uploadErr.message}`)

  const { data: { publicUrl } } = bucket.getPublicUrl(path)

  // Cache-bust the placard_url so the browser image fetch + the next
  // PDF embed don't show the stale copy. signed_placard_url is nulled
  // because any prior signature was over the old bytes — the next
  // reviewer must re-sign over the new placard.
  const cacheBusted = `${publicUrl}?v=${Date.now()}`
  const { error: patchErr } = await admin
    .from('loto_equipment')
    .update({
      placard_url:        cacheBusted,
      signed_placard_url: null,
      updated_at:         new Date().toISOString(),
    })
    .eq('tenant_id',   tenantId)
    .eq('equipment_id', equipmentId)
  if (patchErr) throw new Error(`patch equipment: ${patchErr.message}`)

  return { placardUrl: cacheBusted }
}
