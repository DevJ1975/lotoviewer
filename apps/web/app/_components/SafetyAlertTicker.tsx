'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { CommandCenterSafetyAlert } from '@soteria/core/incidentSafetyAlerts'

const SEEN_ALERTS_STORAGE_KEY = 'soteria:safety-alert-banner-seen:v1'

export interface SafetyAlertBannerItem {
  id:      string
  href:    string
  message: string
}

export function buildSafetyAlertBannerItems(alerts: CommandCenterSafetyAlert[]): SafetyAlertBannerItem[] {
  return alerts.map(alert => ({
    id:      alert.id,
    href:    `/safety-alerts/${alert.id}`,
    message: [
      alert.severity_tone.toUpperCase(),
      alert.report_number,
      alert.title,
      alert.summary,
      `Status: ${alert.status.replaceAll('_', ' ')}`,
    ].join(' - '),
  }))
}

export function filterUnseenSafetyAlertBannerItems(
  items: SafetyAlertBannerItem[],
  seenIds: Iterable<string>,
): SafetyAlertBannerItem[] {
  const seen = new Set(seenIds)
  return items.filter(item => !seen.has(item.id))
}

export function SafetyAlertTicker({ alerts }: { alerts: CommandCenterSafetyAlert[] }) {
  const [seenIds, setSeenIds] = useState<string[]>([])

  useEffect(() => {
    setSeenIds(readSeenAlertIds())
  }, [])

  const allItems = useMemo(() => buildSafetyAlertBannerItems(alerts), [alerts])
  const items = useMemo(
    () => filterUnseenSafetyAlertBannerItems(allItems, seenIds),
    [allItems, seenIds],
  )

  if (items.length === 0) return null

  function markSeen(id: string) {
    const next = Array.from(new Set([...seenIds, id]))
    writeSeenAlertIds(next)
    setSeenIds(next)
  }

  return (
    <section
      role="alert"
      aria-label="Open safety alerts"
      className="group overflow-hidden rounded-lg border-2 border-rose-500 bg-rose-700 text-white shadow-sm"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 shrink-0 items-center gap-2 bg-rose-950/35 px-3 text-xs font-black uppercase tracking-wide sm:px-4">
          <AlertTriangle className="h-4 w-4" />
          Safety Alert
        </div>
        <div className="min-w-0 flex-1 overflow-hidden py-3">
          <div className="flex w-max items-center gap-8 whitespace-nowrap [animation:safety-alert-marquee_38s_linear_infinite] group-hover:[animation-play-state:paused] motion-reduce:animate-none">
            <TickerItems items={items} onOpen={markSeen} />
            <span aria-hidden="true" className="flex items-center gap-8">
              <TickerItems items={items} />
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function TickerItems({ items, onOpen }: {
  items:  SafetyAlertBannerItem[]
  onOpen?: (id: string) => void
}) {
  return (
    <>
      {items.map(item => (
        onOpen ? (
          <Link
            key={item.id}
            href={item.href}
            onClick={() => onOpen(item.id)}
            className="inline-flex items-center gap-2 text-sm font-bold text-white underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span>{item.message}</span>
            <OpenAlertPill />
          </Link>
        ) : (
          <span key={item.id} className="inline-flex items-center gap-2 text-sm font-bold text-white">
            <span>{item.message}</span>
            <OpenAlertPill />
          </span>
        )
      ))}
    </>
  )
}

function OpenAlertPill() {
  return (
    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-rose-700">
      Open alert
    </span>
  )
}

function readSeenAlertIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SEEN_ALERTS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeSeenAlertIds(ids: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SEEN_ALERTS_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Storage can fail in private browsing or quota-restricted contexts.
  }
}
