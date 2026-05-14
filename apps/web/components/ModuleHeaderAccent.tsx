import { getModuleVisuals } from '@/lib/moduleVisuals'
import { getFeature } from '@soteria/core/features'

// Per-module header accent. Renders a colored icon tile + module-name
// pill in a thin strip above the page content. Mounted in each
// top-level module's layout.tsx so it appears above every page in
// that module without touching individual page.tsx files.
//
// Pairs with the chrome-level accent strip in AppChrome.tsx — the
// chrome strip is the persistent "you are here" cue at the very top;
// this accent reinforces it inline with the page content.

interface Props {
  moduleId: string
}

export default function ModuleHeaderAccent({ moduleId }: Props) {
  const { Icon, classes } = getModuleVisuals(moduleId)
  const feature = getFeature(moduleId)
  if (!feature) return null

  // Short, stable placard ID derived from the module slug. Reads like
  // a real piece of safety equipment ("MOD · LOTO") rather than a CMS
  // breadcrumb. First 4 chars uppercased keeps everything fixed-width.
  const placardId = moduleId.slice(0, 4).toUpperCase()

  return (
    <div className={`relative border-l-4 ${classes.border}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3">
        <span
          className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center ${classes.tile}`}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className={`placard-label-lg ${classes.text}`}>
          {feature.name}
        </span>
        <span aria-hidden="true" className="h-px flex-1 max-w-[8rem] bg-gradient-to-r from-slate-300 to-transparent dark:from-slate-700" />
        <span className="placard-numeric text-[10px] text-slate-400 dark:text-slate-500">
          MOD · {placardId}
        </span>
      </div>
    </div>
  )
}
