-- Rollback for 20260726230000_oss_startup_linker.sql
-- Drops link_oss_projects() and restores strong_identity_groups() to its
-- original 3-branch form (domain, cik, ch_number only). Note: this does NOT
-- retroactively unlink any oss_projects.startup_id set while link_oss_projects()
-- was live, nor remove any github_org/hf_org identifiers it recorded.

DROP FUNCTION IF EXISTS link_oss_projects(integer, boolean);

CREATE OR REPLACE FUNCTION strong_identity_groups()
RETURNS TABLE (kind text, value text, startup_ids uuid[])
LANGUAGE sql
STABLE
AS $$
  SELECT 'domain'::text, registrable_domain(s.website), array_agg(DISTINCT s.id)
    FROM startups s
   WHERE s.website IS NOT NULL
     AND registrable_domain(s.website) IS NOT NULL
   GROUP BY 2
  HAVING count(DISTINCT s.id) > 1

  UNION ALL

  SELECT 'cik'::text, g.cik, array_agg(DISTINCT g.startup_id)
    FROM raw_gov_filings g
   WHERE g.source = 'sec_form_d'
     AND g.startup_id IS NOT NULL
     AND btrim(coalesce(g.cik, '')) <> ''
   GROUP BY 2
  HAVING count(DISTINCT g.startup_id) > 1

  UNION ALL

  SELECT 'ch_number'::text, g.entity_number, array_agg(DISTINCT g.startup_id)
    FROM raw_gov_filings g
   WHERE g.source = 'uk_companies_house'
     AND g.startup_id IS NOT NULL
     AND btrim(coalesce(g.entity_number, '')) <> ''
   GROUP BY 2
  HAVING count(DISTINCT g.startup_id) > 1;
$$;

COMMENT ON FUNCTION strong_identity_groups() IS
  'Groups of startups sharing a strong identifier (domain, CIK, Companies House number), derived from source columns rather than company_identifiers -- which is UNIQUE(kind,value) and so cannot represent a duplicate at all.';
