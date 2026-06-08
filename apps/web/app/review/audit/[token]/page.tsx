import { notFound } from 'next/navigation'
import AuditReviewClient from './_components/AuditReviewClient'

// Public audit-review page. The URL token is the only auth (mirrors
// app/review/[token]). The audit API is token-scoped and serves both the
// initial load and every decision, so this server component just validates the
// token shape and hands it to the client — which fetches the run, change-set,
// and results, posts a view-ack, and drives approve/reject + sign-off.

const TOKEN_RE = /^[0-9a-f]{32}$/

export default async function AuditReviewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!TOKEN_RE.test(token)) notFound()
  return <AuditReviewClient token={token} />
}
