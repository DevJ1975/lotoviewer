'use client'

import { ConfirmDeleteDialog } from '@/components/environmental/ConfirmDeleteDialog'
import { deleteOutfall, type Outfall, type Scope } from '@/lib/environmental/client'

interface Props {
  scope: Scope
  outfall: Outfall
  onDeleted: () => void
  onClose: () => void
}

export function DeleteOutfallDialog({ scope, outfall, onDeleted, onClose }: Props) {
  return (
    <ConfirmDeleteDialog
      title={`Delete outfall ${outfall.code}?`}
      description="The outfall is removed from this site. Any outfall that names it as the one it is substantially identical to loses that link. If it is no longer in service, set its status to removed instead and keep its record. This cannot be undone."
      confirmLabel="Delete outfall"
      onConfirm={async () => { await deleteOutfall(scope, outfall.id) }}
      onDone={() => onDeleted()}
      onClose={onClose}
    />
  )
}
