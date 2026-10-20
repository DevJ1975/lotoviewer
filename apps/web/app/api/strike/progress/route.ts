import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { resolveMemberIdForUser } from '@/lib/strike/attempts'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  deriveBadges,
  privateRank,
  rankTeams,
  totalXp,
  type StrikeLedgerRow,
  type StrikeXpEventType,
} from '@soteria/core/strikeGamification'

export const runtime = 'nodejs'

// The learner's own progress plus whatever boards the tenant allows. Rank
// is computed over everyone but returned only to its owner; the individual
// board lists only people who opted in, and only to people who opted in.
export async function GET(req: Request) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const memberId = await resolveMemberIdForUser(admin, gate.tenantId, gate.userId)
    if (!memberId) return NextResponse.json({ xp: 0, badges: [], rank: null, teams: [], leaders: null, opted_in: false })

    const [ledgerRes, settingsRes, membersRes, optinsRes, lotoRes] = await Promise.all([
      admin.from('strike_xp_events').select('member_id,event_type,points,module_id').eq('tenant_id', gate.tenantId).limit(50000),
      admin.from('strike_tenant_settings').select('leaderboard_enabled,team_leaderboard_enabled').eq('tenant_id', gate.tenantId).maybeSingle(),
      admin.from('members').select('id,display_name,preferred_name,department').eq('tenant_id', gate.tenantId).eq('status', 'active'),
      admin.from('strike_leaderboard_optins').select('member_id').eq('tenant_id', gate.tenantId),
      admin.from('strike_modules').select('id').or('category.ilike.%lockout%,tags.cs.{loto}'),
    ])
    const failed = [ledgerRes, settingsRes, membersRes, optinsRes, lotoRes].find(r => r.error)
    if (failed?.error) throw new Error(failed.error.message)

    const xpByMember = new Map<string, number>()
    const mine: StrikeLedgerRow[] = []
    for (const row of ledgerRes.data ?? []) {
      xpByMember.set(row.member_id, (xpByMember.get(row.member_id) ?? 0) + row.points)
      if (row.member_id === memberId) mine.push({ eventType: row.event_type as StrikeXpEventType, points: row.points, moduleId: row.module_id })
    }
    const members = membersRes.data ?? []
    const xp = totalXp(mine)
    const optedIn = new Set((optinsRes.data ?? []).map(o => o.member_id as string))
    // Defaults mirror strike_tenant_settings (both true) for tenants without a row.
    const teamBoard = settingsRes.data?.team_leaderboard_enabled ?? true
    const individualBoard = settingsRes.data?.leaderboard_enabled ?? true

    return NextResponse.json({
      xp,
      badges: deriveBadges(mine, new Set((lotoRes.data ?? []).map(m => m.id as string))),
      rank: privateRank(xp, members.map(m => xpByMember.get(m.id) ?? 0)),
      teams: teamBoard ? rankTeams(members.map(m => ({ team: m.department, xp: xpByMember.get(m.id) ?? 0 }))).slice(0, 10) : [],
      opted_in: optedIn.has(memberId),
      leaders: individualBoard && optedIn.has(memberId)
        ? members
          .filter(m => optedIn.has(m.id))
          .map(m => ({ name: m.preferred_name || m.display_name, xp: xpByMember.get(m.id) ?? 0, you: m.id === memberId }))
          .sort((a, b) => b.xp - a.xp)
          .slice(0, 10)
        : null,
      individual_board_enabled: individualBoard,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/progress' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { opt_in?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.opt_in !== 'boolean') return NextResponse.json({ error: 'opt_in must be true or false' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const memberId = await resolveMemberIdForUser(admin, gate.tenantId, gate.userId)
    if (!memberId) return NextResponse.json({ error: 'You are not on this roster.' }, { status: 404 })
    const { error } = body.opt_in
      ? await admin.from('strike_leaderboard_optins').upsert({ tenant_id: gate.tenantId, member_id: memberId })
      : await admin.from('strike_leaderboard_optins').delete().eq('tenant_id', gate.tenantId).eq('member_id', memberId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ opted_in: body.opt_in })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/progress' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
