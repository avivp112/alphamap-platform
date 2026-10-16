-- =============================================================================
-- Migration: patent applicant denylist — incumbents from the full dry run
-- Created:   2026-10-15
-- Description:
--   The quality-gate dry run over all 221 EPO filings (194 companies) still
--   queued 125 applicants for review, most of them incumbents or their IP
--   subsidiaries: Dropbox, Snap, OpenAI, Walmart, Capital One, LG Energy
--   Solution, NAVER, Zoox (Amazon), ByteDance's Beijing Zitiao, Yandex's
--   Y.E. Hub, Toyota's Prime Planet... The review queue is for companies that
--   might be startups, not for re-confirming the Fortune 500 every week.
--   Subsidiary naming patterns (…Technology Licensing, …Global Technologies,
--   …Innovation LLC, Bidco, OpCo) are rejected by the gate itself
--   (corporate_ip_vehicle); this list covers the brand names.
--
--   Word-boundary matched by is_excluded_applicant(), on names normalised by
--   normalize_applicant_name() ("MANN+HUMMEL GmbH" -> "mann hummel gmbh").
--
-- Idempotent (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO patent_excluded_applicants (pattern, category, note) VALUES
  ('dropbox',                         'multinational', NULL),
  ('snap inc',                        'multinational', 'Snap Inc.'),
  ('openai',                          'multinational', NULL),
  ('walmart',                         'multinational', NULL),
  ('state farm',                      'multinational', NULL),
  ('capital one',                     'multinational', NULL),
  ('paccar',                          'multinational', NULL),
  ('lg energy solution',              'multinational', NULL),
  ('naver',                           'multinational', NULL),
  ('zoox',                            'multinational', 'Amazon subsidiary'),
  ('wistron',                         'multinational', NULL),
  ('yanmar',                          'multinational', NULL),
  ('fca us',                          'multinational', 'Stellantis'),
  ('magna electronics',               'multinational', NULL),
  ('mitel',                           'multinational', NULL),
  ('dish network',                    'multinational', NULL),
  ('verisign',                        'multinational', NULL),
  ('digicert',                        'multinational', NULL),
  ('carl zeiss',                      'multinational', NULL),
  ('leica geosystems',                'multinational', 'Hexagon'),
  ('mahle',                           'multinational', NULL),
  ('mann hummel',                     'multinational', NULL),
  ('nichia',                          'multinational', NULL),
  ('semiconductor energy laboratory', 'multinational', NULL),
  ('rockwell automation',             'multinational', NULL),
  ('cerner',                          'multinational', 'Oracle Health'),
  ('blue yonder',                     'multinational', 'Panasonic'),
  ('bluehalo',                        'multinational', 'AeroVironment'),
  ('oshkosh',                         'multinational', NULL),
  ('avago',                           'multinational', 'Broadcom'),
  ('fujifilm',                        'multinational', NULL),
  ('toshiba',                         'multinational', NULL),
  ('mikuni',                          'multinational', NULL),
  ('chervon',                         'multinational', NULL),
  ('core scientific',                 'multinational', NULL),
  ('qliktech',                        'multinational', 'Qlik'),
  ('idemia',                          'multinational', NULL),
  ('torc robotics',                   'multinational', 'Daimler Truck subsidiary'),
  ('zitiao',                          'multinational', 'ByteDance (Beijing Zitiao Network Technology)'),
  ('bytedance',                       'multinational', NULL),
  ('nec laboratories',                'multinational', 'NEC'),
  ('b e aerospace',                   'multinational', 'RTX / Collins'),
  ('savant systems',                  'multinational', NULL),
  ('y e hub',                         'multinational', 'Yandex')
ON CONFLICT (pattern) DO NOTHING;
