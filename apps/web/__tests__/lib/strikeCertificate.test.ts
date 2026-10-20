import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildCertificatePdf } from '@/lib/strike/certificate'

describe('buildCertificatePdf', () => {
  it('produces a one-page landscape certificate titled for the module', async () => {
    const bytes = await buildCertificatePdf({
      learnerName: 'Ana Ruiz',
      moduleTitle: 'LOTO 101: Control of Hazardous Energy',
      organization: 'Snak King',
      scorePercent: 90,
      completedAt: new Date('2026-11-10T12:00:00Z'),
      reference: 'a1b2c3d4-0000-0000-0000-000000000000',
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeGreaterThan(height)
    expect(doc.getTitle()).toBe('LOTO 101: Control of Hazardous Energy — Certificate of Completion')
  })

  it('does not throw on names the standard fonts cannot encode', async () => {
    await expect(buildCertificatePdf({
      learnerName: 'Nguyễn Thị 李', moduleTitle: 'LOTO 101', organization: null,
      scorePercent: 80, completedAt: new Date(), reference: 'abcdef12',
    })).resolves.toBeInstanceOf(Uint8Array)
  })
})
