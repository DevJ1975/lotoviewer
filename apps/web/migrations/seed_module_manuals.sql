-- seed_module_manuals.sql — stub manuals for every top-level module in
-- packages/core/src/features.ts. Idempotent; run after migration 080.
-- The /api/superadmin/manuals/bootstrap route mirrors this seed for
-- runtime use whenever a new module ships.
--
-- Each stub is `published_at = NULL` (draft) so a non-superadmin
-- doesn't see "this manual is a placeholder" until a human writes
-- something real. The /manuals index still surfaces stubs to
-- superadmins via the SUPERADMIN_ALL policy so they know what's
-- pending.

begin;

insert into public.manuals (module_id, title, summary, body_md)
values
  ('loto',                      'LOTO',               'Lockout/Tagout equipment + placards.',                E'## Overview\n\nThis manual covers the LOTO module. **Edit me.**'),
  ('risk-assessment', 'Risk Assessment',     'ISO 45001 6.1 risk register + heat map.',             E'## Overview\n\nThis manual covers Risk Assessment. **Edit me.**'),
  ('confined-spaces', 'Confined Spaces',     'Permit-required confined space program.',             E'## Overview\n\nThis manual covers Confined Spaces. **Edit me.**'),
  ('hot-work',        'Hot Work',            'Hot-work permits + fire-watch sign-on.',              E'## Overview\n\nThis manual covers Hot Work. **Edit me.**'),
  ('incidents',       'Incidents',           'Incident reporting, investigation, OSHA logs.',       E'## Overview\n\nThis manual covers Incidents. **Edit me.**'),
  ('near-miss',       'Near-miss',           'Near-miss reports (legacy — folding into Incidents).', E'## Overview\n\nThis manual covers Near-miss reporting. **Edit me.**'),
  ('jha',             'JHA',                 'Job Hazard Analysis library.',                        E'## Overview\n\nThis manual covers JHA. **Edit me.**'),
  ('toolbox-talks',   'Toolbox Talks',       'AI-generated daily talks + crew sign-in roster.',     E'## Overview\n\nThis manual covers Toolbox Talks. **Edit me.**'),
  ('strike',          'STRIKE',              'Microlearning + task-readiness for high-risk work.',  E'## Overview\n\nThis manual covers STRIKE: short videos, quizzes, assignments, and task-readiness checks. **Edit me.**'),
  ('safety-boards',   'Safety Boards',       'Internal threaded forums for safety discussion.',     E'## Overview\n\nThis manual covers Safety Boards. **Edit me.**'),
  ('bbs',             'Behavior-Based Safety','QR-driven unsafe act / condition / safe behavior observations.', E'## Overview\n\nThis manual covers Behavior-Based Safety (BBS). **Edit me.**'),
  ('chemicals',       'Chemical Management', 'Chemical inventory, GHS labeling, SDS storage + AI parsing + drift monitor.', E'## Overview\n\nThis manual covers the Chemical Management module. **Edit me.**'),
  ('reports-scorecard',         'EHS Scorecard',      'Leading + lagging indicators rolled up tenant-wide.',    E'## Overview\n\nThis manual covers the EHS Scorecard. **Edit me.**'),
  ('reports-insights',          'Insights',           'Auto-surfaced trends across the safety modules.',        E'## Overview\n\nThis manual covers the Insights module. **Edit me.**'),
  ('reports-compliance-bundle', 'Compliance bundle',  'One-click PDF pack of OSHA forms + records.',            E'## Overview\n\nThis manual covers the Compliance bundle export. **Edit me.**'),
  ('reports-inspector',         'Inspector view',     'Tokenized read-only view for outside inspectors.',       E'## Overview\n\nThis manual covers the Inspector view. **Edit me.**'),
  ('admin-loto-devices',        'LOTO devices',       'Manage lock + tag inventory.',                           E'## Overview\n\nThis manual covers LOTO device administration. **Edit me.**'),
  ('admin-workers',             'Workers',            'Worker roster + role management.',                       E'## Overview\n\nThis manual covers worker administration. **Edit me.**'),
  ('admin-configuration',       'Configuration',      'Tenant-level configuration: modules, branding, defaults.', E'## Overview\n\nThis manual covers Configuration. **Edit me.**'),
  ('admin-webhooks',            'Webhooks',           'Outbound webhooks for integrations.',                    E'## Overview\n\nThis manual covers Webhooks. **Edit me.**'),
  ('admin-training',            'Training records',   'Training certifications + expiry tracking.',             E'## Overview\n\nThis manual covers Training records. **Edit me.**'),
  ('admin-hygiene-log',         'Data hygiene log',   'Per-tenant data-cleanup audit trail.',                   E'## Overview\n\nThis manual covers the Data hygiene log. **Edit me.**'),
  ('settings-notifications',    'Notifications',      'Web Push subscription + per-user notification toggles.', E'## Overview\n\nThis manual covers Notification settings. **Edit me.**')
on conflict (module_id) do nothing;

commit;
