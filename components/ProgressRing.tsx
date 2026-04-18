'use client'

interface Props {
  value: number   // 0–100
  size?: number
  strokeWidth?: number
  label?: string
  sublabel?: string
}

export default function ProgressRing({
  value,
  size = 180,
  strokeWidth = 16,
  label,
  sublabel,
}: Props) {
  // Clamp to [0, 100] so NaN / out-of-range values don't break SVG math
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (clamped / 100) * circumference

  const color = clamped >= 80 ? '#22c55e' : clamped >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center text-center">
        <span className="text-3xl font-bold text-gray-900">{Math.round(clamped)}%</span>
        {label && <span className="text-sm font-medium text-gray-600 mt-0.5">{label}</span>}
        {sublabel && <span className="text-xs text-gray-400">{sublabel}</span>}
      </div>
    </div>
  )
}
