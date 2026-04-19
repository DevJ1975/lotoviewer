export interface EnergyCode {
  code:     string
  labelEn:  string
  labelEs:  string
  hex:      string
  textHex:  string  // readable text color on the badge background
}

export const ENERGY_CODES: EnergyCode[] = [
  { code: 'E',  labelEn: 'Electrical',  labelEs: 'Eléctrico',  hex: '#FFD900', textHex: '#1A1A1A' },
  { code: 'G',  labelEn: 'Gas',         labelEs: 'Gas',        hex: '#33993A', textHex: '#FFFFFF' },
  { code: 'H',  labelEn: 'Hydraulic',   labelEs: 'Hidráulico', hex: '#1478C7', textHex: '#FFFFFF' },
  { code: 'P',  labelEn: 'Pneumatic',   labelEs: 'Neumático',  hex: '#999999', textHex: '#FFFFFF' },
  { code: 'N',  labelEn: 'None',        labelEs: 'Ninguno',    hex: '#555555', textHex: '#FFFFFF' },
  { code: 'O',  labelEn: 'Mechanical',  labelEs: 'Mecánico',   hex: '#BF1414', textHex: '#FFFFFF' },
  { code: 'OG', labelEn: 'Comp. Gas',   labelEs: 'Gas Comp.',  hex: '#7F4DB3', textHex: '#FFFFFF' },
]

const byCode = new Map(ENERGY_CODES.map(c => [c.code.toUpperCase(), c]))

export function energyCodeFor(code: string | null | undefined): EnergyCode {
  const key = (code ?? '').toUpperCase().trim()
  return byCode.get(key) ?? { code: key || '?', labelEn: key || 'Unknown', labelEs: key || 'Desconocido', hex: '#888888', textHex: '#FFFFFF' }
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
}
