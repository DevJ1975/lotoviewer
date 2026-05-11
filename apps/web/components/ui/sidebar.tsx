"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { PanelLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SidebarContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }
  return context
}

function SidebarProvider({
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen

  const setOpen = React.useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [controlledOpen, onOpenChange])

  return (
    <SidebarContext.Provider value={{ open, setOpen }}>
      {children}
    </SidebarContext.Provider>
  )
}

function SidebarTrigger({
  className,
  onClick,
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { open, setOpen } = useSidebar()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Open navigation"
      aria-expanded={open}
      className={cn("size-10", className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) setOpen(true)
      }}
      {...props}
    >
      {children ?? <PanelLeft className="size-5" />}
    </Button>
  )
}

function Sidebar({
  className,
  children,
  side = "left",
  ...props
}: React.ComponentProps<"aside"> & { side?: "left" | "right" }) {
  const { open, setOpen } = useSidebar()

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  React.useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="App navigation"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <button
        type="button"
        aria-label="Close navigation"
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <aside
        data-slot="sidebar"
        className={cn(
          "relative flex h-full w-80 max-w-[88vw] flex-col border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl",
          side === "left" ? "border-r" : "ml-auto border-l",
          className
        )}
        {...props}
      >
        {children}
      </aside>
    </div>
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-header" className={cn("shrink-0 border-b border-sidebar-border p-3", className)} {...props} />
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-content" className={cn("min-h-0 flex-1 overflow-y-auto p-2", className)} {...props} />
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cn("shrink-0 border-t border-sidebar-border p-3", className)} {...props} />
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="sidebar-group" className={cn("py-2", className)} {...props} />
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="sidebar-group-label"
      className={cn("px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/50", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cn("space-y-0.5", className)} {...props} />
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn("min-w-0", className)} {...props} />
}

function SidebarMenuButton({
  className,
  isActive,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  isActive?: boolean
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive ? "true" : "false"}
      className={cn(
        "group/menu-button flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-xs",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      className={cn("ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-2", className)}
      {...props}
    />
  )
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-sub-item" className={cn("min-w-0", className)} {...props} />
}

function SidebarMenuSubButton({
  className,
  isActive,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  isActive?: boolean
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-active={isActive ? "true" : "false"}
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-sidebar-foreground/80 transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
}
