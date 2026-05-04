import { describe, it, expect } from 'vitest'
import { renderReviewLinkBody } from '@/lib/email/renderReviewLinkBody'

// Pure-function tests for the shared review-link body renderer.
// The same renderer feeds both server-side Resend sends AND
// client-side mailto/clipboard fallbacks; if these wordings drift,
// reviewers get inconsistent messaging depending on which channel
// the admin chose.

function base(over: Partial<Parameters<typeof renderReviewLinkBody>[0]> = {}) {
  return {
    reviewerName:  'Alice',
    reviewerEmail: 'alice@client.com',
    tenantName:    'Snak King',
    department:    'Mechanical',
    placardCount:  12,
    reviewUrl:     'https://soteriafield.app/review/0123456789abcdef0123456789abcdef',
    expiresAt:     '2026-06-04T00:00:00.000Z',
    ...over,
  }
}

describe('renderReviewLinkBody', () => {
  it('builds the canonical subject including department + tenant', () => {
    const { subject } = renderReviewLinkBody(base())
    expect(subject).toBe('Please review LOTO placards for Mechanical — Snak King')
  })

  it('greets the reviewer by name and includes the placard count + review URL', () => {
    const { body } = renderReviewLinkBody(base())
    expect(body).toMatch(/^Hi Alice,/)
    expect(body).toContain("Snak King's Mechanical department has 12 LOTO placards")
    expect(body).toContain('https://soteriafield.app/review/0123456789abcdef0123456789abcdef')
    expect(body).toContain('expires Jun 4, 2026')
  })

  it('falls back to the email local-part when reviewerName is empty', () => {
    const { body } = renderReviewLinkBody(base({ reviewerName: '', reviewerEmail: 'jane.doe@client.com' }))
    expect(body).toMatch(/^Hi jane\.doe,/)
  })

  it('falls back to "there" when both name and email local-part are empty', () => {
    const { body } = renderReviewLinkBody(base({ reviewerName: '', reviewerEmail: '' }))
    expect(body).toMatch(/^Hi there,/)
  })

  it('singularizes "placard" when placardCount is 1', () => {
    const { body } = renderReviewLinkBody(base({ placardCount: 1 }))
    expect(body).toContain('1 LOTO placard ')
    expect(body).not.toContain('1 LOTO placards')
  })

  it('renders the optional admin message in a quoted block above the link', () => {
    const { body } = renderReviewLinkBody(base({
      adminMessage: 'Please look at the new fryers especially.',
    }))
    expect(body).toContain('  > Please look at the new fryers especially.')
  })

  it('quotes every line of a multi-line admin message', () => {
    const { body } = renderReviewLinkBody(base({
      adminMessage: 'Line one.\nLine two.\nLine three.',
    }))
    expect(body).toContain('  > Line one.\n  > Line two.\n  > Line three.')
  })

  it('truncates a long admin message in mailto-rendering mode but leaves it alone otherwise', () => {
    const long = 'x'.repeat(2000)
    const noTrunc = renderReviewLinkBody(base({ adminMessage: long }))
    expect(noTrunc.body).toContain(long) // server path keeps full text

    const trunc = renderReviewLinkBody(
      base({ adminMessage: long }),
      { truncateAdminMessageForMailto: true },
    )
    expect(trunc.body).toContain('[message truncated; see review portal')
    expect(trunc.body.length).toBeLessThan(noTrunc.body.length)
  })
})
