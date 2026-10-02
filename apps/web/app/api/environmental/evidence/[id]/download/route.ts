import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ENVIRONMENTAL_MODULE, UUID_RE, gateFailure, notFound, type RouteContext } from '@/lib/environmental/registerApi'
import { EVIDENCE_BUCKET, sha256Hex } from '@/lib/environmental/evidence'

// GET /api/environmental/evidence/[id]/download   The evidence file, after proving it is the
//   file that was filed: the stored bytes are re-hashed and compared with the SHA-256
//   recorded at upload. A mismatch is never served; it answers 409 and is reported.
//
// Members of the tenant may download (RLS on ms_evidence decides which rows they see).
// The bytes come from the private bucket through the service role.

export const runtime = 'nodejs'

interface EvidenceRow { id: string; storage_path: string; sha256: string; mime_type: string; file_name: string }

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const { data, error } = await gate.authedClient
    .from('ms_evidence')
    .select('id, storage_path, sha256, mime_type, file_name')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (error) return sanitizeError(error, 'environmental/evidence/[id]/download/GET')
  if (!data) return notFound()
  const evidence = data as EvidenceRow

  const file = await supabaseAdmin().storage.from(EVIDENCE_BUCKET).download(evidence.storage_path)
  if (file.error || !file.data) {
    return sanitizeError(file.error ?? new Error('evidence object missing'), 'environmental/evidence/[id]/download/GET storage')
  }
  const bytes = new Uint8Array(await file.data.arrayBuffer())

  if (sha256Hex(bytes) !== evidence.sha256) {
    Sentry.captureException(new Error('Evidence failed its integrity check'), {
      level: 'fatal',
      tags:  { route: 'environmental/evidence/[id]/download', integrity: 'sha256_mismatch' },
      extra: { evidenceId: evidence.id, tenantId: gate.tenantId },
    })
    return NextResponse.json({
      error: 'This file no longer matches the one that was filed, so it has not been served. The mismatch has been reported.',
    }, { status: 409 })
  }

  return new Response(bytes, {
    headers: {
      'Content-Type':           evidence.mime_type,
      'Content-Disposition':    contentDisposition(evidence.file_name),
      'Cache-Control':          'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Evidence-SHA256':      evidence.sha256,
    },
  })
}
