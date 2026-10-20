#!/usr/bin/env node
// Emits the SQL that installs a STRIKE seed module for one tenant by hand:
// the same rows `python manage.py import_seed_module <seed> --tenant <id>`,
// `approve_media` and steps 4-5 of scripts/strike-demo-wls.sh produce, as one
// script for the Supabase SQL editor. The media files themselves are uploaded
// through the Storage dashboard; the script refuses to run until they are there.
//
//   node scripts/strike-seed-sql.mjs --seed services/learning-studio/seed/loto-101 \
//     --tenant <tenant uuid> --approver <reviewer email> [--gate hot_work|none] [--dry-run]
//
// A translation of a module already installed goes in as a new published
// version of that module, in its own language, so completions in either
// language satisfy the same training requirements:
//
//   node scripts/strike-seed-sql.mjs --seed services/learning-studio/seed/loto-101 \
//     --module module.es.json --add-locale --tenant <tenant uuid> --approver <reviewer email>
//
// --dry-run skips the media check and ends by raising an error, so the
// database discards everything: it proves the script against a real schema
// without changing it, whatever runs it.
//
// The path and approval rules mirror services/learning-studio/studio/content.py;
// keep the two in step.
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const seedDir = option('seed')
const tenantId = option('tenant')
const approver = option('approver')
const gate = option('gate', 'hot_work')
const moduleFile = option('module', 'module.json')
const addLocale = process.argv.includes('--add-locale')
const dryRun = process.argv.includes('--dry-run')

if (!seedDir || !tenantId || !approver) fail('usage: --seed <dir> --tenant <uuid> --approver <email> [--gate hot_work|none] [--dry-run]')
if (!UUID.test(tenantId)) fail(`--tenant must be a UUID, got ${tenantId}`)
if (!approver.includes('@')) fail(`--approver must be an email address, got ${approver}`)
if (!['hot_work', 'none'].includes(gate)) fail(`--gate must be hot_work or none, got ${gate}`)

const module_ = JSON.parse(readFileSync(join(seedDir, moduleFile), 'utf8'))
const locale = module_.locale ?? 'en'

// content.py: media_prefix_for
function mediaPrefixFor(mod, tenant) {
  const prefix = mod.media_prefix.replace(/^\/+|\/+$/g, '')
  const rest = prefix.startsWith('global/') ? prefix.slice('global/'.length) : prefix
  return `${tenant}/${rest}`
}

// content.py: bucket_path
const bucketPath = (prefix, path) => (path.includes('/') ? path : `${prefix}/${path}`)

// content.py: _media_refs
function* mediaRefs(block) {
  const image = block.image
  if (image && typeof image === 'object' && image.path) yield [image, 'path']
  const narration = block.narration
  if (narration && typeof narration === 'object') {
    for (const field of ['audio_path', 'captions_path']) if (narration[field]) yield [narration, field]
  }
}

// content.py: rewrite_media_paths
function rewriteMediaPaths(content, prefix, dir) {
  const rewritten = structuredClone(content)
  const uploads = new Map()
  const missing = new Set()
  for (const block of rewritten.blocks) {
    for (const [owner, field] of mediaRefs(block)) {
      const original = owner[field]
      const target = bucketPath(prefix, original)
      owner[field] = target
      const local = join(dir, posix.basename(original))
      if (existsSync(local)) uploads.set(target, { local: posix.basename(original), target })
      else if (!original.includes('/')) missing.add(original)
    }
  }
  return { content: rewritten, uploads: [...uploads.values()], missing: [...missing].sort() }
}

const prefix = mediaPrefixFor(module_, tenantId)
const { content, uploads, missing } = rewriteMediaPaths(module_.content, prefix, seedDir)
if (missing.length) fail(`media files missing from ${seedDir}: ${missing.join(', ')}`)

