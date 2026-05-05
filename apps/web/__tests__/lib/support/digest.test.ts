import { describe, it, expect } from 'vitest'
import { renderSupportTicketSection, type DigestTicket } from '@/lib/support/digest'

function ticket(p: Partial<DigestTicket> = {}): DigestTicket {
  return {
    id:          'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    subject:     'How do I sign off a department?',
    reason:      'user_requested',
    user_email:  'tech@plant.example',
    user_name:   'Jamie',
    tenant_name: 'Snak King',
    emailed_ok:  true,
    resolved_at: null,
    created_at:  '2026-05-05T12:00:00Z',
    ...p,
  }
}

describe('renderSupportTicketSection', () => {
  it('renders a quiet-day line when nothing is open and nothing is new', () => {
    const out = renderSupportTicketSection({ recent: [], openCount: 0 })
    expect(out[0]).toMatch(/AI SUPPORT TICKETS/)
    expect(out.some(l => l.includes('quiet day'))).toBe(true)
  })

  it('shows the open backlog even when there are no new tickets', () => {
    const out = renderSupportTicketSection({ recent: [], openCount: 3 })
    expect(out.some(l => l.includes('backlog: 3 open'))).toBe(true)
    expect(out.some(l => l.includes('quiet day'))).toBe(false)
  })

  it('breaks down new tickets by reason', () => {
    const out = renderSupportTicketSection({
      recent: [
        ticket({ reason: 'user_requested' }),
        ticket({ reason: 'user_requested' }),
        ticket({ reason: 'low_confidence' }),
        ticket({ reason: 'safety_critical' }),
      ],
      openCount: 4,
    })
    const breakdown = out.find(l => l.includes('by reason')) ?? ''
    expect(breakdown).toContain('user=2')
    expect(breakdown).toContain('stuck=1')
    expect(breakdown).toContain('safety=1')
  })

  it('lists each new ticket with reporter and tenant', () => {
    const out = renderSupportTicketSection({
      recent: [ticket({ subject: 'Permit will not sign' })],
      openCount: 1,
    })
    const ticketLine = out.find(l => l.includes('Permit will not sign')) ?? ''
    expect(ticketLine).toContain('tech@plant.example')
    expect(ticketLine).toContain('(Snak King)')
    expect(ticketLine.startsWith('  [user]')).toBe(true)
  })

  it('flags tickets whose support email failed', () => {
    const out = renderSupportTicketSection({
      recent: [ticket({ emailed_ok: false })],
      openCount: 1,
    })
    expect(out.some(l => l.includes('email failed'))).toBe(true)
  })

  it('caps the recent list at 10 entries with a "more" line', () => {
    const recent = Array.from({ length: 15 }, (_, i) => ticket({ subject: `Ticket ${i}` }))
    const out = renderSupportTicketSection({ recent, openCount: 15 })
    const subjectLines = out.filter(l => l.includes('Ticket '))
    expect(subjectLines.length).toBe(10)
    expect(out.some(l => l.includes('and 5 more'))).toBe(true)
  })

  it('marks resolved tickets so a quick scan can tell them apart', () => {
    const out = renderSupportTicketSection({
      recent: [
        ticket({ subject: 'Already handled', resolved_at: '2026-05-05T13:00:00Z' }),
        ticket({ subject: 'Still open' }),
      ],
      openCount: 1,
    })
    const resolved = out.find(l => l.includes('Already handled')) ?? ''
    const open     = out.find(l => l.includes('Still open'))     ?? ''
    expect(resolved.endsWith('✓')).toBe(true)
    expect(open.endsWith('✓')).toBe(false)
  })

  it('falls back to user_name then "(unknown)" when there is no email', () => {
    const named = renderSupportTicketSection({
      recent: [ticket({ user_email: null, user_name: 'Jamie' })],
      openCount: 1,
    })
    expect(named.some(l => l.includes('Jamie'))).toBe(true)

    const anon = renderSupportTicketSection({
      recent: [ticket({ user_email: null, user_name: null })],
      openCount: 1,
    })
    expect(anon.some(l => l.includes('(unknown)'))).toBe(true)
  })
})
