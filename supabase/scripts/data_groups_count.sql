-- How much v1 knows about each company (owner, 2026-11-13). READ ONLY. Same definition as lib/enrichment/dataGroups.ts.
--   five things: description, headquarters (city or country), founded year, at least one funding round, at least one founder
--   empty    none of the five
--   partial  one to four, or all five with a description under 200 characters
--   full     all five, description of 200 characters or more
WITH r AS (SELECT startup_id, count(*) AS rounds FROM funding_rounds GROUP BY startup_id),
c AS (
  SELECT s.id, s.status, s.website,
         (coalesce(btrim(s.description), '') <> '')::int
       + ((coalesce(btrim(s.city), '') <> '' OR coalesce(btrim(s.country), '') <> ''))::int
       + (s.founded_year IS NOT NULL)::int
       + (coalesce(r.rounds, 0) > 0)::int
       + (jsonb_array_length(coalesce(s.founders, '[]'::jsonb)) > 0)::int AS have,
         length(coalesce(btrim(s.description), '')) AS desc_len
    FROM startups s LEFT JOIN r ON r.startup_id = s.id
)
SELECT CASE WHEN have = 0 THEN 'empty' WHEN have = 5 AND desc_len >= 200 THEN 'full' ELSE 'partial' END AS data_group,
       count(*)                                                        AS companies,
       count(*) FILTER (WHERE coalesce(btrim(website), '') <> '')       AS with_website,
       count(*) FILTER (WHERE coalesce(btrim(website), '') = '')        AS without_website,
       count(*) FILTER (WHERE status <> 'active')                       AS not_active
  FROM c GROUP BY 1 ORDER BY 1;

-- The partial group by how many of the five it has (run separately):
-- WITH ... same CTE ... SELECT have, count(*) FROM c WHERE NOT (have = 0 OR (have = 5 AND desc_len >= 200)) GROUP BY have ORDER BY have;
