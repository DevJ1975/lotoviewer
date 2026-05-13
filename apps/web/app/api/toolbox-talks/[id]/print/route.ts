import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { renderToolboxTalkPdf } from '@/lib/pdfToolboxTalk'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid talk id' }, { status: 400 })
  }

  const url = new URL(req.url)
  const language = url.searchParams.get('lang') === 'es' ? 'es' : 'en'

  try {
    const [talkResult, signaturesResult, tenantResult] = await Promise.all([
      gate.authedClient
        .from('toolbox_talks')
        .select('id, tenant_id, topic_id, talk_date, title, title_es, body_markdown, body_markdown_es, key_points, key_points_es, delivery_notes, delivery_notes_es, generated_by, generated_at, ai_model')
        .eq('id', id)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle(),
      gate.authedClient
        .from('toolbox_talk_signatures')
        .select('id, signer_name, employee_id, signed_at, inserted_by, signature_data')
        .eq('talk_id', id)
        .eq('tenant_id', gate.tenantId)
        .order('signed_at', { ascending: true }),
      gate.authedClient
        .from('tenants')
        .select('name')
        .eq('id', gate.tenantId)
        .maybeSingle(),
    ])

    if (talkResult.error) throw new Error(talkResult.error.message)
    if (signaturesResult.error) throw new Error(signaturesResult.error.message)
    if (tenantResult.error) throw new Error(tenantResult.error.message)
    if (!talkResult.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const bytes = await renderToolboxTalkPdf({
      tenantName: tenantResult.data?.name ?? null,
      talkUrl: `${url.origin}/toolbox-talks/${id}`,
      language,
      talk: talkResult.data,
      signatures: signaturesResult.data ?? [],
    })

    const fileDate = String(talkResult.data.talk_date).replace(/[^0-9-]/g, '')
    const filename = `toolbox-talk-${fileDate || id}.pdf`
    const pdfBlob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
    return new NextResponse(pdfBlob, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${filename}"`,
        'cache-control': 'private, no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    Sentry.captureException(err, { tags: { route: 'toolbox-talks/[id]/print/GET' } })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
