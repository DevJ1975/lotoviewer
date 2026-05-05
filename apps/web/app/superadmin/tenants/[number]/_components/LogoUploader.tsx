'use client'

import Image from 'next/image'
import { useState, type ChangeEvent } from 'react'
import { Loader2, Upload, Trash2, AlertCircle } from 'lucide-react'
import { superadminFetch, superadminJson } from '@/lib/superadminFetch'
import type { Tenant } from '@soteria/core/types'
import { Section } from './Section'

interface Props {
  tenantNumber: string
  tenant:       Tenant
  onChange:     (next: Tenant) => void
}

// Logo upload + clear. POSTs multipart, DELETEs to clear (also removes
// the storage object — see /api/superadmin/tenants/[number]/logo).
// Calls onChange with the updated tenant row so the parent can refresh
// the active-tenant cache (TenantHeaderPill picks up the new logo).
export function LogoUploader({ tenantNumber, tenant, onChange }: Props) {
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null)
    try {
      // FormData uploads can't go through superadminJson (which sets
      // Content-Type: application/json by default). Use superadminFetch
      // so the browser picks the multipart boundary itself.
      const fd = new FormData()
      fd.append('file', file)
      const res = await superadminFetch(`/api/superadmin/tenants/${tenantNumber}/logo`, {
        method: 'POST',
        body:   fd,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.error ?? `Upload failed (${res.status})`)
        return
      }
      onChange(json.tenant as Tenant)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
      // Allow re-uploading the same file (input doesn't re-fire change otherwise).
      e.target.value = ''
    }
  }

  async function onClear() {
    if (!confirm('Remove the logo? The image is also deleted from storage; reuploading will create a fresh path.')) return
    setBusy(true); setError(null)
    const result = await superadminJson<{ tenant: Tenant }>(
      `/api/superadmin/tenants/${tenantNumber}/logo`,
      { method: 'DELETE' },
    )
    if (!result.ok || !result.body) {
      setError(result.error ?? 'Clear failed')
    } else {
      onChange(result.body.tenant)
    }
    setBusy(false)
  }

  return (
    <Section title="Logo">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
          {tenant.logo_url ? (
            <Image src={tenant.logo_url} alt={`${tenant.name} logo`} width={80} height={80} className="object-contain" unoptimized />
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">No logo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 cursor-pointer transition-colors">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {tenant.logo_url ? 'Replace' : 'Upload'} logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onUpload} disabled={busy} />
          </label>
          {tenant.logo_url && (
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
        PNG, JPEG, or WebP. Max 1MB. Shown in the app header next to the tenant name.
      </p>
      {error && (
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </Section>
  )
}
