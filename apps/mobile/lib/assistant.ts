import { apiBase, authHeaders } from '@/lib/api'

// Mobile client for the safety assistant. Reuses the web endpoint
// (POST /api/assistant/chat) so the Anthropic key, tool-use loop, and RAG
// retrieval all stay server-side — the app just sends a message and renders
// the reply + citations. Non-streaming: one request, one JSON reply.

export interface AssistantCitation {
  document_id:  string
  chunk_index:  number
  title:        string
  source_type:  string
  jurisdiction: string | null
  source_url:   string | null
  similarity:   number
}

export interface AssistantReply {
  conversationId: string
  messageId:      string | null
  reply:          string
  citations:      AssistantCitation[]
  stopReason:     string | null
}

export interface SendAssistantMessageArgs {
  tenantId:        string
  message:         string
  /** Pass the id returned by the previous turn to continue the thread. */
  conversationId?: string | null
}

export async function sendAssistantMessage(args: SendAssistantMessageArgs): Promise<AssistantReply> {
  const res = await fetch(`${apiBase()}/api/assistant/chat`, {
    method:  'POST',
    headers: await authHeaders(args.tenantId),
    body: JSON.stringify({
      message:        args.message,
      conversationId: args.conversationId ?? undefined,
      pathname:       'mobile/assistant',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Fold the rate-limit retry hint into the message so the screen can show a
    // single human string without special-casing 429.
    const retry = typeof body.retryAfterSec === 'number'
      ? ` Try again in ${Math.max(1, Math.ceil(body.retryAfterSec / 60))} min.`
      : ''
    throw new Error((body.error ?? `Request failed (${res.status})`) + retry)
  }
  return body as AssistantReply
}

// Citations arrive per-chunk, so the same document can repeat. Collapse to one
// entry per document (first occurrence wins) for a clean source list.
export function dedupeCitations(citations: AssistantCitation[]): AssistantCitation[] {
  const seen = new Set<string>()
  const out: AssistantCitation[] = []
  for (const c of citations) {
    if (seen.has(c.document_id)) continue
    seen.add(c.document_id)
    out.push(c)
  }
  return out
}
