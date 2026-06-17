import type Anthropic from '@anthropic-ai/sdk'
import type { ToolContext, UserRole } from '@/lib/ai/tools'
import type { CarveOutAction } from '@soteria/core/operatorActions'

// Core types for the Operator Console's multi-agent tool layer.
//
// The Operator Console is a dedicated, hands-free chat surface (separate from
// the read-only home assistant) where an Opus orchestrator delegates to domain
// SUB-AGENTS. Each sub-agent owns a small toolset. This file defines the tool
// shape those sub-agents share, plus role-ranking so a tool a user's role can't
// run is omitted from the schema the model ever sees.

// The 12 domain sub-agents. The orchestrator routes to one of these (or answers
// trivial cross-module reads itself). Kept in lockstep with OPERATOR_AGENTS in
// ./agents and the operator-* surfaces in lib/ai/{models,rateLimit}.
export type OperatorAgentId =
  | 'incidents'
  | 'risk'
  | 'loto'
  | 'permits'
  | 'chem'
  | 'inspections'
  | 'training'
  | 'bbs'
  | 'osha'
  | 'admin'
  | 'home'
  | 'knowledge'

// How a tool behaves when invoked:
//   read      — a query; always safe, executes for any role that meets minRole.
//   write     — an ordinary, autonomous mutation; executes hands-free.
//   regulated — a legally-gated, life-safety action; NEVER executes inline.
//               runOperatorTool routes it to the human-approval queue.
export type ToolScope =
  | { kind: 'read' }
  | { kind: 'write' }
  | { kind: 'regulated'; action: CarveOutAction }

export interface OperatorToolDef {
  definition: Anthropic.Tool
  /** Which sub-agent owns this tool. */
  agent: OperatorAgentId
  /** Minimum role allowed to see + run this tool. Below this, the loader omits
   *  the tool from the model's schema entirely (defense in depth: runOperatorTool
   *  re-checks, and the handler/DB enforce too). */
  minRole: UserRole
  scope: ToolScope
  /** Returns a string the model sees as the tool_result. Same contract as the
   *  read-only assistant's ToolDef.handler. */
  handler: (input: unknown, ctx: ToolContext) => Promise<string>
}

// Role ranking. Higher rank can do everything a lower rank can. Mirrors the
// tenantGate semantics: an 'admin'-gated capability is open to admin, owner,
// and superadmin; an 'owner'-gated one (e.g. role escalation, OSHA executive
// certification) is open only to owner + superadmin.
const ROLE_RANK: Record<UserRole, number> = {
  viewer:     0,
  member:     1,
  admin:      2,
  owner:      3,
  superadmin: 4,
}

export function roleRank(role: UserRole): number {
  return ROLE_RANK[role] ?? 0
}

/** True when `role` is at least `minRole` in the ranking above. */
export function roleMeets(role: UserRole, minRole: UserRole): boolean {
  return roleRank(role) >= roleRank(minRole)
}
