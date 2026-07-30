'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound, LayoutDashboard, Shield, UserRoundCog, Wrench } from 'lucide-react'

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
import { useDebounce } from '@/hooks/useDebounce'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@soteria/core/types'

// The single search surface for the app. It answers two questions that used to
// live in two different places: "where is that page?" (the feature registry)
// and "where is that machine?" (loto_equipment). Splitting them meant the only
// search box a user could actually see — the header one — searched equipment
// only, so typing "confined space permit" into it returned nothing while the
// page sat one keystroke away behind ⌘K.
//
// It also owns ⌘K outright. GlobalSearch used to bind ⌘K and bare "/" while
// this component bound ⌘K too, and AppChrome mounted GlobalSearch twice
// (desktop + mobile) — three live window listeners, all calling
// preventDefault(), none aware of the others.

type EquipmentHit = Pick<Equipment, 'equipment_id' | 'description' | 'department'>

const EQUIPMENT_LIMIT = 6
const MIN_QUERY_CHARS = 2

export default function CommandPalette() {
  const router = useRouter()
  const { tenant, tenantId } = useTenant()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [equipment, setEquipment] = useState<EquipmentHit[]>([])
  const debouncedSearch = useDebounce(search, 300)
  const reqToken = useRef(0)

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

  // Clear the query when the dialog closes, so reopening never shows a stale
  // result set from the previous session.
  useEffect(() => {
    if (!open) { setSearch(''); setEquipment([]) }
  }, [open])

  // Equipment lookup. Carried over verbatim from the old GlobalSearch,
  // including two details worth keeping:
  //   - the sanitizer strips characters that break PostgREST's .or() parsing
  //     (, ( ) or act as ILIKE wildcards (% _ \), which is safer than escaping
  //   - reqToken drops a slow response that lands after a newer query fired
  useEffect(() => {
    const sanitized = debouncedSearch.replace(/[%_\\,()]/g, ' ').trim()

    if (!open || !tenantId || sanitized.length < MIN_QUERY_CHARS) {
      setEquipment([])
      return
    }

    const myReq = ++reqToken.current
    void supabase
      .from('loto_equipment')
      .select('equipment_id, description, department')
      .eq('tenant_id', tenantId)
      .or(
        `equipment_id.ilike.%${sanitized}%,` +
        `description.ilike.%${sanitized}%,` +
        `department.ilike.%${sanitized}%`
      )
      .limit(EQUIPMENT_LIMIT)
      .then(({ data }) => {
        if (myReq !== reqToken.current) return
        setEquipment((data as EquipmentHit[]) ?? [])
      })
  }, [debouncedSearch, tenantId, open])

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
      {
        groupLabel: 'Pinned',
        label: 'My Profile',
        href: '/settings/profile',
        value: 'My Profile member demographics readiness handle profile settings @member',
        shortcut: '/settings/profile',
        Icon: UserRoundCog,
      },
      {
        groupLabel: 'Pinned',
        label: 'Account & Password',
        href: '/welcome',
        value: 'Account Password login setup global profile name welcome',
        shortcut: '/welcome',
        Icon: KeyRound,
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
      <CommandInput
        placeholder="Search pages, modules, and equipment…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[min(480px,70vh)]">
        <CommandEmpty>No matches.</CommandEmpty>

        {/* Equipment is filtered server-side, so forceMount keeps cmdk's
            client-side filter from second-guessing the query and hiding rows
            whose text doesn't literally contain what was typed (a department
            match, for instance). */}
        {equipment.length > 0 && (
          <CommandGroup heading="Equipment" forceMount>
            {equipment.map(item => (
              <CommandItem
                key={item.equipment_id}
                value={`equipment-${item.equipment_id}`}
                forceMount
                onSelect={() => go(`/equipment/${encodeURIComponent(item.equipment_id)}`)}
              >
                <Wrench className="size-4" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono font-semibold">{item.equipment_id}</span>
                  {item.description ? <span className="text-muted-foreground"> · {item.description}</span> : null}
                </span>
                <CommandShortcut className="max-w-36 truncate tracking-normal">
                  {item.department ?? ''}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

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
