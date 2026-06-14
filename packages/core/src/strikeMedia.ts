// STRIKE videos are Vimeo references. A module version "has a video" iff it
// carries a numeric Vimeo id in video_external_id; the optional unlisted
// privacy hash rides in video_meta.vimeo_hash. Playback is an embed of
// player.vimeo.com — there is no file in our storage to sign or expire.

const VIMEO_ID_RE = /^[0-9]{6,12}$/
// Unlisted privacy hashes are short lowercase alphanumerics (Vimeo issues 10).
const VIMEO_HASH_RE = /^[0-9a-z]{6,20}$/
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'])

export type StrikeVideoSource =
  | { kind: 'none' }
  | { kind: 'vimeo'; videoId: string; hash: string | null }
  | { kind: 'unsupported'; reason: string }

export interface StrikeVideoFields {
  video_external_id?: string | null
  video_meta?: Record<string, unknown> | null
}

export interface VimeoReference {
  videoId: string
  hash: string | null
}

// Resolves the playable source from a strike_module_versions row. A blank
// external id means no video; a non-Vimeo id (e.g. a stale Cloudflare UID on a
// pre-migration row) fails closed rather than rendering a broken player.
export function resolveStrikeVideo(version: StrikeVideoFields): StrikeVideoSource {
  const videoId = version.video_external_id?.trim() ?? ''
  if (!videoId) return { kind: 'none' }
  if (!VIMEO_ID_RE.test(videoId)) {
    return { kind: 'unsupported', reason: 'STRIKE video id is not a valid Vimeo id.' }
  }
  return { kind: 'vimeo', videoId, hash: readVimeoHash(version.video_meta) }
}

function readVimeoHash(meta: Record<string, unknown> | null | undefined): string | null {
  const raw = typeof meta?.vimeo_hash === 'string' ? meta.vimeo_hash.trim() : ''
  return VIMEO_HASH_RE.test(raw) ? raw : null
}

// Parses admin-pasted input into a Vimeo reference. Accepts a bare numeric id,
// vimeo.com/{id}, vimeo.com/{id}/{hash} (unlisted), or
// player.vimeo.com/video/{id}?h={hash}. The host allow-list rejects links to
// any other site outright, so the id can never become an arbitrary iframe src
// downstream — same posture as the manuals embed allow-list.
export function parseVimeoReference(input: string | null | undefined): VimeoReference | null {
  const value = input?.trim()
  if (!value) return null

  if (VIMEO_ID_RE.test(value)) return { videoId: value, hash: null }

  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    return null
  }
  if (!VIMEO_HOSTS.has(url.hostname.toLowerCase())) return null

  const segments = url.pathname.split('/').filter(Boolean)
  const idIndex = segments[0] === 'video' ? 1 : 0
  const videoId = segments[idIndex] ?? ''
  if (!VIMEO_ID_RE.test(videoId)) return null

  const rawHash = (segments[idIndex + 1] ?? url.searchParams.get('h') ?? '').trim()
  return { videoId, hash: VIMEO_HASH_RE.test(rawHash) ? rawHash : null }
}

// Builds the player embed URL. `dnt` disables Vimeo's own cookies/analytics so
// the learner isn't tracked; the unlisted hash, when present, authorizes the
// embed of a non-public video.
export function vimeoEmbedUrl(videoId: string, hash: string | null): string {
  const params = new URLSearchParams()
  if (hash) params.set('h', hash)
  params.set('dnt', '1')
  return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?${params.toString()}`
}
