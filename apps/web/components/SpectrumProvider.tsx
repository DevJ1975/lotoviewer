'use client'

import { useRouter } from 'next/navigation'
import { RouterProvider } from 'react-aria-components'
import { I18nProvider } from 'react-aria'
import type { ReactNode } from 'react'

// Foundation for the React Aria Components migration. Wires RAC's client-side
// navigation to the Next.js router (so RAC Links/menus navigate correctly) and
// pins the locale for SSR consistency. Harmless until RAC components are
// adopted — it only provides context.
export function SpectrumProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  return (
    <I18nProvider locale="en-US">
      <RouterProvider navigate={(href) => router.push(href)}>
        {children}
      </RouterProvider>
    </I18nProvider>
  )
}
