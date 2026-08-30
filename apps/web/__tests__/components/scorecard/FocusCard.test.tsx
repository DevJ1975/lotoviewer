import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FocusCard } from '@/components/scorecard/FocusCard'

// The route distinguishes a real AI answer from the deterministic fallback via
// `source`. The card must surface that distinction (honesty) and announce async
// results to assistive tech — both verified here.

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
}))

function focusResponse(source: 'ai' | 'fallback') {
  return {
    score: 42,
    band: 'moderate',
    focusAreas: [{ key: 'capa', title: 'Close overdue CAPAs', why: '3 overdue this month', href: '/admin/compliance/nonconformities' }],
    rationale: 'CAPA backlog is the main lever right now.',
    source,
    generatedAt: new Date().toISOString(),
  }
}

function stubFetch(source: 'ai' | 'fallback') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => focusResponse(source) }))
}

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { cleanup() })

describe('FocusCard', () => {
  it('flags a deterministic fallback so it is not mistaken for AI output', async () => {
    stubFetch('fallback')
    render(<FocusCard tenantId="t1" incidentMetrics={null} />)
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }))
    expect(await screen.findByText(/AI analysis unavailable/i)).toBeInTheDocument()
  })

  it('shows no fallback flag for a genuine AI result and announces results politely', async () => {
    stubFetch('ai')
    render(<FocusCard tenantId="t1" incidentMetrics={null} />)
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }))
    const region = await screen.findByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('CAPA backlog is the main lever right now.')).toBeInTheDocument()
    expect(screen.queryByText(/AI analysis unavailable/i)).not.toBeInTheDocument()
  })
})
