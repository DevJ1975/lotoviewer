import type { Equipment } from '@soteria/core/types'

// Defends against CSV injection (Excel/Sheets/Numbers treat leading
// = + - @ TAB CR as formulas) and quotes fields with special chars.
export function csvEscape(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

export function buildEquipmentCsv(equipment: Equipment[], decommissioned: ReadonlySet<string>): string {
  const headers = [
    'equipment_id', 'description', 'department', 'prefix', 'photo_status',
    'has_equip_photo', 'has_iso_photo', 'needs_equip_photo', 'needs_iso_photo',
    'verified', 'verified_by', 'verified_date', 'decommissioned', 'notes',
  ]

  const body = [...equipment]
    .sort((a, b) => a.equipment_id.localeCompare(b.equipment_id))
    .map(eq => [
      csvEscape(eq.equipment_id),
      csvEscape(eq.description),
      csvEscape(eq.department),
      csvEscape(eq.prefix ?? ''),
      eq.photo_status,
      String(eq.has_equip_photo),
      String(eq.has_iso_photo),
      String(eq.needs_equip_photo),
      String(eq.needs_iso_photo),
      String(eq.verified),
      csvEscape(eq.verified_by   ?? ''),
      csvEscape(eq.verified_date ?? ''),
      String(decommissioned.has(eq.equipment_id)),
      csvEscape(eq.notes ?? ''),
    ].join(','))

  return [headers.join(','), ...body].join('\n')
}

export function downloadEquipmentCsv(equipment: Equipment[], decommissioned: ReadonlySet<string>): void {
  const csv  = buildEquipmentCsv(equipment, decommissioned)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `LOTO_Equipment_Export_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
