import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { verifyPngDataUrl } from '@/lib/security/magicBytes'
import { buildCertificatePdf } from '@/lib/strike/certificate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const SIGNATURE_MAX_BYTES = 200_000

// The signer printed on every STRIKE completion certificate: one platform-wide
// row, superadmin only. The signature is drawn in the browser (finger or
// mouse) and stored as a PNG data URL, as toolbox-talk signatures are.
//   GET               { signatory } without the image, plus has_signature
//   GET ?preview=1    a sample certificate PDF with the saved signature
//   PUT               { signer_name, signer_title, issuer, signature_png? }
export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  try {
    const { data, error } = await supabaseAdmin()
      .from('strike_certificate_signatory')
      .select('signer_name,signer_title,issuer,signature_png,updated_at')
      .maybeSingle()
    if (error) throw new Error(error.message)

    if (new URL(req.url).searchParams.get('preview') !== '1') {
      if (!data) return NextResponse.json({ signatory: null })
      const { signature_png, ...rest } = data
      return NextResponse.json({ signatory: { ...rest, has_signature: !!signature_png } })
    }

    const pdf = await buildCertificatePdf({
      locale: 'en',
      learnerName: 'Sample Learner',
      moduleTitle: 'LOTO 101: Control of Hazardous Energy',
      organization: 'Sample Organization',
      completedAt: new Date(),
      reference: '00000000-preview',
      result: { kind: 'score', scorePercent: 90 },
      signatory: data
        ? {
            name: data.signer_name as string,
            title: data.signer_title as string,
            issuer: data.issuer as string,
            signaturePng: Buffer.from((data.signature_png as string).replace(/^data:image\/png;base64,/, ''), 'base64'),
          }
        : null,
    })
    return new Response(Buffer.from(pdf), { headers: { 'content-type': 'application/pdf', 'cache-control': 'private, no-store' } })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin/strike/certificate-signatory', method: 'GET' } })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { signer_name?: unknown; signer_title?: unknown; issuer?: unknown; signature_png?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = typeof body.signer_name === 'string' ? body.signer_name.trim() : ''
  const title = typeof body.signer_title === 'string' ? body.signer_title.trim() : ''
  const issuer = typeof body.issuer === 'string' ? body.issuer.trim() : ''
  const signature = typeof body.signature_png === 'string' && body.signature_png ? body.signature_png : null
  if (!name || name.length > 120) return NextResponse.json({ error: 'Enter the signer’s name.' }, { status: 400 })
  if (title.length > 120) return NextResponse.json({ error: 'The title is too long.' }, { status: 400 })
  if (!issuer || issuer.length > 120) return NextResponse.json({ error: 'Enter the issuing organization.' }, { status: 400 })
  if (signature && (signature.length > SIGNATURE_MAX_BYTES || verifyPngDataUrl(signature) !== null)) {
    return NextResponse.json({ error: 'The signature must be a drawn PNG under 200 KB.' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: existing, error: readErr } = await admin.from('strike_certificate_signatory').select('signature_png').maybeSingle()
    if (readErr) throw new Error(readErr.message)
    const signaturePng = signature ?? (existing?.signature_png as string | undefined)
    if (!signaturePng) return NextResponse.json({ error: 'Draw your signature before saving.' }, { status: 400 })

    const { error } = await admin.from('strike_certificate_signatory').upsert({
      id: true,
      signer_name: name,
      signer_title: title,
      issuer,
      signature_png: signaturePng,
      updated_by: gate.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ signatory: { signer_name: name, signer_title: title, issuer, has_signature: true } })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin/strike/certificate-signatory', method: 'PUT' } })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
