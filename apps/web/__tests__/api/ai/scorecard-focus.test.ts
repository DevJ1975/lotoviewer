// Tests for /api/insights/scorecard-focus.
//
// The deterministic risk model is mocked (it does real Supabase I/O); we pin the
// public contract: the admin gate is enforced, the LLM's focus areas are mapped
// back to authoritative driver hrefs, and the route degrades to the deterministic
// drivers when the AI call fails — so the card always renders.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resetAiMocks, gateRejects, queueAnthropic, queueAnthropicError,
} from './_helpers'

// computeIncidentRisk does real DB work — replace it with a fixed, elevated
// result (so the route doesn't short-circuit to the "healthy" path).
vi.mock('@/lib/incidentRiskFeatures', () => ({
  computeIncidentRisk: vi.fn(async () => ({
    score: 42,
    band: 'moderate',
    modelVersion: '1.0.0',
    drivers: [
      { key: 'capa_overdue', label: 'Overdue corrective actions (CAPAs)', kind: 'leading', pressure: 60, contribution: 12, value: '3 overdue', target: '0 overdue', href: '/incidents', suggestedAction: 'Close overdue CAPAs.' },
      { key: 'recordable_trend', label: 'Recordable injuries', kind: 'lagging', pressure: 50, contribution: 10, value: '4 this window', target: 'flat or declining', href: '/incidents/scorecard', suggestedAction: 'Review recent recordables.' },
    ],
  })),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({}) }))

function jsonRequest(body: unknown): Request {
  return new Request('http://x/api/insights/scorecard-focus', {
    method: 'POST',
    headers: {
      authorization: 'Bearer t',
      'x-active-tenant': '00000000-0000-0000-0000-000000000001',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => { resetAiMocks() })

describe('POST /api/insights/scorecard-focus', () => {
  it('returns 403 when the user is not a tenant admin', async () => {
    gateRejects(403, 'Admins only')
    const { POST } = await import('@/app/api/insights/scorecard-focus/route')
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(403)
  })

  it('maps AI focus areas back to authoritative driver hrefs', async () => {
    queueAnthropic(JSON.stringify({
      focusAreas: [{ driverKey: 'capa_overdue', title: 'Close overdue CAPAs', why: '3 CAPAs are overdue against a target of 0.' }],
      rationale: 'Overdue corrective actions are the highest-leverage fix.',
    }))
    const { POST } = await import('@/app/api/insights/scorecard-focus/route')
    const res = await POST(jsonRequest({ incidentMetrics: {} }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('ai')
    expect(body.score).toBe(42)
    expect(body.focusAreas).toHaveLength(1)
    expect(body.focusAreas[0]).toMatchObject({
      key: 'capa_overdue',
      title: 'Close overdue CAPAs',
      href: '/incidents', // resolved server-side, never from the model
    })
  })

  it('falls back to deterministic drivers when the AI call fails', async () => {
    queueAnthropicError(new Error('upstream boom'))
    const { POST } = await import('@/app/api/insights/scorecard-focus/route')
    const res = await POST(jsonRequest({ incidentMetrics: {} }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('fallback')
    expect(body.focusAreas.map((a: { key: string }) => a.key)).toContain('capa_overdue')
  })
})
