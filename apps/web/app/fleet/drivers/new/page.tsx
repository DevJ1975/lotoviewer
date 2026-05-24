'use client'

import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import { DriverForm } from '../../_components/DriverForm'
import { createDriver } from '@/lib/fleet/client'
import type { DriverInput } from '@soteria/core/fleetDriver'

export default function NewDriverPage() {
  const router = useRouter()
  const { tenant } = useTenant()

  async function handleCreate(input: DriverInput) {
    if (!tenant?.id) throw new Error('No active tenant')
    const created = await createDriver(tenant.id, input)
    router.push(`/fleet/drivers/${created.id}`)
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <PageHeader icon={Users} title="Add driver" description="Pick a worker from the roster, then record their licensing." back="/fleet/drivers" />
      {tenant?.id && <DriverForm tenantId={tenant.id} includeWorkerPicker submitLabel="Create driver" onSubmit={handleCreate} />}
    </main>
  )
}
