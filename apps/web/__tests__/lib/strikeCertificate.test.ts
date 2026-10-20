import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildCertificatePdf, certificateFilename, winAnsi, type CertificateData } from '@/lib/strike/certificate'

// A 1×1 transparent PNG: enough for pdf-lib to embed a signature.
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const base: CertificateData = {
  locale: 'en',
  learnerName: 'Ana Ruiz',
  moduleTitle: 'LOTO 101: Control of Hazardous Energy',
  organization: 'Snak King',
  completedAt: new Date('2026-11-10T12:00:00Z'),
  reference: 'a1b2c3d4-0000-0000-0000-000000000000',
  result: { kind: 'score', scorePercent: 90 },
  signatory: null,
}

async function load(data: CertificateData) {
  return PDFDocument.load(await buildCertificatePdf(data))
}

describe('buildCertificatePdf', () => {
  it('produces one landscape Letter page titled for the module', async () => {
    const doc = await load(base)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 })
    expect(doc.getTitle()).toBe('LOTO 101: Control of Hazardous Energy — Certificate of Completion')
  })

  it('is titled in Spanish for the Spanish version', async () => {
    const doc = await load({ ...base, locale: 'es', moduleTitle: 'LOTO 101: Control de energía peligrosa' })
    expect(doc.getTitle()).toBe('LOTO 101: Control de energía peligrosa — Certificado de Finalización')
  })

  it('stamps the signatory signature and names the issuer', async () => {
    const doc = await load({
      ...base,
      result: { kind: 'verified', verifierName: 'Juan Pérez' },
      signatory: { name: 'Signer', title: 'Founder', issuer: 'Trainovations', signaturePng: PIXEL_PNG },
    })
    expect(doc.getAuthor()).toBe('Trainovations')
  })

  it('does not throw on names the standard fonts cannot encode', async () => {
    await expect(buildCertificatePdf({ ...base, learnerName: 'Nguyễn Thị 李', organization: '' })).resolves.toBeInstanceOf(Uint8Array)
  })
})

describe('certificateFilename', () => {
  // The name is the learner's own profile text, so its length is theirs to
  // choose, and certificates render on the server.
  it('renders an absurdly long name in well under a second', async () => {
    const started = performance.now()
    await buildCertificatePdf({ ...base, learnerName: 'A'.repeat(20_000), moduleTitle: 'B'.repeat(20_000) })
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it.each([
    ['Nguyễn Thị Ánh', 'Nguyen Thi Ánh'],
    ['Nguye\u0303\u0302n', 'Nguyen'],
    ['Zoë Ångström', 'Zoë Ångström'],
    ['Šimon Žák', 'Šimon Žák'],
    ['Đặng Łukasz', 'Dang Lukasz'],
    ['李小龙', ''],
  ])('keeps %s readable on the certificate', (name, printed) => {
    expect(winAnsi(name)).toBe(printed)
  })

  it('makes a safe, readable file name from the module title', () => {
    expect(certificateFilename('LOTO 101: Control de energía peligrosa')).toBe('loto-101-control-de-energ-a-peligrosa-certificate.pdf')
    expect(certificateFilename('!!!')).toBe('strike-certificate.pdf')
  })
})
