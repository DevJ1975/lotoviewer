import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { parseAnnotations } from '@/lib/photoAnnotations'
import QrPlacardPhoto from './_components/QrPlacardPhoto'
import QrEnergySteps from './_components/QrEnergySteps'

// Public LOTO placard view. A worker scans the printed placard QR
// (https://soteriafield.app/qr/{qr_token}) and lands here with NO login.
//
// Trust model:
//   • The page never sees the service key. It calls the SECURITY DEFINER
//     RPC `get_placard_by_qr` with the anon key — the same key the browser
//     would hold — so RLS is never weakened and only display-safe columns
//     leave the database.
//   • The RPC also logs the resolved scan to loto_placard_scan_log and
//     returns NULL for unknown / decommissioned tokens, which renders the
//     clean "Placard not found" state below.
//
// force-dynamic: each scan is a fresh request (and a logged event); never
// cache a placard.

export const dynamic = 'force-dynamic'

const TOKEN_RE = /^[0-9a-f]{16}$/

interface EnergyStep {
  energy_type:            string | null
  tag_description:        string | null
  isolation_procedure:    string | null
  method_of_verification: string | null
}

interface Placard {
  equipment_id:    string
  description:     string | null
  department:      string | null
  iso_photo_url:   string | null
  equip_photo_url: string | null
  iso_annotations: unknown
  verified:        boolean | null
  verified_date:   string | null
  energy_steps:    EnergyStep[]
}

async function resolvePlacard(token: string): Promise<Placard | null> {
  if (!TOKEN_RE.test(token)) return null

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Supabase env not configured')

  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null
  const userAgent = h.get('user-agent') ?? null

  // Anon-keyed client: proves the RPC's anon grant is sufficient and keeps
  // the service key out of this code path entirely.
  const anonClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data, error } = await anonClient.rpc('get_placard_by_qr', {
    p_token:      token,
    p_ip:         ip,
    p_user_agent: userAgent,
  })
  if (error) throw new Error(error.message)
  return (data as Placard | null) ?? null
}

export default async function QrPlacardPage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const placard = await resolvePlacard(token)

  if (!placard) return <NotFound />

  const isoAnnotations = parseAnnotations(placard.iso_annotations)

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <header className="rounded-2xl bg-brand-navy text-white p-5 shadow-sm">
          <div className="text-[11px] font-bold tracking-widest uppercase opacity-90">
            SoteriaField · LOTO placard
          </div>
          <h1 className="text-2xl font-bold mt-1 font-mono">{placard.equipment_id}</h1>
          {placard.description ? (
            <p className="text-sm opacity-95 mt-1">{placard.description}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {placard.department ? (
              <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold">
                {placard.department}
              </span>
            ) : null}
            <VerifiedBadge verified={placard.verified} verifiedDate={placard.verified_date} />
          </div>
        </header>

        <QrPlacardPhoto
          isoUrl={placard.iso_photo_url}
          equipUrl={placard.equip_photo_url}
          isoAnnotations={isoAnnotations}
        />

        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-xs font-bold tracking-wide uppercase text-slate-500 mb-3">
            Energy-control steps
          </h2>
          <QrEnergySteps steps={placard.energy_steps} />
        </section>

        <footer className="pt-1 pb-6 text-center text-[11px] text-slate-400">
          Read-only placard view · Lock out, tag out, verify zero energy before service.
        </footer>
      </div>
    </main>
  )
}

function VerifiedBadge({
  verified, verifiedDate,
}: { verified: boolean | null; verifiedDate: string | null }) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-400/20 px-2.5 py-1 text-xs font-semibold text-emerald-100">
        ✓ Verified{verifiedDate ? ` · ${formatDate(verifiedDate)}` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-400/20 px-2.5 py-1 text-xs font-semibold text-amber-100">
      Unverified
    </span>
  )
}

function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold">
          SoteriaField · LOTO placard
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Placard not found</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This code doesn&apos;t match an active placard. The equipment may have been
          decommissioned, or the code may be mistyped. Check with your supervisor.
        </p>
      </div>
    </main>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}
