// Static pattern scanners for the daily bug hunt.
//
// Each pattern is derived from a real defect surfaced in
// docs/bug-hunt-log/ (see the 2026-05-12 seed log for the original
// list). The point of codifying them is regression pressure: once a
// class of bug is found and fixed by hand, the daily run keeps the
// same shape from coming back.
//
// A pattern is a `{ id, severity, title, scan(root) }` object.
// `scan` returns an array of `{ file, line, snippet, note }`.
//
// Severity guidance:
//   high   — likely data-leak, auth bypass, or hard crash
//   medium — correctness or a11y regression that ships to users
//   low    — code hygiene that masks a future bug

import { readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { execSync } from 'node:child_process'

// Use `git ls-files` so we never scan node_modules, .next, etc., and so
// the scan respects .gitignore. Limits the surface to source files only.
function listSourceFiles(root, extensions) {
  const out = execSync('git ls-files', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out
    .split('\n')
    .filter(Boolean)
    .filter(p => extensions.some(ext => p.endsWith(ext)))
    .map(p => resolve(root, p))
}

function readLines(path) {
  return readFileSync(path, 'utf8').split('\n')
}

// Strip `// ...` and `/* ... */` content from a single line so pattern
// matches don't false-positive on a comment that happens to mention
// the matched API. Block comments that span multiple lines aren't
// stripped here — patterns that care can do so themselves.
function stripLineComments(line) {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\/\/.*$/, '')
}

// ─── Pattern 1: loto_equipment query missing tenant_id ─────────────────
//
// Origin: H1 in plan 2026-05-12. `equipment_id` is not globally unique
// across tenants, so every read/write on loto_equipment must also pin
// `tenant_id`. RLS catches this server-side today, but app-layer
// scoping is the second line of defense.
//
// Heuristic: find any chain that calls `.from('loto_equipment')` and
// uses `.eq('equipment_id'` within the next 6 lines but does NOT also
// have `.eq('tenant_id'` within the next 10 lines.
function scanLotoEquipmentTenantScope(root) {
  const files = listSourceFiles(root, ['.ts', '.tsx', '.mjs'])
  const hits = []
  for (const f of files) {
    const lines = readLines(f)
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(".from('loto_equipment'")) continue
      const window10 = lines.slice(i, i + 10).join('\n')
      if (!window10.includes(".eq('equipment_id'")) continue
      if (window10.includes(".eq('tenant_id'")) continue
      hits.push({
        file:    relative(root, f),
        line:    i + 1,
        snippet: lines[i].trim(),
        note:    'loto_equipment query filters by equipment_id without tenant_id — equipment_id is not globally unique.',
      })
    }
  }
  return hits
}

