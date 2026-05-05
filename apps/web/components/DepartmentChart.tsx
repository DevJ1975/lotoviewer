'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { DepartmentStats } from '@soteria/core/types'

interface Props {
  data: DepartmentStats[]
}

export default function DepartmentChart({ data }: Props) {
  const sorted = [...data].sort((a, b) => b.total - a.total).slice(0, 15)

  return (
    <ResponsiveContainer width="100%" height={380}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="department"
          width={140}
          tick={{ fontSize: 11 }}
        />
        <Tooltip
          formatter={(value, name) => [value, String(name).charAt(0).toUpperCase() + String(name).slice(1)]}
        />
        <Legend />
        <Bar dataKey="complete" stackId="a" fill="#22c55e" name="Complete" />
        <Bar dataKey="partial"  stackId="a" fill="#f59e0b" name="Partial" />
        <Bar dataKey="missing"  stackId="a" fill="#ef4444" name="Missing" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
