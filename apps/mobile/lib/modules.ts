import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { useTenant } from '@/components/TenantProvider'

// Whether a feature is switched on for the active tenant. Same resolver the
// web drawer and the API module gates use, so a module hidden on web is also
// hidden here instead of failing with a 403 on first tap.
export function useModuleVisible(featureId: string): boolean {
  const { tenant } = useTenant()
  return isModuleVisible(featureId, tenant?.modules)
}
