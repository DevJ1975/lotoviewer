"use client"

import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner"

// Mount once per app — see app/layout.tsx. Use `toast(...)` from
// anywhere (`import { toast } from '@/components/ui/sonner'`) to
// surface a notification: toast.success(...), toast.error(...),
// toast.promise(...), or toast(...) for a neutral message.
function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      theme="system"
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, sonnerToast as toast }
