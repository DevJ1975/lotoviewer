// Module identity pictograms — the full line + soft-duotone safety set.
// One component per `icon:` string declared in
// `packages/core/src/features.ts`; `moduleVisuals.ts` maps those string
// keys onto these components.
//
// Visual language: a thin `currentColor` stroke (1.75) over a translucent
// `currentColor` fill (~0.13–0.5 opacity). Because every layer paints with
// `currentColor`, a single `text-{color}-700` / `dark:text-{color}-300`
// cascade theme-tints the whole pictogram — light, dark, and the per-module
// accent colors declared in moduleVisuals.ts all "just work". Drawn in the
// ISO-7010 / ANSI signage idiom: clear silhouettes, no fine detail, legible
// at 16px. Inside a `.module-icon-tile` wrapper the shared stroke is pumped
// to 2.25 (see globals.css) so the marks carry module-identity weight.
//
// Why inline SVGs over an icon package? No new dependency, full control of
// the visual vocabulary, ~12 lines each, tree-shakable, zero runtime cost.

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { className?: string }

const baseProps: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
  focusable: false,
}

// LOTO — padlock  (features.ts icon: 'Lock')
export function PadlockIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <rect x="5.5" y="11" width="13" height="9" rx="1.3" fill="currentColor" fillOpacity="0.14"/>
      <rect x="5.5" y="11" width="13" height="9" rx="1.3"/>
      <path d="M8 11V8.2a4 4 0 0 1 8 0V11"/>
      <circle cx="12" cy="14.6" r="1.4" fill="currentColor"/>
      <path d="M12 16v2.2"/>
    </svg>
  )
}

// Hot work — flame in a warning triangle  (features.ts icon: 'Flame')
export function FlameTriangleIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 3.6 21.4 20.4H2.6Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M12 3.6 21.4 20.4H2.6Z"/>
      <path d="M12 9.6c.7 1.2 1.9 1.8 1.9 3.4a1.9 1.9 0 0 1-3.8.1c0-.8.4-1.2.6-1.9-.7.3-1.1 1-1.1 1.9a2.7 2.7 0 0 0 5.4 0c0-2.1-1.7-3.3-3-4.9Z" fill="currentColor" fillOpacity="0.42" stroke="none"/>
    </svg>
  )
}

// Chemicals — flask  (features.ts icon: 'FlaskConical')
export function FlaskIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M9.4 3.6h5.2" strokeLinecap="round"/>
      <path d="M10 4v4.8L5.7 16.9A2 2 0 0 0 7.5 20h9a2 2 0 0 0 1.8-3.1L14 8.8V4" fill="currentColor" fillOpacity="0.13"/>
      <path d="M10 4v4.8L5.7 16.9A2 2 0 0 0 7.5 20h9a2 2 0 0 0 1.8-3.1L14 8.8V4"/>
      <path d="M7.9 14.2h8.2"/>
      <circle cx="11" cy="17" r="0.6" fill="currentColor" stroke="none"/>
      <circle cx="13.2" cy="18" r="0.5" fill="currentColor" stroke="none"/>
    </svg>
  )
}

// Confined space — opening with a worker descending  (features.ts icon: 'DoorClosed')
export function ConfinedSpaceIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <ellipse cx="12" cy="18" rx="8" ry="2.3" fill="currentColor" fillOpacity="0.13"/>
      <ellipse cx="12" cy="18" rx="8" ry="2.3"/>
      <ellipse cx="12" cy="18" rx="4.3" ry="1.1" fill="currentColor" fillOpacity="0.22" stroke="none"/>
      <path d="M12 4v8"/>
      <path d="M8.4 9.3 12 12.8l3.6-3.5"/>
    </svg>
  )
}

// Risk / warning  (features.ts icon: 'AlertTriangle')
export function RiskTriangleIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 3.6 21.4 20.4H2.6Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M12 3.6 21.4 20.4H2.6Z"/>
      <path d="M12 9.6v4.4"/>
      <circle cx="12" cy="17" r="0.95" fill="currentColor" stroke="none"/>
    </svg>
  )
}

