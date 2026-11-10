-- Review 8 (owner, 2026-11-10): more sectors, and AgTech moves to Food & Agriculture.
-- Mirrors SECTOR_TAXONOMY in src/lib/taxonomy.ts. Idempotent; needs 20261121 to have run (it creates AgTech).
INSERT INTO sectors (name) VALUES ('Food & Agriculture'), ('Automotive & Mobility')
ON CONFLICT (name) DO NOTHING;

INSERT INTO sectors (name, parent_id)
SELECT v.sub_name, p.id
FROM (VALUES
  ('AI & ML',                'Voice & Speech AI'),
  ('Cybersecurity',          'Vulnerability Management'),
  ('Enterprise Software',    'Productivity & Collaboration'),
  ('Food & Agriculture',     'FoodTech'),
  ('Food & Agriculture',     'AgTech'),
  ('Automotive & Mobility',  'Automotive / General'),
  ('Automotive & Mobility',  'Vehicle Security'),
  ('Automotive & Mobility',  'Autonomous Driving'),
  ('Automotive & Mobility',  'Mobility Services')
) AS v(parent_name, sub_name)
JOIN sectors p ON p.name = v.parent_name AND p.parent_id IS NULL
ON CONFLICT (name) DO NOTHING;

-- AgTech was filed under Industrial & Manufacturing by 20261121: move it (companies tagged AgTech keep the tag).
UPDATE sectors SET parent_id = (SELECT id FROM sectors WHERE name = 'Food & Agriculture' AND parent_id IS NULL)
WHERE name = 'AgTech' AND parent_id IS DISTINCT FROM (SELECT id FROM sectors WHERE name = 'Food & Agriculture' AND parent_id IS NULL);
