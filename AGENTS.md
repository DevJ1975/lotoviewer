<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:wiki-sync-rules -->
# Keep the user wiki in sync

Every user-facing module has a wiki page at `apps/web/app/wiki/<slug>/page.tsx` with an FAQ, Do's & Don'ts, version, and changelog. The mapping from module source paths to wiki pages lives in `apps/web/app/wiki/_lib/manifest.json`.

When you add, remove, or change a feature in a documented module, update the matching wiki page in the same PR:

1. Edit the relevant Section / Faq / DoDont entry on the wiki page.
2. Run `npm run wiki:touch -- <slug> --message="One-line summary"` to bump `CURRENT_VERSION` (patch) + `LAST_UPDATED` and prepend a CHANGELOG row. Then flesh out the changelog entry by hand.
3. The CI check (`npm run check:wiki`, also run as the `Wiki sync` GitHub Action on every PR) will fail if a module's source files changed without its wiki page being touched.

Bypass when the change genuinely doesn't need docs (refactor, dependency bump, test-only):
- Add a line to any commit body: `wiki-sync-skip: <one-line reason>`, **or**
- Run with `WIKI_SYNC_SKIP=1` for a one-off local override.

Adding a brand-new module:
1. Append an entry to `apps/web/app/wiki/_lib/manifest.json`.
2. Create `apps/web/app/wiki/<slug>/page.tsx` (copy an existing page as a template).
3. The card on `/wiki` and the check script pick it up automatically.
<!-- END:wiki-sync-rules -->
