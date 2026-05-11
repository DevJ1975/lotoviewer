import { supabase } from './supabaseClient'
import { TRAINING_ROLE_LABELS } from './trainingRecords'
import type { TrainingRecord, TrainingRole } from './types'

export type ReadinessTone = 'ready' | 'attention' | 'restricted'
export type RequirementStatus = 'current' | 'due_soon' | 'overdue' | 'missing' | 'not_required'

export interface MyReadinessProfile {
  userId:     string
  email:      string | null
  fullName:   string | null
  avatarUrl:  string | null
  isAdmin:    boolean
}

export interface MyReadinessAssignment {
  positionTitle:    string | null
  department:       string | null
  shiftLabel:       string | null
  serviceStartDate: string | null
  serviceLabel:     string | null
  supervisorName:   string | null
}

export interface TrainingRequirementStatus {
  id:               string
  role:             TrainingRole
  label:            string
  recurrenceMonths: number | null
  status:           RequirementStatus
  completedAt:      string | null
  expiresAt:        string | null
  evidenceHref:     string | null
  evidenceLabel:    string
}

export interface EquipmentBadgeStatus {
  id:              string
  equipmentFamily: string
  label:           string
  status:          RequirementStatus
  issuedAt:        string | null
  evaluationDueAt: string | null
  expiresAt:       string | null
  evidenceHref:    string | null
  evidenceLabel:   string
}

export interface MyLeaderboardStatus {
  rank:             number | null
  pointsTotal:      number
  observationCount: number
  safeBehaviorCount: number
}

export interface RestrictedWorkItem {
  id:     string
  label:  string
  reason: string
  source: 'training' | 'equipment'
  status: RequirementStatus
}

export interface RenewalTimelineItem {
  id:           string
  label:        string
  kind:         'training' | 'equipment'
  dueAt:        string
  daysUntilDue: number
  status:       RequirementStatus
}

export interface AdminManageLink {
  id:     string
  label:  string
  detail: string
  href:   string
}

export interface PrimaryReadinessAction {
  label: string
  href:  string
  tone:  ReadinessTone
}

export interface SupervisorReportRow {
  userId:        string
  fullName:      string | null
  email:         string | null
  positionTitle: string | null
  shiftLabel:    string | null
  openGapCount:  number
  dueSoonCount:  number
  status:        ReadinessTone
}

export interface MyReadiness {
  profile:          MyReadinessProfile
  assignment:       MyReadinessAssignment
  overallStatus:    ReadinessTone
  readinessLabel:   string
  nextBestAction:   string
  primaryAction:    PrimaryReadinessAction
  training:         TrainingRequirementStatus[]
  equipmentBadges:  EquipmentBadgeStatus[]
  restrictions:     RestrictedWorkItem[]
  renewalTimeline:  RenewalTimelineItem[]
  adminLinks:       AdminManageLink[]
  supervisorTeam:   SupervisorReportRow[]
  leaderboard:      MyLeaderboardStatus
  matrixPlaceholder: {
    requiredTrainingCount: number
    currentTrainingCount:  number
    openGapCount:          number
  }
}

interface AssignmentRow {
  id: string
  tenant_id: string
  user_id: string
  position_id: string | null
  shift_label: string | null
  service_start_date: string | null
  supervisor_user_id: string | null
}

interface PositionRow {
  id: string
  title: string
  department: string | null
}

interface TrainingRequirementRow {
  id: string
  role: TrainingRole
  requirement_label: string
  recurrence_months: number | null
}

interface EquipmentRequirementRow {
  id: string
  equipment_family: string
  requirement_label: string
}

interface EquipmentAuthorizationRow {
  id: string
  equipment_family: string
  issued_at: string | null
  evaluation_due_at: string | null
  expires_at: string | null
  status: 'active' | 'expired' | 'suspended' | 'revoked'
}

interface LeaderboardRow {
  user_id: string
  points_total: number
  observation_count: number
  safe_behavior_count: number
}

interface TeamAssignmentRow {
  user_id: string
  position_id: string | null
  shift_label: string | null
}

interface MatrixStatusRow {
  user_id: string
  status: RequirementStatus
}

const DUE_SOON_DAYS = 30

const EQUIPMENT_FAMILY_LABELS: Record<string, string> = {
  forklift_electric:      'Electric forklift',
  forklift_ic_lpg:        'LPG forklift',
  reach_truck:            'Reach truck',
  order_picker:           'Order picker',
  pallet_jack_powered:    'Powered pallet jack',
  pallet_lifter_manual:   'Manual pallet lifter',
  aerial_lift_scissor:    'Scissor lift',
  aerial_lift_boom:       'Boom lift',
  tow_tractor:            'Tow tractor',
  rough_terrain_forklift: 'Rough terrain forklift',
  general:                'General equipment',
}

