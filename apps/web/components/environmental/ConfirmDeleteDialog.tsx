'use client'

import { useId, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { errorList } from '@/lib/environmental/client'
import { dangerButtonCls, ErrorList, secondaryButtonCls } from './form'

// Deleting a record cannot be undone, so it is asked twice. The dialog stays open
// while the request runs and when it fails, so the reason is read where it was asked.

interface Props {
  title: string
  /** What goes, and what happens to things that point at it. */
  description: ReactNode
  confirmLabel: string
  /** Does the deletion. It may return a message for the caller, such as a warning the API attached. */
  onConfirm: () => Promise<string | void>
  onDone: (message?: string) => void
  onClose: () => void
}

export function ConfirmDeleteDialog({ title, description, confirmLabel, onConfirm, onDone, onClose }: Props) {
  const descriptionId = useId()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  async function confirm() {
    setBusy(true); setErrors([])
    try {
      onDone((await onConfirm()) || undefined)
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent aria-describedby={descriptionId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id={descriptionId}>{description}</DialogDescription>
        </DialogHeader>
        <ErrorList errors={errors} />
        <DialogFooter>
          <button type="button" className={secondaryButtonCls} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={dangerButtonCls} onClick={() => void confirm()} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
