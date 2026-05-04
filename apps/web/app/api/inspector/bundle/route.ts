import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyInspectorToken, type InspectorTokenPayload } from '@/lib/inspectorToken'
import { generateCompliancePdfBundle } from '@/lib/pdfBundle'
import type {
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpacePermit,
  HotWorkPermit,
} from '@/lib/types'

// GET /api/inspector/bundle?start=…&end=…&exp=…&label=…&sig=…
//
// The inspector page links straight here with its own search params so
// the same HMAC validates a second time server-side (we don't trust the
// client to gate access). Returns a PDF response — no JSON wrapper —
// so the browser opens it natively.
//
// Same fetch logic as /admin/compliance-bundle but without the admin
// auth check; the HMAC is the auth.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const secret = process.env.INSPECTOR_TOKEN_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Inspector access is not configured.' }, { status: 503 })
  }

  const u = new URL(req.url)
  const payload: InspectorTokenPayload = {
    start: u.searchParams.get('start') ?? '',
    end:   u.searchParams.get('end')   ?? '',
    exp:   Number(u.searchParams.get('exp') ?? '0'),
    label: u.searchParams.get('label') ?? '',
  }
  const sig = u.searchParams.get('sig') ?? ''
  const verify = verifyInspectorToken({ payload, sig, secret })
  if (!verify.ok) return NextResponse.json({ error: verify.reason }, { status: 401 })

  const startTs = new Date(`${payload.start}T00:00:00.000Z`).toISOString()
  const endTs   = new Date(`${payload.end}T23:59:59.999Z`).toISOString()

  const admin = supabaseAdmin()
  try {
    // Fetch CS permits, hot-work permits, atmospheric tests for the
    // CS permits, and parent spaces — same shape generateCompliancePdfBundle
    // expects. Service role bypasses RLS; the HMAC is the boundary.
    const [csRes, hwRes] = await Promise.all([
      admin
        .from('loto_confined_space_permits')
        .select('*')
        .gte('started_at', startTs)
        .lte('started_at', endTs)
        .order('started_at', { ascending: true }),
      admin
        .from('loto_hot_work_permits')
        .select('*')
        .gte('started_at', startTs)
        .lte('started_at', endTs)
        .order('started_at', { ascending: true }),
    ])
    if (csRes.error) throw new Error(`CS permits: ${csRes.error.message}`)
    if (hwRes.error) throw new Error(`hot-work permits: ${hwRes.error.message}`)

    const csPermitsRaw = (csRes.data ?? []) as ConfinedSpacePermit[]
    const hwPermitsRaw = (hwRes.data ?? []) as HotWorkPermit[]

    const spaceIds  = Array.from(new Set(csPermitsRaw.map(p => p.space_id))).filter(Boolean) as string[]
    const permitIds = csPermitsRaw.map(p => p.id)

    const [spacesRes, testsRes] = await Promise.all([
      spaceIds.length > 0
        ? admin.from('loto_confined_spaces').select('*').in('space_id', spaceIds)
        : Promise.resolve({ data: [], error: null }),
      permitIds.length > 0
        ? admin.from('loto_atmospheric_tests').select('*').in('permit_id', permitIds).order('tested_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])
    if (spacesRes.error) throw new Error(`spaces: ${spacesRes.error.message}`)
    if (testsRes.error)  throw new Error(`tests: ${testsRes.error.message}`)

    const spacesById = new Map<string, ConfinedSpace>()
    for (const s of (spacesRes.data ?? []) as ConfinedSpace[]) {
      spacesById.set(s.space_id, s)
    }
    const testsByPermit = new Map<string, AtmosphericTest[]>()
    for (const t of (testsRes.data ?? []) as AtmosphericTest[]) {
      const list = testsByPermit.get(t.permit_id) ?? []
      list.push(t)
      testsByPermit.set(t.permit_id, list)
    }

    // CS permits with missing parent spaces are dropped — see the same
    // logic on the admin compliance-bundle page.
    const csEntries = csPermitsRaw
      .map(p => {
        const space = spacesById.get(p.space_id)
        if (!space) return null
        return { permit: p, space, tests: testsByPermit.get(p.id) ?? [] }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const bytes = await generateCompliancePdfBundle({
      startDate:      payload.start,
      endDate:        payload.end,
      csPermits:      csEntries,
      hotWorkPermits: hwPermitsRaw.map(p => ({ permit: p })),
      origin:         u.origin,
    })

    const filename = `inspector-bundle-${payload.start}-to-${payload.end}.pdf`
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        // Inspectors are loading this from a clipped URL — make sure
        // intermediaries don't cache the response. Each fetch re-validates.
        'Cache-Control':       'no-store',
      },
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/inspector/bundle' } })
    console.error('[inspector/bundle]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Bundle generation failed' },
      { status: 500 },
    )
  }
}
