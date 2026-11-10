-- Review 9 (owner, 2026-11-10): security providers that sell a service (MDR, MSSP, consulting, incident response) had no sub-category.
-- Mirrors SECTOR_TAXONOMY in src/lib/taxonomy.ts. Idempotent.
INSERT INTO sectors (name, parent_id)
SELECT v.sub_name, p.id
FROM (VALUES
  ('Cybersecurity', 'Managed Security Services')
) AS v(parent_name, sub_name)
JOIN sectors p ON p.name = v.parent_name AND p.parent_id IS NULL
ON CONFLICT (name) DO NOTHING;
