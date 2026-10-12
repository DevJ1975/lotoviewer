import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultLimitRow, type DefaultLimit } from '@soteria/core/environmental/monitoringDefaults'
import { DatabaseError } from './monitoringHttp'
import { PG_UNIQUE_VIOLATION } from './http'

// Adopting draft default limits for a site (or one of its outfalls). Idempotent: the library
// key is unique per site and outfall, so adopting again only fills the gaps, and a concurrent
// adopt that wins the race leaves the loser with "already there", not an error.

interface Target {
  tenantId:   string
  facilityId: string
  /** The outfall the copies are for, or null for site-wide limits. */
  outfallId:  string | null
  userId:     string
}

export interface AdoptResult {
  created:      Array<Record<string, unknown>>
  alreadyThere: number
}

export async function adoptDefaultLimits(client: SupabaseClient, target: Target, chosen: readonly DefaultLimit[]): Promise<AdoptResult> {
  const adopted = client.from('monitoring_limits').select('library_key')
    .eq('tenant_id', target.tenantId).eq('facility_id', target.facilityId).not('library_key', 'is', null)
  const { data, error } = await (target.outfallId === null ? adopted.is('outfall_id', null) : adopted.eq('outfall_id', target.outfallId))
  if (error) throw new DatabaseError(error.code, error.message)
  const have = new Set((data ?? []).map(row => row.library_key as string))

  const result: AdoptResult = { created: [], alreadyThere: 0 }
  // One at a time: a few rows, and a failure part-way leaves a clean record of what was adopted.
  for (const limit of chosen) {
    if (have.has(limit.libraryKey)) { result.alreadyThere += 1; continue }
    const { data: row, error: insertError } = await client.from('monitoring_limits')
      .insert({
        tenant_id: target.tenantId, facility_id: target.facilityId, outfall_id: target.outfallId, created_by: target.userId,
        ...defaultLimitRow(limit),
      })
      .select('*').single()
    if (insertError?.code === PG_UNIQUE_VIOLATION) { result.alreadyThere += 1; continue }
    if (insertError) throw new DatabaseError(insertError.code, insertError.message)
    result.created.push(row as Record<string, unknown>)
  }
  return result
}
