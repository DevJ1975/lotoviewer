import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock } } }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/email/instrument', () => ({ logEmailSend: vi.fn() }))

import { sendRegulationUpdateAlert } from '@/lib/email/sendRegulationUpdateAlert'

const ORIG_ENV = process.env

function args(over: Partial<Parameters<typeof sendRegulationUpdateAlert>[0]> = {}) {
  return {
    to: 'ops@example.com', source: 'osha-29-cfr-1910',
    title: 'Federal OSHA 29 CFR Part 1910 (General Industry)', ecfrTitle: '29', ecfrPart: '1910',
    latestAmendment: '2026-09-01', ingestedSnapshot: '2026-05-07', ...over,
  }
}

beforeEach(() => {
  process.env = { ...ORIG_ENV, RESEND_API_KEY: 'test-key' }
  sendMock.mockReset()
  sendMock.mockResolvedValue({ data: { id: 'msg-1' }, error: null })
})
afterEach(() => { process.env = ORIG_ENV })

describe('sendRegulationUpdateAlert', () => {
  it('still sends the offline-script command for Federal OSHA 1910', async () => {
    await sendRegulationUpdateAlert(args())
    const { text, html } = sendMock.mock.calls[0][0]
    expect(text).toContain('29 CFR 1910')
    expect(text).toContain('python scripts/osha_1910_ingest.py all --date 2026-09-01')
    expect(html).toContain('osha_1910_ingest.py')
  })

  it('points every other part at the superadmin load panel and names the right CFR title', async () => {
    await sendRegulationUpdateAlert(args({
      source: 'epa-40-cfr-262', title: 'EPA 40 CFR Part 262 (Generators of Hazardous Waste)', ecfrTitle: '40', ecfrPart: '262',
    }))
    const { text, html, subject } = sendMock.mock.calls[0][0]
    expect(subject).toContain('EPA 40 CFR Part 262')
    expect(text).toContain('eCFR part:         40 CFR 262')
    expect(text).not.toContain('29 CFR')
    expect(text).not.toContain('osha_1910_ingest')
    expect(text).toContain('Regulation freshness')
    expect(text).toContain('dry run first')
    expect(html).not.toContain('osha_1910_ingest')
    expect(html).toContain('Regulation freshness')
  })

  it('says a never-loaded part has never been ingested', async () => {
    await sendRegulationUpdateAlert(args({ source: 'epa-40-cfr-70', ecfrTitle: '40', ecfrPart: '70', ingestedSnapshot: null }))
    expect(sendMock.mock.calls[0][0].text).toContain('never ingested')
  })

  it('escapes the part title in the HTML', async () => {
    await sendRegulationUpdateAlert(args({ source: 'x', title: '<script>alert(1)</script>' }))
    expect(sendMock.mock.calls[0][0].html).not.toContain('<script>')
  })

  it('skips the send, without throwing, when email is not configured', async () => {
    delete process.env.RESEND_API_KEY
    expect(await sendRegulationUpdateAlert(args())).toBe(false)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('reports a provider failure as false', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await sendRegulationUpdateAlert(args())).toBe(false)
  })
})
