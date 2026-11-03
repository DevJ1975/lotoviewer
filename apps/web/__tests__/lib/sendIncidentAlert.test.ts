import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Same mock shape as the other email senders: hoist a spy so
// `new Resend(key).emails.send` lands on it.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/email/instrument', () => ({ logEmailSend: vi.fn(async () => {}) }))

import { sendIncidentAlertEmail, type IncidentAlertArgs } from '@/lib/email/sendIncidentAlert'

const ORIG_ENV = process.env

function args(over: Partial<IncidentAlertArgs> = {}): IncidentAlertArgs {
  return {
    to:             'admin@example.test',
    reportNumber:   'INC-2026-0042',
    incidentType:   'near_miss',
    severityActual: 'none',
    occurredAt:     '2026-11-03T14:00:00.000Z',
    locationText:   'Dock B entrance',
    description:    'Load swung over the walkway.',
    appUrl:         'https://app.example.test',
    incidentId:     'inc-1',
    tenantName:     'Northgate Terminal',
    ...over,
  }
}

async function sent(over: Partial<IncidentAlertArgs> = {}) {
  await sendIncidentAlertEmail(args(over))
  expect(sendMock).toHaveBeenCalledTimes(1)
  return sendMock.mock.calls[0][0] as { subject: string; text: string; html: string }
}

describe('sendIncidentAlertEmail — what the recipient is told', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV, RESEND_API_KEY: 'test-key' }
    sendMock.mockReset()
    sendMock.mockResolvedValue({ data: { id: 'msg-1' }, error: null })
  })
  afterEach(() => { process.env = ORIG_ENV })

  describe('severity potential', () => {
    it('flags a high-potential near miss in the subject, so the inbox glance differs from a trivial one', async () => {
      const { subject } = await sent({ severityPotential: 'high' })
      expect(subject).toContain('(high potential)')
    })

    it('flags an extreme-potential near miss in the subject', async () => {
      const { subject } = await sent({ severityPotential: 'extreme' })
      expect(subject).toContain('(extreme potential)')
    })

    it.each(['low', 'moderate', null, undefined] as const)(
      'adds nothing to the subject for %s potential',
      async potential => {
        const { subject } = await sent({ severityPotential: potential })
        expect(subject).not.toMatch(/potential\)/)
      },
    )

    it('states the worst case in both bodies when potential is known', async () => {
      const { text, html } = await sent({ severityPotential: 'extreme' })
      expect(text).toMatch(/Potential: Extreme — Could have killed someone/)
      expect(html).toContain('Worst case if it had played out')
      expect(html).toContain('Extreme — Could have killed someone')
    })

    it('omits the worst-case line when potential is unknown', async () => {
      const { text, html } = await sent({ severityPotential: null })
      expect(text).not.toContain('Potential:')
      expect(html).not.toContain('Worst case if it had played out')
    })
  })

  describe('escalation wording', () => {
    it('does not promise to page anyone: push and SMS are not delivered today', async () => {
      const { text, html } = await sent()
      expect(text).not.toMatch(/page leadership/i)
      expect(html).not.toMatch(/page leadership/i)
    })

    it('says what actually happens: a reminder to the same recipients while still Reported or Triaged', async () => {
      const { text, html } = await sent()
      for (const body of [text, html]) {
        expect(body).toContain('move it to Investigating')
        expect(body).toContain('Reported or Triaged')
        expect(body).toContain('a reminder is sent to the same recipients')
      }
    })
  })
})
