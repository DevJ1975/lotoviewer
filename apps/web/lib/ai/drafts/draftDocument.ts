// First-draft generation for regulatory documents: risk assessments, method
// statements, JSA checklists, and incident reports.
//
// RETRIEVE, THEN DRAFT
// The model never writes a citation from memory. Each draft starts with a
// retrieval pass over the knowledge base (lib/ai/rag.ts → knowledge_documents,
// which carries jurisdiction, effective date, and source URL per chunk), the
// retrieved chunks go into the prompt with their ids, and the model is told to
// cite by id. Anything it cites outside that set is stripped by
// resolveCitations() before a human sees it, and the count of what was stripped
// is shown to the reviewer.
//
// This is the highest-liability part of the feature. A method statement with a
// plausible, wrong CFR reference gets signed, filed, and discovered by an
// inspector. A draft with no citations is honest; a draft with an invented one
// is a liability the platform manufactured.
//
// NOTHING HERE WRITES A LIVE RECORD. The draft lands in document_drafts with
// status 'draft'. Accepting it happens through the target module's own reviewed
// write path, which is what stamps provenance on the real row.

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DOCUMENT_DRAFT_LABELS,
  DOCUMENT_DRAFT_PAYLOAD_VERSION,
  requiredSectionsFor,
  resolveCitations,
  validateDraftPayload,
  type DocumentDraftKind,
  type RetrievedSource,
} from '@soteria/core/documentDrafts'
import { getAnthropic } from '@/lib/ai/client'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { logAiInvocation } from '@/lib/ai/rateLimit'
import { retrieveContext } from '@/lib/ai/rag'

const SURFACE = 'draft-regulatory-document' as const
const MODEL = MODEL_BY_SURFACE[SURFACE]
const PROMPT_VERSION = 'v1'
/** Chunks retrieved per draft. Enough to ground the mandatory sections. */
const RETRIEVAL_K = 8

export interface DraftRequest {
  tenantId:     string
  userId:       string
  kind:         DocumentDraftKind
  /** What the document is about, in the requester's words. */
  subject:      string
  /** Required — mandatory sections differ by regime, so it is never inferred. */
  jurisdiction: string
  /** Optional operational context the caller already has (equipment, location). */
  context?:     string
  facilityId?:  string | null
}

export interface DraftOutcome {
  draftId:                 string
  title:                   string
  citations:               RetrievedSource[]
  fabricatedCitationCount: number
  /** True when retrieval returned nothing, so the draft rests on no source. */
  ungrounded:              boolean
}

export class DraftGenerationError extends Error {}

/**
 * Generates one draft and stages it for review.
 *
 * Throws DraftGenerationError for anything the operator can act on (the model
 * returned malformed output, or a payload that fails the shared validator).
 * The caller maps that to a 502 with the message.
 */
