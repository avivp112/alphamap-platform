-- =============================================================================
-- Migration: patent applicant denylist — incumbents found in production
-- Created:   2026-10-15
-- Description:
--   A 25-row sample of EPO filings (60 days to 2026-10-15) was mostly
--   incumbents the seed list missed, each of which became a "startup":
--   subsidiaries filing under a name the parent's pattern does not match
--   (GM Global Technology Operations vs "general motors", UOP vs "honeywell",
--   GDM Holding = Google DeepMind vs "google") and large companies never
--   listed. Added here so the quality gate (_shared/company-gate.ts) rejects
--   them as excluded_applicant instead of sending them to the review queue.
--
--   Patterns are word-boundary matched by is_excluded_applicant(), so "zoom"
--   cannot fire on a startup called "Zoomly".
--
-- Idempotent (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO patent_excluded_applicants (pattern, category, note) VALUES
  ('disney',               'multinational', 'Disney Enterprises — 2026-10-15 sample'),
  ('gm global technology', 'multinational', 'General Motors IP subsidiary'),
  ('intuit',               'multinational', '2026-10-15 sample'),
  ('zoom communications',  'multinational', 'Zoom (renamed from Zoom Video Communications)'),
  ('zoom video',           'multinational', 'Zoom, former name'),
  ('sk on',                'multinational', 'SK Group battery subsidiary'),
  ('fluke',                'multinational', 'Fortive subsidiary'),
  ('amdocs',               'multinational', '2026-10-15 sample'),
  ('avalara',              'multinational', '2026-10-15 sample'),
  ('samsara',              'multinational', 'NYSE-listed since 2021'),
  ('uop',                  'multinational', 'Honeywell UOP'),
  ('gdm holding',          'multinational', 'Google DeepMind'),
  ('deepmind',             'multinational', 'Google DeepMind'),
  ('prime planet energy',  'multinational', 'Toyota / Panasonic battery joint venture'),
  ('bitdefender',          'multinational', '2026-10-15 sample'),
  ('sphere entertainment', 'multinational', 'NYSE-listed'),
  ('uipco',                'multinational', 'USAA IP subsidiary'),
  ('usaa',                 'multinational', NULL),
  ('vialto',               'multinational', 'Vialto Partners (ex-PwC)')
ON CONFLICT (pattern) DO NOTHING;
