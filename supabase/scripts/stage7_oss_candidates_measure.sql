-- =============================================================================
-- supabase/scripts/stage7_oss_candidates_measure.sql — READ ONLY.
-- Stage 7 measurement (2026-10-29): how many GitHub / Hugging Face projects not
-- yet linked to a company would pass a DRAFT candidate filter. Nothing is
-- written. Two queries — the SQL Editor shows only the last result, so run them
-- one at a time (select one, Run).
--
-- Draft filter, every threshold in `params`:
--   1. unlinked                 oss_projects.startup_id IS NULL
--   2. owner not excluded       owner_login not in oss_excluded_owners
--   3. own homepage             a homepage whose domain is not a code host /
--                               free hosting / social page (github.io, huggingface.co ...)
--   4. recent                   created on the platform within 180 days
--   5. growing                  GitHub: +stars in 7 days; Hugging Face: +likes in 7 days
--   6. product-like description at least 30 characters, not a paper / course /
--                               list / personal project
-- =============================================================================

-- ── Query 1: the funnel, per source ─────────────────────────────────────────
WITH params AS (
  SELECT 180 AS max_age_days, 50 AS min_stars_7d, 20 AS min_likes_7d, 30 AS min_desc_chars
),
p AS (
  SELECT o.id, o.source, o.owner_login, o.name, o.description, o.homepage, o.created_at_source,
         v.stars, v.likes, v.stars_delta_7d, v.likes_delta_7d,
         lower(regexp_replace(coalesce(o.homepage, ''), '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2', 'i')) AS home_domain
    FROM oss_projects o
    LEFT JOIN oss_project_velocity v ON v.project_id = o.id
   WHERE o.startup_id IS NULL
),
f AS (
  SELECT p.*,
    NOT EXISTS (SELECT 1 FROM oss_excluded_owners x WHERE lower(x.owner_login) = lower(p.owner_login)) AS ok_owner,
    (p.home_domain <> '' AND p.home_domain ~ '\.' AND p.home_domain !~ '(^|\.)(github\.com|github\.io|githubusercontent\.com|gitlab\.com|gitlab\.io|bitbucket\.org|huggingface\.co|hf\.space|hf\.co|readthedocs\.io|readthedocs\.org|vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|streamlit\.app|gradio\.live|replit\.app|colab\.research\.google\.com|sites\.google\.com|notion\.site|substack\.com|medium\.com|arxiv\.org|twitter\.com|x\.com|linkedin\.com|discord\.gg|discord\.com|youtube\.com|pypi\.org|npmjs\.com|kaggle\.com|paperswithcode\.com)$') AS ok_home,
    (p.created_at_source >= now() - make_interval(days => (SELECT max_age_days FROM params))) AS ok_recent,
    (CASE WHEN p.source = 'github_repo' THEN coalesce(p.stars_delta_7d, 0) >= (SELECT min_stars_7d FROM params)
          ELSE coalesce(p.likes_delta_7d, 0) >= (SELECT min_likes_7d FROM params) END) AS ok_growth,
    (length(coalesce(p.description, '')) >= (SELECT min_desc_chars FROM params)
       AND p.description !~* '(\mpaper\M|official (code|implementation)|implementation of|reproduc|course|assignment|homework|tutorial|lecture|thesis|awesome[- ]|curated list|list of|leetcode|dotfiles|my (personal|own)|\mfork\M|benchmark for|dataset (of|for)|survey)') AS ok_desc
  FROM p
)
SELECT source,
       count(*)                                                                        AS unlinked,
       count(*) FILTER (WHERE ok_owner)                                                AS owner_not_excluded,
       count(*) FILTER (WHERE ok_owner AND ok_home)                                    AS own_homepage,
       count(*) FILTER (WHERE ok_owner AND ok_home AND ok_recent)                      AS recent_180d,
       count(*) FILTER (WHERE ok_owner AND ok_home AND ok_recent AND ok_growth)        AS growing,
       count(*) FILTER (WHERE ok_owner AND ok_home AND ok_recent AND ok_growth AND ok_desc) AS pass_all,
       count(*) FILTER (WHERE created_at_source IS NULL)                               AS no_created_date,
       count(*) FILTER (WHERE stars_delta_7d IS NULL AND likes_delta_7d IS NULL)       AS no_7d_measurement
  FROM f
 GROUP BY ROLLUP (source)
 ORDER BY source NULLS LAST;

-- ── Query 2: a sample of ~50 that pass every step, fastest-growing first ────
WITH params AS (
  SELECT 180 AS max_age_days, 50 AS min_stars_7d, 20 AS min_likes_7d, 30 AS min_desc_chars
),
p AS (
  SELECT o.id, o.source, o.owner_login, o.name, o.description, o.homepage, o.created_at_source, o.url,
         v.stars, v.likes, v.stars_delta_7d, v.likes_delta_7d,
         lower(regexp_replace(coalesce(o.homepage, ''), '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2', 'i')) AS home_domain
    FROM oss_projects o
    LEFT JOIN oss_project_velocity v ON v.project_id = o.id
   WHERE o.startup_id IS NULL
)
SELECT source, owner_login || '/' || name AS project, home_domain, created_at_source::date AS created,
       stars, stars_delta_7d, likes, likes_delta_7d, left(description, 160) AS description, url
  FROM p
 WHERE NOT EXISTS (SELECT 1 FROM oss_excluded_owners x WHERE lower(x.owner_login) = lower(p.owner_login))
   AND home_domain <> '' AND home_domain ~ '\.'
   AND home_domain !~ '(^|\.)(github\.com|github\.io|githubusercontent\.com|gitlab\.com|gitlab\.io|bitbucket\.org|huggingface\.co|hf\.space|hf\.co|readthedocs\.io|readthedocs\.org|vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|streamlit\.app|gradio\.live|replit\.app|colab\.research\.google\.com|sites\.google\.com|notion\.site|substack\.com|medium\.com|arxiv\.org|twitter\.com|x\.com|linkedin\.com|discord\.gg|discord\.com|youtube\.com|pypi\.org|npmjs\.com|kaggle\.com|paperswithcode\.com)$'
   AND created_at_source >= now() - make_interval(days => (SELECT max_age_days FROM params))
   AND (CASE WHEN source = 'github_repo' THEN coalesce(stars_delta_7d, 0) >= (SELECT min_stars_7d FROM params)
             ELSE coalesce(likes_delta_7d, 0) >= (SELECT min_likes_7d FROM params) END)
   AND length(coalesce(description, '')) >= (SELECT min_desc_chars FROM params)
   AND description !~* '(\mpaper\M|official (code|implementation)|implementation of|reproduc|course|assignment|homework|tutorial|lecture|thesis|awesome[- ]|curated list|list of|leetcode|dotfiles|my (personal|own)|\mfork\M|benchmark for|dataset (of|for)|survey)'
 ORDER BY coalesce(stars_delta_7d, 0) + 3 * coalesce(likes_delta_7d, 0) DESC
 LIMIT 50;
