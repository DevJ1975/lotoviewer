'use client'

import { ConfirmDeleteDialog } from '@/components/environmental/ConfirmDeleteDialog'
import { deletePermit, type Permit, type Scope } from '@/lib/environmental/client'
import { permitLabel } from '@/lib/environmental/permitView'

interface Props {
  scope: Scope
  permit: Permit
  onDeleted: () => void
  onClose: () => void
}

export function DeletePermitDialog({ scope, permit, onDeleted, onClose }: Props) {
  return (
    <ConfirmDeleteDialog
      title={`Delete ${permitLabel(permit)}?`}
      description="The permit is removed from this site and its renewal deadline on the calendar is dismissed, so it stops showing as due. Outfalls covered by this permit are kept but no longer name it. This cannot be undone."
      confirmLabel="Delete permit"
      onConfirm={async () => { await deletePermit(scope, permit.id) }}
      onDone={() => onDeleted()}
      onClose={onClose}
    />
  )
}
