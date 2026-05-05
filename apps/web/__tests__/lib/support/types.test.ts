import { describe, it, expect } from 'vitest'
import {
  validateCreateTicketInput,
  isEscalationReason,
  renderSupportTicketEmail,
  type CreateTicketInput,
  type SupportTicketContext,
} from '@/lib/support/types'

// ── isEscalationReason ────────────────────────────────────────────────────

describe('isEscalationReason', () => {
  it('accepts the three documented reasons', () => {
    for (const r of ['user_requested', 'low_confidence', 'safety_critical']) {
      expect(isEscalationReason(r)).toBe(true)
    }
  })
  it('rejects empty / unknown / wrong type', () => {
    expect(isEscalationReason(null)).toBe(false)
    expect(isEscalationReason(undefined)).toBe(false)
    expect(isEscalationReason('')).toBe(false)
    expect(isEscalationReason('panic')).toBe(false)
    expect(isEscalationReason(7)).toBe(false)
  })
})

// ── validateCreateTicketInput ────────────────────────────────────────────

function input(p: Partial<CreateTicketInput>): Partial<CreateTicketInput> {
  return {
    subject: 'How do I sign off a department?',
    summary: 'User is on /departments/north-line. Sign Off button is greyed out, '
           + 'they want to know which equipment is missing photos.',
    reason:  'low_confidence',
    ...p,
  }
}

describe('validateCreateTicketInput', () => {
  it('accepts a well-formed input', () => {
    expect(validateCreateTicketInput(input({}))).toEqual([])
  })

  it('flags a missing subject', () => {
    const errs = validateCreateTicketInput(input({ subject: '' }))
    expect(errs.some(e => e.field === 'subject')).toBe(true)
  })

  it('flags a missing summary', () => {
    const errs = validateCreateTicketInput(input({ summary: '   ' }))
    expect(errs.some(e => e.field === 'summary')).toBe(true)
  })

  it('flags an oversized subject (anti-DoS, 200 char cap mirrors DB)', () => {
    const errs = validateCreateTicketInput(input({ subject: 'x'.repeat(201) }))
    expect(errs.some(e => e.field === 'subject' && e.reason.includes('200'))).toBe(true)
  })

  it('flags an oversized summary (4k cap mirrors DB)', () => {
    const errs = validateCreateTicketInput(input({ summary: 'x'.repeat(4001) }))
    expect(errs.some(e => e.field === 'summary' && e.reason.includes('4,000'))).toBe(true)
  })

  it('flags an unknown reason — model can\'t spoof escalation type', () => {
    const errs = validateCreateTicketInput({
      ...input({}),
      reason: 'panic' as unknown as 'low_confidence',
    })
    expect(errs.some(e => e.field === 'reason')).toBe(true)
  })

  it('returns a single error for completely empty input', () => {
    expect(validateCreateTicketInput(null)).toHaveLength(1)
    expect(validateCreateTicketInput(undefined)).toHaveLength(1)
  })

  it('combines multiple field errors so the model sees them all at once', () => {
    const errs = validateCreateTicketInput({
      subject: '',
      summary: '',
      reason:  'nope' as unknown as 'low_confidence',
    })
    expect(errs.length).toBeGreaterThanOrEqual(3)
  })
})

// ── renderSupportTicketEmail ─────────────────────────────────────────────

function ctx(p: Partial<SupportTicketContext> = {}): SupportTicketContext {
  return {
    ticket_id:   '11111111-2222-3333-4444-555555555555',
    reason:      'user_requested',
    subject:     'Help with sign-off',
    summary:     'User is stuck on the department sign-off step.',
    user_email:  'tech@plant.example',
    user_name:   'Jamie',
    tenant_name: 'Snak King',
    origin_path: '/departments/north-line',
    opened_at:   '2026-05-05T12:00:00Z',
    transcript:  [
      { role: 'user',      content: 'How do I sign off?' },
      { role: 'assistant', content: 'Tap Sign Off then sign in the modal.' },
    ],
    ...p,
  }
}

describe('renderSupportTicketEmail', () => {
  it('renders ticket id, reason, user, tenant, page, and timestamp', () => {
    const out = renderSupportTicketEmail(ctx())
    expect(out).toContain('11111111-2222-3333-4444-555555555555')
    expect(out).toContain('Reason: user_requested')
    expect(out).toContain('Jamie <tech@plant.example>')
    expect(out).toContain('Tenant: Snak King')
    expect(out).toContain('Page:   /departments/north-line')
    expect(out).toContain('2026-05-05T12:00:00Z')
  })

  it('includes the bot summary and a transcript section', () => {
    const out = renderSupportTicketEmail(ctx())
    expect(out).toContain('— Summary (from the bot) —')
    expect(out).toContain('User is stuck on the department sign-off step.')
    expect(out).toContain('— Conversation transcript —')
    expect(out).toContain('[user]      How do I sign off?')
    expect(out).toContain('[assistant] Tap Sign Off then sign in the modal.')
  })

  it('falls back gracefully when the user has no profile name or email', () => {
    const out = renderSupportTicketEmail(ctx({ user_email: null, user_name: null }))
    expect(out).toContain('(unknown) <unknown>')
  })

  it('omits Page line when origin_path is null', () => {
    const out = renderSupportTicketEmail(ctx({ origin_path: null }))
    expect(out).not.toMatch(/^Page:/m)
  })

  it('shows "(none)" for tenant when the user has no active tenant', () => {
    const out = renderSupportTicketEmail(ctx({ tenant_name: null }))
    expect(out).toContain('Tenant: (none)')
  })

  it('mentions Reply-To so the support team knows replying lands in the user inbox', () => {
    const out = renderSupportTicketEmail(ctx())
    expect(out).toContain('Reply-To')
  })

  it('indents multi-line transcript content under the role tag for readability', () => {
    const out = renderSupportTicketEmail(ctx({
      transcript: [{ role: 'assistant', content: 'line one\nline two\nline three' }],
    }))
    // Each subsequent line should be padded so the role tag column lines up.
    expect(out).toMatch(/\[assistant\] line one\n\s+line two/)
  })
})
