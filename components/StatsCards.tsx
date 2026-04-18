import { Card, CardContent } from '@/components/ui/card'

interface Props {
  total: number
  complete: number
  partial: number
  missing: number
}

export default function StatsCards({ total, complete, partial, missing }: Props) {
  const cards = [
    { label: 'Total Equipment', value: total,    accent: 'bg-slate-400',   number: 'text-slate-800'  },
    { label: 'Complete',        value: complete,  accent: 'bg-emerald-500', number: 'text-emerald-600' },
    { label: 'Partial',         value: partial,   accent: 'bg-amber-400',   number: 'text-amber-600'  },
    { label: 'Missing',         value: missing,   accent: 'bg-rose-500',    number: 'text-rose-600'   },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, accent, number }) => (
        <Card key={label} className="bg-white border border-slate-100 shadow-sm overflow-hidden">
          <div className={`h-1 w-full ${accent}`} />
          <CardContent className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">{label}</p>
            <p className={`text-4xl font-bold tracking-tight ${number}`}>{value.toLocaleString()}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
