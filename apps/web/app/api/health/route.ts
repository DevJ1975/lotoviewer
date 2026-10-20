import { NextResponse } from 'next/server'

// Liveness probe for container hosts (ECS task health check, ALB target
// group). Deliberately touches no dependency: a Supabase or Anthropic outage
// must not make the load balancer cycle every healthy container.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } })
}