export async function fetchMyReadiness(): Promise<MyReadiness | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return null

  const userId = authData.user.id
  const [profileRes, assignmentRes, leaderboardRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, is_admin, is_superadmin')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('worker_position_assignments')
      .select('id, tenant_id, user_id, position_id, shift_label, service_start_date, supervisor_user_id')
      .eq('user_id', userId)
      .eq('is_current', true)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('bbs_leaderboard')
      .select('user_id, points_total, observation_count, safe_behavior_count')
      .order('points_total', { ascending: false })
      .limit(100),
  ])

  if (profileRes.error) throw new Error(profileRes.error.message)
  if (assignmentRes.error) throw new Error(assignmentRes.error.message)
  if (leaderboardRes.error) {
    console.warn('[myReadiness] leaderboard fetch failed', leaderboardRes.error)
  }

  const profileRow = profileRes.data as { id: string; email: string | null; full_name: string | null; avatar_url: string | null; is_admin?: boolean | null; is_superadmin?: boolean | null } | null
  const profile: MyReadinessProfile = {
    userId,
    email:     profileRow?.email ?? authData.user.email ?? null,
    fullName:  profileRow?.full_name ?? null,
    avatarUrl: profileRow?.avatar_url ?? null,
    isAdmin:   !!profileRow?.is_admin || !!profileRow?.is_superadmin,
  }

  const assignment = ((assignmentRes.data ?? []) as AssignmentRow[])[0] ?? null
  const workerName = profile.fullName || profile.email || ''
  const leaderboardRows = (leaderboardRes.data ?? []) as LeaderboardRow[]
  const leaderboard = summarizeLeaderboard(leaderboardRows, userId)

  if (!assignment?.position_id) {
    return {
      profile,
      assignment: emptyAssignment(),
      overallStatus:  'attention',
      readinessLabel: 'Profile setup needed',
      nextBestAction: 'Assign a current position to unlock the training matrix.',
      primaryAction:  choosePrimaryAction('attention', [], []),
      training:       [],
      equipmentBadges: [],
      restrictions:   [],
      renewalTimeline: [],
      adminLinks:     buildAdminLinks(true),
      supervisorTeam: [],
      leaderboard,
      matrixPlaceholder: {
        requiredTrainingCount: 0,
        currentTrainingCount:  0,
        openGapCount:          0,
      },
    }
  }

  const [positionRes, supervisorRes, trainingReqRes, equipmentReqRes, trainingRes, authzRes] = await Promise.all([
    supabase
      .from('worker_positions')
      .select('id, title, department')
      .eq('id', assignment.position_id)
      .maybeSingle(),
    assignment.supervisor_user_id
      ? supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', assignment.supervisor_user_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('position_training_requirements')
      .select('id, role, requirement_label, recurrence_months')
      .eq('position_id', assignment.position_id)
      .eq('required', true)
      .order('requirement_label', { ascending: true }),
    supabase
      .from('position_equipment_requirements')
      .select('id, equipment_family, requirement_label')
      .eq('position_id', assignment.position_id)
      .eq('required', true)
      .order('requirement_label', { ascending: true }),
    workerName
      ? supabase
        .from('loto_training_records')
        .select('id, worker_name, role, completed_at, expires_at, cert_authority, notes, created_by, created_at, updated_at')
        .ilike('worker_name', workerName)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('equipment_operator_authorizations')
      .select('id, equipment_family, issued_at, evaluation_due_at, expires_at, status')
      .eq('user_id', userId),
  ])

  for (const res of [positionRes, supervisorRes, trainingReqRes, equipmentReqRes, trainingRes, authzRes]) {
    if (res.error) throw new Error(res.error.message)
  }

  const position = positionRes.data as PositionRow | null
  const supervisor = supervisorRes.data as { full_name: string | null; email: string | null } | null
  const training = summarizeTraining(
    (trainingReqRes.data ?? []) as TrainingRequirementRow[],
    (trainingRes.data ?? []) as TrainingRecord[],
    profile.isAdmin,
    workerName,
  )
  const equipmentBadges = summarizeEquipment(
    (equipmentReqRes.data ?? []) as EquipmentRequirementRow[],
    (authzRes.data ?? []) as EquipmentAuthorizationRow[],
    profile.isAdmin,
  )

  const allStatuses = [
    ...training.map(t => t.status),
    ...equipmentBadges.map(e => e.status),
  ]
  const openGapCount = allStatuses.filter(s => s === 'missing' || s === 'overdue').length
  const dueSoonCount = allStatuses.filter(s => s === 'due_soon').length
  const overallStatus: ReadinessTone = openGapCount > 0 ? 'restricted' : dueSoonCount > 0 ? 'attention' : 'ready'
  const nextBestAction = chooseNextBestAction(training, equipmentBadges)
  const restrictions = buildRestrictions(training, equipmentBadges)
  const renewalTimeline = buildRenewalTimeline(training, equipmentBadges)
  const supervisorTeam = profile.isAdmin ? await fetchSupervisorTeam(userId) : []

  return {
    profile,
    assignment: {
      positionTitle:    position?.title ?? null,
      department:       position?.department ?? null,
      shiftLabel:       assignment.shift_label,
      serviceStartDate: assignment.service_start_date,
      serviceLabel:     serviceLabel(assignment.service_start_date),
      supervisorName:   supervisor?.full_name ?? supervisor?.email ?? null,
    },
    overallStatus,
    readinessLabel: overallStatus === 'ready'
      ? 'Ready for assigned work'
      : overallStatus === 'attention'
        ? 'Renewals coming due'
        : 'Work restrictions present',
    nextBestAction,
    primaryAction: choosePrimaryAction(overallStatus, training, equipmentBadges),
    training,
    equipmentBadges,
    restrictions,
    renewalTimeline,
    adminLinks: buildAdminLinks(profile.isAdmin),
    supervisorTeam,
    leaderboard,
    matrixPlaceholder: {
      requiredTrainingCount: training.length,
      currentTrainingCount:  training.filter(t => t.status === 'current' || t.status === 'due_soon').length,
      openGapCount,
    },
  }
}

