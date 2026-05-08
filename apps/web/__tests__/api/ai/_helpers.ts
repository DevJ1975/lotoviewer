// Shared harness for the AI route tests under __tests__/api/ai/.
//
// Pattern (matches superadmin/_helpers.ts):
//   1. import this BEFORE the route file
//   2. Call gateOk() / rateLimitOk() / queueAnthropic(...) to seed state
//   3. Import the route handler dynamically and invoke
//
// Why a custom harness here instead of reusing _helpers.ts: the AI
// routes use requireTenantMember (not requireSuperadmin) and need an
// Anthropic client mock. vi.mock is hoisted per file so the two
// harnesses don't share scope cleanly.

import { vi } from 'vitest'

// ── tenant gate ───────────────────────────────────────────────────────
export const requireTenantMemberMock = vi.fn()

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (req: Request) => requireTenantMemberMock(req),
  requireTenantAdmin:  (req: Request) => requireTenantMemberMock(req),
}))

export function gateOk(opts: Partial<{
  userId:    string
  tenantId:  string
  userEmail: string
  role:      'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'
}> = {}) {
  requireTenantMemberMock.mockResolvedValue({
    ok:           true,
    userId:       opts.userId    ?? 'user-1',
    tenantId:     opts.tenantId  ?? 'tenant-1',
    userEmail:    opts.userEmail ?? 'u@example.com',
    role:         opts.role      ?? 'member',
    authedClient: {} as never,
  })
}

export function gateRejects(status: number, message: string) {
  requireTenantMemberMock.mockResolvedValue({ ok: false, status, message })
}

// ── rate limit + invocation logger ────────────────────────────────────
export const checkAiRateLimitMock = vi.fn()
export const logAiInvocationMock  = vi.fn()

vi.mock('@/lib/ai/rateLimit', async () => {
  // Preserve the AI_LIMITS export — some routes don't import it but
  // tests may want to reference it. Re-import the real module to
  // pass through anything we don't override.
  const actual = await vi.importActual<typeof import('@/lib/ai/rateLimit')>('@/lib/ai/rateLimit')
  return {
    ...actual,
    checkAiRateLimit: (a: unknown) => checkAiRateLimitMock(a),
    logAiInvocation:  (a: unknown) => logAiInvocationMock(a),
  }
})

export function rateLimitOk() {
  checkAiRateLimitMock.mockResolvedValue({ ok: true })
}
export function rateLimitBlocks(reason: 'hourly' | 'daily', retryAfterSec = 60) {
  checkAiRateLimitMock.mockResolvedValue({ ok: false, reason, retryAfterSec })
}

// ── Anthropic SDK ─────────────────────────────────────────────────────
// Each test queues one or more responses; messages.create() shifts
// from the queue. Throwing values are also supported (use queueAnthropicError).
type AnthropicResult =
  | { ok: true;  value: unknown }
  | { ok: false; error: unknown }

// Capture shape of the Anthropic args we care about in assertions.
export interface AnthropicCreateArgs {
  model?:    string
  system?:   string
  messages:  Array<{
    role?: string
    content: Array<{
      type:    string
      text?:   string
      source?: { type: string; url?: string; media_type?: string; data?: string }
    }>
  }>
  [k: string]: unknown
}

const anthropicQueue: AnthropicResult[] = []
export const messagesCreateMock = vi.fn(async (_args: AnthropicCreateArgs) => {
  const next = anthropicQueue.shift()
  if (!next) throw new Error('No queued Anthropic response — test forgot to queueAnthropic*')
  if (!next.ok) throw next.error
  return next.value
})

// ── getTenantApiKey ──────────────────────────────────────────────────
// The route handlers short-circuit with 503 if getTenantApiKey()
// returns empty. Default the mock to a well-formed-looking key so
// existing tests don't trip the new gate; tests for the
// missing-key path use returnEmptyApiKey() below.
export const getTenantApiKeyMock = vi.fn(async () => 'sk-ant-test-' + 'a'.repeat(40))

vi.mock('@/lib/ai/getTenantApiKey', () => ({
  getTenantApiKey: (tenantId: string | null) => getTenantApiKeyMock(tenantId),
  // Re-export the shape validator with its real implementation so
  // anything that imports it directly still gets the production
  // behavior (currently nothing in tests does, but the module's
  // public surface stays stable).
  looksLikeAnthropicKey: (s: string) => s.startsWith('sk-ant-') && s.length >= 30,
}))

export function returnEmptyApiKey() {
  getTenantApiKeyMock.mockResolvedValueOnce('')
}

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreateMock }
  }
  // The route does `err instanceof Anthropic.RateLimitError` etc.
  // Provide stubs so those checks compile + can be hit explicitly.
  class APIError       extends Error { status = 502 }
  class RateLimitError extends APIError { constructor() { super('rate limit'); this.status = 429 } }
  return {
    default: Object.assign(MockAnthropic, { APIError, RateLimitError }),
    APIError,
    RateLimitError,
  }
})

export function queueAnthropic(text: string, usage = { input_tokens: 100, output_tokens: 50 }) {
  anthropicQueue.push({
    ok: true,
    value: {
      content: [{ type: 'text', text }],
      usage,
      stop_reason: 'end_turn',
    },
  })
}

export function queueAnthropicRaw(value: unknown) {
  anthropicQueue.push({ ok: true, value })
}

export function queueAnthropicError(err: unknown) {
  anthropicQueue.push({ ok: false, error: err })
}

// ── Sentry passthrough ────────────────────────────────────────────────
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage:   vi.fn(),
}))

// ── Reset between tests ───────────────────────────────────────────────
export function resetAiMocks() {
  requireTenantMemberMock.mockReset()
  checkAiRateLimitMock.mockReset()
  logAiInvocationMock.mockReset()
  messagesCreateMock.mockClear()
  getTenantApiKeyMock.mockReset()
  anthropicQueue.length = 0
  // Default happy-path setup; individual tests can override.
  gateOk()
  rateLimitOk()
  // Restore the default well-formed key — getTenantApiKeyMock.mockReset()
  // wipes the value above, so reinstall it on every reset.
  getTenantApiKeyMock.mockResolvedValue('sk-ant-test-' + 'a'.repeat(40))
}
