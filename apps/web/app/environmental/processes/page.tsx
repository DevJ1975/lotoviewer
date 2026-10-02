'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2, Workflow } from 'lucide-react'
import {
  EMS_RESPONSIBILITIES,
  type EmsResponsibility,
  type ResponsibilityKey,
} from '@soteria/core/emsProcesses'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import MemberPicker, { memberName, useTenantMembers, type Member } from '@/app/risk/_components/wizard/MemberPicker'
import { assignResponsibility, getResponsibilities } from '@/lib/environmental/client'
import { useCanEditRegisters } from '../_components/access'
import { RegisterHealthStrip } from '../_components/RegisterHealthStrip'
import { FIELD_ERROR } from '../_components/formStyles'

// /environmental/processes — clauses 4.4 and 5.3. The EMS as a map of
// processes and how each one's outputs feed the others, with an owner for
// each, plus the two roles clause 5.3 says top management must assign.
// Members can read who holds what; admins assign them. Showing it here is a
// record, not 5.3's communication to the workforce, which needs its own
// evidence. Processes the platform keeps no record of yet are still listed:
// the organization must run and own them.

type ResponsibilitiesState = Awaited<ReturnType<typeof getResponsibilities>>

const NAMES = new Map(EMS_RESPONSIBILITIES.map(r => [r.key, r.name]))
const ROLES = EMS_RESPONSIBILITIES.filter(r => r.kind === 'role')
const PROCESSES = EMS_RESPONSIBILITIES.filter(r => r.kind === 'process')

export default function EmsProcessesPage() {
  const { tenantId } = useTenant()
  const canEdit = useCanEditRegisters()
  const { members, error: membersError } = useTenantMembers()
  const [state, setState] = useState<ResponsibilitiesState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState<ReadonlySet<ResponsibilityKey>>(new Set())
  const [saveError, setSaveError] = useState<{ key: ResponsibilityKey; message: string } | null>(null)
  // Each assignment reloads the map; only the newest reload may land, or an
  // earlier one finishing last would show a newer assignment as undone.
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    if (!tenantId) return
    const request = ++latestLoad.current
    setLoadError(null)
    try {
      const next = await getResponsibilities(tenantId)
      if (request === latestLoad.current) setState(next)
    } catch (err) {
      if (request === latestLoad.current) setLoadError(err instanceof Error ? err.message : 'Could not load the process map.')
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const markSaving = (key: ResponsibilityKey, on: boolean) => setSaving(previous => {
    const next = new Set(previous)
    if (on) next.add(key)
    else next.delete(key)
    return next
  })

  async function assign(key: ResponsibilityKey, userId: string) {
    // A second pick while the first is saving would race it into a 409 of the user's own making.
    if (!tenantId || saving.has(key)) return
    markSaving(key, true)
    setSaveError(null)
    try {
      await assignResponsibility(tenantId, key, userId || null)
      await load()
    } catch (err) {
      setSaveError({ key, message: err instanceof Error ? err.message : 'Could not save the owner.' })
    } finally {
      markSaving(key, false)
    }
  }

  const ownerOf = (key: ResponsibilityKey) =>
    state?.responsibilities.find(r => r.responsibility_key === key)?.owner_user_id ?? null

  const row = (item: EmsResponsibility) => (
    <ResponsibilityItem key={item.key} item={item} ownerId={ownerOf(item.key)} members={members}
      membersFailed={membersError !== null} canEdit={canEdit} saving={saving.has(item.key)}
      error={saveError?.key === item.key ? saveError.message : null}
      onAssign={userId => void assign(item.key, userId)} />
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        icon={Workflow}
        eyebrow="ISO 14001:2015 · clauses 4.4 & 5.3"
        title="Processes & responsibilities"
        description="The processes your environmental management system needs, how each feeds the others, and who owns each one."
        back="/environmental"
      />

      <RegisterHealthStrip title="Responsibilities" health={state?.health ?? null} facts={state ? [
        { label: '5.3 roles unassigned', value: state.coverage.rolesUnassigned, warn: state.coverage.rolesUnassigned > 0 },
        { label: 'processes without an owner', value: state.coverage.processesUnassigned, warn: state.coverage.processesUnassigned > 0 },
      ] : []} />

      {loadError && <p className={FIELD_ERROR} role="alert">{loadError}</p>}
      {membersError && <p className={FIELD_ERROR} role="alert">Could not load the organization&apos;s members: {membersError}</p>}

      {!state && !loadError ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : state && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Roles top management assigns (clause 5.3)</h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {ROLES.map(row)}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">The EMS processes (clause 4.4)</h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {PROCESSES.map(row)}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function ResponsibilityItem({ item, ownerId, members, membersFailed, canEdit, saving, error, onAssign }: {
  item:          EmsResponsibility
  ownerId:       string | null
  members:       Member[] | null
  membersFailed: boolean
  canEdit:       boolean
  saving:        boolean
  error:         string | null
  onAssign:      (userId: string) => void
}) {
  const owner = ownerId && members ? members.find(m => m.user_id === ownerId) ?? null : null
  // The database clears an owner whose membership is removed, so this is the
  // rare owner whose invitation was cancelled, or a member list from before
  // they left. Say so rather than show "No owner" or a stale name.
  const formerMember = ownerId !== null && members !== null && owner === null
  const ownerLabel =
    ownerId === null ? 'No owner'
      : owner ? memberName(owner)
        : formerMember ? 'Former member'
          : membersFailed ? 'Assigned (names unavailable)'
            : 'Loading…'

  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_16rem] sm:items-start">
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          <span className="placard-numeric mr-2 text-xs text-slate-500 dark:text-slate-400">{item.clauses.join(' · ')}</span>
          {item.name}
        </p>
        {item.feeds.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Feeds: {item.feeds.map(key => NAMES.get(key)).join(', ')}
          </p>
        )}
        {item.kind === 'process' && (item.href ? (
          <Link href={item.href} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-navy hover:underline dark:text-brand-yellow">
            Open <ArrowRight className="h-3 w-3" />
          </Link>
        ) : (
          <p className="text-xs italic text-slate-500 dark:text-slate-400">Kept outside the platform for now.</p>
        ))}
      </div>
      <div role="group" aria-label={`Owner of ${item.name}`} className="space-y-1">
        {canEdit ? (
          <MemberPicker value={ownerId ?? ''} onChange={onAssign} placeholder={ownerLabel} />
        ) : (
          <p className="text-sm text-slate-800 dark:text-slate-100">{ownerLabel}</p>
        )}
        {formerMember && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            The owner is no longer a member.{canEdit ? ' Reassign it.' : ''}
          </p>
        )}
        {saving && <p className="text-[11px] text-slate-500">Saving…</p>}
        {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
      </div>
    </li>
  )
}
