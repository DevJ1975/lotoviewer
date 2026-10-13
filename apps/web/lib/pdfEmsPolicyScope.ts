import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  MARGIN, NAVY, PAGE_H, PAGE_W, SLATE, WHITE,
  createDrawCtx, drawBullets, drawKeyValue, drawSectionBar, reserveSpace, sanitizeForWinAnsi, wrap,
  type DrawCtx,
} from '@/lib/pdfShared'
import type { PolicyCommitmentOption, PolicyRow, ScopeRow } from '@/lib/environmental/client'

// The environmental policy and the EMS scope as one document an organization
// can hand to its interested parties: ISO 14001 requires both to be
// "available to interested parties" (clauses 4.3 and 5.2). It carries only
// what those two records state publicly: no internal review dates, and no
// names of the people who maintain the system.

export interface PolicyScopeStatementArgs {
  scope:       ScopeRow
  policy:      PolicyRow
  /** The commitments the policy's standard requires; those the policy states are printed. */
  commitments: readonly PolicyCommitmentOption[]
  /** ISO date of issue, passed in so the screen and the paper agree. */
  issuedOn:    string
}

const BODY_SIZE = 9.5
const LINE_H = 13

export async function generatePolicyScopeStatement(args: PolicyScopeStatementArgs): Promise<Uint8Array> {
  const { scope, policy, commitments, issuedOn } = args

  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ctx  = createDrawCtx({
    doc, page, font, bold,
    legend: sanitizeForWinAnsi(`Environmental policy and EMS scope · issued ${issuedOn}`),
  })

  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 56, width: PAGE_W - 2 * MARGIN, height: 56, color: NAVY })
  ctx.page.drawText('ENVIRONMENTAL POLICY AND EMS SCOPE', {
    x: MARGIN + 14, y: ctx.y - 24, size: 15, font: bold, color: WHITE,
  })
  ctx.page.drawText(sanitizeForWinAnsi(scope.legal_entity), {
    x: MARGIN + 14, y: ctx.y - 42, size: 10, font, color: WHITE,
  })
  ctx.y -= 70

  drawSectionBar(ctx, `Environmental policy · version ${policy.version}`)
  drawParagraphs(ctx, policy.body)
  ctx.y -= 4
  reserveSpace(ctx, LINE_H)
  ctx.page.drawText('This policy commits us to:', { x: MARGIN, y: ctx.y - 10, size: BODY_SIZE, font: bold, color: SLATE })
  ctx.y -= LINE_H
  drawBullets(ctx, commitments.filter(c => policy.commitments[c.key] === true).map(c => c.label))
  ctx.y -= 4
  const signature = `Signed by ${policy.signatory_name}${policy.signatory_title ? `, ${policy.signatory_title}` : ''}, ${policy.signed_at}`
  drawParagraphs(ctx, signature)
  ctx.y -= 10

  drawSectionBar(ctx, `Scope of the environmental management system · version ${scope.version}`)
  drawKeyValue(ctx, 'Legal entity', scope.legal_entity, { wrap: true })
  drawKeyValue(ctx, 'In force from', scope.effective_from)
  drawKeyValue(ctx, 'Physical boundary', scope.physical_boundary, { wrap: true })
  drawKeyValue(ctx, 'Activities', scope.activities, { wrap: true })
  drawKeyValue(ctx, 'Products and services', scope.products_services, { wrap: true })
  drawKeyValue(ctx, 'Control and influence', scope.control_and_influence ?? 'Not stated in this version.', { wrap: true })
  drawKeyValue(ctx, 'Exclusions', scope.exclusions ?? 'None.', { wrap: true })

  return doc.save()
}

/** Body text, a line at a time, so a long policy runs onto the next page instead of off this one. */
function drawParagraphs(ctx: DrawCtx, text: string): void {
  for (const line of wrap(text, ctx.font, BODY_SIZE, PAGE_W - 2 * MARGIN)) {
    reserveSpace(ctx, LINE_H)
    if (line) ctx.page.drawText(line, { x: MARGIN, y: ctx.y - 10, size: BODY_SIZE, font: ctx.font, color: SLATE })
    ctx.y -= LINE_H
  }
}