// Incident beacon — siren  (features.ts icon: 'Siren')
export function SirenIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M7.5 18.5v-4a4.5 4.5 0 0 1 9 0v4Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M7.5 18.5v-4a4.5 4.5 0 0 1 9 0v4"/>
      <path d="M5.6 18.5h12.8"/>
      <path d="M12 6V3.7M5 8.4 3.5 7.2M19 8.4 20.5 7.2"/>
    </svg>
  )
}

// Observation — eye  (features.ts icon: 'Eye')
export function ObserveEyeIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M2.6 12S6 6.6 12 6.6 21.4 12 21.4 12 18 17.4 12 17.4 2.6 12 2.6 12Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M2.6 12S6 6.6 12 6.6 21.4 12 21.4 12 18 17.4 12 17.4 2.6 12 2.6 12Z"/>
      <circle cx="12" cy="12" r="2.5" fill="currentColor" fillOpacity="0.33"/>
      <circle cx="12" cy="12" r="2.5"/>
    </svg>
  )
}

// Hazardous waste — drum  (features.ts icon: 'Recycle')
export function WasteDrumIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M6.8 6.5h10.4v12.2a1 1 0 0 1-1 1H7.8a1 1 0 0 1-1-1Z" fill="currentColor" fillOpacity="0.13"/>
      <ellipse cx="12" cy="6.5" rx="5.2" ry="1.5"/>
      <path d="M6.8 6.5v12.2a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1V6.5"/>
      <path d="M6.8 10.8h10.4M6.8 15.3h10.4"/>
    </svg>
  )
}

// Near-miss — octagon  (features.ts icon: 'AlertOctagon')
export function NearMissOctagonIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M8.1 3.3h7.8L20.7 8.1v7.8L15.9 20.7H8.1L3.3 15.9V8.1Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M8.1 3.3h7.8L20.7 8.1v7.8L15.9 20.7H8.1L3.3 15.9V8.1Z"/>
      <path d="M12 8v4.6"/>
      <circle cx="12" cy="15.8" r="0.95" fill="currentColor" stroke="none"/>
    </svg>
  )
}

// JHA — clipboard list  (features.ts icon: 'ClipboardList')
export function ClipboardListIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <rect x="5" y="5" width="14" height="16" rx="1.5" fill="currentColor" fillOpacity="0.13"/>
      <rect x="5" y="5" width="14" height="16" rx="1.5"/>
      <rect x="8.5" y="3.4" width="7" height="3.4" rx="1" fill="currentColor" fillOpacity="0.5"/>
      <path d="M8.5 11h7M8.5 14.2h7M8.5 17.4h4.4"/>
    </svg>
  )
}

// Inspection — clipboard check  (features.ts icon: 'ClipboardCheck')
export function ClipboardCheckIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <rect x="5" y="5" width="14" height="16" rx="1.5" fill="currentColor" fillOpacity="0.13"/>
      <rect x="5" y="5" width="14" height="16" rx="1.5"/>
      <rect x="8.5" y="3.4" width="7" height="3.4" rx="1" fill="currentColor" fillOpacity="0.5"/>
      <path d="M9 14.4 11.1 16.5 15.4 11.8"/>
    </svg>
  )
}

// Toolbox talks — megaphone  (features.ts icon: 'Megaphone')
export function MegaphoneIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M6.2 10 17 5.4v13.2L6.2 14Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M6.2 10 17 5.4v13.2L6.2 14Z"/>
      <path d="M6.2 10H4.4a1.2 1.2 0 0 0-1.2 1.2v1.6A1.2 1.2 0 0 0 4.4 14h1.8"/>
      <path d="M8.5 14.8v3a1.6 1.6 0 0 0 3.2 0v-1.6"/>
      <path d="M20 9.5c1 1.2 1 3.8 0 5"/>
    </svg>
  )
}

