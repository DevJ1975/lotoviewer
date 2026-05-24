import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { aiErrorToResponse } from '@/lib/ai/client'
import { logAiInvocation } from '@/lib/ai/rateLimit'
import { SONNET } from '@/lib/ai/models'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  extractAnnualSummary,
  SUPPORTED_MIMES,
  UnsupportedMimeError,
  NoSummaryFoundError,
} from '@/lib/ai/extractAnnualSummary'

// POST /api/insights/history-import/extract
//
// Step 1 of the historical-import flow. Accepts a prior-year OSHA 300A
// PDF as multipart FormData (field `file`), asks Claude to read the
// numeric totals off it, logs the AI spend, and returns the parsed
// fields for the admin to review.
//
// This route DOES NOT write to the database. Persisting is the job of
// the sibling /confirm route, which only runs after the admin reviews
// and edits the numbers. Human-in-the-loop is mandatory by design.

export const runtime     = 'nodejs'
export const maxDuration = 120

// Vercel caps a direct request body at 4.5MB. A single-page 300A is a
// few hundred KB, so we guard well under that and tell the admin to
// flatten/compress an oversized scan rather than failing opaquely.
const MAX_REQUEST_BYTES = 4.5 * 1024 * 1024

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A file is required in the "file" field.' }, { status: 400 })
  }
  if (file.size > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: 'File is too large (max 4.5MB). Flatten or compress the PDF and try again.' },
      { status: 413 },
    )
  }

  const mime = file.type || 'application/pdf'
  if (!(SUPPORTED_MIMES as string[]).includes(mime)) {
    return NextResponse.json(
      { error: `Unsupported file type ${mime || '(unknown)'}. Supported: ${SUPPORTED_MIMES.join(', ')}.` },
      { status: 415 },
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  try {
    const { parsed, usage } = await extractAnnualSummary({ bytes, mime })

    if (usage) {
      await logAiInvocation({
        userId:          gate.userId,
        tenantId:        gate.tenantId,
        surface:         'parse-sds',
        model:           SONNET,
        status:          'success',
        inputTokens:     usage.inputTokens,
        outputTokens:    usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        context:         `history-import:300A:${parsed.year}`,
      })
    }

    return NextResponse.json({ ok: true, fields: parsed })
  } catch (err) {
    if (err instanceof UnsupportedMimeError) {
      return NextResponse.json({ error: err.message }, { status: 415 })
    }
    if (err instanceof NoSummaryFoundError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    // Anthropic SDK / wrapper errors get the shared mapping (429/502/503).
    const status = (err as { status?: number })?.status
    if (typeof status === 'number') {
      const mapped = aiErrorToResponse(err, 'parse-sds')
      Sentry.captureException(err, { tags: { ...mapped.tags, route: 'insights/history-import/extract' } })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
    return sanitizeError(err, 'insights/history-import/extract/POST')
  }
}
