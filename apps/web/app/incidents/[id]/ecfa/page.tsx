import { redirect } from 'next/navigation'

// Events & Causal Factors is now a sub-view of the investigation dossier
// (/incidents/[id]/investigate). This route stays only so existing bookmarks
// and the old tab link don't 404 — it redirects to the ECFA sub-view. The
// editor itself lives in ./_components/EcfaBoard, still imported from there.
export default async function EcfaRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/incidents/${id}/investigate?view=ecfa`)
}
