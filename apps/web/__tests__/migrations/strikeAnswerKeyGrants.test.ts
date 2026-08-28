import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 260 closes an answer-key disclosure: strike_answers_read (114)
// grants row-level SELECT on strike_quiz_answers to any authenticated member,
// and Postgres RLS cannot filter columns. The learner page only ever asked for
// answer_text, but nothing enforced that — a session could request is_correct
// and get the key for every published module. Column grants supply the missing
// scope, the same mechanism migration 178 used for the Prop 65 anon surface.
//
// These are migration-TEXT assertions, in the same style as
// __tests__/migrations/profilesPrivilegedColumns.test.ts. There is no database
// in the unit suite, so they prove the migration says what it must — NOT that
// Postgres enforces it. The behavioural proof is the staging checklist in the
// PR body: apply to a Supabase branch, then confirm a learner's
// `select('is_correct')` fails while `select('answer_text')` succeeds.

const REPO_APPS_WEB = resolve(__dirname, '../..')

const sql = readFileSync(
  resolve(REPO_APPS_WEB, 'migrations/260_strike_security_hardening.sql'),
  'utf8',
)
const rollback = readFileSync(
  resolve(REPO_APPS_WEB, 'migrations/260_rollback.sql'),
  'utf8',
)

// The header comment necessarily names the leaked columns and quotes the
// exploit, so every structural assertion runs against comment-stripped SQL.
const sqlNoComments = sql.replace(/--[^\n]*/g, '').replace(/\n{2,}/g, '\n').trim()

/** The single `grant select (...) on <table>` column list, normalized. */
function grantedColumns(table: string): string[] {
  const match = sqlNoComments.match(
    new RegExp(String.raw`grant\s+select\s*\(([^)]*)\)\s*\n?\s*on\s+public\.${table}\b`, 'i'),
  )
  if (!match) throw new Error(`no column grant found for ${table}`)
  return match[1].split(',').map(c => c.trim()).filter(Boolean)
}

describe('Migration 260 — STRIKE answer-key column grants', () => {
  it('strips the base grant before re-granting, on both quiz tables', () => {
    // Revoke-then-grant is what makes a column added later default to
    // unreadable rather than silently exposed.
    expect(sqlNoComments).toContain('revoke select on public.strike_quiz_answers from authenticated, anon')
    expect(sqlNoComments).toContain('revoke select on public.strike_quiz_questions from authenticated, anon')
  })

  it('never grants is_correct to a browser-facing role', () => {
    expect(grantedColumns('strike_quiz_answers')).not.toContain('is_correct')
  })

  it('never grants explanation to a browser-facing role', () => {
    // Explanations paraphrase the key ("Correct, because ..."), so they are a
    // soft copy of it and travel back only with a graded result.
    expect(grantedColumns('strike_quiz_questions')).not.toContain('explanation')
  })

  it('still grants the columns the learner player actually reads', () => {
    // Guards against over-revoking: these are the exact selects in
    // app/strike/[slug]/page.tsx.
    const answers = grantedColumns('strike_quiz_answers')
    for (const col of ['id', 'question_id', 'answer_text', 'sort_order']) {
      expect(answers).toContain(col)
    }
    const questions = grantedColumns('strike_quiz_questions')
    for (const col of ['id', 'question_type', 'prompt', 'sort_order', 'required', 'points']) {
      expect(questions).toContain(col)
    }
  })

  it('leaves service_role alone so server-side grading still works', () => {
    // supabaseAdmin() does the grading and needs both columns. A revoke naming
    // service_role would break every submit.
    //
    // Asserted statement-by-statement rather than over the whole file: the
    // `comment on ... is '...'` bodies mention service_role by design, and a
    // whole-file regex happily spans one.
    const revokes = sqlNoComments
      .split(';')
      .map(s => s.trim())
      .filter(s => /^revoke\b/i.test(s))
    expect(revokes.length).toBeGreaterThan(0)
    for (const statement of revokes) {
      expect(statement.toLowerCase()).not.toContain('service_role')
    }
  })

  it('puts audio behind the same storage rule as video', () => {
    // Migration 223 restricted video extensions under the cross-tenant
    // `global/` prefix and left `else true`, so every other file type was
    // readable by any authenticated user of any tenant.
    for (const ext of ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus']) {
      expect(sqlNoComments).toContain(`'${ext}'`)
    }
    expect(sqlNoComments).toContain('create policy strike_media_read on storage.objects')
  })

  it('restores a domain on video_provider', () => {
    expect(sqlNoComments).toContain("check (video_provider = 'vimeo')")
  })

  it('is idempotent and reloads the PostgREST schema cache', () => {
    expect(sqlNoComments).toContain('drop policy if exists strike_media_read')
    expect(sqlNoComments).toContain('drop constraint if exists strike_versions_provider_ck')
    expect(sqlNoComments).toContain("notify pgrst, 'reload schema'")
  })
})

describe('Migration 260 rollback', () => {
  it('restores whole-row select on both quiz tables', () => {
    expect(rollback).toContain('grant select on public.strike_quiz_answers   to authenticated')
    expect(rollback).toContain('grant select on public.strike_quiz_questions to authenticated')
  })

  it('warns that rolling back re-opens the leak', () => {
    // The rollback is a last resort, not a routine escape hatch — the comment
    // is the only thing telling the on-call engineer that.
    expect(rollback).toMatch(/RE-OPENS THE ANSWER-KEY LEAK/i)
  })
})