// Training / STRIKE — graduation cap  (features.ts icon: 'GraduationCap')
export function GradCapIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 4.8 22 9l-10 4.2L2 9Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M12 4.8 22 9l-10 4.2L2 9Z"/>
      <path d="M6 11v4.2c0 1.5 2.7 2.6 6 2.6s6-1.1 6-2.6V11"/>
      <path d="M22 9v4.2"/>
    </svg>
  )
}

// Scorecard — bars  (features.ts icon: 'BarChart3')
export function BarsIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M4 4.5v15.5h15.5"/>
      <rect x="6.5" y="12" width="3" height="6" fill="currentColor" fillOpacity="0.26"/>
      <rect x="6.5" y="12" width="3" height="6"/>
      <rect x="11" y="8.5" width="3" height="9.5" fill="currentColor" fillOpacity="0.26"/>
      <rect x="11" y="8.5" width="3" height="9.5"/>
      <rect x="15.5" y="5.5" width="3" height="12.5" fill="currentColor" fillOpacity="0.26"/>
      <rect x="15.5" y="5.5" width="3" height="12.5"/>
    </svg>
  )
}

// Risk intelligence — sparkle  (features.ts icon: 'Sparkles')
export function SparkInsightIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M11.5 3.8 13.2 9.3 18.7 11l-5.5 1.7-1.7 5.5-1.7-5.5L4.3 11l5.5-1.7Z" fill="currentColor" fillOpacity="0.15"/>
      <path d="M11.5 3.8 13.2 9.3 18.7 11l-5.5 1.7-1.7 5.5-1.7-5.5L4.3 11l5.5-1.7Z"/>
      <path d="M18 5 18.6 6.6 20.2 7.2 18.6 7.8 18 9.4 17.4 7.8 15.8 7.2 17.4 6.6Z" fill="currentColor" stroke="none"/>
    </svg>
  )
}

// Compliance bundle — binder  (features.ts icon: 'FileArchive')
export function ArchiveBinderIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <rect x="5" y="4" width="14" height="16" rx="1.4" fill="currentColor" fillOpacity="0.13"/>
      <rect x="5" y="4" width="14" height="16" rx="1.4"/>
      <path d="M5 8.2h14"/>
      <path d="M12 10v1M12 12.5v1"/>
      <rect x="10.4" y="14.4" width="3.2" height="3.2" rx="0.6" fill="currentColor" fillOpacity="0.26"/>
      <rect x="10.4" y="14.4" width="3.2" height="3.2" rx="0.6"/>
    </svg>
  )
}

// Compliance calendar  (features.ts icon: 'CalendarClock')
export function CalendarClockIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <rect x="3.5" y="5.5" width="12.5" height="13" rx="1.4" fill="currentColor" fillOpacity="0.13"/>
      <rect x="3.5" y="5.5" width="12.5" height="13" rx="1.4"/>
      <path d="M3.5 9.4h12.5M7.5 3.6v3.6M12 3.6v3.6"/>
      <circle cx="17.5" cy="16.5" r="4.2" fill="currentColor" fillOpacity="0.13"/>
      <circle cx="17.5" cy="16.5" r="4.2"/>
      <path d="M17.5 14.6v2l1.3 1"/>
    </svg>
  )
}

// LOTO devices — tag  (features.ts icon: 'Tag')
export function LockTagIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M4 4.5h6.6L20 13.9l-6.6 6.6L4 11.1Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M4 4.5h6.6L20 13.9l-6.6 6.6L4 11.1Z"/>
      <circle cx="8" cy="8.5" r="1.5" fill="currentColor"/>
    </svg>
  )
}

