"use client"

import { Separator as AriaSeparator, type SeparatorProps } from "react-aria-components"

import { cn } from "@/lib/utils"

// Migrated to React Aria Components (Spectrum migration Phase 1). Same
// `orientation`/`className` API; renders an accessible separator.
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorProps) {
  return (
    <AriaSeparator
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  )
}

export { Separator }
