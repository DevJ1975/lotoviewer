// xAPI 1.0.3 (Experience API / Tin Can) type definitions.
// Spec: https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Data.md
//
// Only the fields Soteria emits are typed here — the spec allows many
// more (attachments, signed statements, sub-statements). YAGNI: add
// them when a real customer flow needs them.

export interface XapiAgent {
  objectType?: 'Agent'
  name?: string
  // The "Inverse Functional Identifier" — exactly ONE of these is
  // required by the spec. We standardize on mbox (mailto:) so the LRS
  // can correlate statements to a learner without us coining an
  // account namespace per tenant.
  mbox?: string                          // "mailto:user@example.com"
  account?: { homePage: string; name: string }
}

export interface XapiVerb {
  // Verb IRIs are immutable identifiers. The ADL-defined set lives at
  // http://adlnet.gov/expapi/verbs/ — we use those where they fit and
  // mint Soteria-namespaced IRIs for domain-specific events.
  id: string
  display: Record<string, string>        // { 'en-US': 'completed' }
}

export interface XapiActivityDefinition {
  name?: Record<string, string>
  description?: Record<string, string>
  type?: string
  extensions?: Record<string, unknown>
}

export interface XapiActivity {
  objectType?: 'Activity'
  id: string                             // IRI
  definition?: XapiActivityDefinition
}

export interface XapiResult {
  completion?: boolean
  success?: boolean
  response?: string
  score?: { scaled?: number; raw?: number; min?: number; max?: number }
  duration?: string                      // ISO 8601 duration
  extensions?: Record<string, unknown>
}

export interface XapiContext {
  registration?: string                  // UUID, links related statements
  platform?: string
  language?: string
  extensions?: Record<string, unknown>
}

export interface XapiStatement {
  id: string                             // UUID v4 — LRS dedupes on this
  actor: XapiAgent
  verb: XapiVerb
  object: XapiActivity
  result?: XapiResult
  context?: XapiContext
  timestamp: string                      // ISO 8601
}

// Configuration row read from public.loto_xapi_endpoints.
export interface XapiEndpoint {
  id: string
  tenantId: string
  endpointUrl: string
  authKey: string
  authSecret: string
  version: string
  active: boolean
}

// Outcome from posting a single statement to an LRS.
export type XapiPostResult =
  | { ok: true;  status: number; body: string }
  | { ok: false; status: number; body: string; error: string }
