// Tests for /api/drafts.
//
// The route's job is to refuse a request that would produce an unsafe document
// before spending a token on it. The two claims worth pinning: a draft is an
// admin authoring action (not a member read), and jurisdiction is a REQUIRED
// input — a Cal/OSHA method statement and a UK RAMS have different mandatory
// sections, so letting the model infer it makes a legal document rest on a
// silent guess.
//
// draftDocument itself does retrieval + generation + DB I/O and is mocked; its
// grounding contract is covered by the pure resolveCitations tests in
// packages/core.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resetAiMocks, gateOk, gateRejects, rateLimitBlocks, budgetBlocks,
} from './_helpers'

const draftDocumentMock = vi.fn()

vi.mock('@/lib/ai/drafts/draftDocument', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/drafts/draftDocument')>(
    '@/lib/ai/drafts/draftDocument',
  )
  return { ...actual, draftDocument: (...args: unknown[]) => draftDocumentMock(...args) }
})
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({}) }))

function post(body: unknown): Request {
  return new Request('http://x/api/drafts', {
    method:  'POST',
    headers: {
      authorization:    'Bearer t',
      'x-active-tenant': '00000000-0000-0000-0000-000000000001',
      'content-type':    'application/json',
    },
    body: JSON.stringify(body),
  })
}

const validBody = {
  kind:         'method_statement',
  subject:      'Replacing the drive belt on the No. 2 mixer',
  jurisdiction: 'US-CA',
}

async function callPost(body: unknown) {
  const { POST } = await import('@/app/api/drafts/route')
  return POST(post(body))
}

beforeEach(() => {
  resetAiMocks()
  draftDocumentMock.mockReset()
  draftDocumentMock.mockResolvedValue({
    draftId: 'draft-1', title: 'Mixer belt replacement',
    citations: [], fabricatedCitationCount: 0, ungrounded: true,
  })
})

describe('authorization', () => {
  it('refuses a caller the admin gate rejects', async () => {
    gateRejects(403, 'Admin only')
    const res = await callPost(validBody)
    expect(res.status).toBe(403)
    expect(draftDocumentMock).not.toHaveBeenCalled()
  })
})

describe('input validation', () => {
  beforeEach(() => { gateOk({ role: 'admin' }) })

  it('requires a jurisdiction and never infers one', async () => {
    const res = await callPost({ ...validBody, jurisdiction: '   ' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('jurisdiction is required')
    expect(draftDocumentMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown document kind', async () => {
    const res = await callPost({ ...validBody, kind: 'permit_to_work' })
    expect(res.status).toBe(400)
    expect(draftDocumentMock).not.toHaveBeenCalled()
  })

  it('requires a subject', async () => {
    const res = await callPost({ ...validBody, subject: '' })
    expect(res.status).toBe(400)
  })

  it('rejects an over-long subject rather than truncating it silently', async () => {
    const res = await callPost({ ...validBody, subject: 'x'.repeat(501) })
    expect(res.status).toBe(400)
  })

  it('rejects a non-JSON body', async () => {
    const { POST } = await import('@/app/api/drafts/route')
    const res = await POST(new Request('http://x/api/drafts', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'x-active-tenant': 't1' },
      body: 'not json',
    }))
    expect(res.status).toBe(400)
  })

  it('caps oversized context instead of refusing the request', async () => {
    const res = await callPost({ ...validBody, context: 'y'.repeat(9_000) })
    expect(res.status).toBe(200)
    const passed = draftDocumentMock.mock.calls[0][1] as { context: string }
    expect(passed.context.length).toBe(4_000)
  })
})

describe('spend controls', () => {
  beforeEach(() => { gateOk({ role: 'admin' }) })

  it('stops before generating when the tenant budget is spent', async () => {
    budgetBlocks('budget_exceeded', 'Daily AI budget reached.')
    const res = await callPost(validBody)
    expect(res.status).toBe(429)
    expect(draftDocumentMock).not.toHaveBeenCalled()
  })

  it('stops before generating when the user is rate-limited', async () => {
    rateLimitBlocks('hourly', 900)
    const res = await callPost(validBody)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('900')
    expect(draftDocumentMock).not.toHaveBeenCalled()
  })
})

describe('generation', () => {
  beforeEach(() => { gateOk({ role: 'admin' }) })

  it('passes the validated request through and returns the staged draft', async () => {
    const res = await callPost({ ...validBody, context: 'Mixer 2, mixing room.' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, draftId: 'draft-1' })

    const passed = draftDocumentMock.mock.calls[0][1] as Record<string, unknown>
    expect(passed).toMatchObject({
      kind: 'method_statement', jurisdiction: 'US-CA', subject: 'Replacing the drive belt on the No. 2 mixer',
    })
  })

  it('surfaces how many citations were stripped', async () => {
    // A reviewer who knows the model invented references reads the rest of the
    // draft differently — so this count reaches the caller, not just the log.
    draftDocumentMock.mockResolvedValue({
      draftId: 'draft-2', title: 'x', citations: [], fabricatedCitationCount: 3, ungrounded: false,
    })
    const res = await callPost(validBody)
    expect(await res.json()).toMatchObject({ fabricatedCitationCount: 3 })
  })

  it('reports a generation failure as a 502 with the operator-facing reason', async () => {
    const { DraftGenerationError } = await import('@/lib/ai/drafts/draftDocument')
    draftDocumentMock.mockRejectedValue(new DraftGenerationError('Draft is missing: steps.'))
    const res = await callPost(validBody)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Draft is missing: steps.')
  })

  it('maps an upstream AI failure through the shared error mapper', async () => {
    draftDocumentMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 429 }))
    const res = await callPost(validBody)
    expect(res.status).toBe(429)
  })
})
