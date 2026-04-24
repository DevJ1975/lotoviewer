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
  notes: string | null
  notes_es: string | null
  internal_notes: string | null
  spanish_reviewed: boolean
  verified: boolean
  verified_date: string | null
  verified_by: string | null
  needs_equip_photo: boolean
  needs_iso_photo: boolean
  needs_verification: boolean
  decommissioned: boolean
  created_at: string | null
  updated_at: string | null
}

export interface LotoEnergyStep {
  id: string
  equipment_id: string
  energy_type: string
  step_number: number
  tag_description: string | null
  isolation_procedure: string | null
  method_of_verification: string | null
  tag_description_es: string | null
  isolation_procedure_es: string | null
  method_of_verification_es: string | null
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

export interface Profile {
  id:                   string
  email:                string
  full_name:            string | null
  is_admin:             boolean
  must_change_password: boolean
  created_at:           string
  updated_at:           string
}
