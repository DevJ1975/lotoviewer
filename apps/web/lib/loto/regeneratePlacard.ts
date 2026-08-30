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
//   4. Patch loto_equipment.placard_url (cache-busted) to the fresh copy.
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

// Load the tenant's logo as pdf-lib-embeddable PNG bytes for the placard
// header. Tenant logos are stored as WebP, which pdf-lib can't embed — sharp
// (server-only) decodes WebP/PNG/JPEG and re-encodes PNG. Best-effort: any
// failure returns null and the placard falls back to the "SL" badge. Capped
// in size since the header box is ~150×32pt.
export async function loadTenantLogoPng(
  admin: SupabaseClient,
  tenantId: string,
): Promise<Uint8Array | null> {
  try {
    const { data } = await admin
      .from('tenants')
      .select('logo_url')
      .eq('id', tenantId)
      .maybeSingle<{ logo_url: string | null }>()
    const url = data?.logo_url
    if (!url) return null

    const res = await fetch(url)
    if (!res.ok) return null
    const input = Buffer.from(await res.arrayBuffer())

    const sharp = (await import('sharp')).default
    const png = await sharp(input)
      .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return new Uint8Array(png)
  } catch {
    return null
  }
}

export async function regenerateAndUploadPlacard(
  admin: SupabaseClient,
  tenantId:   string,
  equipmentId: string,
  // Optional pre-loaded tenant logo (PNG bytes). A bulk caller (the backfill
  // cron) loads each tenant's logo once and threads it through so we don't
  // re-fetch + re-encode the same logo per equipment. Omit to self-load; pass
  // null to force the "no logo" fallback.
  logoPngOverride?: Uint8Array | null,
): Promise<RegenerateResult> {
  const [eqRes, stepsRes] = await Promise.all([
    admin.from('loto_equipment')
         .select('*')
         .eq('tenant_id', tenantId)
         .eq('equipment_id', equipmentId)
         .maybeSingle<Equipment>(),
    admin.from('loto_energy_steps')
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

  const tenantLogoPng = logoPngOverride !== undefined
    ? logoPngOverride
    : await loadTenantLogoPng(admin, tenantId)
  const bytes = await generatePlacardPdf({ equipment, steps, tenantLogoPng })
  const path  = placardPdfPath(tenantId, equipmentId)

  const bucket = admin.storage.from(BUCKET)
  const { error: uploadErr } = await bucket.upload(path, bytes, {
    contentType: 'application/pdf',
    upsert:      true,
  })
  if (uploadErr) throw new Error(`upload placard: ${uploadErr.message}`)

  const { data: { publicUrl } } = bucket.getPublicUrl(path)

  // Cache-bust the placard_url so the browser image fetch + the next
  // PDF embed don't show the stale copy. (We don't touch signed_placard_url
  // here — it isn't a column on loto_equipment; the signed artifact lives in
  // loto_signed_pdf_artifacts. Writing it errored against the live schema.)
  const cacheBusted = `${publicUrl}?v=${Date.now()}`
  const { error: patchErr } = await admin
    .from('loto_equipment')
    .update({
      placard_url: cacheBusted,
      updated_at:  new Date().toISOString(),
    })
    .eq('tenant_id',   tenantId)
    .eq('equipment_id', equipmentId)
  if (patchErr) throw new Error(`patch equipment: ${patchErr.message}`)

  return { placardUrl: cacheBusted }
}
