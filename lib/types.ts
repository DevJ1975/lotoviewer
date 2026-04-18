export interface Equipment {
  equipment_id: string
  description: string
  department: string
  prefix: string | null
  photo_status: 'missing' | 'partial' | 'complete'
  has_equip_photo: boolean
  has_iso_photo: boolean
  equip_photo_url: string | null
  iso_photo_url: string | null
  placard_url: string | null
  signed_placard_url: string | null
  energy_tag: string | null
  iso_description: string | null
  iso_procedure: string | null
  lockout_device: string | null
  verification_method: string | null
  notes: string | null
  verified: boolean
  verified_date: string | null
  verified_by: string | null
  needs_equip_photo: boolean
  needs_iso_photo: boolean
  needs_verification: boolean
  created_at: string | null
  updated_at: string | null
}

export interface LotoReview {
  id: string
  department: string
  reviewer_name: string | null
  reviewer_email: string | null
  signed_at: string | null
  approved: boolean
  notes: string | null
  created_at: string
}

export interface DepartmentStats {
  department: string
  total: number
  complete: number
  partial: number
  missing: number
  pct: number
}
