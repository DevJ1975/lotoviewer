'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronRight, Clock, Search, Settings2, Shield, X } from 'lucide-react'
import {
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
  useSidebar,
} from '@/components/ui/sidebar'
import {
  getNavigationGroups,
  type NavigationGroup,
  type NavigationItem,
} from '@/lib/navigationCatalog'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { getModuleVisuals } from '@/lib/moduleVisuals'
import SoteriaLogo from '@/components/SoteriaLogo'
import { isFeatureAccessible, type FeatureDef } from '@soteria/core/features'
import { cn } from '@/lib/utils'
import { useRecentRoutes } from '@/lib/useRecentRoutes'
import { resolveHref } from '@/lib/resolveHref'

interface Props {
  onClose?: () => void
}

function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('soteria:open-command-palette'))
}

export default function AppDrawer({ onClose }: Props) {
  const pathname = usePathname()
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const { setOpen } = useSidebar()
  const groups = getNavigationGroups(tenant?.modules ?? null)

  function close() {
    setOpen(false)
    onClose?.()
  }

  function openSearch() {
    close()
    openCommandPalette()
  }

  return (
    <Sidebar className="w-[22rem] max-w-[92vw] border-r border-slate-200/80 bg-white/[0.98] dark:border-slate-800/80 dark:bg-slate-950/[0.98]">
      <SidebarHeader className="space-y-3 border-b border-sidebar-border/80 pb-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            onClick={close}
            aria-label="SoteriaField home"
            className="flex min-w-0 items-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow"
          >
            <SoteriaLogo variant="dark" width={150} className="block dark:hidden" />
            <SoteriaLogo variant="color" width={150} className="hidden dark:block" />
          </Link>
          <button
            type="button"
            onClick={close}
            aria-label="Close navigation"
            className="motion-press flex size-9 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={openSearch}
          className="motion-press flex h-10 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/80 px-3 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:border-sidebar-ring/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Search className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search modules and pages</span>
          <kbd className="hidden rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            ⌘K
          </kbd>
        </button>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <RecentsSection tenantId={tenant?.id ?? null} pathname={pathname} onNavigate={close} />
        {groups.map((group, index) => (
          <NavigationGroupSection
            key={group.id}
            group={group}
            pathname={pathname}
            onNavigate={close}
            animationDelayMs={index * 35}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="space-y-2">
        {(profile?.is_admin || profile?.is_superadmin) && (
          <Link
            href="/admin"
            onClick={close}
            className="flex min-h-10 items-center gap-2 rounded-md px-2.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-sidebar-accent dark:text-slate-200"
          >
            <Settings2 className="size-4" />
            Administration
          </Link>
        )}
        {profile?.is_superadmin && (
          <Link
            href="/superadmin"
            onClick={close}
            className="flex min-h-10 items-center gap-2 rounded-md px-2.5 py-2 text-sm font-semibold text-brand-navy transition-colors hover:bg-sidebar-accent dark:text-brand-yellow"
          >
            <Shield className="size-4" />
            Superadmin
          </Link>
        )}
        <p className="px-2 text-[10px] leading-relaxed text-sidebar-foreground/45">
          Modules are grouped by workflow. Search opens the same catalog used by the drawer.
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}

function NavigationGroupSection({
  group,
  pathname,
  onNavigate,
  animationDelayMs,
}: {
  group: NavigationGroup
  pathname: string | null
  onNavigate: () => void
  animationDelayMs: number
}) {
  return (
    <SidebarGroup className="animate-panel-in" style={{ animationDelay: `${animationDelayMs}ms` }}>
      <SidebarGroupLabel title={group.description}>{group.label}</SidebarGroupLabel>
      <SidebarMenu>
        {group.items.map(item => (
          <ModuleRow
            key={item.feature.id}
            item={item}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function ModuleRow({
  item,
  pathname,
  onNavigate,
}: {
  item: NavigationItem
  pathname: string | null
  onNavigate: () => void
}) {
  const mod = item.feature
  const hasChildren = item.children.length > 0
  const active = isNavigationItemActive(item, pathname)
  const expanded = hasChildren && active
  const isClickable = isFeatureAccessible(mod.id)
  const { Icon, classes } = getModuleVisuals(mod.id)

  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'module-icon-tile flex size-7 shrink-0 items-center justify-center rounded-md',
          classes.tile,
          active && classes.ring,
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">{mod.name}</span>
      {mod.comingSoon && (
        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Soon
        </span>
      )}
      {hasChildren && (
        <span className="shrink-0 text-sidebar-foreground/45">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>
      )}
    </>
  )

  return (
    <SidebarMenuItem>
      {isClickable ? (
        <SidebarMenuButton asChild isActive={active} className="motion-reactive">
          <Link href={mod.href!} onClick={onNavigate}>
            {content}
          </Link>
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton type="button" disabled isActive={active} className="motion-reactive cursor-not-allowed opacity-70">
          {content}
        </SidebarMenuButton>
      )}

      {expanded && (
        <SidebarMenuSub>
          {item.children.map(child => (
            <ChildRow
              key={child.id}
              child={child}
              active={pathname === child.href}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}

function ChildRow({
  child,
  active,
  onNavigate,
}: {
  child: FeatureDef
  active: boolean
  onNavigate: () => void
}) {
  const isClickable = isFeatureAccessible(child.id)

  const label = (
    <>
      <span className="min-w-0 flex-1 truncate">{child.name}</span>
      {child.comingSoon && (
        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Soon
        </span>
      )}
    </>
  )

  return (
    <SidebarMenuSubItem>
      {isClickable ? (
        <SidebarMenuSubButton asChild isActive={active}>
          <Link href={child.href!} onClick={onNavigate}>
            {label}
          </Link>
        </SidebarMenuSubButton>
      ) : (
        <SidebarMenuSubButton type="button" disabled isActive={active} className="cursor-not-allowed opacity-70">
          {label}
        </SidebarMenuSubButton>
      )}
    </SidebarMenuSubItem>
  )
}

function RecentsSection({
  tenantId,
  pathname,
  onNavigate,
}: {
  tenantId: string | null
  pathname: string | null
  onNavigate: () => void
}) {
  const recents = useRecentRoutes(tenantId)

  // Resolve to display-ready rows; drop anything we can't render with a
  // proper label (e.g. deep detail pages not in the catalog) so the
  // section stays curated rather than a raw URL bar.
  const rows = recents
    .map(href => resolveHref(href))
    .filter((r): r is NonNullable<ReturnType<typeof resolveHref>> => r !== null)

  // First load — no recents yet. Hide the section entirely so the
  // drawer doesn't show a stub.
  if (rows.length === 0) return null

  return (
    <SidebarGroup className="animate-panel-in">
      <SidebarGroupLabel title="Most recently visited pages in this tenant">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3" />
          Recents
        </span>
      </SidebarGroupLabel>
      <SidebarMenu>
        {rows.map(row => {
          const Icon = row.Icon
          const active = pathname === row.href
          return (
            <SidebarMenuItem key={row.href}>
              <SidebarMenuButton asChild isActive={active} className="motion-reactive">
                <Link href={row.href} onClick={onNavigate}>
                  <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-accent/40 text-sidebar-foreground/70">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function isFeatureActive(feature: FeatureDef, pathname: string | null) {
  if (!pathname || !feature.href) return false
  if (pathname === feature.href) return true
  return pathname.startsWith(`${feature.href}/`)
}

function isNavigationItemActive(item: NavigationItem, pathname: string | null) {
  return isFeatureActive(item.feature, pathname) ||
    item.children.some(child => isFeatureActive(child, pathname))
}
