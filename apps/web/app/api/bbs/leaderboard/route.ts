import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '10', 10) || 10))

  try {
    const { data, error } = await gate.authedClient
      .from('bbs_leaderboard')
      .select('user_id, full_name, avatar_url, observation_count, points_total, unsafe_act_count, unsafe_condition_count, safe_behavior_count, last_submitted_at')
      .order('points_total', { ascending: false })
      .order('observation_count', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return NextResponse.json({ leaderboard: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
