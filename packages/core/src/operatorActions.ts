// Carve-out (regulated) action registry for the Operator Console.
//
// The Operator Console lets an AI agent operate the SaaS autonomously, with
// ONE exception: a small set of legally-gated, life-safety actions may never
// be finalized by the agent. The agent does all the prep work, then the action
// is STAGED for a named, qualified human to approve with one tap.
//
// This module is the single source of truth for that gated set. It lives in
// @soteria/core because three layers must agree on it:
//   - the tool layer (decides a tool must stage rather than execute),
//   - notification targeting (who is the "named human" for an action),
//   - the apply RPC (re-proves the approver holds the authorizing role).
//
// Pure data + helpers only — no DOM, no Node, no DB.

export type CarveOutAction =
  | 'loto_zero_energy_cert'      // OSHA 1910.147: certify a machine's hazardous energy is isolated / zero-energy verified
  | 'permit_confined_space_auth' // OSHA 1910.146: authorize a permit-required confined-space entry
  | 'permit_hot_work_auth'       // authorize a hot-work permit (fire watch, combustibles cleared)
  | 'osha_300a_cert'             // certify the OSHA 300A annual summary (must be a company executive)
  | 'osha_ita_submit'            // electronically submit 300A data to OSHA's ITA portal (irreversible)
  | 'capa_high_severity_close'   // verify-effective + close a high-severity corrective/preventive action

// The minimum tenant role allowed to approve an action. 'admin' means
// admin-or-higher (admin, owner, superadmin); 'owner' means owner-or-higher.
// OSHA 300A certification + ITA submission require executive sign-off, so they
// demand 'owner'. Resolved against tenant_memberships at approval time.
export type AuthorizingRole = 'admin' | 'owner'

export interface CarveOutActionSpec {
  readonly action: CarveOutAction
  readonly authorizingRole: AuthorizingRole
  /** Whether an applied action can be rolled back. An ITA submission to OSHA
   *  cannot be un-sent, so it is explicitly NOT reversible. */
  readonly reversible: boolean
  /** One-line description rendered on the approval card. */
  readonly label: string
}

export const CARVE_OUT_ACTIONS: Record<CarveOutAction, CarveOutActionSpec> = {
  loto_zero_energy_cert: {
    action: 'loto_zero_energy_cert',
    authorizingRole: 'admin',
    reversible: true,
    label: 'Certify LOTO zero-energy state for equipment',
  },
  permit_confined_space_auth: {
    action: 'permit_confined_space_auth',
    authorizingRole: 'admin',
    reversible: true,
    label: 'Authorize a permit-required confined-space entry',
  },
  permit_hot_work_auth: {
    action: 'permit_hot_work_auth',
    authorizingRole: 'admin',
    reversible: true,
    label: 'Authorize a hot-work permit',
  },
  osha_300a_cert: {
    action: 'osha_300a_cert',
    authorizingRole: 'owner',
    reversible: true,
    label: 'Certify the OSHA 300A annual summary',
  },
  osha_ita_submit: {
    action: 'osha_ita_submit',
    authorizingRole: 'owner',
    reversible: false,
    label: 'Submit 300A data to the OSHA ITA portal (final)',
  },
  capa_high_severity_close: {
    action: 'capa_high_severity_close',
    authorizingRole: 'admin',
    reversible: true,
    label: 'Close a high-severity corrective action',
  },
}

export const ALL_CARVE_OUT_ACTIONS: readonly CarveOutAction[] =
  Object.keys(CARVE_OUT_ACTIONS) as CarveOutAction[]

export function isCarveOutAction(value: string): value is CarveOutAction {
  return Object.prototype.hasOwnProperty.call(CARVE_OUT_ACTIONS, value)
}

export function authorizingRoleFor(action: CarveOutAction): AuthorizingRole {
  return CARVE_OUT_ACTIONS[action].authorizingRole
}

export function isReversibleAction(action: CarveOutAction): boolean {
  return CARVE_OUT_ACTIONS[action].reversible
}
