#!/usr/bin/env node
/**
 * Complete four of the Northfield demo tenant's compliance evaluations, with
 * real evidence files, after seed_ems_northfield_demo.sql has run.
 *
 * SQL cannot do this part honestly. A compliant or noncompliant result needs
 * a current evidence file (migration 299), and an evidence row records the
 * SHA-256 of bytes that must really sit in the private ms-evidence bucket:
 * the download route re-hashes them and refuses a mismatch. Every completed
 * evaluation also names the person who evaluated it. So this script uploads
 * small generated PDFs, records their hashes, and completes:
 *
 *   stormwater general permit      compliant       with a monitoring record
 *   hazardous waste generator      compliant       with a monthly tally
 *   surface coating permit by rule noncompliant    with a usage log, opening a nonconformity
 *   hazardous waste biennial report not applicable with notes saying why
 *
 * The files say on their face that they are invented demo records.
 *
 * Idempotent: every row has a fixed id, and an evaluation that already
 * exists is skipped, so a re-run changes nothing.
 *
 * Usage:
 *   node apps/web/scripts/seed-ems-northfield-evidence.mjs --as <email> [--dry-run]
 *
 *   --as       the person recorded as evaluator and uploader; they must have
 *              signed in once so a profile exists. Use the demo presenter.
 *   --dry-run  print the plan and the files' hashes; touch nothing.
 *
 * Env required (not for --dry-run):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

// ── argv ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) args[key] = true
      else { args[key] = next; i++ }
    }
  }
  return args
}

// ── env ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

// ── the plan ────────────────────────────────────────────────────────────

const TENANT_SLUG = 'northfield-forge-demo'
const EVIDENCE_BUCKET = 'ms-evidence'   // EVIDENCE_BUCKET in apps/web/lib/environmental/evidence.ts

// The SQL seed's fixed ids: 4e0f + register + ordinal. Registers 2 and 3 are
// its obligations and evaluations; 6 and 7 are this script's nonconformity
// and evidence.
function northfieldId(register, ordinal) {
  return `4e0f${String(register).padStart(4, '0')}-0000-4000-8000-${String(ordinal).padStart(12, '0')}`
}

export const COMPLETIONS = [
  {
    ordinal: 1, obligation: 9, scheduledDaysAgo: 95, completedDaysAgo: 92, result: 'compliant',
    notes: 'Quarterly visual assessment done at the north outfall; no sheen, odor or floating solids.',
    evidence: {
      fileName: 'stormwater-visual-monitoring.pdf',
      lines: ['Quarterly stormwater visual monitoring record', 'Outfall: north outfall',
        'Observations: clear, no sheen, no odor, no floating solids'],
    },
  },
  {
    ordinal: 2, obligation: 3, scheduledDaysAgo: 40, completedDaysAgo: 38, result: 'compliant',
    notes: 'Monthly generation tally kept; accumulation containers closed, labeled and dated.',
    evidence: {
      fileName: 'generator-monthly-tally.pdf',
      lines: ['Hazardous waste generator monthly tally', 'Streams: spent paint filters, spent coolant, spent solvent',
        'Containers inspected: closed, labeled, dated'],
    },
  },
  {
    ordinal: 3, obligation: 10, scheduledDaysAgo: 20, completedDaysAgo: 18, result: 'noncompliant',
    notes: 'Coating usage log reviewed for the quarter; three production days have no entries.',
    evidence: {
      fileName: 'coating-usage-log.pdf',
      lines: ['Paint booth coating usage log, quarterly review', 'Finding: no entries on three production days',
        'All other days recorded'],
    },
    nonconformity: {
      ordinal: 1,
      title: 'Coating usage records missing for three production days',
      description: 'The permit by rule relies on daily coating usage records; three production days in the quarter have none.',
      classification: 'minor',
    },
  },
  {
    ordinal: 4, obligation: 4, scheduledDaysAgo: 60, completedDaysAgo: 58, result: 'not_applicable',
    notes: 'The site generated as a small quantity generator in every month of the reporting year, so the biennial report does not apply.',
  },
]

// ── evidence files ──────────────────────────────────────────────────────

function pdfText(value) {
  return value.replace(/[\\()]/g, ch => `\\${ch}`)
}

/** A one-page PDF that states it is invented demo evidence. Deterministic, so its hash is stable. */
export function demoEvidencePdf(lines) {
  const allLines = ['Northfield Forge & Finish - DEMO EVIDENCE (invented, not a real record)', '', ...lines]
  const content = allLines
    .map((line, i) => `BT /F1 11 Tf 72 ${720 - i * 18} Td (${pdfText(line)}) Tj ET`)
    .join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const offset = Buffer.byteLength(pdf, 'latin1')
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

// ── Supabase (service role, like the evidence route's server-side writes) ──

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${res.status} ${body}`)
  return body ? JSON.parse(body) : null
}

async function one(path, what) {
  const rows = await rest(path)
  if (rows.length !== 1) throw new Error(`${what} not found`)
  return rows[0]
}

/** Insert one row with a fixed id; an existing row with that id is left as it is. */
async function insertOnce(table, row) {
  await rest(`${table}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(row),
  })
}

async function uploadEvidence(storagePath, bytes) {
  // Upsert: the bytes are deterministic, so a retry after a partial run writes the same file.
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${EVIDENCE_BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!res.ok) throw new Error(`upload ${storagePath} failed: ${res.status} ${await res.text()}`)
}

// ── run ─────────────────────────────────────────────────────────────────

