-- =============================================================================
-- supabase/scripts/stage7_hf_homepage_measure.sql — READ ONLY. Hugging Face: do the projects or their organisations have a site?
-- Run the two queries one at a time (select, Run); the SQL Editor shows only the last result.
-- =============================================================================

-- ── Query 1: per HF source — how many rows carry a homepage, how many organisations a website in their profile ──
WITH rows AS (
  SELECT o.id, o.source, o.owner_login, o.homepage, o.authors,
         lower(regexp_replace(coalesce(o.homepage, ''), '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2', 'i')) AS home_domain,
         (SELECT string_agg(DISTINCT lower(regexp_replace(a->>'website', '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2', 'i')), ', ')
            FROM jsonb_array_elements(o.authors) a WHERE coalesce(a->>'website', '') <> '') AS profile_domains
    FROM oss_projects o WHERE o.source LIKE 'huggingface%' AND o.startup_id IS NULL
)
SELECT source,
       count(*)                                                           AS unlinked,
       count(*) FILTER (WHERE homepage IS NOT NULL AND btrim(homepage) <> '')                AS with_homepage_field,
       count(*) FILTER (WHERE home_domain ~ '\.' AND home_domain !~ '(^|\.)(huggingface\.co|hf\.co|hf\.space|github\.com|github\.io|arxiv\.org)$') AS homepage_own_domain,
       count(DISTINCT owner_login)                                         AS owners,
       count(DISTINCT owner_login) FILTER (WHERE profile_domains IS NOT NULL)               AS owners_with_profile_website,
       count(DISTINCT owner_login) FILTER (WHERE profile_domains IS NOT NULL
             AND profile_domains !~ '(huggingface\.co|hf\.co|github\.com|github\.io|twitter\.com|x\.com|linkedin\.com)') AS owners_with_own_profile_site
  FROM rows
 GROUP BY ROLLUP (source)
 ORDER BY source NULLS LAST;

-- ── Query 2: up to 30 HF owners whose profile names an own-domain site, fastest-liked first ──
WITH rows AS (
  SELECT o.owner_login, o.owner_type, o.name, o.source, o.created_at_source, v.likes, v.likes_delta_7d,
         (SELECT string_agg(DISTINCT lower(regexp_replace(a->>'website', '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2', 'i')), ', ')
            FROM jsonb_array_elements(o.authors) a WHERE coalesce(a->>'website', '') <> '') AS profile_domains
    FROM oss_projects o LEFT JOIN oss_project_velocity v ON v.project_id = o.id
   WHERE o.source LIKE 'huggingface%' AND o.startup_id IS NULL
)
SELECT owner_login, owner_type, profile_domains, count(*) AS projects, max(likes) AS max_likes, max(likes_delta_7d) AS max_likes_7d, max(created_at_source)::date AS newest
  FROM rows
 WHERE profile_domains IS NOT NULL AND profile_domains !~ '(huggingface\.co|hf\.co|github\.com|github\.io|twitter\.com|x\.com|linkedin\.com)'
 GROUP BY owner_login, owner_type, profile_domains
 ORDER BY max_likes_7d DESC NULLS LAST, max_likes DESC NULLS LAST
 LIMIT 30;
