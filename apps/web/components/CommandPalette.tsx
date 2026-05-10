'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Flame,
  GraduationCap,
  HardHat,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'

// ⌘K / Ctrl+K opens a global navigation palette over any page. Mounted
// once in AppChrome so the chord works from anywhere. Currently a
// static route list — first iteration of the broader cross-feature
// search idea (cf. Tier 1 #3 in the shadcn UX roadmap). Easy to extend
// with live equipment / permit / worker lookup later.

interface NavItem {
  label:    string
  href:     string
  hint?:    string
  icon:     React.ComponentType<{ className?: string }>
  group:    'Daily' | 'Safety' | 'Permits' | 'Admin' | 'Help'
}

const NAV: NavItem[] = [
  { group: 'Daily',   label: 'Dashboard',         href: '/',                    icon: LayoutDashboard },
  { group: 'Daily',   label: 'Equipment / LOTO',  href: '/loto',                icon: Lock,           hint: 'Lockout/tagout devices' },
  { group: 'Daily',   label: 'Toolbox talks',     href: '/toolbox-talks',       icon: ClipboardCheck },
  { group: 'Daily',   label: 'STRIKE',            href: '/strike',              icon: GraduationCap, hint: 'Microlearning' },
  { group: 'Daily',   label: 'JHA',               href: '/jha',                 icon: ListChecks,     hint: 'Job hazard analysis' },

  { group: 'Safety',  label: 'Incidents',         href: '/incidents',           icon: AlertTriangle },
  { group: 'Safety',  label: 'Near miss',         href: '/near-miss',           icon: ShieldAlert },
  { group: 'Safety',  label: 'BBS observations',  href: '/bbs',                 icon: ShieldCheck,    hint: 'Behavior-based safety' },
  { group: 'Safety',  label: 'Risk',              href: '/risk',                icon: Flame },
  { group: 'Safety',  label: 'Safety boards',     href: '/safety-boards',       icon: HardHat },

  { group: 'Permits', label: 'Hot work permits',  href: '/hot-work',            icon: Flame },
  { group: 'Permits', label: 'Confined spaces',   href: '/confined-spaces',     icon: HardHat },

  { group: 'Admin',   label: 'Departments',       href: '/departments',         icon: Wrench },
  { group: 'Admin',   label: 'Users',             href: '/admin/users',         icon: Users },
  { group: 'Admin',   label: 'Audit log',         href: '/admin/audit',         icon: FileText },

  { group: 'Help',    label: 'Manuals',           href: '/manuals',             icon: FileText },
  { group: 'Help',    label: 'Support',           href: '/support',             icon: LifeBuoy },
]

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // ⌘K (mac) / Ctrl+K (everywhere else) toggles the palette. Skip when
  // a text input has focus so it doesn't fight the user's typing.
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Group rendering — one CommandGroup per heading.
  const groups = NAV.reduce<Record<NavItem['group'], NavItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item)
    return acc
  }, {} as Record<NavItem['group'], NavItem[]>)

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a page or action…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {(Object.keys(groups) as NavItem['group'][]).map(g => (
          <CommandGroup key={g} heading={g}>
            {groups[g].map(item => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.hint ?? ''} ${item.href}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                  {item.hint && (
                    <span className="ml-2 text-xs text-muted-foreground">{item.hint}</span>
                  )}
                  <CommandShortcut>{item.href}</CommandShortcut>
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
