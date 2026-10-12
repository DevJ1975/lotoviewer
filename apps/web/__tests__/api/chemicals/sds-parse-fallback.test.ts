// POST /api/chemicals/products/[id]/sds/[sdsId]/parse — the deterministic
// fallback when Claude is unavailable.
//
// Pins the order the route tries things in: a background job on the parser
// service first (a scanned SDS needs OCR that can outlast the request), then
// the synchronous parse, then the original AI error. Supabase, the gate, the
// rate limiter and the parser service are stubbed; the route's own branching
// is what runs.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const PRODUCT_ID = '00000000-0000-0000-0000-0000000000aa'
const SDS_ID     = '00000000-0000-0000-0000-0000000000bb'

const enqueueSdsParseJobMock  = vi.fn()
const parseSdsViaFallbackMock = vi.fn()
const getAnthropicMock        = vi.fn()
const parseSdsDocumentMock    = vi.fn()
const sdsUpdateMock           = vi.fn()

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: async () => ({ ok: true, userId: 'user-1', tenantId: 'tenant-1' }),
}))

vi.mock('@/lib/ai/rateLimit', () => ({
  checkAiRateLimit: async () => ({ ok: true }),
  logAiInvocation:  async () => undefined,
}))

vi.mock('@/lib/ai/client', () => ({
  getAnthropic:      (tenantId: string) => getAnthropicMock(tenantId),
  aiErrorToResponse: () => ({ status: 503, body: { error: 'AI is not configured.' }, tags: {} }),
}))

vi.mock('@/lib/ai/parseSdsPdf', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/parseSdsPdf')>('@/lib/ai/parseSdsPdf')
  return { ...actual, parseSdsDocument: (...args: unknown[]) => parseSdsDocumentMock(...args) }
})

vi.mock('@/lib/ai/sdsFallback', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/sdsFallback')>('@/lib/ai/sdsFallback')
  return {
    ...actual,
    sdsFallbackConfigured: () => true,
    enqueueSdsParseJob:    (ids: unknown) => enqueueSdsParseJobMock(ids),
    parseSdsViaFallback:   (pdf: unknown) => parseSdsViaFallbackMock(pdf),
  }
})

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: async () => ({
          data:  { id: SDS_ID, storage_path: 'tenant-1/sds.pdf', file_bytes: 1000, product_id: PRODUCT_ID, tenant_id: 'tenant-1' },
          error: null,
        }),
      }) }) }) }),
      update: (values: Record<string, unknown>) => {
        sdsUpdateMock(values)
        return { eq: () => ({ eq: () => ({ select: () => ({
          single: async () => ({ data: { id: SDS_ID, ...values }, error: null }),
        }) }) }) }
      },
    }),
    storage: { from: () => ({ download: async () => ({ data: new Blob(['%PDF-1.4']), error: null }) }) },
  }),
}))

const FALLBACK_PARSE = {
  product_name: 'Acetone',
  confidence:   { overall: 'low' },
}

async function callRoute(): Promise<Response> {
  const { POST } = await import('@/app/api/chemicals/products/[id]/sds/[sdsId]/parse/route')
  const req = new Request(`http://x/api/chemicals/products/${PRODUCT_ID}/sds/${SDS_ID}/parse`, { method: 'POST' })
  return POST(req as never, { params: Promise.resolve({ id: PRODUCT_ID, sdsId: SDS_ID }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  getAnthropicMock.mockRejectedValue(new Error('No Anthropic API key configured'))
})

describe('SDS parse route — deterministic fallback', () => {
  it('queues a background job and answers 202 when the parser service runs jobs', async () => {
    enqueueSdsParseJobMock.mockResolvedValue({ jobId: 'job-1' })

    const res = await callRoute()

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true, job_id: 'job-1' })
    expect(enqueueSdsParseJobMock).toHaveBeenCalledWith({ sdsId: SDS_ID, tenantId: 'tenant-1', userId: 'user-1' })
    expect(parseSdsViaFallbackMock).not.toHaveBeenCalled()
    expect(sdsUpdateMock).not.toHaveBeenCalled() // the worker stages it, not the route
  })

  it('parses synchronously when the service cannot queue, and persists for review', async () => {
    enqueueSdsParseJobMock.mockResolvedValue(null)
    parseSdsViaFallbackMock.mockResolvedValue(FALLBACK_PARSE)

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect((await res.json()).fallback).toBe(true)
    expect(sdsUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      parse_model:         'python-sds-parser@1',
      parse_review_status: 'pending',
    }))
  })

  it('surfaces the original AI error when the service can do neither', async () => {
    enqueueSdsParseJobMock.mockResolvedValue(null)
    parseSdsViaFallbackMock.mockResolvedValue(null)

    const res = await callRoute()

    expect(res.status).toBe(503)
    expect(sdsUpdateMock).not.toHaveBeenCalled()
  })

  it('also queues when Claude is configured but rate-limited mid-parse', async () => {
    getAnthropicMock.mockResolvedValue({})
    parseSdsDocumentMock.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }))
    enqueueSdsParseJobMock.mockResolvedValue({ jobId: 'job-2' })

    const res = await callRoute()

    expect(res.status).toBe(202)
    expect((await res.json()).job_id).toBe('job-2')
  })
})
