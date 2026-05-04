'use client'

interface CounterTileProps {
  value:      number
  label:      string
  valueClass: string
  bgClass:    string
}

// Small KPI tile for the active / decommissioned counters at the top of
// the decommission page. Pulled out so the count rendering matches between
// the live header and any future summary surfaces.

export function CounterTile({ value, label, valueClass, bgClass }: CounterTileProps) {
  return (
    <div className={`rounded-xl ${bgClass} px-5 py-4 text-center`}>
      <div className={`text-4xl font-bold tabular-nums leading-tight ${valueClass}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  )
}
