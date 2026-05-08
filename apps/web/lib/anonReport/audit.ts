// Audit logger for QR-token CRUD events.
//
// Centralised so the four endpoints (POST/PATCH/DELETE on the
// admin route, plus the public submit endpoint when it triggers
// rate-limit changes) all write the same shape. Every call is
// best-effort: a failure to write the audit row should never
// prevent the underlying admin action from completing.

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

export type QrAuditEvent =
  | 'create' | 'update' | 'enable' | 'disable' | 'delete'
  | 'rotate' | 'config_geofence' | 'config_captcha'

export interface QrAuditEntry {
  tenant_id:   string
  token_id:    string
  event_type:  QrAuditEvent
  before_row?: Record<string, unknown> | null
  after_row?:  Record<string, unknown> | null
  actor_id?:   string | null
  actor_email?:string | null
  context?:    string | null
}

export async function writeQrTokenAudit(
  client: SupabaseClient,
  entry: QrAuditEntry,
): Promise<void> {
  try {
    const { error } = await client.from('qr_token_audit_log').insert({
      tenant_id:   entry.tenant_id,
      token_id:    entry.token_id,
      event_type:  entry.event_type,
      before_row:  entry.before_row ?? null,
      after_row:   entry.after_row  ?? null,
      actor_id:    entry.actor_id   ?? null,
      actor_email: entry.actor_email?? null,
      context:     entry.context    ?? null,
    })
    if (error) {
      Sentry.captureException(error, {
        tags: { module: 'qrTokenAudit', event: entry.event_type },
      })
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { module: 'qrTokenAudit', event: entry.event_type },
    })
  }
}