// Workers / PPE — hard hat  (features.ts icon: 'Users')
export function HardHatIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <rect x="3.6" y="16.2" width="16.8" height="2.8" rx="0.9" fill="currentColor" fillOpacity="0.18"/>
      <rect x="3.6" y="16.2" width="16.8" height="2.8" rx="0.9"/>
      <path d="M6 16.2v-2.3C6 10.3 8.7 7.2 12 7.2s6 3.1 6 6.7v2.3" fill="currentColor" fillOpacity="0.13"/>
      <path d="M6 16.2v-2.3C6 10.3 8.7 7.2 12 7.2s6 3.1 6 6.7v2.3"/>
      <path d="M12 7.2V5.2M9.7 7.5V6.2M14.3 7.5V6.2"/>
    </svg>
  )
}

// Configuration — hex nut  (features.ts icon: 'Settings')
export function HexNutIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 3 19.5 7.4v9.2L12 21 4.5 16.6V7.4Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M12 3 19.5 7.4v9.2L12 21 4.5 16.6V7.4Z"/>
      <circle cx="12" cy="12" r="3.2" fill="currentColor" fillOpacity="0.13"/>
      <circle cx="12" cy="12" r="3.2"/>
    </svg>
  )
}

// Webhooks  (features.ts icon: 'Webhook')
export function WebhookIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <circle cx="7" cy="7.5" r="2.4" fill="currentColor" fillOpacity="0.15"/>
      <circle cx="7" cy="7.5" r="2.4"/>
      <circle cx="16.8" cy="9" r="2.4"/>
      <circle cx="10.8" cy="17.5" r="2.4" fill="currentColor" fillOpacity="0.15"/>
      <circle cx="10.8" cy="17.5" r="2.4"/>
      <path d="M8.6 9.2 9.9 15.2M15.6 10.6 12.4 16M9 7.2 14.9 8.4"/>
    </svg>
  )
}

// Data hygiene — scrub brush  (features.ts icon: 'Brush')
export function ScrubBrushIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <rect x="5.5" y="12.6" width="13" height="4.2" rx="1" fill="currentColor" fillOpacity="0.18"/>
      <rect x="5.5" y="12.6" width="13" height="4.2" rx="1"/>
      <path d="M9 12.6V7.8a3 3 0 0 1 6 0v4.8"/>
      <path d="M7.2 16.8v3M9.8 16.8v3M12.4 16.8v3M15 16.8v3"/>
    </svg>
  )
}

// Notifications — bell  (features.ts icon: 'Bell')
export function BellIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M6 17V11a6 6 0 0 1 12 0v6l1.6 2H4.4Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M6 17V11a6 6 0 0 1 12 0v6l1.6 2H4.4Z"/>
      <path d="M12 5V3"/>
      <path d="M10 19.5a2 2 0 0 0 4 0"/>
    </svg>
  )
}

// Safety boards — forum  (features.ts icon: 'MessageSquare')
export function ForumIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M4 5.2h16v10.6H9L5 19v-3.2H4Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M4 5.2h16v10.6H9L5 19v-3.2H4Z"/>
      <path d="M8 9h8M8 12h5"/>
    </svg>
  )
}

// User manuals — open book  (features.ts icon: 'BookOpen')
export function ManualBookIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 6.2C9.5 4.7 5.2 4.7 3.2 5.7v12.2c2-1 6.3-1 8.8.5 2.5-1.5 6.8-1.5 8.8-.5V5.7c-2-1-6.3-1-8.8.5Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M12 6.2C9.5 4.7 5.2 4.7 3.2 5.7v12.2c2-1 6.3-1 8.8.5"/>
      <path d="M12 6.2c2.5-1.5 6.8-1.5 8.8-.5v12.2c-2-1-6.3-1-8.8.5"/>
      <path d="M12 6.2v12.2"/>
    </svg>
  )
}

// Support — life ring  (features.ts icon: 'LifeBuoy')
export function LifeRingIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <circle cx="12" cy="12" r="8.5" fill="currentColor" fillOpacity="0.1"/>
      <circle cx="12" cy="12" r="8.5"/>
      <circle cx="12" cy="12" r="3.3" fill="currentColor" fillOpacity="0.13"/>
      <circle cx="12" cy="12" r="3.3"/>
      <path d="M9.6 9.6 6.1 6.1M14.4 9.6 17.9 6.1M9.6 14.4 6.1 17.9M14.4 14.4 17.9 17.9"/>
    </svg>
  )
}

