import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useEffect, useRef } from 'react'

import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { registerPushToken } from '@/lib/push'
import { mobileRouteForWebPath } from '@soteria/core/mobileRoutes'

// Mounted once inside the providers. It registers the device for push after
// sign-in (and again when the workspace changes, so the token row follows the
// tenant) and routes notification taps to the matching screen.
export default function PushBootstrap() {
  const { userId } = useAuth()
  const { tenantId } = useTenant()
  const lastResponse = Notifications.useLastNotificationResponse()
  const handledId = useRef<string | null>(null)

  useEffect(() => {
    if (!userId || !tenantId) return
    void registerPushToken(tenantId)
  }, [userId, tenantId])

  useEffect(() => {
    if (!userId || !lastResponse) return
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const requestId = lastResponse.notification.request.identifier
    if (handledId.current === requestId) return
    handledId.current = requestId

    const url = lastResponse.notification.request.content.data?.url
    const route = mobileRouteForWebPath(typeof url === 'string' ? url : null)
    if (route) router.push({ pathname: route.pathname, params: route.params } as Parameters<typeof router.push>[0])
  }, [userId, lastResponse])

  return null
}