function summarizeTraining(
  requirements: TrainingRequirementRow[],
  records: TrainingRecord[],
  canManage: boolean,
  workerName: string,
): TrainingRequirementStatus[] {
  const today = todayYmd()
  return requirements.map(req => {
    const best = records
      .filter(r => r.role === req.role)
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0]
    const status = statusFromExpiry(best?.expires_at ?? null, today, !!best)
    return {
      id:               req.id,
      role:             req.role,
      label:            req.requirement_label || TRAINING_ROLE_LABELS[req.role] || req.role,
      recurrenceMonths: req.recurrence_months,
      status,
      completedAt:      best?.completed_at ?? null,
      expiresAt:        best?.expires_at ?? null,
      evidenceHref:     canManage ? `/admin/training-records?search=${encodeURIComponent(workerName)}` : null,
      evidenceLabel:    best ? 'Training record' : 'Record missing',
    }
  })
}

function summarizeEquipment(
  requirements: EquipmentRequirementRow[],
  authorizations: EquipmentAuthorizationRow[],
  canManage: boolean,
): EquipmentBadgeStatus[] {
  const today = todayYmd()
  return requirements.map(req => {
    const best = authorizations
      .filter(a => a.equipment_family === req.equipment_family)
      .sort((a, b) => (b.issued_at ?? '').localeCompare(a.issued_at ?? ''))[0]
    const hasUsableAuth = !!best && best.status === 'active'
    const status = hasUsableAuth
      ? statusFromExpiry(best.expires_at ?? best.evaluation_due_at, today, true)
      : best
        ? 'overdue'
        : 'missing'
    return {
      id:              req.id,
      equipmentFamily: req.equipment_family,
      label:           req.requirement_label || EQUIPMENT_FAMILY_LABELS[req.equipment_family] || req.equipment_family,
      status,
      issuedAt:        best?.issued_at ?? null,
      evaluationDueAt: best?.evaluation_due_at ?? null,
      expiresAt:       best?.expires_at ?? null,
      evidenceHref:    canManage ? '/equipment-readiness' : null,
      evidenceLabel:   best ? 'Authorization record' : 'Authorization missing',
    }
  })
}

export function statusFromExpiry(expiresAt: string | null, today: string, exists: boolean): RequirementStatus {
  if (!exists) return 'missing'
  if (!expiresAt) return 'current'
  if (expiresAt < today) return 'overdue'
  const days = daysBetween(today, expiresAt)
  return days <= DUE_SOON_DAYS ? 'due_soon' : 'current'
}

