import { NFPA_QUADRANT_HEX } from '@soteria/core/hazardSymbols'

// NFPA 704 "fire diamond" — a pure-SVG, client-safe renderer (no hooks,
// no state). The same four colors come from NFPA_QUADRANT_HEX so this
// matches the PDF renderer (lib/nfpa704.ts) pixel-for-pixel in hue.
//
// The diamond stands on a point and is split into four smaller diamonds:
//   blue   (left)   → health
//   red    (top)    → flammability
//   yellow (right)  → instability
//   white  (bottom) → special symbol (W / OX / SA, free text)
//
// Numeric quadrants show the 0-4 rating (an en-dash when null); the white
// quadrant shows the special symbol text. Tailwind sizes the wrapper only;
// the diamond itself is intrinsic SVG so it scales crisply at any size.

const SIZES = {
  sm: 'h-12 w-12',
  md: 'h-20 w-20',
  lg: 'h-28 w-28',
} as const

interface Props {
  health:        number | null
  flammability:  number | null
  instability:   number | null
  special:       string | null
  size?:         keyof typeof SIZES
}

// 100×100 viewBox. The outer diamond's points sit at the edge midpoints;
// `C` is the center and `M*` are the four outer vertices. Each colored
// quadrant is the smaller diamond bounded by C and two adjacent edge
// midpoints of the half-diagonals.
const C = 50
const TOP = 2
const RIGHT = 98
const BOTTOM = 98
const LEFT = 2
// Midpoints between the center and each outer vertex — the inner corners
// where the four quadrants meet their neighbours.
const MID = (C + TOP) / 2 // 26 — distance the inner vertices sit from center

// Quadrant polygons, each a diamond: center, two edge-midpoints, outer vertex.
const QUADRANTS = {
  // top (flammability): C → mid-up-right → top vertex → mid-up-left
  flammability: `${C},${MID} ${(C + RIGHT) / 2},${(TOP + C) / 2} ${C},${TOP} ${(LEFT + C) / 2},${(TOP + C) / 2}`,
  // right (instability): C → mid-down-right → right vertex → mid-up-right
  instability: `${100 - MID},${C} ${(C + RIGHT) / 2},${(C + BOTTOM) / 2} ${RIGHT},${C} ${(C + RIGHT) / 2},${(TOP + C) / 2}`,
  // bottom (special): C → mid-down-left → bottom vertex → mid-down-right
  special: `${C},${100 - MID} ${(LEFT + C) / 2},${(C + BOTTOM) / 2} ${C},${BOTTOM} ${(C + RIGHT) / 2},${(C + BOTTOM) / 2}`,
  // left (health): C → mid-up-left → left vertex → mid-down-left
  health: `${MID},${C} ${(LEFT + C) / 2},${(TOP + C) / 2} ${LEFT},${C} ${(LEFT + C) / 2},${(C + BOTTOM) / 2}`,
} as const

// Text anchor points — the visual center of each quadrant.
const TEXT_POS = {
  flammability: { x: C, y: (TOP + C) / 2 + 4 },
  instability:  { x: (C + RIGHT) / 2, y: C + 4 },
  special:      { x: C, y: (C + BOTTOM) / 2 + 4 },
  health:       { x: (LEFT + C) / 2, y: C + 4 },
} as const

function ratingText(value: number | null): string {
  return value === null ? '–' : String(value)
}

export function Nfpa704Diamond({
  health,
  flammability,
  instability,
  special,
  size = 'md',
}: Props) {
  const specialText = special && special.trim() ? special.trim().slice(0, 3) : '–'
  const summary =
    `NFPA 704: health ${ratingText(health)}, flammability ${ratingText(flammability)}, ` +
    `instability ${ratingText(instability)}, special ${special && special.trim() ? special.trim() : 'none'}`

  return (
    <svg
      viewBox="0 0 100 100"
      className={SIZES[size]}
      role="img"
      aria-label={summary}
    >
      <title>{summary}</title>
      {/* Black frame so each colored quadrant reads as inset within it. */}
      <polygon
        points={`${C},${TOP} ${RIGHT},${C} ${C},${BOTTOM} ${LEFT},${C}`}
        fill="#000000"
      />
      <polygon points={QUADRANTS.health} fill={NFPA_QUADRANT_HEX.health} />
      <polygon points={QUADRANTS.flammability} fill={NFPA_QUADRANT_HEX.flammability} />
      <polygon points={QUADRANTS.instability} fill={NFPA_QUADRANT_HEX.instability} />
      <polygon
        points={QUADRANTS.special}
        fill={NFPA_QUADRANT_HEX.special}
        stroke="#000000"
        strokeWidth={0.5}
      />

      {/* Ratings: white numerals on the colored quadrants, black on white. */}
      <text
        x={TEXT_POS.flammability.x}
        y={TEXT_POS.flammability.y}
        textAnchor="middle"
        fontSize={18}
        fontWeight="bold"
        fill="#ffffff"
      >
        {ratingText(flammability)}
      </text>
      <text
        x={TEXT_POS.instability.x}
        y={TEXT_POS.instability.y}
        textAnchor="middle"
        fontSize={18}
        fontWeight="bold"
        fill="#ffffff"
      >
        {ratingText(instability)}
      </text>
      <text
        x={TEXT_POS.health.x}
        y={TEXT_POS.health.y}
        textAnchor="middle"
        fontSize={18}
        fontWeight="bold"
        fill="#ffffff"
      >
        {ratingText(health)}
      </text>
      <text
        x={TEXT_POS.special.x}
        y={TEXT_POS.special.y}
        textAnchor="middle"
        fontSize={specialText.length > 1 ? 12 : 18}
        fontWeight="bold"
        fill="#000000"
      >
        {specialText}
      </text>
    </svg>
  )
}
