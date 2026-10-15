-- Quality-gate inputs for every filing that created a company — READ ONLY.
-- Run in the SQL Editor with "No limit", Export -> Copy as CSV; the gate itself
-- (supabase/functions/_shared/company-gate.ts) is applied to the CSV offline.
-- Same data scripts/gate_report.ts reads directly when run on the server.
SELECT
  CASE f.source WHEN 'uk_companies_house' THEN 'uk' WHEN 'sec_form_d' THEN 'sec' ELSE 'epo' END AS src,
  f.entity_name AS name,
  f.form_type AS type,
  array_to_string(f.classification_codes, ' ') AS codes,
  jsonb_array_length(coalesce(f.officers, '[]'::jsonb)) AS off,
  (SELECT count(*) FROM jsonb_array_elements(coalesce(f.officers, '[]'::jsonb)) o
    WHERE lower(coalesce(o->>'relationships', '')) ~ 'director'
      AND lower(coalesce(o->>'relationships', '')) !~ 'corporate|nominee') AS dir,
  f.industry_group AS ind,
  CASE WHEN f.source IN ('epo_ops', 'uspto_patent') AND is_excluded_applicant(f.entity_name) THEN 1 ELSE 0 END AS ex,
  dense_rank() OVER (ORDER BY f.startup_id) AS co,
  CASE WHEN s.description IS NOT NULL THEN 1 ELSE 0 END AS d,
  CASE WHEN s.last_enriched_at IS NOT NULL OR s.enriched_v2_at IS NOT NULL THEN 1 ELSE 0 END AS en
FROM raw_gov_filings f
LEFT JOIN startups s ON s.id = f.startup_id
WHERE f.source IN ('uk_companies_house', 'epo_ops', 'uspto_patent', 'sec_form_d')
  AND f.startup_id IS NOT NULL
ORDER BY 1, 2;
