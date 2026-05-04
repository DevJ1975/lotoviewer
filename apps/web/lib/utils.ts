import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { DepartmentStats } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function buildDeptStats(
  rows: { department: string; photo_status: 'missing' | 'partial' | 'complete' }[]
): DepartmentStats[] {
  const map = new Map<string, DepartmentStats>()
  for (const row of rows) {
    if (!map.has(row.department)) {
      map.set(row.department, { department: row.department, total: 0, complete: 0, partial: 0, missing: 0, pct: 0 })
    }
    const s = map.get(row.department)!
    s.total++
    s[row.photo_status]++
  }
  for (const s of map.values()) {
    s.pct = s.total > 0 ? Math.round((s.complete / s.total) * 100) : 0
  }
  return Array.from(map.values())
}
