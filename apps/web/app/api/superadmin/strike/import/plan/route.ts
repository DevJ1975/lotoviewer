import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { parseStrikePackageInput, readStrikePackage } from '@/lib/strike/package'
import { decideImport, loadExistingModule, loadProtectedMedia, type ImportDecision } from '@/lib/strike/packageImport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface StrikeImportPlanResponse {
  decision: ImportDecision
  /** Bucket paths the browser must upload before committing. */
  uploads: string[]
}

/**
 * Dry run of a package import: validates the documents and says what a
 * commit would do to the library, so the browser can show the operator the
 * outcome (and any refusal) before it spends minutes uploading media.
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

  try {
    const admin = supabaseAdmin()
    const existing = await loadExistingModule(admin, read.plan.slug)
    const decision = decideImport(read.plan, existing, await loadProtectedMedia(admin, existing?.id ?? null))
    return NextResponse.json({ decision, uploads: read.plan.uploads.map(u => u.bucketPath) } satisfies StrikeImportPlanResponse)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read the library' }, { status: 500 })
  }
}
