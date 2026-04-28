import { Badge } from '@/components/ui/badge'

interface Props {
  status: 'missing' | 'partial' | 'complete'
}

const config = {
  complete: { label: 'Complete', className: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100' },
  partial:  { label: 'Partial',  className: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40' },
  missing:  { label: 'Missing',  className: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100' },
}

export default function StatusBadge({ status }: Props) {
  const { label, className } = config[status]
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  )
}
