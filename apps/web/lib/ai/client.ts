import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'
import { getTenantApiKey, MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'

// Shared Anthropic client wrapper.
//
// Every AI route used to do:
//
//   const apiKey = await getTenantApiKey(tenantId)
//   const client = new Anthropic({ apiKey })
//   const response = await client.messages.create({ ... })
//
// That left each route owning its own timeout, retry, and missing-key
// handling — and they drifted. This module collapses all three into one
// place. Routes now do:
//
//   const client = await getAnthropic(tenantId)        // throws on missing/bad key
//   const response = await client.messages.create({ ... })
//
// Defaults: 30s request timeout, 2 retries on transient 5xx + network
// errors (NOT 429 — those propagate so the caller can return a clean
// 429 to the user). The SDK's own retry runs first; this wrapper just
// pins sensible defaults so every surface gets the same posture.

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 2

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not configured for this deployment.')
    this.name = 'AnthropicNotConfiguredError'
  }
}

/**
 * Returns an Anthropic SDK client configured for the given tenant.
 *
 * Throws:
 *   - MalformedTenantKeyError — tenant has an override key, but it's
 *     mangled (truncated, wrong prefix). Surfacing this fast is the
 *     point: silently falling back to env hid "AI works for some
 *     tenants, not others" bugs that took days to diagnose.
 *   - AnthropicNotConfiguredError — neither tenant nor env has a key.
 *
 * Routes catch these and return 502/500 with a clear operator message.
 */
export async function getAnthropic(tenantId: string | null): Promise<Anthropic> {
  const apiKey = await getTenantApiKey(tenantId)
  if (!apiKey) throw new AnthropicNotConfiguredError()
  return new Anthropic({
    apiKey,
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
  })
}

/**
 * Maps an Anthropic SDK / wrapper error to an HTTP response shape the
 * route can return directly. Centralizes the "is this a 429, a 502, a
 * 500, a 503?" decision so every surface answers the same way.
 */
export interface AiErrorResponse {
  status:  number
  body:    { error: string; retryAfterSec?: number }
  /** Sentry tags so the route can capture with consistent metadata. */
  tags:    Record<string, string>
}

export function aiErrorToResponse(err: unknown, surface: string): AiErrorResponse {
  if (err instanceof MalformedTenantKeyError) {
    return {
      status: 502,
      body: { error: 'Your tenant\'s Anthropic API key is malformed. Ask your administrator to update it in Superadmin → Tenant settings.' },
      tags: { surface, kind: 'malformed-tenant-key' },
    }
  }
  if (err instanceof AnthropicNotConfiguredError) {
    return {
      status: 503,
      body: { error: 'The AI assistant is not configured for this deployment. Contact your administrator.' },
      tags: { surface, kind: 'not-configured' },
    }
  }
  // Anthropic.RateLimitError extends APIError; identify by status.
  const status = (err as { status?: number })?.status
  if (status === 429) {
    return {
      status: 429,
      body: { error: 'The AI service is rate-limited right now. Try again in a moment.', retryAfterSec: 30 },
      tags: { surface, kind: 'upstream-429' },
    }
  }
  if (typeof status === 'number' && status >= 500 && status < 600) {
    return {
      status: 502,
      body: { error: 'The AI service is unavailable right now. Try again shortly.' },
      tags: { surface, kind: 'upstream-5xx' },
    }
  }
  return {
    status: 502,
    body: { error: 'The AI service returned an unexpected error.' },
    tags: { surface, kind: 'unknown' },
  }
}

/**
 * Helper that wraps `client.messages.create()` with Sentry breadcrumbs
 * + a latency measurement. Optional — surfaces that need raw access
 * (streaming, tool-use loops) call the SDK directly.
 */
export async function callMessages(
  client: Anthropic,
  args: Anthropic.MessageCreateParamsNonStreaming,
  meta: { surface: string; tenantId: string | null },
): Promise<Anthropic.Message> {
  const start = Date.now()
  try {
    const response = await client.messages.create(args)
    Sentry.addBreadcrumb({
      category: 'ai',
      level:    'info',
      message:  'anthropic.messages.create',
      data: {
        surface:    meta.surface,
        tenant_id:  meta.tenantId,
        model:      args.model,
        latency_ms: Date.now() - start,
        input_tokens:  response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
        cache_read:    response.usage?.cache_read_input_tokens,
      },
    })
    return response
  } catch (err) {
    Sentry.addBreadcrumb({
      category: 'ai',
      level:    'error',
      message:  'anthropic.messages.create failed',
      data: {
        surface:    meta.surface,
        tenant_id:  meta.tenantId,
        model:      args.model,
        latency_ms: Date.now() - start,
        status:     (err as { status?: number })?.status,
      },
    })
    throw err
  }
}
