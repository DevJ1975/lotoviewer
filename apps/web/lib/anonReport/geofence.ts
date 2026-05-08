// Geofence helpers for QR-token sites.
//
// Tokens may store a (lat, lng) site centre and a geofence_radius_m.
// When a report submits with a location_geo, we compute the
// great-circle distance and flag the incident if it's outside the
// radius. We never reject — see migration 086 for rationale.

const EARTH_RADIUS_M = 6_371_008.8 // mean radius

export interface GeoPoint {
  lat: number
  lng: number
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

// Returns null if either side of the comparison is missing — the
// caller stores null in incidents.geo_mismatch in that case.
export function isOutsideRadius(
  site:   GeoPoint | null,
  point:  GeoPoint | null,
  radius: number | null,
): boolean | null {
  if (!site || !point || !radius || radius <= 0) return null
  return haversineMeters(site, point) > radius
}

// Postgres `point` column comes back as a string like "(40.7,-74.0)".
// Defensive parse: returns null on anything that doesn't look right.
export function parsePgPoint(s: string | null | undefined): GeoPoint | null {
  if (!s) return null
  const m = /^\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*$/.exec(s)
  if (!m) return null
  return { lat: Number(m[1]), lng: Number(m[2]) }
}
