import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'

// Public Prop 65 warning page — Cal. Code Regs tit. 27 §25602(a)(4)
// requires the physical sign's reference URL (www.P65Warnings.ca.gov)
// to point at a destination where the warning's chemicals are
// disclosed. Tenants link their on-site sign to /prop65/<slug>; this
// is that destination.
//
// No login. The page reads currently-posted (removed_at IS NULL)
// warnings for the site whose public_slug matches. The Supabase
// anon-client query relies on the migrations 172 + 174 anon-read
// RLS policies. tenant_id is never displayed.

interface PageProps { params: Promise<{ slug: string }> }

interface SiteRow { id: string; name: string; city: string | null }
interface WarningRow {
  warning_text: string
  posted_at:    string
  harm_endpoint: string
  warning_type:  string
  photo_url:    string | null
}

function anonClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Supabase env not configured')
  return createClient(url, anon, { auth: { persistSession: false } })
}

export default async function PublicProp65Page({ params }: PageProps) {
  const { slug } = await params
  const client = anonClient()

  const { data: site } = await client
    .from('prop65_sites')
    .select('id, name, city')
    .eq('public_slug', slug)
    .maybeSingle<SiteRow>()
  if (!site) notFound()

  const { data: warnings } = await client
    .from('prop65_warnings')
    .select('warning_text, posted_at, harm_endpoint, warning_type, photo_url')
    .eq('site_id', site.id)
    .is('removed_at', null)
    .order('posted_at', { ascending: false })

  const rows = (warnings ?? []) as WarningRow[]

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Proposition 65 warning</h1>
        <p className="text-sm text-slate-700 mt-1">{site.name}{site.city ? `, ${site.city}` : ''}, California</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-700">No warnings are currently posted at this location.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((w, idx) => (
            <li key={idx} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="text-[11px] uppercase tracking-wider text-amber-700 mb-2">
                {w.warning_type.replace('_', ' ')} · {w.harm_endpoint} · posted {w.posted_at.slice(0, 10)}
              </div>
              <pre className="text-sm whitespace-pre-wrap text-slate-900">{w.warning_text}</pre>
            </li>
          ))}
        </ul>
      )}

      <footer className="text-[11px] text-slate-500 pt-6 border-t border-slate-200">
        Required by California Health &amp; Safety Code §25249.6 and Cal. Code Regs tit. 27 §25602.
      </footer>
    </main>
  )
}
