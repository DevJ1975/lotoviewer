import type { SupabaseClient } from '@supabase/supabase-js'
import { authenticateDevice, hasDeviceCredential } from '@/lib/strike/deviceAuth'
import { requireStrikeMember } from '@/lib/strike/gate'
import type { OfflineCaller } from '@/lib/strike/offlineSync'

export type OfflineCallerAuth =
  | {
      ok: true
      caller: OfflineCaller
      /** What the offline quiz key is bound to: the device, or the signed-in user. */
      keyScope: string
      /** Rate-limit bucket: per device or per user, never per IP (a plant shares one). */
      rateKey: string
    }
  | { ok: false; status: number; message: string; code?: string }

/**
 * The two ways a tablet reaches the offline routes: an enrolled shared device
 * (kiosk) or a worker signed in on their own tablet. A request that names a
 * device is judged as a device only; a bad device credential never falls back
 * to whatever bearer token rides along.
 */
export async function authenticateOfflineCaller(admin: SupabaseClient, req: Request): Promise<OfflineCallerAuth> {
  if (hasDeviceCredential(req)) {
    const auth = await authenticateDevice(admin, req)
    if (!auth.ok) return auth
    const { device } = auth
    return { ok: true, caller: { tenantId: device.tenantId, device, user: null }, keyScope: device.id, rateKey: `device:${device.id}` }
  }

  const gate = await requireStrikeMember(req)
  if (!gate.ok) return gate
  return {
    ok: true,
    caller: { tenantId: gate.tenantId, device: null, user: { userId: gate.userId, role: gate.role } },
    keyScope: `user:${gate.userId}`,
    rateKey: `user:${gate.tenantId}:${gate.userId}`,
  }
}
