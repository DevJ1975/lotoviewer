import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { loadVercelCrons, toEventBridgeCron } from '../lib/vercelCrons'

test('every-N-minutes steps start at zero', () => {
  assert.equal(toEventBridgeCron('*/5 * * * *'), 'cron(0/5 * * * ? *)')
})

test('every-N-hours steps start at zero', () => {
  assert.equal(toEventBridgeCron('0 */4 * * *'), 'cron(0 0/4 * * ? *)')
})

test('daily schedule leaves day-of-week unspecified', () => {
  assert.equal(toEventBridgeCron('15 13 * * *'), 'cron(15 13 * * ? *)')
})

test('weekly schedule uses day names, so Sunday is not off by one', () => {
  assert.equal(toEventBridgeCron('0 14 * * 1'), 'cron(0 14 ? * MON *)')
  assert.equal(toEventBridgeCron('0 5 * * 0'), 'cron(0 5 ? * SUN *)')
  assert.equal(toEventBridgeCron('0 5 * * 7'), 'cron(0 5 ? * SUN *)')
})

test('day-of-week ranges and lists translate per token', () => {
  assert.equal(toEventBridgeCron('0 9 * * 1-5'), 'cron(0 9 ? * MON-FRI *)')
  assert.equal(toEventBridgeCron('0 9 * * 1,3'), 'cron(0 9 ? * MON,WED *)')
})

test('yearly date keeps day-of-month and month', () => {
  assert.equal(toEventBridgeCron('0 14 15 1 *'), 'cron(0 14 15 1 ? *)')
})

test('month steps start at one', () => {
  assert.equal(toEventBridgeCron('0 8 1 */2 *'), 'cron(0 8 1 1/2 ? *)')
})

test('rejects schedules EventBridge cannot express', () => {
  assert.throws(() => toEventBridgeCron('0 9 1 * 1'), /both day-of-month and day-of-week/)
  assert.throws(() => toEventBridgeCron('0 9 * *'), /Expected 5 cron fields/)
  assert.throws(() => toEventBridgeCron('0 9 * * MON'), /Unsupported day-of-week/)
  assert.throws(() => toEventBridgeCron('0 9 L * *'), /Unsupported cron field/)
})

test('every schedule in apps/web/vercel.json converts', () => {
  const crons = loadVercelCrons(join(__dirname, '../../../apps/web/vercel.json'))
  assert.ok(crons.length > 0)
  for (const cron of crons) assert.match(cron.schedule, /^cron\(.+\)$/)
})
