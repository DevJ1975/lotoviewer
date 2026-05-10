'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { ArrowLeft, Loader2, QrCode } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

interface ModuleRow {
  id: string
  title: string
  slug: string
  category: string | null
  estimated_minutes: number | null
}

export default function StrikeQrPage() {
  const { tenant } = useTenant()
  const [modules, setModules] = useState<ModuleRow[]>([])
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    setError(null)
    const { data, error: fetchErr } = await supabase
      .from('strike_modules')
      .select('id,title,slug,category,estimated_minutes')
      .eq('status', 'published')
      .order('title', { ascending: true })
    if (fetchErr) {
      setError(fetchErr.message)
      setLoading(false)
      return
    }
    const rows = (data ?? []) as ModuleRow[]
    setModules(rows)
    const origin = typeof window === 'undefined' ? '' : window.location.origin
    const nextCodes: Record<string, string> = {}
    await Promise.all(rows.map(async module => {
      nextCodes[module.id] = await QRCode.toDataURL(`${origin}/strike/${module.slug}`, {
        margin: 1,
        width: 220,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
    }))
    setCodes(nextCodes)
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { void load() }, [load])

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/strike" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-brand-navy">
            <ArrowLeft className="h-4 w-4" />
            STRIKE
          </Link>
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
            <QrCode className="h-6 w-6 text-emerald-600" />
            QR launch cards
          </h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Print or post module launch codes at point of work.
          </p>
        </div>
      </header>

      {error && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map(module => (
            <article key={module.id} className="rounded-lg border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-950">
              {codes[module.id] && (
                <div
                  aria-hidden="true"
                  className="mx-auto h-44 w-44 bg-contain bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${codes[module.id]})` }}
                />
              )}
              <h2 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{module.title}</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {module.category ?? 'STRIKE'}{module.estimated_minutes ? ` · ${module.estimated_minutes} min` : ''}
              </p>
              <p className="mt-3 break-all rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                /strike/{module.slug}
              </p>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
