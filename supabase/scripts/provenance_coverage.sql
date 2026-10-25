-- =============================================================================
-- provenance_coverage.sql — Phase 1 (docs/enrichment_v2_spec.md §7): "every
-- accepted material value has a field_provenance row with URL and verified
-- quote". Read-only. Run in the Supabase SQL Editor.
--
-- For companies enrichment v2 has written (enriched_v2_at set), per material
-- field: how many hold a value, and how many of those have a provenance row.
-- A value with no row was written by v1, an import, or v2 before that field
-- got provenance (2026-10-25: social links, GitHub / Hugging Face, ARR,
-- valuation benchmarks, revenue and round values) — it is unknown origin,
-- not necessarily wrong.
-- =============================================================================

WITH v2 AS (
  SELECT * FROM startups WHERE enriched_v2_at IS NOT NULL
),
prov AS (
  SELECT DISTINCT startup_id, field FROM field_provenance
),
fields(field) AS (
  SELECT 'profile.city' UNION ALL
  SELECT 'profile.country' UNION ALL
  SELECT 'profile.founded_year' UNION ALL
  SELECT 'profile.website' UNION ALL
  SELECT 'profile.founding_country' UNION ALL
  SELECT 'profile.linkedin_url' UNION ALL
  SELECT 'technology.github_url' UNION ALL
  SELECT 'technology.huggingface_url' UNION ALL
  SELECT 'metrics.employee_count'
),
per_field AS (
  SELECT f.field,
         count(*) FILTER (WHERE CASE f.field
            WHEN 'profile.city'             THEN v2.city IS NOT NULL
            WHEN 'profile.country'          THEN v2.country IS NOT NULL
            WHEN 'profile.founded_year'     THEN v2.founded_year IS NOT NULL
            WHEN 'profile.website'          THEN v2.website IS NOT NULL
            WHEN 'profile.founding_country' THEN v2.founding_country IS NOT NULL
            WHEN 'profile.linkedin_url'     THEN v2.linkedin_url IS NOT NULL
            WHEN 'technology.github_url'    THEN v2.github_url IS NOT NULL
            WHEN 'technology.huggingface_url' THEN v2.huggingface_url IS NOT NULL
            WHEN 'metrics.employee_count'   THEN v2.employee_count IS NOT NULL
          END) AS with_value,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM prov p WHERE p.startup_id = v2.id AND p.field = f.field)) AS with_provenance
  FROM fields f CROSS JOIN v2
  GROUP BY f.field
),
rounds AS (
  SELECT 'funding_rounds.amount_raised (v2 companies)' AS field,
         count(*) FILTER (WHERE r.amount_raised IS NOT NULL) AS with_value,
         count(*) FILTER (WHERE r.amount_raised IS NOT NULL AND EXISTS (
           SELECT 1 FROM field_provenance p WHERE p.startup_id = r.startup_id AND p.field = 'funding_rounds.' || r.id || '.amount_raised')) AS with_provenance
  FROM funding_rounds r JOIN v2 ON v2.id = r.startup_id
)
SELECT field, with_value, with_provenance,
       CASE WHEN with_value = 0 THEN NULL ELSE round(100.0 * least(with_provenance, with_value) / with_value) END AS pct_with_provenance
FROM (SELECT * FROM per_field UNION ALL SELECT * FROM rounds) x
ORDER BY field;
