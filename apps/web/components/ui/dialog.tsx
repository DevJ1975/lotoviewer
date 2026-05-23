"use client"

import * as React from "react"
import {
  ModalOverlay,
  Modal,
  Dialog as AriaDialog,
  Heading,
  Button as AriaButton,
} from "react-aria-components"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

// Migrated to React Aria Components (Spectrum migration). The public API is
// preserved for the existing consumers (OnboardingDialog + the ⌘K command
// palette), both of which use the *controlled* form:
//   <Dialog open onOpenChange={...}><DialogContent>…</DialogContent></Dialog>
//
// RAC has no single radix-style root that owns open state + trigger + content,
// so a tiny context carries {open, onOpenChange} from <Dialog> to
// <DialogContent>, which renders the RAC ModalOverlay → Modal → Dialog stack.
// RAC handles focus trap, Escape, and dismiss; the backdrop is the overlay.

interface DialogContextValue {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}
const DialogContext = React.createContext<DialogContextValue>({})

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <DialogContext.Provider value={{ open: open ?? defaultOpen, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  )
}

// Kept for export compatibility. The migrated consumers are controlled and
// don't use these; they're thin passthroughs / helpers.
function DialogTrigger({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}
function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}
function DialogBackdrop() {
  return null
}
function DialogClose({ className, children, ...props }: React.ComponentProps<typeof AriaButton>) {
  return (
    <AriaButton slot="close" className={className} {...props}>
      {children}
    </AriaButton>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
}: {
  className?: string
  children?: React.ReactNode
  showCloseButton?: boolean
}) {
  const { open, onOpenChange } = React.useContext(DialogContext)
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        "bg-black/50 backdrop-blur-sm",
        "entering:animate-in entering:fade-in-0 exiting:animate-out exiting:fade-out-0",
      )}
    >
      <Modal className="entering:animate-in entering:zoom-in-95 exiting:animate-out exiting:zoom-out-95">
        <AriaDialog
          data-slot="dialog-content"
          className={cn(
            "relative grid w-full max-w-lg gap-4 rounded-xl border bg-background p-6 shadow-lg outline-none",
            className,
          )}
        >
          {children}
          {showCloseButton && (
            <AriaButton
              onPress={() => onOpenChange?.(false)}
              className="absolute top-4 right-4 rounded-sm opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </AriaButton>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof Heading>) {
  return (
    <Heading
      slot="title"
      data-slot="dialog-title"
      className={cn("font-heading text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogBackdrop,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