export function chooseNextBestAction(training: TrainingRequirementStatus[], equipment: EquipmentBadgeStatus[]): string {
  const urgentTraining = training.find(t => t.status === 'overdue' || t.status === 'missing')
  if (urgentTraining) return `Close the ${urgentTraining.label} training gap.`
  const urgentEquipment = equipment.find(e => e.status === 'overdue' || e.status === 'missing')
  if (urgentEquipment) return `Renew the ${urgentEquipment.label} equipment authorization.`
  const dueTraining = training.find(t => t.status === 'due_soon')
  if (dueTraining) return `Schedule ${dueTraining.label} renewal before ${dueTraining.expiresAt}.`
  const dueEquipment = equipment.find(e => e.status === 'due_soon')
  if (dueEquipment) return `Schedule ${dueEquipment.label} evaluation before ${dueEquipment.expiresAt ?? dueEquipment.evaluationDueAt}.`
  return 'Keep contributing observations and complete routine field checks.'
}

export function buildRestrictions(
  training: TrainingRequirementStatus[],
  equipment: EquipmentBadgeStatus[],
): RestrictedWorkItem[] {
  const trainingRestrictions = training
    .filter(t => t.status === 'missing' || t.status === 'overdue')
    .map((t): RestrictedWorkItem => ({
      id:     `training-${t.id}`,
      label:  t.label,
      reason: t.status === 'missing'
        ? 'Required training is not on file.'
        : `Training expired${t.expiresAt ? ` on ${t.expiresAt}` : ''}.`,
      source: 'training',
      status: t.status,
    }))

  const equipmentRestrictions = equipment
    .filter(e => e.status === 'missing' || e.status === 'overdue')
    .map((e): RestrictedWorkItem => ({
      id:     `equipment-${e.id}`,
      label:  e.label,
      reason: e.status === 'missing'
        ? 'Required equipment authorization is not on file.'
        : `Equipment authorization expired${e.expiresAt ? ` on ${e.expiresAt}` : e.evaluationDueAt ? ` on ${e.evaluationDueAt}` : ''}.`,
      source: 'equipment',
      status: e.status,
    }))

  return [...trainingRestrictions, ...equipmentRestrictions]
}

export function buildRenewalTimeline(
  training: TrainingRequirementStatus[],
  equipment: EquipmentBadgeStatus[],
  today: string = todayYmd(),
  windowDays = 90,
): RenewalTimelineItem[] {
  const items: RenewalTimelineItem[] = []
  for (const t of training) {
    if (!t.expiresAt) continue
    const daysUntilDue = daysBetween(today, t.expiresAt)
    if (daysUntilDue < 0 || daysUntilDue > windowDays) continue
    items.push({
      id:           `training-${t.id}`,
      label:        t.label,
      kind:         'training',
      dueAt:        t.expiresAt,
      daysUntilDue,
      status:       t.status,
    })
  }
  for (const e of equipment) {
    const dueAt = e.expiresAt ?? e.evaluationDueAt
    if (!dueAt) continue
    const daysUntilDue = daysBetween(today, dueAt)
    if (daysUntilDue < 0 || daysUntilDue > windowDays) continue
    items.push({
      id:           `equipment-${e.id}`,
      label:        e.label,
      kind:         'equipment',
      dueAt,
      daysUntilDue,
      status:       e.status,
    })
  }
  return items.sort((a, b) => a.daysUntilDue - b.daysUntilDue || a.label.localeCompare(b.label))
}

export function buildAdminLinks(canManage: boolean): AdminManageLink[] {
  if (!canManage) return []
  return [
    {
      id:     'position',
      label:  'Manage assignment',
      detail: 'Position, shift, service date, supervisor',
      href:   '/admin/users',
    },
    {
      id:     'training',
      label:  'Manage training',
      detail: 'Required records and certificate dates',
      href:   '/admin/training-records',
    },
    {
      id:     'equipment',
      label:  'Manage equipment authorizations',
      detail: 'Forklift, lift, and PIT badges',
      href:   '/equipment-readiness',
    },
  ]
}

export function choosePrimaryAction(
  status: ReadinessTone,
  training: TrainingRequirementStatus[],
  equipment: EquipmentBadgeStatus[],
): PrimaryReadinessAction {
  if (status === 'restricted') {
    const firstGap = [...training, ...equipment].find(item => item.status === 'missing' || item.status === 'overdue')
    return {
      label: firstGap ? 'View required fixes' : 'View restrictions',
      href:  '#restrictions',
      tone:  'restricted',
    }
  }
  if (status === 'attention') {
    return {
      label: 'Schedule renewal',
      href:  '#renewals',
      tone:  'attention',
    }
  }
  return {
    label: 'Start pre-use inspection',
    href:  '/equipment-readiness',
    tone:  'ready',
  }
}