export async function draftDocument(
  admin: SupabaseClient,
  req: DraftRequest,
): Promise<DraftOutcome> {
  const retrieval = await retrieveContext({
    query:    `${req.kind} ${req.subject} ${req.jurisdiction}`,
    tenantId: req.tenantId,
    k:        RETRIEVAL_K,
  })

  const sources: RetrievedSource[] = retrieval.chunks.map(chunk => ({
    chunkId:       chunk.chunk_id,
    title:         chunk.title,
    jurisdiction:  chunk.jurisdiction,
    sourceUrl:     chunk.source_url,
    effectiveDate: chunk.effective_date,
  }))

  const client = await getAnthropic(req.tenantId, { timeoutMs: 120_000 })

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 8_000,
    thinking:   { type: 'adaptive' },
    system:     [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: buildBrief(req, sources) }],
    output_config: { format: { type: 'json_schema', schema: schemaFor(req.kind) } },
  })

  await logAiInvocation({
    userId: req.userId, tenantId: req.tenantId, surface: SURFACE, model: MODEL, status: 'success',
    inputTokens:  response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  })

  const generated = parseGenerated(response)
  if (generated === null) throw new DraftGenerationError('The model returned no usable draft.')

  // Strip every citation that does not resolve to a chunk retrieved for THIS
  // draft. There is no lookup to fall back to and no benefit of the doubt.
  const { resolved, rejected } = resolveCitations(generated.citations, sources)

  const envelope = {
    version:      DOCUMENT_DRAFT_PAYLOAD_VERSION,
    kind:         req.kind,
    jurisdiction: req.jurisdiction,
    title:        generated.title,
    body:         generated.body,
    citations:    resolved,
  }

  // Validate with the SAME function the reviewer's read path uses, so a draft
  // can never be stored in a shape the reader will later reject.
  const validation = validateDraftPayload(envelope)
  if (!validation.ok) throw new DraftGenerationError(validation.reason)

  const { data, error } = await admin.from('document_drafts').insert({
    tenant_id:                 req.tenantId,
    facility_id:               req.facilityId ?? null,
    kind:                      req.kind,
    title:                     generated.title,
    jurisdiction:              req.jurisdiction,
    payload:                   envelope,
    payload_version:           DOCUMENT_DRAFT_PAYLOAD_VERSION,
    citation_chunk_ids:        resolved.map(c => c.chunkId),
    fabricated_citation_count: rejected.length,
    status:                    'draft',
    model:                     MODEL,
    prompt_version:            PROMPT_VERSION,
    created_by:                req.userId,
  }).select('id').single()

  if (error || !data) throw new DraftGenerationError(error?.message ?? 'Could not save the draft.')

  return {
    draftId:                 (data as { id: string }).id,
    title:                   generated.title,
    citations:               resolved,
    fabricatedCitationCount: rejected.length,
    ungrounded:              sources.length === 0,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt
// ──────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You write FIRST DRAFTS of safety and regulatory documents for an industrial EHS platform. A qualified safety professional reviews, edits, and signs everything you produce — your job is to save them the blank page, not to make the final call.

CITATIONS — THE RULE THAT MATTERS MOST
You will be given a numbered list of retrieved source excerpts, each with an id. Cite ONLY by those ids, and only when the excerpt actually supports the statement. If nothing you were given supports a point, write the point without a citation. NEVER write a regulation number, section, or standard reference from memory — a wrong citation in a signed document is worse than no citation, because it will be discovered by an inspector rather than by the reviewer.

WRITING
- Write for the crew doing the work, not for a regulator's bookshelf. Short sentences, plain words, active voice.
- Be specific to the job described. Generic filler that could apply to any task wastes the reviewer's time and is the main way a draft becomes worthless.
- Where you do not have enough information, say so plainly in that section rather than inventing a plausible detail. The reviewer can fill a stated gap; they cannot spot a confident fabrication.
- Never name or describe individual workers. Use roles.
- Apply the hierarchy of controls: elimination, substitution, engineering, administrative, then PPE. Do not reach for PPE when an engineering control is available.`

function buildBrief(req: DraftRequest, sources: readonly RetrievedSource[]): string {
  const lines = [
    `Document type: ${DOCUMENT_DRAFT_LABELS[req.kind]}`,
    `Jurisdiction: ${req.jurisdiction}`,
    `Subject: ${req.subject}`,
  ]
  if (req.context) lines.push('', `Operational context:\n${req.context}`)

  lines.push('', 'Retrieved sources you may cite:')
  if (sources.length === 0) {
    lines.push('(none — nothing in the knowledge base matched. Write the draft without citations and do not invent any.)')
  } else {
    for (const source of sources) {
      const meta = [source.jurisdiction, source.effectiveDate].filter(Boolean).join(', ')
      lines.push(`- id=${source.chunkId} | ${source.title}${meta ? ` (${meta})` : ''}`)
    }
  }

  lines.push(
    '',
    `Produce the draft. Required sections: ${requiredSectionsFor(req.kind).join(', ')}.`,
    'List in `citations` the ids of the sources you actually relied on — an id you were not given above will be discarded.',
  )
  return lines.join('\n')
}

// One schema per kind. They diverge because the documents genuinely diverge: a
// method statement's steps carry a responsible role and hierarchy-placed
// controls, an incident report has a sequence and immediate actions. Forcing
// them into one shape would produce a schema that describes none of them.
function schemaFor(kind: DocumentDraftKind) {
  const stringArray = (description: string) =>
    ({ type: 'array', maxItems: 12, items: { type: 'string' }, description }) as const

  const bodyByKind = {
    risk_assessment: {
      type: 'object',
      required: [...requiredSectionsFor('risk_assessment')],
      additionalProperties: false,
      properties: {
        scope:              { type: 'string', description: 'What this assessment covers, and what it does not.' },
        hazards:            stringArray('Each hazard identified, one per entry.'),
        existingControls:   stringArray('Controls already in place.'),
        additionalControls: stringArray('Further controls recommended, highest on the hierarchy first.'),
      },
    },
    method_statement: {
      type: 'object',
      required: [...requiredSectionsFor('method_statement')],
      additionalProperties: false,
      properties: {
        scope: { type: 'string', description: 'What the job covers, and what it does not.' },
        steps: {
          type: 'array', maxItems: 20,
          items: {
            type: 'object',
            required: ['sequence', 'description', 'hazards', 'controls', 'responsibleRole'],
            additionalProperties: false,
            properties: {
              sequence:        { type: 'integer', minimum: 1 },
              description:     { type: 'string', description: 'One action, imperative, active voice.' },
              hazards:         stringArray('Hazards this step introduces or exposes.'),
              controls: {
                type: 'array', maxItems: 6,
                items: {
                  type: 'object',
                  required: ['description', 'hierarchyLevel'],
                  additionalProperties: false,
                  properties: {
                    description:    { type: 'string' },
                    hierarchyLevel: { type: 'string', enum: ['elimination', 'substitution', 'engineering', 'administrative', 'ppe'] },
                  },
                },
              },
              responsibleRole: { type: 'string', description: 'A role, never a named individual.' },
            },
          },
        },
        ppe:                   stringArray('PPE required across the whole job.'),
        emergencyArrangements: { type: 'string', description: 'Rescue, isolation, first aid, and who to call.' },
      },
    },
    jsa_checklist: {
      type: 'object',
      required: [...requiredSectionsFor('jsa_checklist')],
      additionalProperties: false,
      properties: {
        task: { type: 'string' },
        steps: {
          type: 'array', maxItems: 20,
          items: {
            type: 'object',
            required: ['description', 'hazards', 'controls'],
            additionalProperties: false,
            properties: {
              description: { type: 'string' },
              hazards:     stringArray('Hazards in this step.'),
              controls:    stringArray('Controls for this step.'),
            },
          },
        },
      },
    },
    incident_report: {
      type: 'object',
      required: [...requiredSectionsFor('incident_report')],
      additionalProperties: false,
      properties: {
        summary:          { type: 'string', description: 'What happened, factually, in a few sentences.' },
        sequence:         stringArray('The events in order, one per entry.'),
        immediateActions: stringArray('What was done at the time to make it safe.'),
      },
    },
  } as const

  return {
    type: 'object',
    required: ['title', 'body', 'citations'],
    additionalProperties: false,
    properties: {
      title:     { type: 'string', description: 'A specific title naming the job or event.' },
      body:      bodyByKind[kind],
      citations: {
        type: 'array', maxItems: 12,
        items: { type: 'string', description: 'An id from the retrieved sources list.' },
      },
    },
  } as const
}

interface GeneratedDraft {
  title:     string
  body:      Record<string, unknown>
  citations: unknown[]
}

function parseGenerated(response: Anthropic.Message): GeneratedDraft | null {
  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') return null
  try {
    const parsed = JSON.parse(block.text) as Partial<GeneratedDraft>
    if (typeof parsed.title !== 'string' || typeof parsed.body !== 'object' || parsed.body === null) {
      return null
    }
    return {
      title:     parsed.title,
      body:      parsed.body as Record<string, unknown>,
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    }
  } catch {
    return null
  }
}
