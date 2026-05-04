// Energy-source code registry. Single source of truth for every
// placard, badge, and PDF rendering of an energy code.
//
// Adopted from the Snak King canonical placard layout (April 2026):
// 12 codes covering the energy types Snak King uses across food
// production, packaging, and bakery. Two notes worth flagging:
//
//   • "CG" used to mean "Compressed Gas" but Snak King's reference
//     spreadsheet reused the same letters for "Control Gravity" too.
//     We resolved by keeping CG = Compressed Gas (the more universal
//     usage) and adding GR = Gravity for the rarer case.
//   • Migration 023 renames any pre-existing 'O' rows to 'M'
//     (Mechanical) and any 'OG' rows to 'CG'. The aliases below let
//     the app resolve old codes gracefully during the brief window
//     between deploy and migration apply.

export interface EnergyCode {
  code:     string
  labelEn:  string
  labelEs:  string
  hex:      string
  textHex:  string  // readable text color on the badge background
}

export const ENERGY_CODES: EnergyCode[] = [
  // ── Common / required ────────────────────────────────────────────
  { code: 'E',  labelEn: 'Electrical',     labelEs: 'Eléctrico',     hex: '#BF1414', textHex: '#FFFFFF' },
  { code: 'G',  labelEn: 'Gas',            labelEs: 'Gas',           hex: '#FFD900', textHex: '#1A1A1A' },
  { code: 'H',  labelEn: 'Hydraulic',      labelEs: 'Hidráulico',    hex: '#A67B5B', textHex: '#FFFFFF' },
  { code: 'P',  labelEn: 'Pneumatic',      labelEs: 'Neumático',     hex: '#1478C7', textHex: '#FFFFFF' },
  { code: 'M',  labelEn: 'Mechanical',     labelEs: 'Mecánico',      hex: '#7F4DB3', textHex: '#FFFFFF' },
  { code: 'T',  labelEn: 'Thermal',        labelEs: 'Térmico',       hex: '#000000', textHex: '#FFFFFF' },
  { code: 'W',  labelEn: 'Water',          labelEs: 'Agua',          hex: '#33993A', textHex: '#FFFFFF' },
  { code: 'S',  labelEn: 'Steam',          labelEs: 'Vapor',         hex: '#E07B00', textHex: '#FFFFFF' },
  { code: 'V',  labelEn: 'Valve',          labelEs: 'Válvula',       hex: '#888888', textHex: '#FFFFFF' },
  { code: 'CG', labelEn: 'Compressed Gas', labelEs: 'Gas Comprimido',hex: '#0E8A8A', textHex: '#FFFFFF' },
  { code: 'CP', labelEn: 'Control Panel',  labelEs: 'Panel Control', hex: '#FFFFFF', textHex: '#1A1A1A' },
  { code: 'GR', labelEn: 'Gravity',        labelEs: 'Gravedad',      hex: '#8B0A1A', textHex: '#FFFFFF' },
  // ── Sentinel ─────────────────────────────────────────────────────
  { code: 'N',  labelEn: 'None',           labelEs: 'Ninguno',       hex: '#555555', textHex: '#FFFFFF' },
]

// Legacy code → canonical code. Lets old rows render correctly during
// the brief window between deploy and migration 023 apply, and keeps
// downstream tools that may have cached pre-migration codes working.
const ALIASES: Record<string, string> = {
  O:  'M',   // Mechanical
  OG: 'CG',  // Compressed Gas
}

const byCode = new Map(ENERGY_CODES.map(c => [c.code.toUpperCase(), c]))

export function energyCodeFor(code: string | null | undefined): EnergyCode {
  const raw = (code ?? '').toUpperCase().trim()
  const key = ALIASES[raw] ?? raw
  return byCode.get(key) ?? {
    code: raw || '?',
    labelEn: raw || 'Unknown',
    labelEs: raw || 'Desconocido',
    hex: '#888888',
    textHex: '#FFFFFF',
  }
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
}
