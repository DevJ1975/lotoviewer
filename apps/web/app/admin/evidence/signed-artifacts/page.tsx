'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileCheck2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /admin/evidence/signed-artifacts — read-only chain-of-custody list.
//
// Every row is one immutable signoff of one placard PDF: equipment,
// signer, sha256, timestamp, and a download link. Admins use this
// during audits to satisfy "show me the sealed copy of placard X" and
// to verify SHA-256 against a downloaded file.
//
// Multi-tenant: query is tenant-scoped at the application layer and
// enforced again by RLS — defense in depth.

interface ArtifactRow {
  id:                          string
  equipment_id:                string
  pdf_storage_path:            string
  sha256_hex:                  string
  signer_typed_name:           string
  signer_ip:                   string | null
  signed_at:                   string
  review_link_id:              string | null
  created_at:                  string
}

const PAGE_SIZE = 100

export default function SignedArtifactsPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [rows, setRows]           = useState<ArtifactRow[] | null>(null)
  const [search, setSearch]       = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('loto_signed_pdf_artifacts')
        .select('id, equipment_id, pdf_storage_path, sha256_hex, signer_typed_name, signer_ip, signed_at, review_link_id, created_at')
        .eq('tenant_id', tenantId)
        .order('signed_at', { ascending: false })
        .limit(PAGE_SIZE)
      if (error) throw new Error(formatSupabaseError(error, 'load signed artifacts'))
      setRows((data ?? []) as ArtifactRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load artifacts.')
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (!profile?.is_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">
        Admins only.
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const visible = (rows ?? []).filter(r =>
    !q
    || r.equipment_id.toLowerCase().includes(q)
    || r.signer_typed_name.toLowerCase().includes(q)
    || r.sha256_hex.toLowerCase().includes(q),
  )

  function downloadUrl(storagePath: string): string {
    const { data } = supabase.storage.from('loto-photos').getPublicUrl(storagePath)
    return data.publicUrl
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FileCheck2 className="h-6 w-6 text-brand-navy" />
          Sealed PDF audit artifacts
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          One immutable row per placard sealed through the review portal. The SHA-256 here is the canonical fingerprint —
          download the PDF and recompute SHA-256 to verify the bytes have not been altered after sign-off.
        </p>
      </div>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by equipment, signer, or hash…"
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
      />

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          {q ? 'No artifacts match this search.' : 'No sealed artifacts yet — every review-portal signoff lands here.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Equipment</th>
                <th className="text-left px-4 py-2">Signer</th>
                <th className="text-left px-4 py-2">Signed</th>
                <th className="text-left px-4 py-2">SHA-256</th>
                <th className="text-right px-4 py-2">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map(row => (
                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">
                    {row.equipment_id}
                  </td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                    {row.signer_typed_name}
                    {row.signer_ip && (
                      <span className="ml-1 text-[10px] text-slate-400 font-mono">{row.signer_ip}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {new Date(row.signed_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px] text-slate-500 dark:text-slate-400 break-all max-w-md">
                    {row.sha256_hex}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <a
                      href={downloadUrl(row.pdf_storage_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-navy hover:underline"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length >= PAGE_SIZE && (
        <p className="text-[11px] text-slate-400 italic">
          Showing the {PAGE_SIZE} most recent artifacts. Older signoffs are still verifiable via the compliance-bundle cover sheet.
        </p>
      )}
    </div>
  )
}
