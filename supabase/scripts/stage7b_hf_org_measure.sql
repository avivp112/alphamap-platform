-- Stage 7b measurement — READ ONLY. Run in the Supabase SQL editor BEFORE applying 20261126000000 (it uses only tables that exist today).
-- The owner asked for the numbers before the build; the build is dry-run only, so this is the check on the real DB.

-- 1. How many HF orgs have a website in their profile?  Needs the profile fetch (snapshot-huggingface, dryRun first), so today the only
--    stored profile data is oss_projects.homepage / authors on HF rows. This counts what is already stored.
SELECT count(DISTINCT owner_login)                                                         AS hf_owners,
       count(DISTINCT owner_login) FILTER (WHERE homepage IS NOT NULL AND btrim(homepage) <> '') AS owners_with_homepage_field,
       count(DISTINCT owner_login) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(authors) a WHERE coalesce(a->>'website','') <> '')) AS owners_with_author_website
  FROM oss_projects WHERE source = 'huggingface_model';

-- 2. Weekly-measurement gap: how many tracked HF models have no comparison 6–10 days back?
SELECT count(*) AS hf_models,
       count(*) FILTER (WHERE downloads_delta_7d IS NULL) AS without_weekly,
       round(100.0 * count(*) FILTER (WHERE downloads_delta_7d IS NULL) / NULLIF(count(*), 0), 1) AS pct_without_weekly
  FROM oss_project_velocity WHERE source = 'huggingface_model';

-- 3. Companies that can be linked with certainty RIGHT NOW (site -> HF org): the company's own site links an HF org.
SELECT count(*) AS companies, count(*) FILTER (WHERE huggingface_url IS NOT NULL AND huggingface_url ~* 'huggingface\.co/[^/]+') AS with_hf_url_on_file,
       count(DISTINCT lower(substring(huggingface_url FROM 'huggingface\.co/([^/?#\s]+)'))) FILTER (WHERE huggingface_url ~* 'huggingface\.co/[^/]+') AS distinct_orgs
  FROM startups;

-- 4. ... and of those, how many already have models in the tracked set (so the company page would show something today)
SELECT count(DISTINCT s.id) AS companies_with_tracked_models
  FROM startups s
  JOIN oss_projects p ON p.source = 'huggingface_model'
   AND lower(p.owner_login) = lower(substring(s.huggingface_url FROM 'huggingface\.co/([^/?#\s]+)'))
 WHERE s.huggingface_url ~* 'huggingface\.co/[^/]+';

-- 5. Profile -> company site (the other certain direction) needs the profile website, which only the weekly snapshot fetches.
--    After migration + one dry run of snapshot-huggingface, run:  SELECT count(*) FROM hf_link_candidates;  and  SELECT link_hf_orgs(true);