const text = value => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`)
const textArray = values => `array[${values.map(text).join(', ')}]::text[]`
const jsonb = value => `${text(JSON.stringify(value))}::jsonb`
const scope = `${text(tenantId)}, 'tenant'`

const questionSql = module_.questions.map((question, index) => `
  v_question := gen_random_uuid();
  insert into public.strike_quiz_questions
    (id, module_version_id, tenant_id, library_scope, question_type, prompt, explanation, sort_order, points, required, graded)
  values (v_question, v_version, ${scope}, ${text(question.question_type)}, ${text(question.prompt)}, ${text(question.explanation ?? null)}, ${index}, 1, true, true);
  insert into public.strike_quiz_answers (question_id, tenant_id, library_scope, answer_text, is_correct, sort_order) values
${question.answers.map((answer, answerIndex) => `    (v_question, ${scope}, ${text(answer.text)}, ${Boolean(answer.correct)}, ${answerIndex})`).join(',\n')};`).join('\n')

const gateSql = gate === 'none' || addLocale ? '' : `
  -- strike-demo-wls.sh step 5: require this module before ${gate} permits.
  insert into public.strike_training_requirements
    (tenant_id, module_id, source_type, required_before_start, expires_after_days, active, notes)
  select v_tenant, v_module, ${text(gate)}, true, null, true, ${text(`STRIKE demo: ${module_.title} before ${gate.replace('_', ' ')}`)}
   where not exists (
     select 1 from public.strike_training_requirements r
      where r.tenant_id = v_tenant and r.module_id = v_module and r.source_type = ${text(gate)});
`

// content.py: CONTENT_TYPES / content_type_for
const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.vtt': 'text/vtt', '.mp4': 'video/mp4' }
const contentTypeFor = path => CONTENT_TYPES[posix.extname(path).toLowerCase()] ?? 'application/octet-stream'

const contentTypeSql = `
  -- The dashboard takes content types from the browser; the player needs the
  -- ones the importer would have set (captions as text/vtt, in particular).
  update storage.objects o
     set metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object('mimetype', wanted.mimetype)
    from (values
${uploads.map(u => `      (${text(u.target)}, ${text(contentTypeFor(u.target))})`).join(',\n')}
    ) as wanted(name, mimetype)
   where o.bucket_id = 'strike-media' and o.name = wanted.name
     and coalesce(o.metadata ->> 'mimetype', '') <> wanted.mimetype;
`

const mediaCheckSql = dryRun ? '  -- dry run: media check skipped' : `
  -- The player signs URLs for these objects; refuse to publish a module whose
  -- media is not in the bucket yet.
  select count(*) into v_missing
    from unnest(${textArray(uploads.map(u => u.target))}) as wanted(name)
   where not exists (select 1 from storage.objects o where o.bucket_id = 'strike-media' and o.name = wanted.name);
  if v_missing > 0 then
    raise exception '% of ${uploads.length} media files are not in the strike-media bucket yet; upload them first (see the header of this script)', v_missing;
  end if;
${contentTypeSql}`

const versionInsertSql = (versionNumber, title) => `
  insert into public.strike_module_versions
    (id, module_id, tenant_id, library_scope, version_number, status, content, passing_score, retake_limit, validity_days, locale, title)
  values (v_version, v_module, ${scope}, ${versionNumber}, 'draft', v_content, ${module_.passing_score ?? 80}, ${module_.retake_limit ?? 'null'}, ${module_.validity_days ?? 'null'}, ${text(locale)}, ${title});`

const installSql = addLocale ? `
  -- --add-locale: a new version of the module already installed, in ${locale}.
  select id into v_module from public.strike_modules where tenant_id = v_tenant and slug = v_slug;
  if v_module is null then
    raise exception '% is not installed for this tenant; install the original language first', v_slug;
  end if;
  if exists (select 1 from public.strike_module_versions where module_id = v_module and status = 'published' and locale = ${text(locale)}) then
    raise exception '% already has a published ${locale} version; nothing changed', v_slug;
  end if;
  select coalesce(max(version_number), 0) + 1 into v_version_number from public.strike_module_versions where module_id = v_module;
