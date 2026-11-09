-- Review 7 (owner, 2026-11-09): sectors the taxonomy lacked, so a company is not filed under "General".
-- Mirrors SECTOR_TAXONOMY in src/lib/taxonomy.ts. Idempotent; names stay globally unique.
INSERT INTO sectors (name) VALUES ('Industrial & Manufacturing'), ('Real Estate')
ON CONFLICT (name) DO NOTHING;

INSERT INTO sectors (name, parent_id)
SELECT v.sub_name, p.id
FROM (VALUES
  ('Cybersecurity',              'Security Testing'),
  ('Consumer & Media',           'AdTech'),
  ('Industrial & Manufacturing', 'Industrial / General'),
  ('Industrial & Manufacturing', 'AgTech'),
  ('Real Estate',                'PropTech'),
  ('Enterprise Software',        'Sales Tech'),
  ('Consumer & Media',           'Travel Tech')
) AS v(parent_name, sub_name)
JOIN sectors p ON p.name = v.parent_name AND p.parent_id IS NULL
ON CONFLICT (name) DO NOTHING;
