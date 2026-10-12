// Small response helpers shared by the /api/environmental routes, so every route
// answers the same way: { error: <code>, details?: string[] }.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const PG_UNIQUE_VIOLATION = '23505'
export const PG_FOREIGN_KEY_VIOLATION = '23503'

/** 400 with the list of things wrong, so a form can show them all at once. */
export const invalid = (details: string[]) => Response.json({ error: 'invalid', details }, { status: 400 })

export const badId = () => Response.json({ error: 'invalid_id' }, { status: 400 })
export const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })
export const facilityRequired = () =>
  Response.json({ error: 'facility_required', details: ['Choose a site first: this record belongs to one site.'] }, { status: 400 })

export async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await req.json() }
  } catch {
    return { ok: false, response: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
}

/** Gate failure -> response. The gate's own message is safe to show (it names a missing role, not internals). */
export const refused = (gate: { status: number; message: string }) => Response.json({ error: gate.message }, { status: gate.status })
