'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusChip, VerifyNote } from '@/components/environmental/badges'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { errorList, type Outfall, type Scope } from '@/lib/environmental/complianceClient'
import { adoptDefaults } from '@/lib/environmental/monitoringClient'
import { basisLabel, defaultChoices, limitText } from '@/lib/environmental/monitoringView'
import { outfallOptionLabel } from '@/lib/environmental/outfallView'
import type { MonitoringLimit } from '@soteria/core/environmental/monitoring'
import type { DefaultLimit } from '@soteria/core/environmental/monitoringDefaults'

// Adopt draft default limits for the site, or for one outfall. Nothing is adopted until an
// admin ticks it and confirms. Every default carries the note a reviewer must clear, shown
// here before it is adopted and again beside the limit afterwards: these are starting points
// written from recollection of the permit, not the permit.

interface Props {
  scope: Scope
  siteName: string
  /** The defaults the site's profile offers. */
  offered: DefaultLimit[]
  /** The limits the site has now, to show which defaults are already adopted. */
  limits: MonitoringLimit[]
  outfalls: Outfall[]
  onAdopted: () => void
  onClose: () => void
}

export function AdoptDefaultsDialog({ scope, siteName, offered, limits, outfalls, onAdopted, onClose }: Props) {
  const [outfallId, setOutfallId] = useState('')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const choices = defaultChoices(offered, limits, outfallId || null)
  const selected = choices.filter(c => !c.adopted && chosen.has(c.limit.libraryKey))

  function toggle(key: string, on: boolean) {
    setChosen(current => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function adopt() {
    setBusy(true); setErrors([])
    try {
      await adoptDefaults(scope, { keys: selected.map(c => c.limit.libraryKey), outfall_id: outfallId || null })
      onAdopted()
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adopt draft default limits</DialogTitle>
          <DialogDescription>
            Draft starting points for {siteName}, written from recollection of the permit and not yet reviewed. Each keeps the note
            below it after you adopt it. Check every number against your permit before you rely on it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Adopt for" hint="Adopting for an outfall copies the limit to that outfall alone">
            <select value={outfallId} onChange={e => setOutfallId(e.target.value)} className={inputCls}>
              <option value="">Whole site</option>
              {outfalls.map(o => <option key={o.id} value={o.id}>{outfallOptionLabel(o)}</option>)}
            </select>
          </Field>

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Defaults to adopt</legend>
            <ul className="space-y-3">
              {choices.map(({ limit, adopted }) => {
                const id = `adopt-${limit.libraryKey}`
                const name = `${limit.parameter}: ${limitText(limit)}`
                return (
                  <li key={limit.libraryKey} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <label htmlFor={id} className="flex items-start gap-2 text-sm text-slate-900 dark:text-slate-100">
                      <input
                        id={id} type="checkbox" disabled={adopted} checked={!adopted && chosen.has(limit.libraryKey)}
                        onChange={e => toggle(limit.libraryKey, e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                      />
                      <span className="space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{name}</span>
                          <StatusChip tone="idle">{basisLabel(limit.basis)}</StatusChip>
                          {adopted && <StatusChip tone="good">Already adopted</StatusChip>}
                        </span>
                        <span className="block text-xs text-slate-600 dark:text-slate-400">{limit.citation}</span>
                      </span>
                    </label>
                    <div className="mt-2 pl-6"><VerifyNote note={limit.verify} /></div>
                  </li>
                )
              })}
            </ul>
          </fieldset>

          <ErrorList errors={errors} />

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondaryButtonCls} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={primaryButtonCls} disabled={busy || selected.length === 0} onClick={() => void adopt()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {selected.length === 0 ? 'Adopt selected' : `Adopt ${selected.length} selected`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
