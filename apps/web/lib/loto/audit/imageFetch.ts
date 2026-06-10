// Fetch a stored photo as base64 for an Anthropic vision call. The loto-photos
// bucket allows public SELECT (migration 005) and equipment photo URLs are the
// bucket's public URLs (often cache-busted with ?v=...), so a plain fetch is
// the simplest correct read. Returns null on any failure so a broken/missing
// photo degrades to a "missing" verdict instead of throwing the whole audit.

export interface FetchedImage {
  base64:    string
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
}

export async function fetchImageAsBase64(url: string | null | undefined): Promise<FetchedImage | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0) return null

    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    let mediaType: FetchedImage['mediaType'] = 'image/jpeg'
    if (ct.includes('png')) mediaType = 'image/png'
    else if (ct.includes('webp')) mediaType = 'image/webp'
    else if (ct.includes('gif')) mediaType = 'image/gif'
    // HEIC/HEIF and unknown types fall through to JPEG: our stored photos are
    // re-encoded to JPEG on upload (lib/imageUtils), and Anthropic tolerates
    // mislabeled JPEG bytes in practice (same assumption as scan-photo).
    return { base64: buf.toString('base64'), mediaType }
  } catch {
    return null
  }
}
