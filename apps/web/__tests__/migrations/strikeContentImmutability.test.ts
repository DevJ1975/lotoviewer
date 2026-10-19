import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration-TEXT assertions (no database in the unit suite). They prove the
// freeze says what it must; the behavioural proof is applying it to a
// Supabase branch and confirming an UPDATE of a published version's
// passing_score raises integrity_constraint_violation.

const sql = readFileSync(
  resolve(__dirname, '../../migrations/294_strike_content_immutability.sql'),
  'utf8',
).replace(/--[^\n]*/g, '')

function functionBody(name: string): string {
  const match = sql.match(new RegExp(String.raw`function public\.${name}\(\)[\s\S]*?\$\$([\s\S]*?)\$\$`))
  if (!match) throw new Error(`function ${name} not found`)
  return match[1]
}

describe('strike_content_immutability migration', () => {
  it('adds supersedes_completions defaulting to false (minor edit)', () => {
    expect(sql).toMatch(/add column if not exists supersedes_completions boolean not null default false/)
  })

  it('freezes published, superseded and archived versions', () => {
    expect(sql).toMatch(/p_status in \('published', 'superseded', 'archived'\)/)
  })

  it('attaches freeze triggers to versions, questions and answers', () => {
    expect(sql).toMatch(/create trigger strike_versions_freeze\s+before update or delete on public\.strike_module_versions/)
    expect(sql).toMatch(/create trigger strike_questions_freeze\s+before insert or update or delete on public\.strike_quiz_questions/)
    expect(sql).toMatch(/create trigger strike_answers_freeze\s+before insert or update or delete on public\.strike_quiz_answers/)
  })

  it('has no service-role bypass, because the server routes write as service_role', () => {
    expect(sql).not.toMatch(/request\.jwt\.claims/)
  })

  it('freezes the content columns, including passing_score and the supersession flag', () => {
    const body = functionBody('strike_guard_frozen_version')
    for (const column of ['passing_score', 'retake_limit', 'transcript', 'version_number', 'supersedes_completions']) {
      expect(body).toContain(`new.${column}`)
    }
  })

  it('leaves the delivery-only video columns writable (the video route updates published rows)', () => {
    expect(functionBody('strike_guard_frozen_version')).not.toMatch(/new\.video_/)
  })

  it('only allows status to move forward', () => {
    const body = functionBody('strike_guard_frozen_version')
    expect(body).toContain("old.status = 'published'  and new.status in ('superseded', 'archived')")
    expect(body).toContain("old.status = 'superseded' and new.status = 'archived'")
  })
})
