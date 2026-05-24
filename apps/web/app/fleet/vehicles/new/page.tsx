'use client'

import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import { VehicleForm } from '../../_components/VehicleForm'
import { createVehicle } from '@/lib/fleet/client'
import type { VehicleInput } from '@soteria/core/fleet'

export default function NewVehiclePage() {
  const router = useRouter()
  const { tenant } = useTenant()

  async function handleCreate(input: VehicleInput) {
    if (!tenant?.id) throw new Error('No active tenant')
    const created = await createVehicle(tenant.id, input)
    router.push(`/fleet/vehicles/${created.id}`)
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <PageHeader icon={Truck} title="Add vehicle" description="Photos, placards, and documents can be added after saving." back="/fleet/vehicles" />
      <VehicleForm submitLabel="Create vehicle" onSubmit={handleCreate} />
    </main>
  )
}
