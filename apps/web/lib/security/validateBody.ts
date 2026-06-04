// Shared body-validation wrapper around zod.
//
// Why: 158 of 280 API routes call `await req.json()` and hand-roll
// `typeof` checks per field. The hand-rolled checks are inconsistent
// (nested objects often unverified), the error messages are uneven,
// and adding a new field means editing N call sites instead of one
// schema. zod is already installed (v4) but used in a single route.
//
// Goal: a one-line helper that
//   1. parses + validates against a zod schema,
//   2. returns either { ok: true, data } (correctly typed) or a
//      ready-to-return NextResponse with a 400 + structured details,
//   3. keeps the route handler's happy path trivially readable.
//
// Usage in a route:
//
//   const Body = z.object({
//     name:        z.string().min(1).max(120),
//     daily_budget: z.number().int().nonnegative().nullable().optional(),
//   })
//
//   export async function POST(req: Request) {
//     const parsed = await validateJsonBody(req, Body)
//     if (!parsed.ok) return parsed.response
//     // parsed.data is fully typed against Body.
//   }
//
// The helper deliberately does NOT do auth — the gate stays at the
// top of every route. validateJsonBody runs AFTER the gate succeeds,
// so an unauthorized caller never sees parse details.

import { NextResponse } from 'next/server'
import type { ZodType, ZodTypeAny, infer as ZInfer } from 'zod'

export type ValidatedBody<T extends ZodTypeAny> =
  | { ok: true;  data: ZInfer<T> }
  | { ok: false; response: NextResponse }

/**
 * Parse `req.json()` and validate against `schema`. Returns a tagged
 * union so callers can `if (!parsed.ok) return parsed.response`.
 *
 * Error response shape:
 *   { error: 'Invalid request body', issues: [{ path: string, message: string }] }
 *
 * The `path` is a dot-joined zod issue path (e.g. "modules.safety").
 * No raw zod internals leak — issues are mapped through a small
 * surface to keep the response stable across zod versions.
 */
export async function validateJsonBody<T extends ZodTypeAny>(
  req:    Request,
  schema: T,
): Promise<ValidatedBody<T>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      ),
    }
  }

  const result = (schema as ZodType<ZInfer<T>>).safeParse(raw)
  if (result.success) {
    return { ok: true, data: result.data }
  }

  // Cap issue count so a deeply nested error payload can't be used to
  // bloat the response. 20 issues is plenty for any sane form.
  const issues = result.error.issues.slice(0, 20).map(i => ({
    path:    i.path.map(String).join('.') || '(root)',
    message: i.message,
  }))
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'Invalid request body', issues },
      { status: 400 },
    ),
  }
}

/**
 * Same shape, for query-string parameters. Coerces the URLSearchParams
 * into a plain object before validation so zod's `z.coerce.number()`
 * works on raw strings.
 */
export function validateQueryParams<T extends ZodTypeAny>(
  url:    URL | Request,
  schema: T,
): ValidatedBody<T> {
  const sp = (url instanceof URL ? url : new URL(url.url)).searchParams
  const raw: Record<string, string | string[]> = {}
  for (const key of sp.keys()) {
    const values = sp.getAll(key)
    raw[key] = values.length > 1 ? values : (values[0] ?? '')
  }
  const result = (schema as ZodType<ZInfer<T>>).safeParse(raw)
  if (result.success) {
    return { ok: true, data: result.data }
  }
  const issues = result.error.issues.slice(0, 20).map(i => ({
    path:    i.path.map(String).join('.') || '(root)',
    message: i.message,
  }))
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'Invalid query parameters', issues },
      { status: 400 },
    ),
  }
}