// Shield check  (features.ts icon: 'ShieldCheck')
export function ShieldCheckIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 3 19 5.4v6c0 4.5-3 7.6-7 9.6-4-2-7-5.1-7-9.6v-6Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M12 3 19 5.4v6c0 4.5-3 7.6-7 9.6-4-2-7-5.1-7-9.6v-6Z"/>
      <path d="M8.7 11.8 11 14.1l4.2-4.6"/>
    </svg>
  )
}

// Prop 65 / alert shield  (features.ts icon: 'ShieldAlert')
export function ShieldAlertIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 3 19 5.4v6c0 4.5-3 7.6-7 9.6-4-2-7-5.1-7-9.6v-6Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M12 3 19 5.4v6c0 4.5-3 7.6-7 9.6-4-2-7-5.1-7-9.6v-6Z"/>
      <path d="M12 8v3.8"/>
      <circle cx="12" cy="14.8" r="0.9" fill="currentColor" stroke="none"/>
    </svg>
  )
}

// SCIM — key  (features.ts icon: 'KeyRound')
export function KeyIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <circle cx="8" cy="8" r="4.2" fill="currentColor" fillOpacity="0.13"/>
      <circle cx="8" cy="8" r="4.2"/>
      <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
      <path d="M10.8 10.8 19 19M16.2 15.8 18 14M14.2 13.8 15.6 12.4"/>
    </svg>
  )
}

// CMMS integrations — cable  (features.ts icon: 'Cable')
export function LinkCableIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M9.5 9 6.8 11.7a3.2 3.2 0 0 0 4.5 4.5L13 14.5"/>
      <path d="M14.5 15 17.2 12.3a3.2 3.2 0 0 0-4.5-4.5L11 10.5"/>
      <path d="M5 8V5.5M7.5 5.5V3M19 16v2.5M16.5 18.5V21"/>
    </svg>
  )
}

// Contractors — building  (features.ts icon: 'Building2')
export function BuildingIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <rect x="5" y="4" width="14" height="16" rx="1" fill="currentColor" fillOpacity="0.13"/>
      <rect x="5" y="4" width="14" height="16" rx="1"/>
      <path d="M8.5 7.5h2M13.5 7.5h2M8.5 10.5h2M13.5 10.5h2"/>
      <path d="M10.2 20v-3.4h3.6V20" fill="currentColor" fillOpacity="0.18"/>
      <path d="M10.2 20v-3.4h3.6V20"/>
    </svg>
  )
}

// Working at heights — peak  (features.ts icon: 'Mountain')
export function PeakIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M2.8 19.2 9.5 7.8l3.4 5.6L16 9.2l5.2 10Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M2.8 19.2 9.5 7.8l3.4 5.6L16 9.2l5.2 10Z"/>
      <path d="M9.5 7.8 7.6 11h3.7Z" fill="currentColor" fillOpacity="0.33" stroke="none"/>
    </svg>
  )
}

// Fleet safety — truck  (features.ts icon: 'Truck')
export function TruckIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M2.8 7.4h10.7v9H2.8Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M2.8 7.4h10.7v9H2.8Z"/>
      <path d="M13.5 10.4H17l3.2 3.2v2.8h-6.7Z" fill="currentColor" fillOpacity="0.13"/>
      <path d="M13.5 10.4H17l3.2 3.2v2.8h-6.7"/>
      <circle cx="7" cy="17.6" r="1.9" fill="currentColor" fillOpacity="0.2"/>
      <circle cx="7" cy="17.6" r="1.9"/>
      <circle cx="16.8" cy="17.6" r="1.9" fill="currentColor" fillOpacity="0.2"/>
      <circle cx="16.8" cy="17.6" r="1.9"/>
    </svg>
  )
}
