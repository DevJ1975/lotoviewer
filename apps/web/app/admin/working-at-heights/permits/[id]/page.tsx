'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ScrollText, ArrowLeft, Loader2, CheckCircle2, XCircle, PauseCircle, Ban } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'

// Permit detail + lifecycle actions. The list page hands an id; here the
// permit row is hydrated with its joined CP / worker / anchor / rescue
// plan, the clearance snapshot is rendered, and the issuer can:
//   - Suspend an active permit (work paused; resume via setting active)
//   - Close (complete) a permit when the task is finished
//   - Cancel (void) a permit if it was issued in error

interface PermitRow {
  id:                   string
  permit_number:        string
  work_location:        string
  task_description:     string | null
  status:               'active' | 'completed' | 'suspended' | 'cancelled'
  valid_from:           string
  valid_until:          string
  closed_at:            string | null
  notes:                string | null
  components_used:      string[]
  clearance_calculation: ClearanceSnapshot | null
  weather_check:        WeatherSnapshot | null
  worker:               { display_name: string } | null
  cp:                   { display_name: string } | null
  anchor:               { id: string; location_label: string; asset_tag: string | null } | null
  rescue_plan:          { id: string; location_label: string } | null
}

interface ClearanceSnapshot {
  system:                  string
  lanyard_length_ft:        number
  swing_offset_ft:          number
  available_clearance_ft:   number
  required_clearance_ft:    number
  breakdown:                Array<{ label: string; feet: number }>
  verdict:                  'safe' | 'unsafe'
}

interface WeatherSnapshot {
  wind_mph:  number
  lightning: boolean
  temp_f:    number
  verdict:   'go' | 'caution' | 'no_go'
}

interface ComponentRow {
  id:           string
  type:         string
  manufacturer: string
  model:        string | null
  serial:       string
}

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  completed: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  cancelled: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

