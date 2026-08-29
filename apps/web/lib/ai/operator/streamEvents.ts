import type { OperatorAgentId } from './types'

// The Operator Console's server→client streaming contract.
//
// Types only — no runtime imports — so the client screen can import the union
// without pulling the Anthropic SDK (or any server code) into the browser
// bundle. The route frames each event as one SSE record: `data: <json>\n\n`.
//
// Ownership of who emits what:
//   - runOrchestrator emits the orchestration MILESTONES as it works:
//     `delegation_start`, `agent_tool_call`, `agent_done`.
//   - the route owns the lifecycle frames: `conversation` (first, so the client
//     can store the id even if a later frame errors), `final` (the synthesized
//     answer, from the orchestrator's return value), and `error`.
//
// Milestone-level, not token-level: the value of this surface is *which*
// specialist was consulted and *what* it found — a handful of discrete steps
// per turn. A future `token` variant can be added without breaking the wire
// format (the client switches on `type` and ignores unknown ones).
export type OperatorStreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'delegation_start'; agentId: OperatorAgentId; title: string; task: string; index: number }
  | { type: 'agent_tool_call'; agentId: OperatorAgentId; tool: string; index: number }
  | { type: 'agent_done'; agentId: OperatorAgentId; index: number; text: string; toolCalls: number; hitLoopCap: boolean }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
