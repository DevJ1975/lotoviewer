import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { resolveTargetChannelIds, type NotificationSeverity } from '@soteria/core/notificationRouting'
import { sendSms, type ChannelSendResult } from './sms'
import { sendTeams } from './teams'
import { sendChannelEmail } from './email'

// Server-side notification dispatcher. Resolves a tenant's active rules for an
// event, then fans out to the matching channels. Call from event sites/cron;
// wiring concrete events (e.g. critical incident) is a planned follow-up.

export interface NotifyEvent {
  tenantId:  string
  eventType: string
  severity:  NotificationSeverity
  subject:   string
  body:      string
}

interface ChannelRow { id: string; type: string; config: unknown }

export async function sendToChannel(channel: ChannelRow, ev: { subject: string; body: string }): Promise<ChannelSendResult> {
  const config = (channel.config ?? {}) as Record<string, unknown>
  switch (channel.type) {
    case 'sms':   return sendSms(config, `${ev.subject}: ${ev.body}`)
    case 'teams': return sendTeams(config, ev.subject, ev.body)
    case 'email': return sendChannelEmail(config, ev.subject, ev.body)
    default:      return { sent: false, error: 'unsupported_channel' }
  }
}

export async function dispatchNotification(ev: NotifyEvent): Promise<{ matched: number; sent: number }> {
  const admin = supabaseAdmin()

  const { data: rules } = await admin
    .from('notification_rules')
    .select('channel_id, event_type, min_severity, active')
    .eq('tenant_id', ev.tenantId)
    .eq('event_type', ev.eventType)
    .eq('active', true)

  const routing = (rules ?? []).map(r => ({
    channelId:   r.channel_id as string,
    eventType:   r.event_type as string,
    minSeverity: r.min_severity as NotificationSeverity,
    active:      r.active as boolean,
  }))
  const targetIds = resolveTargetChannelIds({ type: ev.eventType, severity: ev.severity }, routing)
  if (targetIds.length === 0) return { matched: 0, sent: 0 }

  const { data: channels } = await admin
    .from('notification_channels')
    .select('id, type, config')
    .eq('tenant_id', ev.tenantId)
    .eq('active', true)
    .in('id', targetIds)

  let sent = 0
  for (const ch of (channels ?? []) as ChannelRow[]) {
    const res = await sendToChannel(ch, ev)
    if (res.sent) sent++
  }
  return { matched: targetIds.length, sent }
}