${versionInsertSql('v_version_number', text(module_.title))}
${questionSql}

  -- Publish the version only: the module row and its other languages are untouched.
  update public.strike_module_versions set status = 'published', published_at = now() where id = v_version;
` : `
  if exists (select 1 from public.strike_modules where tenant_id = v_tenant and slug = v_slug) then
    raise exception '% already exists for this tenant; nothing changed', v_slug;
  end if;

  -- import_seed_module: module, version, quiz.
  insert into public.strike_modules
    (id, tenant_id, library_scope, slug, title, description, category, tags, estimated_minutes, status)
  values (v_module, ${scope}, v_slug, ${text(module_.title)}, ${text(module_.description ?? null)}, ${text(module_.category ?? null)}, ${textArray(module_.tags ?? [])}, ${module_.estimated_minutes ?? 'null'}, 'in_review');
${versionInsertSql(1, 'null')}
${questionSql}

  -- strike-demo-wls.sh step 4: publish. Questions were inserted first because
  -- a published version's quiz is frozen by trigger.
  update public.strike_module_versions set status = 'published', published_at = now() where id = v_version;
  update public.strike_modules set status = 'published', published_at = now() where id = v_module;
  insert into public.strike_tenant_settings (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
${gateSql}`

process.stdout.write(`-- ${module_.title} for tenant ${tenantId}: manual ${addLocale ? `install of the ${locale} version` : 'install'}.
-- Generated by scripts/strike-seed-sql.mjs from ${posix.basename(seedDir)}/${moduleFile}${dryRun ? ' (DRY RUN: rolls back)' : ''}.
--
-- Before running, upload these ${uploads.length} files from services/learning-studio/seed/${posix.basename(seedDir)}/
-- into the strike-media bucket at exactly these paths (any already there can stay):
${uploads.map(u => `--   ${u.local.padEnd(22)} -> ${u.target}`).join('\n')}
--
-- Then paste the whole file into Supabase -> SQL Editor and run it. It is
-- all-or-nothing and refuses to run twice for the same tenant.
${dryRun ? '' : '\nbegin;\n'}
do $install$
declare
  v_tenant   constant uuid := ${text(tenantId)};
  v_slug     constant text := ${text(module_.slug)};
  v_approver constant text := ${text(approver)};
  v_module   uuid := gen_random_uuid();
  v_version  uuid := gen_random_uuid();
  v_version_number int;
  v_question uuid;
  v_missing  int;
  v_content  jsonb := ${jsonb(content)};
  v_stamp    jsonb := jsonb_build_object('approved_by', v_approver, 'approved_at', to_jsonb(now()));
  v_block    jsonb;
  v_blocks   jsonb := '[]'::jsonb;
begin
${mediaCheckSql}
  -- approve_media: stamp the reviewer on every image and narration.
  for v_block in select value from jsonb_array_elements(v_content -> 'blocks') loop
    if jsonb_typeof(v_block -> 'image') = 'object' and (v_block -> 'image') ? 'path' then
      v_block := jsonb_set(v_block, '{image}', (v_block -> 'image') || v_stamp);
    end if;
    if jsonb_typeof(v_block -> 'narration') = 'object' and (v_block -> 'narration') ? 'audio_path' then
      v_block := jsonb_set(v_block, '{narration}', (v_block -> 'narration') || v_stamp);
    end if;
    v_blocks := v_blocks || jsonb_build_array(v_block);
  end loop;
  v_content := jsonb_set(v_content, '{blocks}', v_blocks);
${installSql}
  ${dryRun
    ? `raise exception 'DRY RUN OK, rolled back: % for tenant % would install version % of module % (% questions)', v_slug, v_tenant, v_version, v_module, ${module_.questions.length};`
    : `raise notice 'Installed % (${locale}) for tenant %: module %, version % (% questions)', v_slug, v_tenant, v_module, v_version, ${module_.questions.length};`}
end
$install$;
${dryRun ? '' : '\ncommit;\n'}`)
