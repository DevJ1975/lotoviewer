'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { LayoutDashboard, Shield } from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { getNavigationCommandItems } from '@/lib/navigationCatalog'
import { getModuleVisuals } from '@/lib/moduleVisuals'

export default function CommandPalette() {
  const router = useRouter()
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'k') return
      if (!(e.metaKey || e.ctrlKey)) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      e.preventDefault()
      setOpen(prev => !prev)
    }

    function onOpenRequest() {
      setOpen(true)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('soteria:open-command-palette', onOpenRequest)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('soteria:open-command-palette', onOpenRequest)
    }
  }, [])

  const grouped = useMemo(() => {
    const rows = [
      {
        groupLabel: 'Pinned',
        label: 'Dashboard',
        href: '/',
        value: 'Dashboard home command center /',
        shortcut: '/',
        Icon: LayoutDashboard,
      },
      ...getNavigationCommandItems(tenant?.modules ?? null).map(item => {
        const { Icon } = getModuleVisuals(item.parent?.id ?? item.feature.id)
        const label = item.parent ? `${item.parent.name} / ${item.feature.name}` : item.feature.name
        return {
          groupLabel: item.group.label,
          label,
          href: item.href,
          value: [
            label,
            item.feature.id,
            item.feature.description,
            item.href,
            item.parent?.name ?? '',
            item.keywords.join(' '),
          ].join(' '),
          shortcut: item.href,
          Icon,
        }
      }),
      ...(profile?.is_superadmin ? [{
        groupLabel: 'Administration',
        label: 'Superadmin',
        href: '/superadmin',
        value: 'Superadmin tenant configuration impersonation modules',
        shortcut: '/superadmin',
        Icon: Shield,
      }] : []),
    ]

    return rows.reduce<Record<string, typeof rows>>((acc, item) => {
      ;(acc[item.groupLabel] ??= []).push(item)
      return acc
    }, {})
  }, [profile?.is_superadmin, tenant?.modules])

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a module, page, or action..." />
      <CommandList className="max-h-[min(480px,70vh)]">
        <CommandEmpty>No matches.</CommandEmpty>
        {Object.entries(grouped).map(([groupLabel, items]) => (
          <CommandGroup key={groupLabel} heading={groupLabel}>
            {items.map(item => {
              const Icon = item.Icon
              return (
                <CommandItem
                  key={`${item.groupLabel}:${item.href}:${item.label}`}
                  value={item.value}
                  onSelect={() => go(item.href)}
                >
                  <Icon className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <CommandShortcut className="max-w-36 truncate tracking-normal">{item.shortcut}</CommandShortcut>
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