export default function PermitDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { tenantId } = useTenant()
  const { profile } = useAuth()
  const canManage = !!profile?.is_admin || !!profile?.is_superadmin
  const [permit, setPermit]         = useState<PermitRow | null>(null)
  const [components, setComponents] = useState<ComponentRow[]>([])
  const [busy, setBusy]             = useState<null | 'suspend' | 'resume' | 'complete' | 'cancel'>(null)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    if (!tenantId || !id) return
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase
        .from('wah_permits')
        .select(`
          id, permit_number, work_location, task_description, status,
          valid_from, valid_until, closed_at, notes, components_used,
          clearance_calculation, weather_check,
          worker:members!worker_id(display_name),
          cp:members!cp_id(display_name),
          anchor:wah_anchors!anchor_id(id, location_label, asset_tag),
          rescue_plan:wah_rescue_plans!rescue_plan_id(id, location_label)
        `)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle<PermitRow>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      setPermit(data)
      if (data?.components_used?.length) {
        const { data: cs } = await supabase
          .from('wah_components')
          .select('id, type, manufacturer, model, serial')
          .in('id', data.components_used)
        if (!cancelled) setComponents((cs ?? []) as ComponentRow[])
      }
    })()
    return () => { cancelled = true }
  }, [tenantId, id])

  async function transition(next: PermitRow['status']) {
    if (!permit) return
    const action = next === 'suspended' ? 'suspend'
      : next === 'active'    ? 'resume'
      : next === 'completed' ? 'complete'
      :                        'cancel'
    setBusy(action)
    setError(null)
    const patch: Record<string, unknown> = { status: next }
    if (next === 'completed' || next === 'cancelled') {
      patch.closed_at = new Date().toISOString()
      patch.closed_by = profile?.id ?? null
    }
    const { error: err } = await supabase
      .from('wah_permits')
      .update(patch)
      .eq('id', permit.id)
    setBusy(null)
    if (err) { setError(err.message); return }
    setPermit({ ...permit, status: next, closed_at: patch.closed_at as string | null ?? permit.closed_at })
  }

  if (!permit && !error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          Loading permit…
        </div>
      </main>
    )
  }

  if (!permit) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
          {error ?? 'Permit not found.'}
        </p>
      </main>
    )
  }

  const isActive    = permit.status === 'active'
  const isSuspended = permit.status === 'suspended'
  const isOpen      = isActive || isSuspended

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/admin/working-at-heights/permits" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow">
        <ArrowLeft className="h-3.5 w-3.5" />
        Permits
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
            <ScrollText className="size-5" />
          </span>
          <div>
            <p className="font-mono text-xs text-slate-500">{permit.permit_number}</p>
            <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50">{permit.work_location}</h1>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
              {permit.task_description ?? <span className="italic text-slate-400">No task description.</span>}
            </p>
          </div>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${STATUS_BADGE[permit.status] ?? ''}`}>
          {permit.status}
        </span>
      </header>

      {error && (
        <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</p>
      )}

      {canManage && isOpen && (
        <div className="mt-4 flex flex-wrap gap-2">
          {isActive && (
            <ActionButton
              onClick={() => transition('suspended')}
              busy={busy === 'suspend'} Icon={PauseCircle} tone="amber"
              label="Suspend"
            />
          )}
          {isSuspended && (
            <ActionButton
              onClick={() => transition('active')}
              busy={busy === 'resume'} Icon={CheckCircle2} tone="emerald"
              label="Resume"
            />
          )}
          <ActionButton
            onClick={() => transition('completed')}
            busy={busy === 'complete'} Icon={CheckCircle2} tone="slate"
            label="Close out"
          />
          <ActionButton
            onClick={() => transition('cancelled')}
            busy={busy === 'cancel'} Icon={Ban} tone="rose"
            label="Cancel"
          />
        </div>
      )}

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Validity">
          <Row label="From" value={new Date(permit.valid_from).toLocaleString()} />
          <Row label="Until" value={new Date(permit.valid_until).toLocaleString()} />
          {permit.closed_at && <Row label="Closed" value={new Date(permit.closed_at).toLocaleString()} />}
        </Card>
        <Card title="Roster">
          <Row label="Worker" value={permit.worker?.display_name ?? '—'} />
          <Row label="CP"     value={permit.cp?.display_name ?? '—'} />
        </Card>
        <Card title="Anchor">
          {permit.anchor ? (
            <Link href={`/admin/working-at-heights/anchors`} className="text-sm text-brand-navy hover:underline dark:text-brand-yellow">
              {permit.anchor.location_label}{permit.anchor.asset_tag ? ` (${permit.anchor.asset_tag})` : ''}
            </Link>
          ) : <span className="text-sm text-slate-500">—</span>}
        </Card>
        <Card title="Rescue plan">
          {permit.rescue_plan ? (
            <Link href={`/admin/working-at-heights/rescue-plans`} className="text-sm text-brand-navy hover:underline dark:text-brand-yellow">
              {permit.rescue_plan.location_label}
            </Link>
          ) : <span className="text-sm text-slate-500">—</span>}
        </Card>
      </section>

      {permit.clearance_calculation && (
        <Card title="Fall clearance snapshot" className="mt-4">
          <div className="flex items-center gap-2">
            {permit.clearance_calculation.verdict === 'safe' ? (
              <CheckCircle2 className="size-5 text-emerald-600" />
            ) : (
              <XCircle className="size-5 text-rose-600" />
            )}
            <span className="font-bold text-sm">
              {permit.clearance_calculation.verdict === 'safe' ? 'SAFE' : 'UNSAFE'}
            </span>
            <span className="text-xs text-slate-500">
              · {permit.clearance_calculation.system}
              · required {permit.clearance_calculation.required_clearance_ft} ft
              · available {permit.clearance_calculation.available_clearance_ft} ft
            </span>
          </div>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {permit.clearance_calculation.breakdown.map((b, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="py-1.5 text-slate-700 dark:text-slate-300">{b.label}</td>
                  <td className="py-1.5 text-right font-mono">{b.feet.toFixed(2)} ft</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {permit.weather_check && (
        <Card title="Weather check" className="mt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
              permit.weather_check.verdict === 'go'      ? 'bg-emerald-100 text-emerald-800'
              : permit.weather_check.verdict === 'caution' ? 'bg-amber-100 text-amber-800'
              :                                              'bg-rose-100 text-rose-800'
            }`}>
              {permit.weather_check.verdict.replace('_', '-')}
            </span>
            <span>Wind {permit.weather_check.wind_mph} mph</span>
            <span>Temp {permit.weather_check.temp_f}°F</span>
            <span>Lightning: {permit.weather_check.lightning ? 'detected' : 'clear'}</span>
          </div>
        </Card>
      )}

      <Card title="Components" className="mt-4">
        {components.length === 0 ? (
          <p className="text-sm text-slate-500">None recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {components.map(c => (
              <li key={c.id} className="flex items-baseline gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-200">{c.type}</span>
                <span className="font-mono text-xs text-slate-500">{c.serial}</span>
                <span className="text-xs text-slate-500">{c.manufacturer}{c.model ? ` · ${c.model}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {permit.notes && (
        <Card title="Notes" className="mt-4">
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{permit.notes}</p>
        </Card>
      )}
    </main>
  )
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className ?? ''}`}>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{title}</h2>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  )
}

function ActionButton({
  onClick, busy, Icon, label, tone,
}: {
  onClick: () => void
  busy:    boolean
  Icon:    React.ComponentType<{ className?: string }>
  label:   string
  tone:    'emerald' | 'amber' | 'slate' | 'rose'
}) {
  const cls =
      tone === 'emerald' ? 'bg-emerald-600 hover:bg-emerald-700'
    : tone === 'amber'   ? 'bg-amber-600 hover:bg-amber-700'
    : tone === 'slate'   ? 'bg-slate-700 hover:bg-slate-800'
    :                      'bg-rose-600 hover:bg-rose-700'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-md ${cls} px-3 py-2 text-sm font-semibold text-white disabled:opacity-50`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {label}
    </button>
  )
}
