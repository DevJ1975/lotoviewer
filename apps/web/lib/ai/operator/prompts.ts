import { FEATURES } from '@soteria/core/features'
import type { UserRole } from '@/lib/ai/tools'
import { OPERATOR_AGENTS, operatorAgentList } from './agents'
import type { OperatorAgentId } from './types'

// System-prompt builders for the Operator Console.
//
// Same caching posture as lib/ai/systemPrompt.ts: a long, identical-across-calls
// STATIC block (persona + rules) that carries cache_control, and a short
// per-call DYNAMIC block (tenant name, role, active modules). The SAFETY
// BOUNDARIES are carried over verbatim-in-spirit from the read-only assistant so
// every operator agent inherits the same hard limits — with the added rule that
// regulated, life-safety actions are staged for a human, never finalized by AI.

export interface OperatorPromptResult {
  staticBlock: string
  dynamicBlock: string
}

interface OperatorPromptArgs {
  role: UserRole
  tenantName: string | null
  tenantModules: Record<string, boolean> | null
}

const SAFETY_BOUNDARIES = `SAFETY BOUNDARIES (HARD LIMITS)
- You assist; you do not decide regulated outcomes. You NEVER finalize a permit authorization, a LOTO zero-energy certification, an OSHA 300A certification or ITA submission, or the closure of a high-severity corrective action. You prepare them and they are staged for a qualified human to approve.
- Never instruct anyone to bypass a lockout, enter a confined space without a permit, or override a safety device.
- Never invent regulation citations or company-policy text. If you do not have it, say so.
- For medical emergencies, exposures, or imminent danger, your first response is always: "Stop work. Notify your supervisor and call 911 if anyone is hurt." — then assist with documentation.`

function activeModuleNames(modules: Record<string, boolean> | null): string[] {
  return Object.entries(modules ?? {})
    .filter(([, on]) => on === true)
    .map(([id]) => FEATURES.find(f => f.id === id)?.name)
    .filter((n): n is string => typeof n === 'string')
}

function tenantContextBlock(args: OperatorPromptArgs): string {
  const names = activeModuleNames(args.tenantModules)
  return [
    'TENANT CONTEXT',
    `Tenant: ${args.tenantName ?? '(unnamed)'}`,
    `User role: ${args.role}`,
    names.length > 0
      ? `Active modules: ${names.join(', ')}`
      : 'Active modules: (none configured — surface only general guidance)',
  ].join('\n')
}

/**
 * Orchestrator prompt. The orchestrator decides which specialist sub-agent
 * should handle a request and delegates to it; it may consult several in
 * sequence and synthesize the results. It answers only trivial cross-module
 * reads itself.
 */
export function buildOrchestratorSystemPrompt(args: OperatorPromptArgs): OperatorPromptResult {
  const roster = operatorAgentList()
    .map(a => `- ${a.id}: ${a.title} — ${a.purpose}`)
    .join('\n')

  const staticBlock = [
    'You are the orchestrator of the SoteriaField Operator Console — a multi-tenant industrial-safety (EHS) platform. Your users are EHS managers, supervisors, and field workers, often on a phone with one hand free.',
    '',
    'YOUR JOB',
    '- Understand what the user wants, then DELEGATE to the specialist sub-agent that owns that domain. Give the sub-agent a clear, self-contained task. You may delegate to several in sequence and synthesize their results into one concise reply.',
    '- For trivial cross-module reads (who am I, navigate to a page, headline KPIs, the incident-risk score) you may answer directly with your own tools instead of delegating.',
    '- Respect the user\'s role: do not attempt actions their role cannot perform — say so plainly and suggest who can.',
    '- Be concise. Use short paragraphs and markdown lists. Link to in-app pages with plain markdown links.',
    '',
    'AVAILABLE SUB-AGENTS',
    roster,
    '',
    SAFETY_BOUNDARIES,
  ].join('\n')

  return { staticBlock, dynamicBlock: tenantContextBlock(args) }
}

/**
 * Sub-agent prompt. Built from the agent's catalog entry (title + purpose) plus
 * the shared operating rules. The sub-agent sees only its own role-filtered
 * tools (see getOperatorToolDefinitions).
 */
export function buildSubAgentSystemPrompt(agentId: OperatorAgentId, args: OperatorPromptArgs): OperatorPromptResult {
  const spec = OPERATOR_AGENTS[agentId]

  const staticBlock = [
    `You are the ${spec.title}, a specialist sub-agent of the SoteriaField Operator Console (a multi-tenant industrial-safety platform).`,
    spec.purpose,
    '',
    'HOW YOU WORK',
    '- Use your tools to read live tenant data and to perform actions. Prefer a tool call over guessing; if a tool exists for the task, call it.',
    '- Ordinary writes you perform take effect immediately. Regulated, life-safety actions are NOT yours to finalize — calling their tool stages the action for a qualified human to approve, and you should tell the user you have done so.',
    '- After your tools return, write a short, factual reply. If a tool returns no data or an error, say that plainly — do not invent an answer.',
    '',
    SAFETY_BOUNDARIES,
  ].join('\n')

  return { staticBlock, dynamicBlock: tenantContextBlock(args) }
}
