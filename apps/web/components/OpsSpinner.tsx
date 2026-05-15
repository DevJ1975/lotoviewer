// Branded loading indicator for the app shell. Replaces full-page
// Loader2 instances that read as generic "React skeleton" chrome.
//
// Visual: a square placard tile with a hazard-yellow rotating ring and
// a centered "STANDBY" placard label underneath. Square + tracked-out
// type matches the rest of the field-safety vocabulary defined in
// globals.css (placard-label, hazard-stripe, etc.).
//
// Sizes:
//   sm  – inline spinner (table row, button)
//   md  – default page-level
//   lg  – full-screen takeover (auth gate, splash)

interface Props {
  size?:    'sm' | 'md' | 'lg'
  /** Override the default "STANDBY" label, or pass null to suppress it. */
  label?:   string | null
  /** Wrap in a full-height centering shell — true for page-level use. */
  fullPage?: boolean
  className?: string
}

const SIZE_MAP = {
  sm: { box: 'h-5 w-5',  ring: 22, stroke: 2.5,  label: 'text-[10px]' },
  md: { box: 'h-10 w-10', ring: 38, stroke: 3,    label: 'text-[11px]' },
  lg: { box: 'h-16 w-16', ring: 60, stroke: 4,    label: 'text-xs'    },
} as const

export default function OpsSpinner({ size = 'md', label, fullPage, className }: Props) {
  const cfg = SIZE_MAP[size]
  const r   = (cfg.ring - cfg.stroke) / 2
  const c   = 2 * Math.PI * r
  // 30% of circumference is filled; the rest is the dashed gap that
  // sweeps as the SVG rotates.
  const dash = `${c * 0.3} ${c}`

  const ring = (
    <span
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
      className={`relative inline-flex flex-col items-center justify-center gap-2 ${className ?? ''}`}
    >
      <span className={`${cfg.box} relative inline-flex items-center justify-center`}>
        {/* Faint guide ring so the moving arc has visible context. */}
        <svg className="absolute inset-0" viewBox={`0 0 ${cfg.ring} ${cfg.ring}`} aria-hidden="true">
          <circle
            cx={cfg.ring / 2}
            cy={cfg.ring / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.18"
            strokeWidth={cfg.stroke}
          />
        </svg>
        {/* Sweeping arc — hazard yellow, rotates via animate-spin. */}
        <svg
          className="absolute inset-0 animate-spin"
          viewBox={`0 0 ${cfg.ring} ${cfg.ring}`}
          aria-hidden="true"
          style={{ animationDuration: '1.1s' }}
        >
          <circle
            cx={cfg.ring / 2}
            cy={cfg.ring / 2}
            r={r}
            fill="none"
            stroke="var(--color-hazard-yellow, #F5C400)"
            strokeWidth={cfg.stroke}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
        </svg>
      </span>
      {label !== null && (
        <span className={`placard-label ${cfg.label} text-slate-500 dark:text-slate-400`}>
          {label ?? 'Standby'}
        </span>
      )}
    </span>
  )

  if (fullPage) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-brand-navy dark:text-brand-yellow">
        {ring}
      </div>
    )
  }
  return <span className="text-brand-navy dark:text-brand-yellow">{ring}</span>
}
