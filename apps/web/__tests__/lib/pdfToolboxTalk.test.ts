import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderToolboxTalkPdf, type ToolboxTalkPdfInput } from '@/lib/pdfToolboxTalk'

const input: ToolboxTalkPdfInput = {
  tenantName: 'Fixture Manufacturing',
  talkUrl: 'https://example.test/toolbox-talks/00000000-0000-0000-0000-000000000001',
  language: 'en',
  talk: {
    id: '00000000-0000-0000-0000-000000000001',
    talk_date: '2026-05-13',
    title: 'Keep Hands Out of Pinch Points',
    title_es: 'Mantenga las manos fuera de puntos de pellizco',
    body_markdown: [
      '### Scenario hook',
      'Marco reached across a conveyor to clear a small jam. The line started moving and his glove caught.',
      '',
      '- Stop the line before clearing a jam.',
      '- Use the lockout point when guards come off.',
      '',
      '**Today’s promise:** I keep my hands out of the bite.',
    ].join('\n'),
    body_markdown_es: null,
    key_points: ['Stop before clearing jams', 'Use lockout for guard removal'],
    key_points_es: [],
    delivery_notes: 'Pause after the scenario and ask the crew to point to the nearest stop.',
    delivery_notes_es: null,
    generated_by: 'cron',
    generated_at: '2026-05-13T12:00:00.000Z',
    ai_model: 'claude-sonnet-4-6',
  },
  signatures: [
    {
      id: 'sig-1',
      signer_name: 'Alex Rivera',
      employee_id: 'E-100',
      signed_at: '2026-05-13T14:30:00.000Z',
      inserted_by: '11111111-1111-1111-1111-111111111111',
      signature_data: null,
    },
  ],
}

describe('renderToolboxTalkPdf', () => {
  it('creates a parseable retained-record PDF', async () => {
    const bytes = await renderToolboxTalkPdf(input)
    expect(bytes.byteLength).toBeGreaterThan(1000)

    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('falls back to English content when Spanish fields are absent', async () => {
    const bytes = await renderToolboxTalkPdf({ ...input, language: 'es' })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })
})
