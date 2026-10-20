import type { SupabaseClient } from '@supabase/supabase-js'
import { strikeContentAssetPaths, type StrikeContent } from '@soteria/core/strikeContent'

export const STRIKE_MEDIA_BUCKET = 'strike-media'

// Long enough to finish a 5-minute module with pauses, short enough that a
// copied link stops working before it can circulate.
export const STRIKE_ASSET_TTL_SECONDS = 60 * 60

/** path → signed URL for every image, narration track and caption file in the content. */
export async function signStrikeContentAssets(
  admin: SupabaseClient,
  content: StrikeContent,
): Promise<Record<string, string>> {
  const paths = strikeContentAssetPaths(content)
  if (paths.length === 0) return {}
  const { data, error } = await admin.storage
    .from(STRIKE_MEDIA_BUCKET)
    .createSignedUrls(paths, STRIKE_ASSET_TTL_SECONDS)
  if (error) throw new Error(error.message)
  const urls: Record<string, string> = {}
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl
  }
  return urls
}
