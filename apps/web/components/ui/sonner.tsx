"use client"

import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { X } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

// Single global toast manager re-exported as `toast` for ergonomic
// toast(...) calls. The Toaster component must be mounted once (e.g.,
// in app/layout.tsx) for the toasts to render.
const toastManager = ToastPrimitive.createToastManager()

export const toast = {
  add:     (opts: Parameters<typeof toastManager.add>[0])     => toastManager.add(opts),
  update:  (id: string, opts: Parameters<typeof toastManager.update>[1]) => toastManager.update(id, opts),
  close:   (id: string) => toastManager.close(id),
  promise: <T,>(promise: Promise<T>, opts: Parameters<typeof toastManager.promise>[1]) => toastManager.promise(promise, opts),
}

function Toaster({ ...props }: ToastPrimitive.Provider.Props) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} {...props}>
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          data-slot="toaster"
          className="fixed top-auto right-4 bottom-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col-reverse gap-2 outline-none sm:bottom-4"
        >
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()
  return toasts.map((t) => (
    <ToastPrimitive.Root
      key={t.id}
      toast={t}
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-md border bg-background p-4 pr-8 shadow-lg",
        "transition-[opacity,transform] duration-200 data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        t.type === "error" && "border-destructive/30 text-destructive",
        t.type === "success" && "border-emerald-500/30",
      )}
    >
      <div className="flex-1 space-y-1">
        {t.title && (
          <ToastPrimitive.Title className="text-sm font-medium" />
        )}
        {t.description && (
          <ToastPrimitive.Description className="text-sm text-muted-foreground" />
        )}
      </div>
      <ToastPrimitive.Close
        className="absolute right-2 top-2 rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Close"
      >
        <X className="size-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  ))
}

export { Toaster }