/**
 * What one completion writes: the evidence file to upload, then the rows in
 * the order they must be inserted. Pure, so the seed's database test can
 * replay exactly these writes against the real constraints.
 * @param ctx { tenantId, facilityId, presenterId }
 */
export function completionRows(plan, ctx) {
  const evaluationId = northfieldId(3, plan.ordinal)
  const obligationId = northfieldId(2, plan.obligation)

  let evidence = null
  if (plan.evidence) {
    const bytes = demoEvidencePdf(plan.evidence.lines)
    const sha256 = sha256Hex(bytes)
    // evidenceStoragePath() in apps/web/lib/environmental/evidence.ts
    const storagePath = `${ctx.tenantId}/compliance_evaluation/${evaluationId}/${sha256}.pdf`
    evidence = {
      bytes,
      row: {
        id:              northfieldId(7, plan.ordinal),
        tenant_id:       ctx.tenantId,
        facility_id:     ctx.facilityId,
        subject_type:    'compliance_evaluation',
        subject_id:      evaluationId,
        kind:            'document',
        storage_path:    storagePath,
        file_name:       plan.evidence.fileName,
        mime_type:       'application/pdf',
        file_size_bytes: bytes.length,
        sha256,
        uploaded_by:     ctx.presenterId,
        uploaded_at:     daysAgo(plan.completedDaysAgo + 1).toISOString(),
      },
    }
  }

  // The same nonconformity the complete route opens (app/api/environmental/evaluations/[id]/complete).
  const nonconformity = plan.nonconformity && {
    id:               northfieldId(6, plan.nonconformity.ordinal),
    tenant_id:        ctx.tenantId,
    facility_id:      ctx.facilityId,
    title:            plan.nonconformity.title,
    description:      plan.nonconformity.description,
    classification:   plan.nonconformity.classification,
    source_type:      'compliance',
    source_reference: obligationId,
    clause_ref:       '9.1.2',
    identified_at:    daysAgo(plan.completedDaysAgo).toISOString().slice(0, 10),
    identified_by:    ctx.presenterId,
    created_by:       ctx.presenterId,
    updated_by:       ctx.presenterId,
  }

  const evaluation = {
    id:               evaluationId,
    tenant_id:        ctx.tenantId,
    facility_id:      ctx.facilityId,
    discipline:       'ems',
    obligation_id:    obligationId,
    scheduled_for:    daysAgo(plan.scheduledDaysAgo).toISOString().slice(0, 10),
    assigned_to:      ctx.presenterId,
    completed_at:     daysAgo(plan.completedDaysAgo).toISOString(),
    evaluator_id:     ctx.presenterId,
    result:           plan.result,
    notes:            plan.notes,
    nonconformity_id: nonconformity ? nonconformity.id : null,
    created_by:       ctx.presenterId,
  }
  // Evidence before the result: migration 299 refuses a compliant or noncompliant result without it.
  const writes = [
    ...(evidence ? [{ table: 'ms_evidence', row: evidence.row }] : []),
    ...(nonconformity ? [{ table: 'nonconformities', row: nonconformity }] : []),
    { table: 'ms_compliance_evaluations', row: evaluation },
  ]
  const upload = evidence && { storagePath: evidence.row.storage_path, bytes: evidence.bytes }
  return { upload, writes }
}

async function complete(plan, ctx) {
  const existing = await rest(`ms_compliance_evaluations?id=eq.${northfieldId(3, plan.ordinal)}&select=id`)
  if (existing.length > 0) return `evaluation ${plan.ordinal}: already seeded, skipped`

  const { upload, writes } = completionRows(plan, ctx)
  if (upload) await uploadEvidence(upload.storagePath, upload.bytes)
  for (const { table, row } of writes) await insertOnce(table, row)
  return `evaluation ${plan.ordinal}: ${plan.result}${plan.evidence ? `, evidence ${plan.evidence.fileName}` : ''}`
}

async function main() {
  const args = parseArgs(process.argv)
  const dryRun = !!args['dry-run']
  const presenterEmail = typeof args.as === 'string' ? args.as.trim().toLowerCase() : ''

  if (dryRun) {
    for (const plan of COMPLETIONS) {
      const file = plan.evidence
        ? `${plan.evidence.fileName} sha256=${sha256Hex(demoEvidencePdf(plan.evidence.lines))}`
        : 'no evidence'
      console.log(`[dry-run] evaluation ${plan.ordinal} on obligation ${plan.obligation}: ${plan.result}; ${file}`)
    }
    return
  }
  if (!presenterEmail) throw new Error('--as <email> is required')
  if (!SUPABASE_URL)   throw new Error('NEXT_PUBLIC_SUPABASE_URL not set')
  if (!SERVICE_ROLE)   throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')

  const tenant = await one(`tenants?slug=eq.${TENANT_SLUG}&select=id`,
    'The Northfield demo tenant (run seed_ems_northfield_demo.sql first)')
  const facility = await one(`facilities?tenant_id=eq.${tenant.id}&is_primary=is.true&select=id`, 'Its primary facility')
  const presenter = await one(`profiles?email=eq.${encodeURIComponent(presenterEmail)}&select=id`,
    `A profile for ${presenterEmail} (they must sign in once)`)
  const ctx = { tenantId: tenant.id, facilityId: facility.id, presenterId: presenter.id }

  for (const plan of COMPLETIONS) console.log(`[seed-ems-evidence] ${await complete(plan, ctx)}`)
}

// Run only when invoked directly; the seed's database test imports completionRows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('[seed-ems-evidence] FAILED:', err.message)
    if (process.env.DEBUG_SEED) console.error(err.stack)
    process.exit(1)
  })
}
