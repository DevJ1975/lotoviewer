// Parse the optional `?equipment=<id>` param on the public review portal.
//
// The public (floor-walk) review link renders every active placard in the
// tenant — for a large site that is hundreds of cards plus their photos and
// energy-step text, a multi-megabyte payload that can exhaust memory on a
// phone. The /qr "Update photo" deep-link instead points a field worker at a
// single machine; when this param is present the portal loads ONLY that
// equipment, keeping the page tiny and crash-free.
//
// Boundary input (URL), so validate: collapse the string|string[] shape,
// trim, reject empty, and cap length defensively. equipment_id is free-form
// text (e.g. "VRC #4", "302-MX-1"), so no character whitelist — the value is
// only ever used as a parameterized `.eq('equipment_id', …)` filter.
export function parseReviewEquipmentParam(
  raw: string | string[] | undefined,
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 128) return null
  return trimmed
}
