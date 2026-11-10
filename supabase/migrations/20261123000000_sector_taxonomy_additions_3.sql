-- Review 8 (owner, 2026-11-10): the new sub-categories of the taxonomy proposal. Nothing is merged or renamed; no re-mapping.
-- Mirrors SECTOR_TAXONOMY in src/lib/taxonomy.ts. Idempotent. Needs 20261121 and 20261122 (the Industrial & Manufacturing parent).
INSERT INTO sectors (name, parent_id)
SELECT v.sub_name, p.id
FROM (VALUES
  ('Fintech', 'Fintech Infrastructure'),
  ('Cybersecurity', 'Application & API Security'),
  ('Cybersecurity', 'Fraud & Abuse Prevention'),
  ('Cybersecurity', 'Email Security'),
  ('SaaS & Dev Tools', 'Observability & Monitoring'),
  ('SaaS & Dev Tools', 'Vertical SaaS'),
  ('Enterprise Software', 'Customer Support & CX'),
  ('Enterprise Software', 'Marketing Tech'),
  ('Enterprise Software', 'Legal & Compliance Software'),
  ('Health & Life Sciences', 'Healthcare IT & Administration'),
  ('DeepTech', 'Advanced Materials'),
  ('DeepTech', 'IoT & Connectivity'),
  ('Industrial & Manufacturing', 'Industrial Automation'),
  ('Industrial & Manufacturing', 'Advanced Manufacturing'),
  ('Industrial & Manufacturing', 'Construction Tech')
) AS v(parent_name, sub_name)
JOIN sectors p ON p.name = v.parent_name AND p.parent_id IS NULL
ON CONFLICT (name) DO NOTHING;
