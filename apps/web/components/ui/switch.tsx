'use client'

import { Switch as AriaSwitch } from 'react-aria-components'

// Migrated to React Aria Components (Spectrum migration Phase 1). Public API is
// unchanged — { checked, onChange(checked), id, ariaLabel } — so call sites are
// untouched. RAC renders a real role="switch" control (keyboard + SR support);
// the pill/thumb look is preserved via native data-[selected] variants.
interface Props {
  checked:    boolean
  onChange:   (checked: boolean) => void
  id?:        string
  ariaLabel?: string
}

export function Switch({ checked, onChange, id, ariaLabel }: Props) {
  return (
    <AriaSwitch
      id={id}
      aria-label={ariaLabel}
      isSelected={checked}
      onChange={onChange}
      className="group relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-slate-300 outline-none transition-colors data-[selected]:bg-emerald-500 data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand-navy/30"
    >
      <span className="inline-block h-4 w-4 translate-x-1 transform rounded-full bg-white shadow transition-transform group-data-[selected]:translate-x-6 dark:bg-slate-900" />
    </AriaSwitch>
  )
}
