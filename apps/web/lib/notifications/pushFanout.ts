import webpush from 'web-push'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PushPayload } from '@/lib/push'

// Direct (in-process) Web Push fanout to a list of profile ids.
// Mirrors /api/push/dispatch but callable from any server route so we
// don't have to make a self-fetch with the internal secret. The two
// implementations should stay in sync; if you change the payload
// shape or the prune-on-410 behavior, change both.
//
// VAPID env required: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT. Missing env is a SOFT failure: the route logs and
// returns { sent: 0 } so business logic (saving the comment) still
// succeeds — push is best-effort, not authoritative.

interface FanoutOpts {
  payload:     PushPayload
  profileIds:  string[]            // skip empty — caller is responsible for de-duping
  /** Tag for Sentry breadcrumbs/errors so we can see which surface fired. */
  source:      string
}

interface FanoutResult {
  sent:    number
  failed:  number
  pruned:  number
  reason?: string
}

let vapidConfigured = false

function configureVapid(): boolean {
  if (vapidConfigured) return true
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subj = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subj) return false
  webpush.setVapidDetails(subj, pub, priv)
  vapidConfigured = true
  return true
}

export async function dispatchPushToProfiles({
  payload, profileIds, source,
}: FanoutOpts): Promise<FanoutResult> {
  if (profileIds.length === 0) {
    return { sent: 0, failed: 0, pruned: 0, reason: 'no recipients' }
  }
  if (!configureVapid()) {
    return { sent: 0, failed: 0, pruned: 0, reason: 'VAPID not configured' }
  }

  try {
    const admin = supabaseAdmin()
    const { data: subs, error } = await admin
      .from('loto_push_subscriptions')
      .select('id, endpoint, p256dh, auth, profile_id')
      .in('profile_id', profileIds)
    if (error) {
      Sentry.captureException(error, { tags: { fanout: source, stage: 'sub-lookup' } })
      return { sent: 0, failed: 0, pruned: 0, reason: error.message }
    }
    if (!subs || subs.length === 0) {
      return { sent: 0, failed: 0, pruned: 0, reason: 'no subscriptions' }
    }

    const json = JSON.stringify(payload)
    const stale: string[] = []

    const results = await Promise.allSettled(
      subs.map(s => webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        json,
      ).catch((err: { statusCode?: number }) => {
        // 404/410 = subscription is gone; remove it so the next dispatch
        // doesn't waste effort on it.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          stale.push(s.endpoint)
        }
        throw err
      })),
    )

    const sent = results.filter(r => r.status === 'fulfilled').length
    const failed = results.length - sent

    if (stale.length > 0) {
      const { error: pruneErr } = await admin
        .from('loto_push_subscriptions').delete().in('endpoint', stale)
      if (pruneErr) {
        Sentry.captureException(pruneErr, { tags: { fanout: source, stage: 'prune' } })
      }
    }

    return { sent, failed, pruned: stale.length }
  } catch (e) {
    Sentry.captureException(e, { tags: { fanout: source, stage: 'unhandled' } })
    return {
      sent: 0, failed: 0, pruned: 0,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}
