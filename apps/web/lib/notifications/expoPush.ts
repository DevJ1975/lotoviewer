import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PushPayload } from '@/lib/push'

// Expo Push fan-out for the Soteria FIELD mobile app. Sits beside the Web
// Push fan-out in pushFanout.ts and is called from it, so every surface that
// already notifies browsers (permits, incidents, chat, boards, alerts) also
// reaches phones without each caller knowing about Expo.
//
// Like Web Push this is best-effort: a failure is reported to Sentry and
// returned as a result, never thrown, so the business action that triggered
// the notification still succeeds.

export const EXPO_PUSH_URL  = 'https://exp.host/--/api/v2/push/send'
// Expo accepts at most 100 messages per request.
export const EXPO_CHUNK_SIZE = 100

const EXPO_TOKEN_RE = /^(?:Exponent|Expo)PushToken\[[^\]\s]+\]$/

export interface ExpoPushMessage {
  to:    string
  title: string
  body:  string
  sound: 'default'
  data:  { url?: string; tag?: string }
}

export interface ExpoPushTicket {
  status:   'ok' | 'error'
  details?: { error?: string }
}

export interface ExpoFanoutResult {
  sent:    number
  failed:  number
  pruned:  number
  reason?: string
}

export function isExpoPushToken(value: string): boolean {
  return EXPO_TOKEN_RE.test(value)
}

export function buildExpoMessages(tokens: string[], payload: PushPayload): ExpoPushMessage[] {
  return tokens.filter(isExpoPushToken).map(to => ({
    to,
    title: payload.title,
    body:  payload.body,
    sound: 'default',
    // Only the fields the app's tap handler reads; never forward extra keys.
    data:  { url: payload.url, tag: payload.tag },
  }))
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Tickets come back in the same order as the messages in the request, so the
// token for ticket i is tokens[i]. Expo reports DeviceNotRegistered when the
// app was uninstalled or the token revoked; those rows should be deleted.
export function staleTokensFromTickets(
  tokens:  readonly string[],
  tickets: readonly ExpoPushTicket[],
): string[] {
  const stale: string[] = []
  tickets.forEach((ticket, i) => {
    const token = tokens[i]
    if (token && ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      stale.push(token)
    }
  })
  return stale
}

interface ExpoFanoutOpts {
  payload:     PushPayload
  /** Omit to notify every registered device (admin broadcast). */
  profileIds?: string[]
  source:      string
}

export async function sendExpoPush({ payload, profileIds, source }: ExpoFanoutOpts): Promise<ExpoFanoutResult> {
  if (profileIds && profileIds.length === 0) {
    return { sent: 0, failed: 0, pruned: 0, reason: 'no recipients' }
  }

  try {
    const admin = supabaseAdmin()
    let query = admin.from('expo_push_tokens').select('token')
    if (profileIds) query = query.in('profile_id', profileIds)
    const { data: rows, error } = await query
    if (error) {
      Sentry.captureException(error, { tags: { fanout: source, stage: 'expo-token-lookup' } })
      return { sent: 0, failed: 0, pruned: 0, reason: error.message }
    }

    const tokens = (rows ?? []).map(r => r.token as string).filter(isExpoPushToken)
    if (tokens.length === 0) {
      return { sent: 0, failed: 0, pruned: 0, reason: 'no expo tokens' }
    }

    const messages = buildExpoMessages(tokens, payload)
    const stale: string[] = []
    let sent = 0
    let failed = 0

    for (const batch of chunk(messages, EXPO_CHUNK_SIZE)) {
      const batchTokens = batch.map(m => m.to)
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method:  'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body:    JSON.stringify(batch),
        })
        if (!res.ok) {
          failed += batch.length
          Sentry.captureMessage(`Expo push HTTP ${res.status}`, { level: 'warning', tags: { fanout: source } })
          continue
        }
        const json = await res.json() as { data?: ExpoPushTicket[] }
        const tickets = json.data ?? []
        const okCount = tickets.filter(t => t.status === 'ok').length
        sent   += okCount
        failed += batch.length - okCount
        stale.push(...staleTokensFromTickets(batchTokens, tickets))
      } catch (e) {
        failed += batch.length
        Sentry.captureException(e, { tags: { fanout: source, stage: 'expo-send' } })
      }
    }

    if (stale.length > 0) {
      const { error: pruneErr } = await admin.from('expo_push_tokens').delete().in('token', stale)
      if (pruneErr) {
        Sentry.captureException(pruneErr, { tags: { fanout: source, stage: 'expo-prune' } })
      }
    }

    return { sent, failed, pruned: stale.length }
  } catch (e) {
    Sentry.captureException(e, { tags: { fanout: source, stage: 'expo-unhandled' } })
    return { sent: 0, failed: 0, pruned: 0, reason: e instanceof Error ? e.message : String(e) }
  }
}
