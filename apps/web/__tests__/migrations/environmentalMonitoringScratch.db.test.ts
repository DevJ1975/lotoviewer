// @vitest-environment node
import { it } from 'vitest'
import { IDS, asCaller, scalar } from './_emsTestDatabase'
import { createSuiteDatabase } from './_suiteTestDatabase'
import { readFileSync, writeFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

it('scratch', async () => {
  const db = await createSuiteDatabase({ extra: ['318_environmental_monitoring.sql'] })
  await db.exec(`create policy zz_probe on public.monitoring_results as permissive for update to authenticated using (true) with check (true);`)
  const TA = IDS.tenantA, TB = IDS.tenantB
  const siteA = (await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [TA]))!
  const siteB = (await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [TB]))!
  const id = (await db.query<{id:string}>(`insert into public.monitoring_results (tenant_id, facility_id, parameter, unit, value, sampled_at) values ($1,$2,'TSS','mg/L',1,now()) returning id`, [TA, siteA])).rows[0]!.id
  try {
    await asCaller(db, { userId: IDS.ownerA, tenantId: TA }, () => db.query(`update public.monitoring_results set tenant_id = $2, facility_id = $3 where id = $1`, [id, TB, siteB]))
    console.log('MOVED OK')
  } catch (e) { console.log('ERR', (e as {code:string; message:string}).code, (e as Error).message) }
})