export function summarizeSupervisorRows(args: {
  assignments: TeamAssignmentRow[]
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>
  positions: PositionRow[]
  matrixRows: MatrixStatusRow[]
}): SupervisorReportRow[] {
  const profileById = new Map(args.profiles.map(p => [p.id, p]))
  const positionById = new Map(args.positions.map(p => [p.id, p]))
  const statusByUser = new Map<string, RequirementStatus[]>()
  for (const row of args.matrixRows) {
    const arr = statusByUser.get(row.user_id) ?? []
    arr.push(row.status)
    statusByUser.set(row.user_id, arr)
  }

  return args.assignments.map(a => {
    const statuses = statusByUser.get(a.user_id) ?? []
    const openGapCount = statuses.filter(s => s === 'missing' || s === 'overdue').length
    const dueSoonCount = statuses.filter(s => s === 'due_soon').length
    const profile = profileById.get(a.user_id)
    const position = a.position_id ? positionById.get(a.position_id) : null
    return {
      userId:        a.user_id,
      fullName:      profile?.full_name ?? null,
      email:         profile?.email ?? null,
      positionTitle: position?.title ?? null,
      shiftLabel:    a.shift_label,
      openGapCount,
      dueSoonCount,
      status:        openGapCount > 0 ? 'restricted' : dueSoonCount > 0 ? 'attention' : 'ready',
    }
  }).sort((a, b) =>
    statusRank(b.status) - statusRank(a.status)
    || (a.fullName ?? a.email ?? '').localeCompare(b.fullName ?? b.email ?? ''),
  )
}

function summarizeLeaderboard(rows: LeaderboardRow[], userId: string): MyLeaderboardStatus {
  const idx = rows.findIndex(r => r.user_id === userId)
  const mine = idx >= 0 ? rows[idx] : null
  return {
    rank:              idx >= 0 ? idx + 1 : null,
    pointsTotal:       mine?.points_total ?? 0,
    observationCount:  mine?.observation_count ?? 0,
    safeBehaviorCount: mine?.safe_behavior_count ?? 0,
  }
}

async function fetchSupervisorTeam(userId: string): Promise<SupervisorReportRow[]> {
  const assignmentsRes = await supabase
    .from('worker_position_assignments')
    .select('user_id, position_id, shift_label')
    .eq('supervisor_user_id', userId)
    .eq('is_current', true)
    .limit(25)

  if (assignmentsRes.error) {
    console.warn('[myReadiness] supervisor team fetch failed', assignmentsRes.error)
    return []
  }

  const assignments = (assignmentsRes.data ?? []) as TeamAssignmentRow[]
  if (assignments.length === 0) return []

  const userIds = Array.from(new Set(assignments.map(a => a.user_id)))
  const positionIds = Array.from(new Set(assignments.map(a => a.position_id).filter((id): id is string => !!id)))

  const [profilesRes, positionsRes, matrixRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds),
    positionIds.length > 0
      ? supabase
        .from('worker_positions')
        .select('id, title, department')
        .in('id', positionIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('training_matrix_placeholder')
      .select('user_id, status')
      .in('user_id', userIds),
  ])

  if (profilesRes.error || positionsRes.error || matrixRes.error) {
    console.warn('[myReadiness] supervisor team detail fetch failed', profilesRes.error ?? positionsRes.error ?? matrixRes.error)
    return []
  }

  return summarizeSupervisorRows({
    assignments,
    profiles:   (profilesRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>,
    positions:  (positionsRes.data ?? []) as PositionRow[],
    matrixRows: (matrixRes.data ?? []) as MatrixStatusRow[],
  })
}

function serviceLabel(startDate: string | null): string | null {
  if (!startDate) return null
  const start = new Date(`${startDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return null
  const now = new Date()
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12
    + (now.getUTCMonth() - start.getUTCMonth())
  if (now.getUTCDate() < start.getUTCDate()) months -= 1
  if (months < 0) return null
  const years = Math.floor(months / 12)
  const remMonths = months % 12
  if (years === 0) return `${remMonths} month${remMonths === 1 ? '' : 's'}`
  if (remMonths === 0) return `${years} year${years === 1 ? '' : 's'}`
  return `${years} yr ${remMonths} mo`
}

function emptyAssignment(): MyReadinessAssignment {
  return {
    positionTitle:    null,
    department:       null,
    shiftLabel:       null,
    serviceStartDate: null,
    serviceLabel:     null,
    supervisorName:   null,
  }
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(startYmd: string, endYmd: string): number {
  const start = Date.parse(`${startYmd}T00:00:00Z`)
  const end = Date.parse(`${endYmd}T00:00:00Z`)
  return Math.floor((end - start) / 86_400_000)
}

function statusRank(status: ReadinessTone): number {
  switch (status) {
    case 'restricted': return 3
    case 'attention':  return 2
    case 'ready':      return 1
  }
}
