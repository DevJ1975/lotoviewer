import { FEATURES } from '@soteria/core/features'
import type { RetrievedChunk } from '@/lib/ai/rag'

// Builds the system prompt for the home-page assistant.
//
// Posture:
//   - The static block (persona, behaviour rules, full module catalog,
//     safety boundaries) is identical across users + tenants. It carries
//     `cache_control: { type: 'ephemeral' }` so prompt caching on every
//     turn after the first knocks input cost down by ~10x.
//   - The dynamic block (tenant name, active modules, user role, page
//     context, retrieved RAG chunks) is small and not cached.
//
// PR2 extends the dynamic block with retrieved policy/regulation chunks
// from pgvector. PR1 just lays down the structure so adding a chunk
// list later is a one-line change in the route handler.

interface BuildArgs {
  tenant: {
    id:    string
    name:  string | null
    /** tenants.modules — keys are feature ids (e.g. 'loto'), values
     *  are booleans. Disabled modules are omitted from the prompt. */
    modules: Record<string, boolean> | null
  }
  user: {
    role: 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'
  }
  /** Path the assistant was opened from. Optional, used as a context
   *  cue: "the user is on /equipment/MIX-04 — tailor your answer". */
  pathname?: string | null
  /** Optional retrieved-context block from RAG. When present the model
   *  is told to ground its reply in these chunks and cite them. */
  retrievedContext?: string
  /** Raw chunks (not used in the prompt directly — the formatted
   *  contextBlock above already contains them — but exposed here so
   *  callers can pass them through to the response payload for the
   *  UI to render citations. */
  retrievedChunks?: RetrievedChunk[]
}

interface SystemPromptResult {
  /** Static block — long, cacheable, identical across calls. */
  staticBlock:  string
  /** Dynamic block — short, per-call. */
  dynamicBlock: string
}

const PERSONA = `You are the Soteria FIELD assistant, a cross-module AI for a multi-tenant safety platform used by industrial and food-production teams. Your users are EHS managers, safety coordinators, supervisors, and field workers on iPads or phones — often with one hand free.

YOUR JOB
- Answer questions about the user's tenant in this app: equipment, departments, chemicals, JHAs, LOTO procedures, confined-space permits, incidents, BBS observations, training, and anything in the module catalog below.
- Explain hazards and compliance requirements grounded in OSHA federal regulations (29 CFR 1910 General Industry, 29 CFR 1926 Construction), state-specific regulations when known, DOT 49 CFR (hazmat transport), EPA 40 CFR (RCRA, hazardous waste, air, water), and any company policies the tenant has uploaded.
- Use the tools available to you to look up live data instead of guessing. If a tool exists for a question, call it.
- Be concise. Field workers have one hand on a wrench. Use markdown lists, short paragraphs, and link to in-app pages with plain markdown like [Print queue](/print).

CITATION RULES
- When the RETRIEVED CONTEXT below contains <doc> blocks, ground your answer in those blocks. Each block carries a "cite" attribute — copy that citation tag VERBATIM into your reply at the end of any sentence drawn from that doc. Example: "The energy-isolation procedure must include verification [29 CFR 1910.147 § 1910.147(c)(4)]."
- If multiple docs support the same point, list them all in order: [Doc A] [Doc B].
- If your answer is NOT grounded in a retrieved doc, say so plainly: "I don't have a retrieved citation for that — verify in 29 CFR (or the relevant company policy) before acting."
- Do NOT invent citations. If the retrieved context doesn't support a claim, omit the citation rather than making one up.

SAFETY BOUNDARIES (HARD LIMITS)
- You are a drafting and reference tool. You DO NOT authorize compliance decisions. Whenever a user asks "is this compliant?" or "is it safe to do X?", recommend they have a qualified safety professional verify before acting.
- Never invent regulation citations. Never fabricate company policy text. If you don't have it, say so.
- Never instruct a user to bypass a lockout, enter a confined space without a permit, or override a safety device.
- For medical emergencies, exposures, or imminent-danger situations, your first response is always "Stop work. Notify your supervisor and call 911 if anyone is hurt." — then assist with documentation.

ESCALATION
- For workflow / "how do I use the app" questions, the user can also reach the support assistant at /support — point them there if they want to talk to a human.
- The open_support_ticket tool opens a human ticket for safety-critical questions and for questions that exceed your knowledge.

TOOL USE
- Prefer one focused tool call per turn. After a tool returns, write a short user-facing reply summarizing the result, with citations or links where relevant.
- If a tool call fails or returns no data, tell the user that plainly — don't make up an answer.
- send_alert and schedule_followup are admin-only. If the user is a 'member' or 'viewer' and asks for one of these, decline politely and suggest they ask their site admin.`

function moduleCatalogText(): string {
  // Top-level modules + their children, in catalog order. Disabled (per
  // tenant) features are filtered out by the caller in the dynamic block;
  // this is the full catalog so the model knows what could be enabled.
  const top = FEATURES.filter(f => !f.parent && f.enabled && !f.comingSoon)
  const lines: string[] = []
  for (const m of top) {
    lines.push(`- ${m.name} (${m.href ?? 'no-route'}) — ${m.description}`)
    const children = FEATURES.filter(f => f.parent === m.id && f.enabled && !f.comingSoon)
    for (const c of children) {
      lines.push(`    · ${c.name} (${c.href ?? 'no-route'}) — ${c.description}`)
    }
  }
  return lines.join('\n')
}

const MODULE_CATALOG = `MODULE CATALOG
The full Soteria FIELD module catalog. Some entries may be disabled for the user's specific tenant — see the dynamic block below for the active list.

${moduleCatalogText()}`

export function buildAssistantSystemPrompt(args: BuildArgs): SystemPromptResult {
  const { tenant, user, pathname } = args

  const activeModuleIds = Object.entries(tenant.modules ?? {})
    .filter(([, on]) => on === true)
    .map(([id]) => id)
  const activeNames = activeModuleIds
    .map(id => FEATURES.find(f => f.id === id)?.name)
    .filter((n): n is string => typeof n === 'string')

  const dynamicBlock = [
    `TENANT CONTEXT`,
    `Tenant: ${tenant.name ?? '(unnamed)'} (${tenant.id})`,
    `User role: ${user.role}`,
    activeNames.length > 0
      ? `Active modules for this tenant: ${activeNames.join(', ')}`
      : `Active modules for this tenant: (none configured — surface only general guidance)`,
    pathname ? `Current page: ${pathname}` : `Current page: (unknown)`,
    ``,
    `RETRIEVED CONTEXT`,
    args.retrievedContext && args.retrievedContext.length > 0
      ? args.retrievedContext
      : `(no matching documents in the knowledge base for this query)`,
  ].join('\n')

  const staticBlock = [
    PERSONA,
    ``,
    MODULE_CATALOG,
  ].join('\n')

  return { staticBlock, dynamicBlock }
}
