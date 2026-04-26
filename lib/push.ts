// Shared types + helpers for Web Push subscriptions (migration 016).

export interface PushSubscription {
  id:           string
  profile_id:   string
  endpoint:     string
  p256dh:       string
  auth:         string
  user_agent:   string | null
  created_at:   string
  last_used_at: string | null
}

// The standard Web Push notification payload we render in the SW. Kept
// minimal — title + body + a deep-link URL — so the SW renderer is
// dumb and the same payload survives any future redesign of where in
// the app the user lands.
export interface PushPayload {
  title: string
  body:  string
  url?:  string
  // Notification tag — same tag collapses on iOS/Android so multiple
  // pushes about the same permit don't stack. e.g. `permit:${id}`.
  tag?:  string
}

// Convert a base64url string to a Uint8Array backed by a fresh
// ArrayBuffer. Web Push VAPID keys arrive as base64url-encoded strings;
// pushManager.subscribe wants the raw bytes as a BufferSource backed by
// ArrayBuffer (not SharedArrayBuffer), so we explicitly allocate one
// to satisfy strict TS typing.
export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