// ─── Pattern 2: atob on data URL without validation ────────────────────
//
// Origin: H2 in plan 2026-05-12. `atob(undefined)` throws an opaque
// error in PDF generation when an empty signature data URL reaches
// stampSignature. Any new `atob(` call should validate input first.
//
// Heuristic: flag `atob(` calls where the prior 5 lines don't include
// a `startsWith('data:` guard or a length check.
function scanUnvalidatedAtob(root) {
  const files = listSourceFiles(root, ['.ts', '.tsx'])
  const hits = []
  for (const f of files) {
    const lines = readLines(f)
    for (let i = 0; i < lines.length; i++) {
      // Use a comment-stripped view for the match test so mentions of
      // `atob()` in prose don't fire the scanner.
      if (!/\batob\(/.test(stripLineComments(lines[i]))) continue
      const back = lines
        .slice(Math.max(0, i - 5), i)
        .map(stripLineComments)
        .join('\n')
      // A guard is either an explicit data-URL prefix check
      // (`startsWith('data:`) or any `.length` test that the
      // pre-decode payload is non-empty.
      const guarded = /startsWith\(['"`]data:/.test(back)
                   || /PNG_PREFIX|JPEG_PREFIX|DATA_URL_PREFIX/.test(back)
                   || /\.length\b/.test(back)
      if (guarded) continue
      hits.push({
        file:    relative(root, f),
        line:    i + 1,
        snippet: lines[i].trim(),
        note:    'atob() call has no preceding data-URL or length guard; an empty/malformed input will throw opaquely.',
      })
    }
  }
  return hits
}

// ─── Pattern 3: setTimeout-deferred URL.revokeObjectURL ────────────────
//
// Origin: H5 in plan 2026-05-12. A 60s setTimeout to revoke an object
// URL keeps the blob alive past component unmount. Revoke immediately
// after `a.click()` or on the next microtask.
function scanDeferredRevokeObjectURL(root) {
  const files = listSourceFiles(root, ['.ts', '.tsx'])
  const hits = []
  // Find every revokeObjectURL call site; flag it when the same line
  // or the prior line also contains `setTimeout(`. The earlier regex
  // used `[^)]*` between the two, which fails the moment the
  // setTimeout callback uses arrow-fn parens like `() => revoke(...)`.
  for (const f of files) {
    const lines = readLines(f)
    for (let i = 0; i < lines.length; i++) {
      if (!/URL\.revokeObjectURL/.test(lines[i])) continue
      const win = (lines[i - 1] ?? '') + '\n' + lines[i]
      if (!/setTimeout\s*\(/.test(win)) continue
      hits.push({
        file:    relative(root, f),
        line:    i + 1,
        snippet: lines[i].trim(),
        note:    'URL.revokeObjectURL deferred via setTimeout — keeps the blob alive after unmount. Revoke synchronously after click() (or queueMicrotask).',
      })
    }
  }
  return hits
}

// ─── Pattern 4: modal container missing role="dialog" ──────────────────
//
// Origin: H3 in plan 2026-05-12. Modals must declare role="dialog",
// aria-modal, and labelledby so screen readers announce them. The
// project's canonical modal shape uses `fixed inset-0 z-50` + a
// backdrop class.
function scanModalA11y(root) {
  const files = listSourceFiles(root, ['.tsx'])
  const hits = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    if (!/fixed inset-0 z-50/.test(text)) continue
    if (!/bg-black\/\d+/.test(text)) continue
    if (/role=["']dialog["']/.test(text)) continue
    const lines = text.split('\n')
    const idx   = lines.findIndex(l => /fixed inset-0 z-50/.test(l))
    hits.push({
      file:    relative(root, f),
      line:    idx + 1,
      snippet: lines[idx].trim(),
      note:    'Modal-shaped container has no role="dialog" + aria-modal — screen readers will not announce it.',
    })
  }
  return hits
}

// ─── Pattern 5: admin-client delete without tenant_id filter ───────────
//
// Origin: false-positive pair in plan 2026-05-12 (risk/route.ts:300
// and controls-library DELETE). Even though those specific cases turned
// out safe, the SHAPE — service-role delete filtered only by id — is
// the dangerous version. Flag it for code review.
//
// Heuristic: any line containing `.delete()` where the same multi-line
// chain has `.eq('id'` but not `.eq('tenant_id'`. Window of 6 lines
// forward to catch line-broken chains.
function scanAdminDeleteTenantScope(root) {
  const files = listSourceFiles(root, ['.ts'])
  const hits = []
  for (const f of files) {
    const lines = readLines(f)
    for (let i = 0; i < lines.length; i++) {
      if (!/\.delete\(\)/.test(lines[i])) continue
      // Look at the broader chain — 3 lines back and 6 forward.
      const start = Math.max(0, i - 3)
      const win   = lines.slice(start, i + 6).join('\n')
      if (!/admin\b|supabaseAdmin\b/.test(win)) continue
      if (!/\.eq\(['"]id['"]/.test(win))         continue
      if (/\.eq\(['"]tenant_id['"]/.test(win))   continue
      hits.push({
        file:    relative(root, f),
        line:    i + 1,
        snippet: lines[i].trim(),
        note:    'Service-role .delete() filters by id without tenant_id — verify the id is sourced from a tenant-scoped read.',
      })
    }
  }
  return hits
}

// ─── Pattern 6: non-null assertion on process.env ──────────────────────
//
// Origin: triage in plan 2026-05-12. `process.env.X!` hides
// misconfigurations until first call — prefer an explicit check + 500
// response.
function scanNonNullEnv(root) {
  const files = listSourceFiles(root, ['.ts', '.tsx'])
  const hits  = []
  const re = /process\.env\.[A-Z][A-Z0-9_]+!/
  for (const f of files) {
    const lines = readLines(f)
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue
      hits.push({
        file:    relative(root, f),
        line:    i + 1,
        snippet: lines[i].trim(),
        note:    'process.env.X! non-null assertion masks a misconfigured deploy until first call.',
      })
    }
  }
  return hits
}

// ─── Pattern 7: stale `void <expr>` dead-code marker ───────────────────
//
// Origin: H4 in plan 2026-05-12. `void height` was left as a marker for
// logic that never got written. These statements are misleading.
function scanVoidDeadCode(root) {
  const files = listSourceFiles(root, ['.ts', '.tsx'])
  const hits  = []
  const re = /^\s*void\s+[a-zA-Z_$][\w$]*\s*$/
  for (const f of files) {
    const lines = readLines(f)
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue
      hits.push({
        file:    relative(root, f),
        line:    i + 1,
        snippet: lines[i].trim(),
        note:    '`void <ident>` with no other statements — either implement the logic or remove the marker.',
      })
    }
  }
  return hits
}

export const PATTERNS = [
  { id: 'loto-equipment-tenant-scope',  severity: 'high',   title: 'loto_equipment query missing tenant_id filter',                scan: scanLotoEquipmentTenantScope },
  { id: 'unvalidated-atob',             severity: 'high',   title: 'atob() call without data-URL or length validation',            scan: scanUnvalidatedAtob },
  { id: 'admin-delete-tenant-scope',    severity: 'high',   title: 'Service-role delete by id without tenant_id filter',           scan: scanAdminDeleteTenantScope },
  { id: 'modal-missing-dialog-role',    severity: 'medium', title: 'Modal container missing role="dialog" / aria-modal',           scan: scanModalA11y },
  { id: 'deferred-revoke-object-url',   severity: 'low',    title: 'URL.revokeObjectURL deferred via setTimeout',                  scan: scanDeferredRevokeObjectURL },
  { id: 'non-null-env',                 severity: 'low',    title: 'process.env.X! non-null assertion',                            scan: scanNonNullEnv },
  { id: 'void-dead-code',               severity: 'low',    title: '`void <ident>` dead-code marker',                              scan: scanVoidDeadCode },
]
