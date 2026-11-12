-- =============================================================================
-- supabase/scripts/stage7_oss_calibration.sql — READ ONLY, runs BEFORE the migration 20261125.
-- Calibrates the "suspected fake stars" flag: for the GitHub repos that pass the stage 7 measurement filter (50+ stars a week),
-- the numbers the flag looks at — forks and open issues against stars. Paste, run, send back the table.
-- The flag (in the migration) is: stars >= 2000 AND forks/stars < 0.02 AND open_issues/stars < 0.002.
-- =============================================================================
WITH p AS (
  SELECT o.id, o.owner_login, o.name, o.description, o.homepage, o.created_at_source,
         v.stars, v.forks, v.stars_delta_7d, lm.open_issues,
         lower(regexp_replace(coalesce(o.homepage, ''), '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2', 'i')) AS home_domain
    FROM oss_projects o
    JOIN oss_project_velocity v ON v.project_id = o.id
    LEFT JOIN LATERAL (SELECT m.open_issues FROM oss_project_metrics m WHERE m.project_id = o.id ORDER BY m.observed_at DESC LIMIT 1) lm ON true
   WHERE o.startup_id IS NULL AND o.source = 'github_repo'
)
SELECT owner_login || '/' || name AS project, home_domain, stars, stars_delta_7d, forks, open_issues,
       round(forks::numeric / NULLIF(stars, 0), 4)              AS forks_per_star,
       round(coalesce(open_issues, 0)::numeric / NULLIF(stars, 0), 5) AS issues_per_star,
       (stars >= 2000 AND forks::numeric / NULLIF(stars, 0) < 0.02 AND coalesce(open_issues, 0)::numeric / NULLIF(stars, 0) < 0.002) AS would_be_flagged
  FROM p
 WHERE coalesce(stars_delta_7d, 0) >= 50
   AND home_domain <> '' AND home_domain ~ '\.'
   AND created_at_source >= now() - interval '180 days'
 ORDER BY stars_delta_7d DESC
 LIMIT 60;
