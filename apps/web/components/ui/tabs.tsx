"use client"

import * as React from "react"
import {
  Tabs as AriaTabs,
  TabList,
  Tab,
  TabPanel,
} from "react-aria-components"

import { cn } from "@/lib/utils"

// Migrated to React Aria Components (Spectrum migration Phase 1, compound
// primitive). Export names are preserved (Tabs, TabsList, TabsTab, TabsPanel);
// RAC's key-based API is used (Tabs: selectedKey/defaultSelectedKey/
// onSelectionChange; TabsTab + TabsPanel: id). This primitive currently has no
// call sites, so adopting RAC's native API is safe and establishes the
// compound-adapter pattern for Select/Dialog/etc.

function Tabs({ className, ...props }: React.ComponentProps<typeof AriaTabs>) {
  return (
    <AriaTabs
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabList>) {
  return (
    <TabList
      data-slot="tabs-list"
      className={cn(
        "relative inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: React.ComponentProps<typeof Tab>) {
  return (
    <Tab
      data-slot="tabs-tab"
      className={cn(
        "relative z-10 inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none",
        "data-[focus-visible]:ring-3 data-[focus-visible]:ring-ring/50",
        "data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: React.ComponentProps<typeof TabPanel>) {
  return (
    <TabPanel
      data-slot="tabs-panel"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsPanel }
