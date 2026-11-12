-- Stage 7b fix: a profile website on a shared host (readthedocs.io, github.io, vercel.app ...) is not a company's own site, so it can
-- never prove a link. angelslim.readthedocs.io matched a company on the registrable domain readthedocs.io. The profile side now
-- requires an own domain (oss_is_own_domain), and the company's site must not be a shared host either.
CREATE OR REPLACE VIEW hf_link_candidates AS
WITH profile_side AS (
  SELECT o.org, s.id AS startup_id, 'profile_site'::text AS proof, o.website AS evidence
    FROM hf_orgs o
    JOIN startups s ON registrable_domain(o.website) IS NOT NULL
                   AND registrable_domain(o.website) = registrable_domain(s.website)
   WHERE oss_is_own_domain(registrable_domain(o.website))
),
site_side AS (
  SELECT lower(substring(s.huggingface_url FROM '^(?:https?://)?(?:www\.)?huggingface\.co/([^/?#\s]+)')) AS org,
         s.id AS startup_id, 'site_link'::text AS proof, s.huggingface_url AS evidence
    FROM startups s
   WHERE s.huggingface_url IS NOT NULL
),
both_sides AS (
  SELECT org, startup_id, proof, evidence FROM profile_side
  UNION ALL
  SELECT org, startup_id, proof, evidence FROM site_side
  WHERE org IS NOT NULL AND org NOT IN ('models', 'datasets', 'spaces', 'docs', 'blog', 'papers', 'organizations', 'collections')
),
per_pair AS (
  SELECT lower(org) AS org, startup_id,
         array_agg(DISTINCT proof ORDER BY proof) AS proofs,
         (array_agg(evidence ORDER BY proof))[1] AS evidence
    FROM both_sides GROUP BY lower(org), startup_id
)
SELECT p.*
  FROM per_pair p
 WHERE (SELECT count(DISTINCT p2.startup_id) FROM per_pair p2 WHERE p2.org = p.org) = 1;
