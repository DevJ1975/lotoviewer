import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isModuleVisible } from '@soteria/core/moduleVisibility'

// An enrolled tablet's credential. The device sends `x-strike-device:
// <device id>.<secret>` on every request. The secret is 32 random bytes shown
// once at enrollment; only its sha256 is stored, so a leaked table cannot be
// replayed. Revoking the row (or disabling STRIKE for the tenant) cuts the
// device off on its next request.

export const STRIKE_DEVICE_HEADER = 'x-strike-device'

/** Update last_seen_at at most this often, so a busy tablet is not one write per request. */
const LAST_SEEN_REFRESH_MS = 60_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface StrikeDevice {
  id: string
  tenantId: string
  name: string
  department: string | null
  siteLabel: string | null
  /** The admin who enrolled it; recorded on kiosk completions as the issuing supervisor. */
  enrolledBy: string | null
}

export type StrikeDeviceAuth =
  | { ok: true; device: StrikeDevice }
  | { ok: false; status: number; message: string; code: 'device_unrecognised' | 'device_revoked' | 'strike_unavailable' }

export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function newDeviceSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url')
  return { secret, hash: hashDeviceSecret(secret) }
}

export function formatDeviceCredential(deviceId: string, secret: string): string {
  return `${deviceId}.${secret}`
}

export function parseDeviceCredential(value: string | null): { deviceId: string; secret: string } | null {
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot === -1) return null
  const deviceId = value.slice(0, dot)
  const secret = value.slice(dot + 1)
  if (!UUID_RE.test(deviceId) || secret.length < 32 || secret.length > 128) return null
  return { deviceId, secret }
}

const UNRECOGNISED: StrikeDeviceAuth = { ok: false, status: 401, message: 'This device is not recognised.', code: 'device_unrecognised' }

/** Whether the request carries a device credential at all, as opposed to a user's bearer token. */
export function hasDeviceCredential(req: Request): boolean {
  return req.headers.get(STRIKE_DEVICE_HEADER) !== null
}

export async function authenticateDevice(admin: SupabaseClient, req: Request, now = new Date()): Promise<StrikeDeviceAuth> {
  const credential = parseDeviceCredential(req.headers.get(STRIKE_DEVICE_HEADER))
  if (!credential) return UNRECOGNISED

  const { data: row, error } = await admin
    .from('strike_devices')
    .select('id,tenant_id,name,department,site_label,secret_hash,enrolled_by,revoked_at,last_seen_at')
    .eq('id', credential.deviceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) return UNRECOGNISED

  // Same answer for an unknown id and a wrong secret, so the response does not
  // confirm which device ids exist.
  const expected = Buffer.from(row.secret_hash as string)
  const actual = Buffer.from(hashDeviceSecret(credential.secret))
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return UNRECOGNISED

  // Only a caller who proved the secret may learn the device was revoked: the
  // tablet needs to know so it can wipe what it downloaded.
  if (row.revoked_at) return { ok: false, status: 401, message: 'This device was removed. Ask an administrator to enroll it again.', code: 'device_revoked' }

  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .select('modules,disabled_at')
    .eq('id', row.tenant_id)
    .maybeSingle()
  if (tenantErr) throw new Error(tenantErr.message)
  if (!tenant || tenant.disabled_at || !isModuleVisible('strike', (tenant.modules ?? null) as Record<string, boolean> | null)) {
    return { ok: false, status: 403, message: 'Training is not available for this site.', code: 'strike_unavailable' }
  }

  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at as string) : 0
  if (now.getTime() - lastSeen > LAST_SEEN_REFRESH_MS) {
    const { error: touchErr } = await admin.from('strike_devices').update({ last_seen_at: now.toISOString() }).eq('id', row.id)
    // A failed heartbeat must not fail the learner's request.
    if (touchErr) console.warn('strike device last_seen_at update failed:', touchErr.message)
  }

  return {
    ok: true,
    device: {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      name: row.name as string,
      department: (row.department as string | null) ?? null,
      siteLabel: (row.site_label as string | null) ?? null,
      enrolledBy: (row.enrolled_by as string | null) ?? null,
    },
  }
}
