interface Props {
  status: 'missing' | 'partial' | 'complete'
}

// Field-safety status tag for placard-photo evidence. Uses the
// `safety-tag-*` vocabulary from globals.css so a status here reads
// the same as the LOCKED / DANGER / CLEARED tags shown elsewhere —
// one shape, one weight, one set of colors across the app.
//
// Note: this used to wrap shadcn's <Badge>; we drop that dependency
// here so the visual matches the new tag system exactly instead of
// inheriting Badge's pill geometry.
const config: Record<Props['status'], { label: string; className: string }> = {
  complete: { label: 'Cleared', className: 'safety-tag-cleared' },
  partial:  { label: 'Partial', className: 'safety-tag-caution' },
  missing:  { label: 'Missing', className: 'safety-tag-danger'  },
}

export default function StatusBadge({ status }: Props) {
  const { label, className } = config[status]
  return <span className={`safety-tag ${className}`}>{label}</span>
}
