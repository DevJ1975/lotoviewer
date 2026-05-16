import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import * as Sentry from '@sentry/nextjs'
import { sha256Hex } from '@soteria/core/signedArtifactHash'
import { signedPlacardPath } from '@soteria/core/storagePaths'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Server-side sealer for review-portal placard signoffs.
//
// Why server-side: the public review API is the only trusted caller —
// hashing the bytes in the browser and POSTing them up would let a
// malicious reviewer forge the hash. We re-stamp the signature on the
// canonical placard PDF here, hash the resulting bytes, upload to
// the loto-photos bucket, and write the audit row.
//
// Failure posture: best-effort per placard. If one placard fails (PDF
// missing, decode error, network blip on storage), we capture to
// Sentry and continue with the rest. The signoff RPC has already
// succeeded — partial sealing is preferable to rolling back the whole
// signoff because of one unreadable PDF.

interface SealArgs {
  tenantId:        string
  reviewLinkId:    string
  signedAt:        string                  // ISO timestamp from the signoff
  typedName:       string
  signatureDataUrl: string                 // PNG data URL from the SignaturePad
  signerIp:        string | null
  signerUserAgent: string | null
}

interface ApprovedPlacard {
  equipment_id:    string
  placard_url:     string | null
}

// SHA-256 hash + sealed-artifact row for every approved placard on a
// review link. Called from the public review API right after the
// signoff RPC succeeds. Each artifact gets its own try/catch so one
// bad placard doesn't take down the rest.
export async function sealReviewPlacards(
  args: SealArgs,
  placards: ApprovedPlacard[],
): Promise<{ sealed: number; failed: number }> {
  let sealed = 0
  let failed = 0

  const admin = supabaseAdmin()
  // Resolve "approved" placards to their signed-PDF bytes. The
  // review-portal flow already gates signoff on every placard having
  // a placard_url, so a missing URL here is genuinely anomalous.
  for (const placard of placards) {
    if (!placard.placard_url) {
      failed++
      continue
    }
    try {
      const sealedBytes = await sealPlacardPdf({
        placardUrl:       placard.placard_url,
        signatureDataUrl: args.signatureDataUrl,
        signerName:       args.typedName,
        signedAt:         args.signedAt,
      })
      const sha256 = await sha256Hex(sealedBytes)
      // Mirror the existing signed-placard storage path so the file
      // sits next to the unsealed equivalent. The unique
      // (tenant_id, review_link_id, equipment_id) constraint catches
      // re-runs; storage upsert=true rewrites the bytes if a retry
      // re-uploads.
      const storagePath = signedPlacardPath(args.tenantId, placard.equipment_id)
      const { error: upErr } = await admin
        .storage
        .from('loto-photos')
        .upload(storagePath, sealedBytes, {
          contentType: 'application/pdf',
          upsert: true,
        })
      if (upErr) throw upErr

      const { error: insertErr } = await admin
        .from('loto_signed_pdf_artifacts')
        .insert({
          tenant_id:                   args.tenantId,
          review_link_id:              args.reviewLinkId,
          equipment_id:                placard.equipment_id,
          pdf_storage_path:            storagePath,
          sha256_hex:                  sha256,
          signer_typed_name:           args.typedName,
          signer_drawn_signature_path: null,
          signer_ip:                   args.signerIp,
          signer_user_agent:           args.signerUserAgent,
          signed_at:                   args.signedAt,
        })
      // The unique constraint protects against double-signoff via a
      // retried POST; map it to a no-op rather than a failure.
      if (insertErr && !insertErr.message.toLowerCase().includes('duplicate key')) {
        throw insertErr
      }
      sealed++
    } catch (err) {
      failed++
      Sentry.captureException(err, {
        tags: { source: 'sealedArtifact', equipmentId: placard.equipment_id },
        extra: { reviewLinkId: args.reviewLinkId },
      })
    }
  }

  return { sealed, failed }
}

// Same stamping logic as lib/pdfUtils.stampSignature but server-side —
// we don't want to import the browser pdfUtils module which assumes
// `document` / `atob`. The duplication is small and isolated; if a
// third call site appears, factor into a pure helper in
// @soteria/core (no DOM globals).
async function sealPlacardPdf(args: {
  placardUrl:       string
  signatureDataUrl: string
  signerName:       string
  signedAt:         string
}): Promise<Uint8Array> {
  const res = await fetch(args.placardUrl)
  if (!res.ok) throw new Error(`Could not fetch placard: HTTP ${res.status}`)
  const pdfBytes = await res.arrayBuffer()
  const pdfDoc   = await PDFDocument.load(pdfBytes)

  const lastPage = pdfDoc.getPages().at(-1)
  if (!lastPage) throw new Error('Placard PDF has no pages')

  const { width } = lastPage.getSize()
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const sigBase64 = args.signatureDataUrl.split(',')[1] ?? ''
  // Node's runtime does not have `atob` in older environments — but
  // Next.js 16 on the Node runtime ships it as a global. Buffer-based
  // decode is the universal fallback.
  const sigBinary = typeof atob === 'function'
    ? atob(sigBase64)
    : Buffer.from(sigBase64, 'base64').toString('binary')
  const sigBytes = Uint8Array.from(sigBinary, c => c.charCodeAt(0))
  const sigImage = await pdfDoc.embedPng(sigBytes)

  const maxSigWidth = 180
  const scale  = Math.min(maxSigWidth / sigImage.width, 1)
  const sigW   = sigImage.width  * scale
  const sigH   = sigImage.height * scale
  const blockH = Math.max(sigH + 36, 72)
  const blockY = 10

  lastPage.drawRectangle({
    x: 20, y: blockY,
    width: width - 40, height: blockH,
    color: rgb(0.97, 0.98, 1),
    borderColor: rgb(0.78, 0.85, 0.92),
    borderWidth: 0.5,
  })
  lastPage.drawImage(sigImage, {
    x: 28, y: blockY + 32, width: sigW, height: sigH,
  })
  lastPage.drawText(`Signed by: ${args.signerName}`, {
    x: 28, y: blockY + 19, size: 7.5, font, color: rgb(0.25, 0.25, 0.25),
  })
  const dateText = new Date(args.signedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  lastPage.drawText(`Date: ${dateText}`, {
    x: 28, y: blockY + 9, size: 7.5, font, color: rgb(0.25, 0.25, 0.25),
  })
  lastPage.drawText('APPROVED', {
    x: width - 118, y: blockY + blockH / 2 - 7,
    size: 13, font: boldFont, color: rgb(0.08, 0.48, 0.22),
  })

  return pdfDoc.save()
}
