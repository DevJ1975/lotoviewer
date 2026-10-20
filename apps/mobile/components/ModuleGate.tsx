import type { ReactNode } from 'react'

import { Text } from '@/components/Themed'
import { Centered, formStyles } from '@/components/form'
import { useModuleVisible } from '@/lib/modules'

// Wraps a module's screen so a tenant that has switched the module off sees a
// plain explanation instead of a list that errors out.
export default function ModuleGate({ featureId, name, children }: {
  featureId: string
  name: string
  children: ReactNode
}) {
  const visible = useModuleVisible(featureId)
  if (visible) return <>{children}</>
  return (
    <Centered>
      <Text style={formStyles.empty}>{name} is not enabled for this workspace. Ask an administrator to turn it on.</Text>
    </Centered>
  )
}
