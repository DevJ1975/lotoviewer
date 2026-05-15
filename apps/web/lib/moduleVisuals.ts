import type { ComponentType, SVGProps } from 'react'
import {
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Box,
  Brush,
  ClipboardList,
  Eye,
  FileArchive,
  GraduationCap,
  LifeBuoy,
  Megaphone,
  MessageSquare,
  Recycle,
  Settings,
  Siren,
  Sparkles,
  Tag,
  Users,
  Webhook,
} from 'lucide-react'
import {
  BiohazardIcon,
  FlameTriangleIcon,
  HardHatIcon,
  HazardDiamondIcon,
  ManholeIcon,
  PadlockIcon,
} from '@/components/icons/safety'
import { FEATURES, getFeature, type FeatureDef, type ModuleColor } from '@soteria/core/features'

// Structural type that matches both Lucide icons and our custom safety
// pictogram components. Both accept `className` and an SVG prop bag, so
// any `<Icon className="..." />` call site works against this.
export type ModuleIconComponent = ComponentType<{ className?: string } & SVGProps<SVGSVGElement>>

// Web-only resolver that turns the string-typed `icon` and `color`
// fields on FEATURES into actual Lucide components and Tailwind
// className strings.
//
// Why split this out instead of putting it on the FeatureDef itself?
// `packages/core` is shared with the mobile app — importing
// `lucide-react` (web-only DOM SVGs) into core would break the
// React Native build. Mobile gets the same string fields and its
// own `lucide-react-native` resolver when that surface lands.
//
// Why hardcoded className strings instead of templates? Tailwind 4's
// JIT scanner only emits classes it can SEE in source. A template
// like `bg-${color}-100` would skip every variant. Every className
// in MODULE_COLOR_CLASSES is a literal so the scanner finds them.
//
// Adding a new color: extend `ModuleColor` in features.ts, add the
// matching row here, ship.
// Adding a new icon: import + register in MODULE_ICONS.

interface ColorClasses {
  /** Icon-tile background + text. Used in the drawer + per-module accent. */
  tile:   string
  /** Pill background + text. Used in the per-module-header accent for the
   *  module-name label. */
  pill:   string
  /** Active-row ring on the drawer. */
  ring:   string
  /** Chrome accent strip fill — solid color, no opacity. */
  strip:  string
  /** Per-module accent left-border (4px). */
  border: string
  /** Just the text class — pulled out for callers that only need text-color. */
  text:   string
}

export const MODULE_COLOR_CLASSES: Record<ModuleColor, ColorClasses> = {
  red: {
    tile:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    pill:   'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    ring:   'ring-1 ring-red-300 dark:ring-red-700',
    strip:  'bg-red-500',
    border: 'border-red-500',
    text:   'text-red-700 dark:text-red-300',
  },
  amber: {
    tile:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    pill:   'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    ring:   'ring-1 ring-amber-300 dark:ring-amber-700',
    strip:  'bg-amber-500',
    border: 'border-amber-500',
    text:   'text-amber-700 dark:text-amber-300',
  },
  orange: {
    tile:   'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    pill:   'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
    ring:   'ring-1 ring-orange-300 dark:ring-orange-700',
    strip:  'bg-orange-500',
    border: 'border-orange-500',
    text:   'text-orange-700 dark:text-orange-300',
  },
  purple: {
    tile:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    pill:   'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
    ring:   'ring-1 ring-purple-300 dark:ring-purple-700',
    strip:  'bg-purple-500',
    border: 'border-purple-500',
    text:   'text-purple-700 dark:text-purple-300',
  },
  rose: {
    tile:   'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    pill:   'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
    ring:   'ring-1 ring-rose-300 dark:ring-rose-700',
    strip:  'bg-rose-500',
    border: 'border-rose-500',
    text:   'text-rose-700 dark:text-rose-300',
  },
  teal: {
    tile:   'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    pill:   'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
    ring:   'ring-1 ring-teal-300 dark:ring-teal-700',
    strip:  'bg-teal-500',
    border: 'border-teal-500',
    text:   'text-teal-700 dark:text-teal-300',
  },
  sky: {
    tile:   'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    pill:   'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    ring:   'ring-1 ring-sky-300 dark:ring-sky-700',
    strip:  'bg-sky-500',
    border: 'border-sky-500',
    text:   'text-sky-700 dark:text-sky-300',
  },
  indigo: {
    tile:   'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    pill:   'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
    ring:   'ring-1 ring-indigo-300 dark:ring-indigo-700',
    strip:  'bg-indigo-500',
    border: 'border-indigo-500',
    text:   'text-indigo-700 dark:text-indigo-300',
  },
  emerald: {
    tile:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    pill:   'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    ring:   'ring-1 ring-emerald-300 dark:ring-emerald-700',
    strip:  'bg-emerald-500',
    border: 'border-emerald-500',
    text:   'text-emerald-700 dark:text-emerald-300',
  },
  slate: {
    tile:   'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    pill:   'bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
    ring:   'ring-1 ring-slate-300 dark:ring-slate-700',
    strip:  'bg-slate-400 dark:bg-slate-600',
    border: 'border-slate-400',
    text:   'text-slate-700 dark:text-slate-300',
  },
}

