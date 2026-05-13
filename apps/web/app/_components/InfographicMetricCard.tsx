'use client'

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

export type InfographicTone = 'neutral' | 'safe' | 'attention' | 'warning' | 'critical' | 'primary'

interface InfographicMetricCardProps {
  label:       string
  value:       string | number
  caption?:    string
  detail?:     string
  href?:       string
  tone?:       InfographicTone
  icon?:       ReactNode
  percent?:    number | null
  compact?:    boolean
  ariaLabel?:  string
}

const TONE_CLASS: Record<InfographicTone, {
  card:     string
  text:     string
  meter:    string
  meterBg:  string
  ring:     string
}> = {
  neutral: {
    card:    'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    text:    'text-slate-900 dark:text-slate-100',
    meter:   'bg-slate-500',
    meterBg: 'bg-slate-200 dark:bg-slate-800',
    ring:    '#64748b',
  },
  safe: {
    card:    'border-emerald-200 bg-emerald-50/55 dark:border-emerald-900 dark:bg-emerald-950/25',
    text:    'text-emerald-700 dark:text-emerald-300',
    meter:   'bg-emerald-500',
    meterBg: 'bg-emerald-100 dark:bg-emerald-950',
    ring:    '#10b981',
  },
  attention: {
    card:    'border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/25',
    text:    'text-sky-700 dark:text-sky-300',
    meter:   'bg-sky-500',
    meterBg: 'bg-sky-100 dark:bg-sky-950',
    ring:    '#0ea5e9',
  },
  warning: {
    card:    'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/25',
    text:    'text-amber-700 dark:text-amber-300',
    meter:   'bg-amber-500',
    meterBg: 'bg-amber-100 dark:bg-amber-950',
    ring:    '#f59e0b',
  },
  critical: {
    card:    'border-rose-200 bg-rose-50/65 dark:border-rose-900 dark:bg-rose-950/25',
    text:    'text-rose-700 dark:text-rose-300',
    meter:   'bg-rose-500',
    meterBg: 'bg-rose-100 dark:bg-rose-950',
    ring:    '#f43f5e',
  },
  primary: {
    card:    'border-teal-200 bg-teal-50/55 dark:border-teal-900 dark:bg-teal-950/25',
    text:    'text-teal-700 dark:text-teal-300',
    meter:   'bg-teal-500',
    meterBg: 'bg-teal-100 dark:bg-teal-950',
    ring:    '#14b8a6',
  },
}

export function InfographicMetricCard({
  label,
  value,
  caption,
  detail,
  href,
  tone = 'neutral',
  icon,
  percent = null,
  compact = false,
  ariaLabel,
}: InfographicMetricCardProps) {
  const cls = TONE_CLASS[tone]
  const boundedPercent = percent == null ? null : Math.max(0, Math.min(100, percent))

  const content = (
    <div
      aria-label={ariaLabel}
      className={[
        'motion-reactive motion-press group h-full rounded-xl border shadow-sm hover:-translate-y-0.5 hover:shadow-md',
        compact ? 'p-2.5' : 'p-3.5',
        cls.card,
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <RadialGlyph tone={tone} percent={boundedPercent} icon={icon} compact={compact} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className={`${compact ? 'text-xl' : 'text-2xl'} mt-0.5 font-black leading-none tabular-nums ${cls.text}`}>
            {value}
          </p>
          {caption && (
            <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
              {caption}
            </p>
          )}
        </div>
      </div>

      {boundedPercent != null && (
        <div className="mt-3">
          <div className={`h-1.5 overflow-hidden rounded-full ${cls.meterBg}`}>
            <div
              className={`animate-meter-fill h-full rounded-full ${cls.meter}`}
              style={{ width: `${boundedPercent}%` }}
            />
          </div>
        </div>
      )}

      {detail && (
        <p className="mt-3 border-t border-slate-200/70 pt-2 text-[11px] font-medium leading-snug text-slate-600 dark:border-slate-800 dark:text-slate-300">
          {detail}
        </p>
      )}
    </div>
  )

  return href ? <Link href={href} className="block h-full">{content}</Link> : content
}

function RadialGlyph({
  tone,
  percent,
  icon,
  compact,
}: {
  tone:    InfographicTone
  percent: number | null
  icon?:   ReactNode
  compact: boolean
}) {
  const cls = TONE_CLASS[tone]
  const size = compact ? 42 : 52
  const stroke = compact ? 4 : 5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const fill = percent == null ? 100 : percent
  const dashOffset = circumference * (1 - fill / 100)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-slate-200 dark:text-slate-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={cls.ring}
          strokeLinecap="round"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="animate-gauge-sweep"
          style={{ '--gauge-empty': circumference } as CSSProperties}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center ${cls.text}`}>
        {icon ?? <span className={compact ? 'h-2.5 w-2.5 rounded-full bg-current' : 'h-3 w-3 rounded-full bg-current'} />}
      </div>
    </div>
  )
}
