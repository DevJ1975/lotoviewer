import AuditDetailClient from './_components/AuditDetailClient'

// /admin/loto/multi-agent-audit/[runId] — run detail. The interactive surface (progress
// polling, change review, mint-link, apply, rollback) all calls the authed
// admin API client-side, so this server component just resolves the async
// route param and hands the runId to the client component.

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  return <AuditDetailClient runId={runId} />
}
