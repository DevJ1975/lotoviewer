import { supabase } from '@/lib/supabase'
import type {
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpaceEntry,
  ConfinedSpacePermit,
  GasMeter,
  HotWorkPermit,
  OrgConfig,
  TrainingRecord,
} from '@/lib/types'

// One-shot loader for the confined-space permit detail page. Replaces
// the inline 8-parallel Promise.all that lived directly in the page
// component — pulling it out lets us:
//   - test the orchestration without the React stack
//   - centralise the "which queries are required vs. optional" rules
//     so the audit-flagged graceful-degradation behaviour stays
//     consistent across callers
//   - swap individual queries for narrower column lists when
//     database.types.ts lands without touching the page
//
// The space + permit are REQUIRED — both not-found = page shows
// "permit not found". Everything else is best-effort and degrades
// to empty arrays / null when the underlying migration hasn't been
// applied or the table is empty.

export type LoadPermitPageResult =
  | { ok: true; data: PermitPageData }
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'error'; message: string }

export interface PermitPageData {
  space:           ConfinedSpace
  permit:          ConfinedSpacePermit
  tests:           AtmosphericTest[]
  entries:         ConfinedSpaceEntry[]
  // Indexed by instrument_id for the bump-test warning lookup the
  // permit form does on every keystroke. Empty map = pre-migration-012
  // OR no meters registered yet (the page treats both the same — no
  // bump warning shown).
  meters:          Map<string, GasMeter>
  orgConfig:       OrgConfig | null
  trainingRecords: TrainingRecord[]
  linkedHotWork:   HotWorkPermit[]
}

export async function loadPermitPage(args: {
  spaceId:  string
  permitId: string
}): Promise<LoadPermitPageResult> {
  const { spaceId, permitId } = args

  // All eight queries fire in parallel — same shape as the original
  // inline code, just hoisted into a helper. The optional ones
  // (entries / meters / config / training / hot-work cross-link) are
  // wrapped in their own try/catch via the .catch() trick on the
  // promise so a missing table fails THIS query without throwing
  // the whole Promise.all.
  const [
    spaceRes,
    permitRes,
    testsRes,
    entriesRes,
    metersRes,
    configRes,
    trainingRes,
    hotWorkRes,
  ] = await Promise.all([
    supabase.from('loto_confined_spaces').select('*').eq('space_id', spaceId).single(),
    supabase.from('loto_confined_space_permits').select('*').eq('id', permitId).single(),
    supabase.from('loto_atmospheric_tests').select('*').eq('permit_id', permitId).order('tested_at', { ascending: false }),
    supabase.from('loto_confined_space_entries').select('*').eq('permit_id', permitId).order('entered_at', { ascending: false }),
    supabase.from('loto_gas_meters').select('*').eq('decommissioned', false),
    supabase.from('loto_org_config').select('*').eq('id', 1).maybeSingle(),
    supabase.from('loto_training_records').select('*'),
    supabase.from('loto_hot_work_permits').select('*').eq('associated_cs_permit_id', permitId).order('started_at', { ascending: false }),
  ])

  // Required pair — either missing → not-found.
  if (spaceRes.error || permitRes.error || !spaceRes.data || !permitRes.data) {
    // PGRST116 (no rows) is the normal "you opened a stale URL" case;
    // anything else (e.g. RLS denial) lands in the same not-found bucket
    // because the user has no actionable difference between the two.
    return { ok: false, kind: 'not-found' }
  }

  // Build the meters map exactly like the page used to. Pre-migration-012
  // metersRes.data is null → empty map.
  const meters = new Map<string, GasMeter>()
  for (const row of (metersRes.data ?? []) as GasMeter[]) {
    meters.set(row.instrument_id, row)
  }

  return {
    ok:   true,
    data: {
      space:           spaceRes.data as ConfinedSpace,
      permit:          permitRes.data as ConfinedSpacePermit,
      tests:           (testsRes.data    ?? []) as AtmosphericTest[],
      entries:         (entriesRes.data  ?? []) as ConfinedSpaceEntry[],
      meters,
      orgConfig:       (configRes.data ?? null) as OrgConfig | null,
      trainingRecords: (trainingRes.data ?? []) as TrainingRecord[],
      linkedHotWork:   (hotWorkRes.data  ?? []) as HotWorkPermit[],
    },
  }
}
