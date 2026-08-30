import { redirect } from 'next/navigation'

// The RCA editor is now unified into the investigation dossier
// (/incidents/[id]/investigate). This route stays only so existing
// bookmarks and the old "RCA" tab link don't 404 — it redirects.
export default async function RcaRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/incidents/${id}/investigate`)
}
