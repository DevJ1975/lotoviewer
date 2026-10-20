import type { SupabaseClient } from '@supabase/supabase-js'
import type { GatedPermitType } from '@soteria/core/permitTrainingGate'

export interface PermitRef {
  tenantId: string
  label: string
  path: string
}

/** Loads a gated permit's tenant, a human label and its page path, or null when it doesn't exist. */
export async function loadPermitRef(admin: SupabaseClient, type: GatedPermitType, permitId: string): Promise<PermitRef | null> {
  switch (type) {
    case 'confined_space': {
      const { data, error } = await admin.from('loto_confined_space_permits').select('tenant_id,serial,space_id').eq('id', permitId).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { tenantId: data.tenant_id as string, label: `Confined-space permit ${data.serial ?? ''}`.trim(), path: `/confined-spaces/${data.space_id}/permits/${permitId}` } : null
    }
    case 'hot_work': {
      const { data, error } = await admin.from('loto_hot_work_permits').select('tenant_id,serial').eq('id', permitId).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { tenantId: data.tenant_id as string, label: `Hot-work permit ${data.serial ?? ''}`.trim(), path: `/hot-work/${permitId}` } : null
    }
    case 'working_at_heights': {
      const { data, error } = await admin.from('wah_permits').select('tenant_id,permit_number').eq('id', permitId).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { tenantId: data.tenant_id as string, label: `Working-at-heights permit ${data.permit_number}`, path: `/admin/working-at-heights/permits/${permitId}` } : null
    }
    case 'loto_group': {
      const { data, error } = await admin.from('loto_group_permits').select('tenant_id').eq('id', permitId).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { tenantId: data.tenant_id as string, label: 'LOTO group permit', path: `/loto/group-permits/${permitId}` } : null
    }
  }
}
