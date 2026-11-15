-- Round 10 (owner, 2026-11-15): personal email, messaging and notes accounts (Posteo) had no sub-sector under Consumer & Media.
-- Mirrors SECTOR_TAXONOMY in src/lib/taxonomy.ts. Idempotent.
INSERT INTO sectors (name, parent_id)
SELECT 'Consumer Apps & Communication', p.id FROM sectors p WHERE p.name = 'Consumer & Media' AND p.parent_id IS NULL
ON CONFLICT (name) DO NOTHING;
