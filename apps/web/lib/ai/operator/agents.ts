import { OPUS, SONNET, type ModelId } from '@/lib/ai/models'
import type { AiSurface } from '@/lib/ai/rateLimit'
import type { UserRole } from '@/lib/ai/tools'
import type { OperatorAgentId } from './types'

// Catalog of the Operator Console's domain sub-agents.
//
// Single source of truth for: which model each agent runs on (barbell routing —
// Opus for the agents that contain life-safety carve-out actions + the
// orchestrator; Sonnet for the rest), the AI surface used for rate-limiting +
// cost attribution, the minimum role to interact with the agent at all, and the
// one-line purpose the orchestrator reads when deciding where to route.
//
// Every `surface` here MUST exist in lib/ai/models.ts MODEL_BY_SURFACE and
// lib/ai/rateLimit.ts AI_LIMITS — a unit test asserts the three stay in sync.

export const ORCHESTRATOR_SURFACE: AiSurface = 'operator-orchestrator'

export interface OperatorAgentSpec {
  id: OperatorAgentId
  surface: AiSurface
  model: ModelId
  /** Human label, e.g. "Incidents & Near-Miss agent". */
  title: string
  /** What this agent does — used verbatim in the orchestrator's delegate-tool
   *  description and as the seed of the sub-agent's own system prompt. */
  purpose: string
  /** Minimum role to interact with this agent. Most are 'member' (or 'viewer'
   *  for read-only knowledge); admin-centric agents (osha, admin, home) are
   *  'admin'. Individual tools further restrict via their own minRole. */
  minRole: UserRole
}

export const OPERATOR_AGENTS: Record<OperatorAgentId, OperatorAgentSpec> = {
  incidents: {
    id: 'incidents',
    surface: 'operator-incidents',
    model: SONNET,
    title: 'Incidents & Near-Miss agent',
    purpose: 'Files and reads incidents and near-misses, classifies them, escalates near-misses to risks, and manages corrective actions (CAPAs). Closing a HIGH-severity CAPA is staged for human approval.',
    minRole: 'member',
  },
  risk: {
    id: 'risk',
    surface: 'operator-risk',
    model: SONNET,
    title: 'Risk & JHA agent',
    purpose: 'Reads and maintains the risk register and Job Hazard Analyses: create/update risks, mark reviews complete, attach controls.',
    minRole: 'member',
  },
  loto: {
    id: 'loto',
    surface: 'operator-loto',
    model: OPUS,
    title: 'LOTO & Audit agent',
    purpose: 'Looks up equipment and energy-control procedures and runs the multi-agent LOTO audit. Certifying a zero-energy state is staged for an authorized human.',
    minRole: 'member',
  },
  permits: {
    id: 'permits',
    surface: 'operator-permits',
    model: OPUS,
    title: 'Permits agent',
    purpose: 'Reads and drafts confined-space and hot-work permits. Authorizing a permit-to-work is staged for a qualified permit authorizer.',
    minRole: 'member',
  },
  chem: {
    id: 'chem',
    surface: 'operator-chem',
    model: SONNET,
    title: 'Chemicals & SDS agent',
    purpose: 'Searches the chemical inventory and SDS library, adds/updates chemicals, and approves pending container requests.',
    minRole: 'member',
  },
  inspections: {
    id: 'inspections',
    surface: 'operator-inspections',
    model: SONNET,
    title: 'Inspections agent',
    purpose: 'Runs inspections from templates and records results; admins build and edit inspection templates.',
    minRole: 'member',
  },
  training: {
    id: 'training',
    surface: 'operator-training',
    model: SONNET,
    title: 'Training agent',
    purpose: 'Reads training/certification records and expiry, records training, and schedules expiry reminders.',
    minRole: 'member',
  },
  bbs: {
    id: 'bbs',
    surface: 'operator-bbs',
    model: SONNET,
    title: 'Behavior-Based Safety agent',
    purpose: 'Summarizes BBS observations and the safe-to-unsafe ratio, submits observations, and closes them out.',
    minRole: 'member',
  },
  osha: {
    id: 'osha',
    surface: 'operator-osha',
    model: OPUS,
    title: 'OSHA Recordkeeping agent',
    purpose: 'Reads OSHA 300/300A/301 records and headline KPIs and edits case fields. Certifying the 300A and submitting to the ITA portal are staged for executive approval.',
    minRole: 'admin',
  },
  admin: {
    id: 'admin',
    surface: 'operator-admin',
    model: SONNET,
    title: 'Admin & Config agent',
    purpose: 'Manages users and members, notification channels and rules, policies, and tenant settings. Role escalation is owner-gated.',
    minRole: 'admin',
  },
  home: {
    id: 'home',
    surface: 'operator-home',
    model: SONNET,
    title: 'Home-Config agent',
    purpose: 'Reconfigures the home page: default landing path, module visibility, command-center signals/cards, assistant suggestions, and branding.',
    minRole: 'admin',
  },
  knowledge: {
    id: 'knowledge',
    surface: 'operator-knowledge',
    model: SONNET,
    title: 'Knowledge & Compliance agent',
    purpose: 'Answers regulation/policy questions grounded in the tenant knowledge base, surfaces due compliance obligations, and points to the right in-app page. Read-only.',
    minRole: 'viewer',
  },
}

export function operatorAgentList(): OperatorAgentSpec[] {
  return Object.values(OPERATOR_AGENTS)
}

/** Agents this role is allowed to interact with at all (per-agent minRole). */
export function operatorAgentsForRole(roleMeetsFn: (minRole: UserRole) => boolean): OperatorAgentSpec[] {
  return operatorAgentList().filter(a => roleMeetsFn(a.minRole))
}
