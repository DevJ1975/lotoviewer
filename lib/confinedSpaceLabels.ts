import type {
  ConfinedSpaceClassification,
  ConfinedSpaceType,
  CancelReason,
} from '@/lib/types'

// Shared labels for confined-space enums. Originally duplicated across the
// list page, the detail page, and the permit page; consolidated here so a
// label tweak (e.g. "Permit-Required" → "Permit Space") only needs to be
// made once. Records are typed against the enum unions so adding a new
// value to ConfinedSpaceType / ConfinedSpaceClassification / CancelReason
// fails the TypeScript build until the label is added here too.

export const SPACE_TYPE_LABELS: Record<ConfinedSpaceType, string> = {
  tank:    'Tank',
  silo:    'Silo',
  vault:   'Vault',
  pit:     'Pit',
  hopper:  'Hopper',
  vessel:  'Vessel',
  sump:    'Sump',
  plenum:  'Plenum',
  manhole: 'Manhole',
  other:   'Other',
}

export const CLASSIFICATION_LABELS: Record<ConfinedSpaceClassification, string> = {
  permit_required: 'Permit-Required',
  non_permit:      'Non-Permit',
  reclassified:    'Reclassified',
}

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  task_complete:        'Task complete',
  prohibited_condition: 'Prohibited condition (evacuated)',
  expired:              'Time expired',
  other:                'Other',
}