const FALLBACK_COLOR: ModuleColor = 'slate'

// Module icon registry. Six signature safety modules render with hand-
// drawn duotone pictograms (`components/icons/safety`) so they read as
// real industrial signage; everything else stays on Lucide for now and
// inherits a chunkier visual via the `.module-icon-treatment` class
// applied at the tile call sites.
//
// Feature names below (the keys) match the string `icon:` values in
// `packages/core/src/features.ts`. Add a new icon here once the
// feature declares its name there.
const MODULE_ICONS: Record<string, ModuleIconComponent> = {
  // ── Custom duotone safety pictograms ───────────────────────────────
  Lock:          PadlockIcon,         // LOTO
  Flame:         FlameTriangleIcon,   // Hot work
  FlaskConical:  BiohazardIcon,       // Chemicals / hazmat
  DoorClosed:    ManholeIcon,         // Confined spaces
  ShieldCheck:   HazardDiamondIcon,   // Risk / equipment readiness
  Users:         HardHatIcon,         // Workers / PPE

  // ── Lucide fallbacks for non-signature modules ─────────────────────
  AlertOctagon, AlertTriangle, BarChart3, Bell, BookOpen, Brush,
  ClipboardList, Eye, FileArchive, GraduationCap, LifeBuoy,
  Megaphone, MessageSquare, Settings, Siren, Sparkles,
  Tag, Webhook, Recycle,
}

const FALLBACK_ICON: ModuleIconComponent = Box

export interface ModuleVisuals {
  Icon:    ModuleIconComponent
  classes: ColorClasses
  color:   ModuleColor
  /** The resolved feature, or null if the id wasn't found. The drawer
   *  uses this to inherit visuals from a parent module for child rows. */
  feature: FeatureDef | null
}

/** Resolve a feature id (top-level OR child) to its visuals. Children
 *  inherit their parent's icon + color so a child row in the drawer
 *  doesn't need its own assignment. */
export function getModuleVisuals(featureId: string): ModuleVisuals {
  const feature = getFeature(featureId)
  if (!feature) {
    return {
      Icon:    FALLBACK_ICON,
      classes: MODULE_COLOR_CLASSES[FALLBACK_COLOR],
      color:   FALLBACK_COLOR,
      feature: null,
    }
  }

  // Walk up the parent chain so a child like 'loto-print' inherits
  // LOTO's icon + color without each child needing its own fields.
  let owner: FeatureDef = feature
  while (owner.parent && (!owner.icon || !owner.color)) {
    const parent = getFeature(owner.parent)
    if (!parent) break
    owner = parent
  }

  const color  = owner.color ?? FALLBACK_COLOR
  const Icon   = (owner.icon && MODULE_ICONS[owner.icon]) || FALLBACK_ICON

  return {
    Icon,
    classes: MODULE_COLOR_CLASSES[color],
    color,
    feature,
  }
}

/** Resolve a path to the visuals of the module that owns it. Picks the
 *  module whose `href` is the longest prefix of `pathname`. Used by
 *  the chrome accent strip to color itself based on the active route.
 *
 *  Returns the slate fallback when no module matches (e.g. on `/`,
 *  `/login`, `/superadmin/...`). */
export function getModuleVisualsForPath(pathname: string | null): ModuleVisuals {
  if (!pathname) {
    return {
      Icon:    FALLBACK_ICON,
      classes: MODULE_COLOR_CLASSES[FALLBACK_COLOR],
      color:   FALLBACK_COLOR,
      feature: null,
    }
  }

  let best: FeatureDef | null = null
  let bestLen = 0
  for (const f of FEATURES) {
    if (!f.href || f.parent) continue  // top-level routables only
    const href = f.href
    if (pathname === href || pathname.startsWith(href + '/')) {
      if (href.length > bestLen) {
        best = f
        bestLen = href.length
      }
    }
  }

  if (!best) {
    return {
      Icon:    FALLBACK_ICON,
      classes: MODULE_COLOR_CLASSES[FALLBACK_COLOR],
      color:   FALLBACK_COLOR,
      feature: null,
    }
  }
  return getModuleVisuals(best.id)
}
