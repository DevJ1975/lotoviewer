import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { apiBase, authHeaders } from '@/lib/api'

// Push registration for the Soteria FIELD app. The Expo push token is sent to
// /api/push/expo-token; the server fans every existing notification (permit
// expiry, incidents, chat, boards) out to it through Expo.
//
// Registration is best-effort: it never throws into the UI, because a phone
// that can't register for push must still be able to work.

const TOKEN_KEY = 'soteria.expoPushToken.v1'

// Foreground notifications still show, so a permit-expiry alert isn't lost
// just because the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
})

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true
  if (!current.canAskAgain) return false
  const requested = await Notifications.requestPermissionsAsync()
  return requested.granted
}

// Returns the registered token, or null when push isn't available (simulator,
// permission denied, or the build has no EAS project id yet).
export async function registerPushToken(tenantId: string): Promise<string | null> {
  try {
    if (!Device.isDevice) return null

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Soteria alerts',
        importance: Notifications.AndroidImportance.HIGH,
      })
    }

    if (!(await ensurePermission())) return null

    const projectId = easProjectId()
    if (!projectId) {
      console.warn('[push] No EAS project id; run `eas init` so push tokens can be issued.')
      return null
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    const res = await fetch(`${apiBase()}/api/push/expo-token`, {
      method:  'POST',
      headers: await authHeaders(tenantId),
      body:    JSON.stringify({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
    })
    if (!res.ok) {
      console.warn('[push] Token registration failed:', res.status)
      return null
    }
    await AsyncStorage.setItem(TOKEN_KEY, token)
    return token
  } catch (error) {
    console.warn('[push] Registration failed:', error)
    return null
  }
}

// Called before sign-out, while the session can still authenticate the
// request, so a shared phone stops notifying the previous user.
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY)
    if (!token) return
    await fetch(`${apiBase()}/api/push/expo-token`, {
      method:  'DELETE',
      headers: await authHeaders(''),
      body:    JSON.stringify({ token }),
    })
    await AsyncStorage.removeItem(TOKEN_KEY)
  } catch (error) {
    console.warn('[push] Unregister failed:', error)
  }
}
