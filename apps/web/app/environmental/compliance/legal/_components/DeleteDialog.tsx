'use client'

import { ConfirmDeleteDialog } from '@/components/environmental/ConfirmDeleteDialog'
import { deleteLegal, type LegalEntry, type Scope } from '@/lib/environmental/client'

interface Props {
  scope: Scope
  entry: LegalEntry
  onClose: () => void
  onDeleted: (message: string) => void
}

export function DeleteDialog({ scope, entry, onClose, onDeleted }: Props) {
  return (
    <ConfirmDeleteDialog
      title="Delete this requirement?"
      description={<>“{entry.title}” is removed from the register{entry.facility_id === null ? ' for every site' : ''}, along with its rating and review dates. This cannot be undone.</>}
      confirmLabel="Delete"
      // A library entry comes back when the library is applied again; the API says so.
      onConfirm={async () => {
        const { warning } = await deleteLegal(scope, entry.id)
        return `Deleted “${entry.title}”.${warning ? ` ${warning}` : ''}`
      }}
      onDone={message => onDeleted(message ?? `Deleted “${entry.title}”.`)}
      onClose={onClose}
    />
  )
}
