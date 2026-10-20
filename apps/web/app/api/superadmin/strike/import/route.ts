import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { parseStrikePackageInput, readStrikePackage } from '@/lib/strike/package'
import {
  decideImport, importStrikePackage, ImportRefused, loadExistingModule, missingUploads, type ImportOutcome,
} from '@/lib/strike/packageImport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type StrikeImportResponse = ImportOutcome

/**
 * Commit a package import. The browser has already uploaded the media under
 * the package's media prefix (strike_media_write lets superadmins write
 * `global/`); this route re-validates the documents, confirms every
 * referenced file is in the bucket, and writes the module, versions and
 * quiz as drafts for the studio to approve.
 */
export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const input = parseStrikePackageInput(body)
  if (!input) return NextResponse.json({ error: 'Send the package documents and file list' }, { status: 400 })

  const read = readStrikePackage(input)
  if (!read.ok) return NextResponse.json({ error: 'Package is not importable', issues: read.issues }, { status: 422 })

  const admin = supabaseAdmin()
  try {
    const missing = await missingUploads(admin, read.plan)
    if (missing.length > 0) {
      return NextResponse.json({ error: 'Some media files are not in the bucket yet', missing }, { status: 409 })
    }
    const existing = await loadExistingModule(admin, read.plan.slug)
    const decision = decideImport(read.plan, existing)
    const outcome = await importStrikePackage(admin, read.plan, existing, decision, gate.userId)
    return NextResponse.json(outcome satisfies StrikeImportResponse, { status: existing ? 200 : 201 })
  } catch (error) {
    if (error instanceof ImportRefused) return NextResponse.json({ error: error.message }, { status: 409 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Import failed' }, { status: 500 })
  }
}
