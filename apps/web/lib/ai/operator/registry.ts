import type Anthropic from '@anthropic-ai/sdk'
import { ASSISTANT_TOOLS, type ToolContext, type UserRole } from '@/lib/ai/tools'
import type { OperatorAgentId, OperatorToolDef } from './types'
import { roleMeets } from './types'
import { fileNearMiss, submitBbsObservation } from './writeTools'
import { getHomeConfig, setDefaultLandingPath, setModuleVisibility } from './homeTools'

// The Operator Console tool registry.
//
// Tools are grouped per sub-agent so each model call only ever loads its own
// domain's (role-filtered) toolset — small tool lists keep selection accurate
// and the cached prompt prefix lean. runOperatorTool re-checks the role and
// short-circuits regulated actions into the approval queue.
//
// Slice 1 wired the READ tools by reusing the read-only assistant's existing
// handlers (one definition, imported — never duplicated). Slice 3 adds the
// first hands-free WRITE tools (see ./writeTools); the regulated carve-out
// tools still land in a later slice. The machinery here already supports both
// via ToolScope — runOperatorTool runs read + write inline and refuses regulated.

function refuse(reason: string): string {
  return JSON.stringify({ ok: false, refusal: reason })
}

function fail(message: string): string {
  return JSON.stringify({ ok: false, error: message })
}

// Reuse a read-only handler from the assistant registry, tagged for an operator
// sub-agent. Throws at module load if the source tool was renamed/removed — a
// loud, test-caught failure beats a silently missing capability.
function sharedRead(name: string, agent: OperatorAgentId, minRole: UserRole = 'member'): OperatorToolDef {
  const base = ASSISTANT_TOOLS[name]
  if (!base) {
    throw new Error(`operator registry: shared read tool '${name}' not found in ASSISTANT_TOOLS`)
  }
  return { definition: base.definition, agent, minRole, scope: { kind: 'read' }, handler: base.handler }
}

function byName(defs: OperatorToolDef[]): Record<string, OperatorToolDef> {
  const out: Record<string, OperatorToolDef> = {}
  for (const d of defs) out[d.definition.name] = d
  return out
}

export const OPERATOR_TOOLS: Record<OperatorAgentId, Record<string, OperatorToolDef>> = {
  incidents: byName([
    sharedRead('recent_incidents', 'incidents'),
    sharedRead('near_misses_recent', 'incidents'),
    sharedRead('incident_risk_score', 'incidents'),
    fileNearMiss,
  ]),
  risk: byName([
    sharedRead('list_risks', 'risk'),
    sharedRead('list_jhas', 'risk'),
  ]),
  loto: byName([
    sharedRead('lookup_equipment', 'loto'),
    sharedRead('list_departments', 'loto'),
    sharedRead('active_permits', 'loto'),
  ]),
  permits: byName([
    sharedRead('active_permits', 'permits'),
  ]),
  chem: byName([
    sharedRead('find_chemical', 'chem'),
  ]),
  inspections: byName([
    sharedRead('recent_inspections', 'inspections'),
  ]),
  training: byName([
    sharedRead('training_expiring', 'training'),
  ]),
  bbs: byName([
    sharedRead('bbs_summary', 'bbs'),
    submitBbsObservation,
  ]),
  osha: byName([
    sharedRead('scorecard_kpis', 'osha', 'admin'),
  ]),
  admin: byName([
    sharedRead('list_departments', 'admin', 'admin'),
  ]),
  // Home-config tools (Slice 4, Phase A): inspect, then change the default
  // landing path and per-module visibility. Branding, assistant suggestions, and
  // command-center signals come in a later phase.
  home: byName([
    getHomeConfig,
    setDefaultLandingPath,
    setModuleVisibility,
  ]),
  knowledge: byName([
    sharedRead('compliance_obligations_due', 'knowledge', 'viewer'),
    sharedRead('navigate_to', 'knowledge', 'viewer'),
  ]),
}

/**
 * Anthropic tool schemas for one sub-agent, filtered to what `role` may run.
 * Names are sorted so the tool list (and therefore the cached prompt prefix)
 * is deterministic across calls.
 */
export function getOperatorToolDefinitions(agentId: OperatorAgentId, role: UserRole): Anthropic.Tool[] {
  const reg = OPERATOR_TOOLS[agentId] ?? {}
  return Object.keys(reg)
    .sort()
    .map(k => reg[k])
    .filter(d => roleMeets(role, d.minRole))
    .map(d => d.definition)
}

/**
 * Execute one operator tool. Re-checks the role (defense in depth) and routes
 * regulated, life-safety actions to the human-approval queue rather than
 * running them inline. Returns the JSON string the model sees as tool_result.
 */
export async function runOperatorTool(
  agentId: OperatorAgentId,
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<string> {
  const reg = OPERATOR_TOOLS[agentId]
  if (!reg) return fail(`Unknown operator agent: ${agentId}`)
  const tool = reg[name]
  if (!tool) return fail(`Unknown tool '${name}' for agent '${agentId}'`)

  if (!roleMeets(ctx.role, tool.minRole)) {
    return refuse(`Your role (${ctx.role}) is not permitted to run '${name}'. A ${tool.minRole} can do this.`)
  }

  if (tool.scope.kind === 'regulated') {
    // Carve-out: a regulated, life-safety action is NEVER executed inline. It
    // must be staged for a named human's one-tap approval (the agent_action_queue,
    // shipped in a later slice). Refuse until that path is wired so a regulated
    // tool can never silently take effect.
    return refuse(
      `'${name}' is a regulated action (${tool.scope.action}) that requires approval by a qualified human. ` +
      `The approval queue is not yet enabled in this build.`,
    )
  }

  try {
    return await tool.handler(input, ctx)
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'operator tool handler threw')
  }
}
