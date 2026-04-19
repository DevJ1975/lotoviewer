export type FieldType =
  | 'description'
  | 'notes'
  | 'tag_description'
  | 'isolation_procedure'
  | 'method_of_verification'

export interface AssistRequest {
  field:        FieldType
  currentValue: string
  equipment: {
    equipment_id: string
    description:  string
    department:   string
  }
  energy_type?:            string
  step_number?:            number
  tag_description?:        string
  isolation_procedure?:    string
  method_of_verification?: string
}

export interface AssistResponse {
  suggestion: string
}
