import type { IncidentRiskResult } from '@soteria/core/incidentRiskModel'
import type { MicrolearningSummary } from '@soteria/core/strikeScorecard'
import type { ScorecardPdfInput } from './pdfScorecard'
import { MICROLEARNING_NOTES, microlearningFacts, microlearningModuleRows } from './scorecardMicrolearning'

// Word (.docx) export of the EHS Scorecard: the same headline numbers as the
// PDF and the Excel workbook, as an editable document a safety manager can
// paste into a board report. `docx` is loaded with a runtime import() so it
// never enters the client bundle.

export interface ScorecardDocumentInput {
  tenantName: string
  windowDays: number
  loto?: ScorecardPdfInput['loto']
  incident?: ScorecardPdfInput['incident']
  /** Recomputed server-side: the authoritative predicted-risk headline. */
  risk?: IncidentRiskResult | null
  /** Computed server-side; absent when STRIKE is off for the tenant. */
  microlearning?: MicrolearningSummary | null
  generatedAt?: Date
}

const NAVY = '0E1A2E'
const HEADER_FILL = '214488'

// XML 1.0 forbids these; docx escapes & < > but passes them through, and Word
// then refuses to open the file.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g
function safeDocxText(value: unknown): string {
  return (value == null ? '' : String(value)).replace(XML_INVALID, '')
}

function fmtNumber(v: number | null | undefined, digits = 2): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—'
}
function fmtPercent(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}%` : '—'
}

export async function buildScorecardDocx(input: ScorecardDocumentInput): Promise<Uint8Array> {
  const {
    AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber,
    Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
  } = await import('docx')

  const text = (value: unknown, opts: { bold?: boolean; color?: string; size?: number } = {}) =>
    new TextRun({ text: safeDocxText(value), bold: opts.bold, color: opts.color, size: opts.size })
  const heading = (value: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [text(value, { color: NAVY })] })
  const paragraph = (value: string, opts: { italic?: boolean } = {}) =>
    new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: safeDocxText(value), italics: opts.italic, size: 20 })] })

  const cell = (value: unknown, opts: { header?: boolean; width?: number } = {}) => new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: HEADER_FILL } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [text(value, { bold: opts.header, color: opts.header ? 'FFFFFF' : undefined, size: 20 })] })],
  })
  const table = (header: string[], rows: unknown[][], widths?: number[]) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'C8CFDA' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C8CFDA' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E3E7EE' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { header: true, width: widths?.[i] })) }),
      ...rows.map(r => new TableRow({ children: r.map((v, i) => cell(v, { width: widths?.[i] })) })),
    ],
  })
  const factTable = (facts: { label: string; value: string }[]) =>
    table(['Measure', 'Value'], facts.map(f => [f.label, f.value]), [60, 40])

  const generatedAt = input.generatedAt ?? new Date()
  const inc = input.incident ?? {}
  const loto = input.loto ?? {}
  const risk = input.risk ?? null
  const ml = input.microlearning ?? null

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [text(`EHS Scorecard — ${input.tenantName}`, { color: NAVY })] }),
    paragraph(`Last ${input.windowDays} days · generated ${generatedAt.toISOString().slice(0, 10)}`, { italic: true }),

    heading('Executive summary'),
    factTable([
      ...(risk ? [{ label: 'Predicted risk', value: `${Math.round(risk.score)} / 100 (${risk.band})` }] : []),
      { label: 'TRIR (per 100 FTE)', value: fmtNumber(inc.trir) },
      { label: 'DART (per 100 FTE)', value: fmtNumber(inc.dart) },
      { label: 'LTIR (per 100 FTE)', value: fmtNumber(inc.ltir) },
      { label: 'Severity rate', value: fmtNumber(inc.severityRate) },
      { label: 'Recordables (12 months)', value: String(inc.totalRecordable ?? '—') },
      { label: 'Days since last recordable', value: (inc.daysSinceLastRecordable ?? -1) < 0 ? 'none on file' : String(inc.daysSinceLastRecordable) },
    ]),

    heading('Reporting & investigation quality'),
    factTable([
      { label: 'Near-miss : recordable', value: inc.nearMissToRecordableRatio == null ? '—' : `${inc.nearMissToRecordableRatio.toFixed(1)} : 1` },
      { label: 'CAPA closed on time', value: fmtPercent(inc.actionClosureOnTimePct) },
      { label: 'RCA completion', value: fmtPercent(inc.rcaCompletionPct) },
    ]),

    heading(`Permits & LOTO — last ${input.windowDays} days`),
    factTable([
      { label: 'Permits', value: String(loto.totalPermits ?? 0) },
      { label: 'Non-routine cancellations', value: fmtPercent(loto.cancelRate) },
      { label: 'Failed atmospheric tests', value: fmtPercent(loto.failingTestRate) },
      { label: 'LOTO placards with photos', value: fmtPercent(loto.photoCompletionPct) },
    ]),
  ]

  if (risk && risk.drivers.length > 0) {
    children.push(
      heading('Where to work: top risk drivers'),
      table(['Indicator', 'Current', 'Suggested action'], risk.drivers.slice(0, 5).map(d => [d.label, d.value, d.suggestedAction]), [30, 20, 50]),
    )
  }

  if (ml) {
    children.push(
      heading(`Microlearning (STRIKE) — last ${ml.windowDays} days`),
      factTable(microlearningFacts(ml)),
      heading('Completions by module'),
    )
    const rows = microlearningModuleRows(ml)
    children.push(rows.length === 0
      ? paragraph('No microlearning activity in this window.')
      : table(
        ['Module', 'Done', 'People', 'Pass rate', 'Avg', 'ADA', 'Languages'],
        rows.map(r => [r.title, r.completions, r.learners, r.passRate, r.averageScore, r.assisted, r.languages]),
        [31, 8, 9, 18, 8, 7, 19],
      ))
    for (const note of MICROLEARNING_NOTES) children.push(paragraph(note, { italic: true }))
  }

  const doc = new Document({
    creator: 'SoteriaField',
    title: safeDocxText(`EHS Scorecard · ${input.tenantName}`),
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ children: [safeDocxText(`${input.tenantName} · EHS Scorecard · page `), PageNumber.CURRENT], size: 16, color: '6B7280' })],
          })],
        }),
      },
      children,
    }],
  })
  return new Uint8Array(await Packer.toBuffer(doc))
}
