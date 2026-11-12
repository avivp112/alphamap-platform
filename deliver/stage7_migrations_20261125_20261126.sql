-- =============================================================================
-- Migration: stage 7 — growing GitHub projects as company candidates
-- Created:   2026-11-12
-- Description:
--   The sourcing engine tracks GitHub / Hugging Face projects and their weekly growth. A growing project that looks like a
--   startup's product can now be PROPOSED as a company candidate in /admin/review — the same model as the SEC / UK / EPO gate of
--   2026-10-15: the engine proposes, an admin disposes. Nothing here creates a company.
--
--   Owner decisions, 2026-11-12:
--     1. 100+ stars in 7 days → the review queue. 50–99 → a watch list (a view), no queue.
--     2. GitHub only in this version. Hugging Face stays out (no project has a homepage of its own; measured separately).
--     3. Corporate owners (Tencent, Amazon's Kiro, …) go into oss_excluded_owners. The full list is below.
--     4. A repo whose stars look bought is FLAGGED (suspect_stars), not dropped: stars far above forks and open issues.
--     5. One candidate per homepage domain (the repo with most stars); a description filter ("official repository for", courses).
--
--   Nothing is scheduled. propose_oss_candidates() is a dry run by default.
--
-- Rollback: supabase/rollback/20261125000000_oss_candidates_down.sql
-- Idempotent.
-- =============================================================================

-- ── 1. Corporate owners (decision 3) ─────────────────────────────────────────
INSERT INTO oss_excluded_owners (owner_login, reason) VALUES
  ('tencent', 'big tech'), ('TencentCloud', 'big tech'), ('Tencent-Hunyuan', 'big tech'), ('TencentARC', 'big tech'),
  ('alibaba', 'big tech'), ('AlibabaCloud', 'big tech'), ('alibaba-damo-academy', 'big tech'), ('QwenLM', 'big tech'),
  ('baidu', 'big tech'), ('PaddlePaddle', 'big tech'),
  ('bytedance', 'big tech'), ('ByteDance-Seed', 'big tech'), ('volcengine', 'big tech'),
  ('huawei', 'big tech'), ('HuaweiCloud', 'big tech'), ('mindspore-ai', 'big tech'),
  ('xiaomi', 'big tech'), ('XiaoMi', 'big tech'), ('samsung', 'big tech'), ('Samsung', 'big tech'),
  ('kirodotdev', 'big tech (Amazon Kiro)'), ('aws-samples', 'big tech'), ('amazon-science', 'big tech'), ('aws-solutions', 'big tech'),
  ('Azure-Samples', 'big tech'), ('MicrosoftDocs', 'big tech'), ('microsoft-research', 'big tech'),
  ('GoogleCloudPlatform', 'big tech'), ('googlesamples', 'big tech'), ('google-research', 'big tech'),
  ('openai-community', 'established'), ('meta-pytorch', 'big tech'), ('facebookincubator', 'big tech'),
  ('SAP', 'big tech'), ('sap', 'big tech'), ('cisco', 'big tech'), ('Cisco-Talos', 'big tech'), ('vmware', 'big tech'),
  ('redhat', 'big tech'), ('RedHatOfficial', 'big tech'), ('JetBrains', 'established'),
  ('uber', 'big tech'), ('Netflix', 'big tech'), ('airbnb', 'big tech'), ('lyft', 'big tech'), ('spotify', 'big tech'),
  ('twitter', 'big tech'), ('linkedin', 'big tech'), ('shopify', 'established'), ('stripe', 'established'), ('github', 'platform'),
  ('cloudflare', 'established'), ('vercel', 'established'), ('supabase', 'established')
ON CONFLICT (owner_login) DO NOTHING;

-- ── 2. The parameters, in one place ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION oss_candidate_params()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'max_age_days',        180,    -- created on GitHub within this many days
    'queue_stars_7d',      100,    -- 100+ stars in 7 days → the review queue
    'watch_stars_7d',      50,     -- 50–99 → the watch list only
    'min_desc_chars',      30,
    'suspect_min_stars',   2000,   -- stars-bought check applies from this many stars
    'suspect_max_fork_ratio',  0.02,   -- forks / stars below this …
    'suspect_max_issue_ratio', 0.002   -- … and open issues / stars below this
  );
$$;

-- A homepage on its own domain: not a code host, free hosting or a social page.
CREATE OR REPLACE FUNCTION oss_is_own_domain(p_domain text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_domain, '') <> '' AND p_domain ~ '\.'
     AND p_domain !~ '(^|\.)(github\.com|github\.io|githubusercontent\.com|gitlab\.com|gitlab\.io|bitbucket\.org|huggingface\.co|hf\.space|hf\.co|readthedocs\.io|readthedocs\.org|vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|streamlit\.app|gradio\.live|replit\.app|colab\.research\.google\.com|sites\.google\.com|notion\.site|substack\.com|medium\.com|arxiv\.org|twitter\.com|x\.com|linkedin\.com|discord\.gg|discord\.com|youtube\.com|pypi\.org|npmjs\.com|kaggle\.com|paperswithcode\.com)$';
$$;

-- ── 3. The pool: every unlinked GitHub repo with its flags ───────────────────
CREATE OR REPLACE VIEW oss_candidate_pool AS
WITH prm AS (SELECT oss_candidate_params() AS p),
base AS (
  SELECT v.project_id, v.owner_login, v.owner_type, v.name, v.url, v.created_at_source, v.age_days,
         v.stars, v.forks, v.stars_delta_7d, o.description, o.homepage, lm.open_issues,
         lower(regexp_replace(coalesce(o.homepage, ''), '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2', 'i')) AS home_domain,
         registrable_domain(o.homepage) AS reg_domain
    FROM oss_project_velocity v
    JOIN oss_projects o ON o.id = v.project_id
    LEFT JOIN LATERAL (
      SELECT m.open_issues FROM oss_project_metrics m WHERE m.project_id = v.project_id ORDER BY m.observed_at DESC LIMIT 1
    ) lm ON true
   WHERE v.source = 'github_repo' AND v.startup_id IS NULL
),
f AS (
  SELECT b.*,
    NOT EXISTS (SELECT 1 FROM oss_excluded_owners x WHERE lower(x.owner_login) = lower(b.owner_login))        AS ok_owner,
    oss_is_own_domain(b.home_domain)                                                                         AS ok_home,
    -- a personal site: the domain is the owner's own name ("xingjianbai.com" for xingjian-bai)
    (lower(coalesce(b.owner_type, '')) = 'user'
       AND regexp_replace(split_part(b.home_domain, '.', 1), '[^a-z0-9]', '', 'g') = regexp_replace(lower(b.owner_login), '[^a-z0-9]', '', 'g')) AS personal_home,
    (b.created_at_source >= now() - make_interval(days => (SELECT (p->>'max_age_days')::int FROM prm)))      AS ok_recent,
    (length(coalesce(b.description, '')) >= (SELECT (p->>'min_desc_chars')::int FROM prm)
       AND b.description !~* '(\mpaper\M|official (code|implementation|repo|repository)|implementation of|reproduc|course|assignment|homework|tutorial|lecture|thesis|awesome[- ]|curated list|list of|leetcode|dotfiles|my (personal|own)|\mfork\M|benchmark|dataset (of|for)|survey|cheat ?sheet)'
       AND b.description !~ '(教程|学习|路线|课程|面试)')                                                      AS ok_desc,
    -- stars far above forks and open issues (a flag for the reviewer, never a rejection)
    (coalesce(b.stars, 0) >= (SELECT (p->>'suspect_min_stars')::int FROM prm)
       AND b.forks::numeric / NULLIF(b.stars, 0) < (SELECT (p->>'suspect_max_fork_ratio')::numeric FROM prm)
       AND coalesce(b.open_issues, 0)::numeric / NULLIF(b.stars, 0) < (SELECT (p->>'suspect_max_issue_ratio')::numeric FROM prm)) AS suspect_stars,
    (b.reg_domain IS NOT NULL AND (
        EXISTS (SELECT 1 FROM company_identifiers ci WHERE ci.kind = 'domain' AND ci.value = b.reg_domain)
        OR EXISTS (SELECT 1 FROM startups s WHERE registrable_domain(s.website) = b.reg_domain)))            AS known_domain
  FROM base b
)
SELECT f.*,
  row_number() OVER (PARTITION BY f.reg_domain ORDER BY f.stars DESC NULLS LAST) AS rank_in_domain,
  CASE
    WHEN f.ok_owner AND f.ok_home AND NOT f.personal_home AND f.ok_recent AND f.ok_desc AND NOT f.known_domain
         AND coalesce(f.stars_delta_7d, 0) >= (SELECT (p->>'queue_stars_7d')::int FROM prm) THEN 'queue'
    WHEN f.ok_owner AND f.ok_home AND NOT f.personal_home AND f.ok_recent AND f.ok_desc AND NOT f.known_domain
         AND coalesce(f.stars_delta_7d, 0) >= (SELECT (p->>'watch_stars_7d')::int FROM prm) THEN 'watch'
  END AS tier
FROM f;

COMMENT ON VIEW oss_candidate_pool IS
  'Unlinked GitHub repos with the stage 7 filter as columns (ok_owner, ok_home, personal_home, ok_recent, ok_desc, known_domain, suspect_stars) and a tier: queue (100+ stars in 7 days, all filters) or watch (50–99). One row per repo; rank_in_domain 1 is the repo with the most stars on its homepage domain.';

-- ── 4. The watch list: 50–99 stars a week, no queue ──────────────────────────
CREATE OR REPLACE VIEW oss_watchlist AS
SELECT project_id, owner_login, name, url, home_domain, created_at_source::date AS created, stars, stars_delta_7d, forks, open_issues, suspect_stars, left(description, 160) AS description
  FROM oss_candidate_pool
 WHERE tier = 'watch' AND rank_in_domain = 1
 ORDER BY stars_delta_7d DESC;

-- ── 5. Propose: the queue tier, one per homepage domain, into company_candidates ─
CREATE OR REPLACE FUNCTION propose_oss_candidates(p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_n_new  integer := 0;
  v_n_seen integer := 0;
  v_detail jsonb := '[]'::jsonb;
  v_ev     jsonb;
  v_was    text;
BEGIN
  FOR r IN
    SELECT * FROM oss_candidate_pool
     WHERE tier = 'queue' AND rank_in_domain = 1 AND reg_domain IS NOT NULL
     ORDER BY stars_delta_7d DESC NULLS LAST
     LIMIT p_limit
  LOOP
    v_n_seen := v_n_seen + 1;
    v_ev := jsonb_strip_nulls(jsonb_build_object(
      'github_url', r.url, 'owner', r.owner_login, 'owner_type', r.owner_type, 'repo', r.name,
      'description', left(r.description, 600), 'homepage', r.homepage,
      'stars', r.stars, 'stars_7d', r.stars_delta_7d, 'forks', r.forks, 'open_issues', r.open_issues,
      'created', r.created_at_source::date, 'age_days', r.age_days,
      'suspect_stars', r.suspect_stars));
    SELECT status INTO v_was FROM company_candidates WHERE source = 'oss_github' AND candidate_key = 'domain:' || r.reg_domain;
    v_detail := v_detail || jsonb_build_array(jsonb_build_object(
      'project', r.owner_login || '/' || r.name, 'domain', r.reg_domain, 'stars_7d', r.stars_delta_7d, 'stars', r.stars,
      'suspect_stars', r.suspect_stars, 'already', v_was));
    CONTINUE WHEN p_dry_run;
    INSERT INTO company_candidates AS c (source, candidate_key, name, website, gate_tier, evidence)
    VALUES ('oss_github', 'domain:' || r.reg_domain, left(r.name, 120), r.homepage, 'queue', v_ev)
    ON CONFLICT (source, candidate_key) DO UPDATE
      SET last_seen_at = now(),
          -- a pending candidate shows the latest numbers; a decided one is left as decided (a rejected one is never proposed again)
          evidence     = CASE WHEN c.status = 'pending' THEN EXCLUDED.evidence ELSE c.evidence END,
          website      = coalesce(c.website, EXCLUDED.website);
    IF v_was IS NULL THEN v_n_new := v_n_new + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run', p_dry_run, 'seen', v_n_seen, 'new_candidates', CASE WHEN p_dry_run THEN NULL ELSE v_n_new END, 'detail', v_detail);
END;
$$;

COMMENT ON FUNCTION propose_oss_candidates IS
  'Proposes the queue tier of oss_candidate_pool as company_candidates (source oss_github, key domain:<registrable domain>, review only — never an alert, never a company). Dry run by default. A rejected candidate stays rejected.';

REVOKE ALL ON FUNCTION propose_oss_candidates(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION propose_oss_candidates(integer, boolean) TO service_role;


-- Stage 7b: Hugging Face at the ORGANIZATION level.
--
--   1. hf_orgs                  one row per HF org: profile website, followers, type, when its model list was last taken in full
--   2. record_hf_org_profile()  the weekly job writes it (service_role only)
--   3. hf_org_stats             per org: models, first model, downloads, 7-day downloads growth
--   4. hf_link_candidates       a company <-> org link that is CERTAIN, with the proof; never by name
--   5. link_hf_orgs()           records the certain links (dry run by default) as company_identifiers hf_org + oss_projects.startup_id
--   6. company_hf_summary()     what the company page shows: models, downloads, trend
--   7. hf_candidate_pool + propose_hf_candidates()  new-company discovery at org level into company_candidates (source hf_org), dry run by default
--
-- A link is certain only when the org's HF profile names the company's site, or the company's site names the HF org.
-- A similar name alone is never a link. Nothing here runs by itself: no cron, and the proposals are review-only.

-- ── 1. Orgs ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hf_orgs (
  org                 text        PRIMARY KEY CHECK (btrim(org) <> ''),
  fullname            text,
  org_type            text,                      -- what HF says it is (company, university, non-profit, ...), when it says
  website             text,                      -- the website field of the HF profile, as published
  github              text,
  followers           integer,
  is_enterprise       boolean,
  models_count        integer,                   -- as HF reports it
  models_listed_at    timestamptz,               -- when we last listed ALL of its models; first_model_at is only trustworthy after this
  profile_fetched_at  timestamptz NOT NULL DEFAULT now(),
  first_seen_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE hf_orgs IS
  'Hugging Face organizations. website is what the profile publishes; it is the only thing that links an org to a company (never the name).';
ALTER TABLE hf_orgs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hf_orgs FROM PUBLIC, anon, authenticated;
GRANT ALL ON hf_orgs TO service_role;

CREATE OR REPLACE FUNCTION record_hf_org_profile(
  p_org text, p_fullname text DEFAULT NULL, p_org_type text DEFAULT NULL, p_website text DEFAULT NULL,
  p_github text DEFAULT NULL, p_followers integer DEFAULT NULL, p_is_enterprise boolean DEFAULT NULL,
  p_models_count integer DEFAULT NULL, p_models_listed boolean DEFAULT false)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO hf_orgs AS o (org, fullname, org_type, website, github, followers, is_enterprise, models_count, models_listed_at)
  VALUES (lower(p_org), p_fullname, p_org_type, nullif(btrim(p_website), ''), nullif(btrim(p_github), ''), p_followers, p_is_enterprise,
          p_models_count, CASE WHEN p_models_listed THEN now() END)
  ON CONFLICT (org) DO UPDATE
    SET fullname = coalesce(EXCLUDED.fullname, o.fullname),
        org_type = coalesce(EXCLUDED.org_type, o.org_type),
        website = coalesce(EXCLUDED.website, o.website),
        github = coalesce(EXCLUDED.github, o.github),
        followers = coalesce(EXCLUDED.followers, o.followers),
        is_enterprise = coalesce(EXCLUDED.is_enterprise, o.is_enterprise),
        models_count = coalesce(EXCLUDED.models_count, o.models_count),
        models_listed_at = coalesce(EXCLUDED.models_listed_at, o.models_listed_at),
        profile_fetched_at = now();
$$;
REVOKE ALL ON FUNCTION record_hf_org_profile(text,text,text,text,text,integer,boolean,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_hf_org_profile(text,text,text,text,text,integer,boolean,integer,boolean) TO service_role;

-- ── 2. Org-level numbers from the model series ────────────────────────────────
CREATE OR REPLACE VIEW hf_org_stats AS
SELECT v.owner_login                                         AS org,
       count(*)                                              AS models,
       min(v.created_at_source)                              AS first_model_at,
       sum(v.downloads)                                      AS downloads,
       sum(v.likes)                                          AS likes,
       sum(v.downloads_delta_7d)                             AS downloads_delta_7d,
       count(v.downloads_delta_7d)                           AS models_with_delta,
       max(v.last_observed_at)                               AS last_observed_at
  FROM oss_project_velocity v
 WHERE v.source = 'huggingface_model'
 GROUP BY v.owner_login;
COMMENT ON VIEW hf_org_stats IS
  'Per HF org: models tracked, first model, downloads, likes and the 7-day downloads growth (summed only over models that have a comparison 6–10 days back; models_with_delta says how many). first_model_at is only complete once hf_orgs.models_listed_at is set.';

-- ── 3. Certain links ──────────────────────────────────────────────────────────
-- (a) the org profile names the company's site, or (b) the company's own site names the org (startups.huggingface_url).
-- An org that would link to two companies, or a company site that names an org belonging to another company's domain, is dropped.
CREATE OR REPLACE VIEW hf_link_candidates AS
WITH profile_side AS (
  SELECT o.org, s.id AS startup_id, 'profile_site'::text AS proof, o.website AS evidence
    FROM hf_orgs o
    JOIN startups s ON registrable_domain(o.website) IS NOT NULL
                   AND registrable_domain(o.website) = registrable_domain(s.website)
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
 WHERE (SELECT count(DISTINCT p2.startup_id) FROM per_pair p2 WHERE p2.org = p.org) = 1;   -- an org that points at two companies is not certain
COMMENT ON VIEW hf_link_candidates IS
  'Company <-> HF org pairs that are certain: proofs lists profile_site (the HF profile website is the company site) and/or site_link (the company site links the HF org). Never name similarity.';

CREATE OR REPLACE FUNCTION link_hf_orgs(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record; n_pairs int := 0; n_ident int := 0; n_proj int := 0; k int; v_detail jsonb := '[]'::jsonb;
BEGIN
  FOR r IN SELECT * FROM hf_link_candidates ORDER BY org LOOP
    n_pairs := n_pairs + 1;
    v_detail := v_detail || jsonb_build_array(jsonb_build_object('org', r.org, 'startup_id', r.startup_id, 'proofs', r.proofs, 'evidence', r.evidence));
    CONTINUE WHEN p_dry_run;
    INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
    VALUES (r.startup_id, 'hf_org', r.org, 'hf_link_candidates via ' || array_to_string(r.proofs, '+'), 1.00)
    ON CONFLICT (kind, value) DO NOTHING;
    GET DIAGNOSTICS k = ROW_COUNT; n_ident := n_ident + k;
    UPDATE oss_projects SET startup_id = r.startup_id
     WHERE source IN ('huggingface_model', 'huggingface_dataset', 'huggingface_space')
       AND lower(owner_login) = r.org AND startup_id IS NULL;
    GET DIAGNOSTICS k = ROW_COUNT; n_proj := n_proj + k;
  END LOOP;
  RETURN jsonb_build_object('dry_run', p_dry_run, 'pairs', n_pairs,
    'identifiers_added', CASE WHEN p_dry_run THEN NULL ELSE n_ident END,
    'projects_linked', CASE WHEN p_dry_run THEN NULL ELSE n_proj END, 'detail', v_detail);
END;
$$;
COMMENT ON FUNCTION link_hf_orgs IS
  'Records the certain HF links (hf_link_candidates) as company_identifiers hf_org and links that org''s oss_projects to the company. Dry run by default; creates no company.';
REVOKE ALL ON FUNCTION link_hf_orgs(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION link_hf_orgs(boolean) TO service_role;

-- ── 4. The company page ───────────────────────────────────────────────────────
-- Models, downloads and a weekly trend for a company whose HF org is linked. Empty when nothing is linked: no guessing.
CREATE OR REPLACE FUNCTION company_hf_summary(p_startup_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH orgs AS (
    SELECT DISTINCT lower(value) AS org FROM company_identifiers WHERE startup_id = p_startup_id AND kind = 'hf_org'
  ),
  models AS (
    SELECT v.* FROM oss_project_velocity v JOIN orgs ON lower(v.owner_login) = orgs.org WHERE v.source = 'huggingface_model'
  ),
  weekly AS (
    SELECT wk, sum(d) AS downloads
      FROM (
        SELECT date_trunc('week', m.observed_at)::date AS wk, p.id, max(m.downloads) AS d
          FROM oss_projects p
          JOIN orgs ON lower(p.owner_login) = orgs.org
          JOIN oss_project_metrics m ON m.project_id = p.id
         WHERE p.source = 'huggingface_model' AND m.downloads IS NOT NULL
         GROUP BY 1, p.id
      ) x GROUP BY wk
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM orgs) THEN NULL ELSE jsonb_build_object(
    'orgs', (SELECT jsonb_agg(org) FROM orgs),
    'models', (SELECT count(*) FROM models),
    'downloads', (SELECT sum(downloads) FROM models),
    'downloads_delta_7d', (SELECT sum(downloads_delta_7d) FROM models),
    'models_with_delta', (SELECT count(downloads_delta_7d) FROM models),
    'likes', (SELECT sum(likes) FROM models),
    'top_models', coalesce((SELECT jsonb_agg(jsonb_build_object('name', external_id, 'url', url, 'downloads', downloads, 'likes', likes, 'downloads_delta_7d', downloads_delta_7d)
                                      ORDER BY downloads DESC NULLS LAST)
                    FROM (SELECT * FROM models ORDER BY downloads DESC NULLS LAST LIMIT 5) t), '[]'::jsonb),
    'weekly', coalesce((SELECT jsonb_agg(jsonb_build_object('week', wk, 'downloads', downloads) ORDER BY wk) FROM weekly), '[]'::jsonb)
  ) END;
$$;
REVOKE ALL ON FUNCTION company_hf_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_hf_summary(uuid) TO authenticated, service_role;

-- ── 5. Discovery: new companies at org level ─────────────────────────────────
CREATE OR REPLACE FUNCTION hf_candidate_params()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'max_age_days',       180,    -- the org's FIRST model is at most this old
    'min_downloads_7d',   100,    -- downloads gained over 7 days, summed over its models
    'max_followers',      3000,   -- above this it is a known lab / community, not an early company (a heuristic, tune it)
    'min_models_delta',   1
  );
$$;

CREATE OR REPLACE VIEW hf_candidate_pool AS
WITH prm AS (SELECT hf_candidate_params() AS p),
f AS (
  SELECT s.org, s.models, s.first_model_at, s.downloads, s.likes, s.downloads_delta_7d, s.models_with_delta,
         o.fullname, o.org_type, o.website, o.github, o.followers, o.is_enterprise, o.models_listed_at,
         registrable_domain(o.website) AS reg_domain,
         lower(regexp_replace(coalesce(o.website, ''), '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2', 'i')) AS site_domain
    FROM hf_org_stats s JOIN hf_orgs o ON lower(o.org) = lower(s.org)
)
SELECT f.*,
  -- the complete model list was taken, so first_model_at is the org's real first model
  (f.models_listed_at IS NOT NULL)                                                                                AS list_complete,
  (f.first_model_at >= now() - make_interval(days => (SELECT (p->>'max_age_days')::int FROM prm)))                AS ok_recent,
  coalesce(f.downloads_delta_7d, 0) >= (SELECT (p->>'min_downloads_7d')::int FROM prm)                            AS ok_growth,
  -- an independent site: present, not a code host / social page / free hosting
  (f.reg_domain IS NOT NULL AND oss_is_own_domain(f.site_domain))                                                 AS ok_site,
  -- universities, non-profits, government and big companies are not early companies
  (NOT EXISTS (SELECT 1 FROM oss_excluded_owners x WHERE lower(x.owner_login) = lower(f.org))
    AND coalesce(lower(f.org_type), '') !~ '(universit|school|research|non-?profit|community|government|lab)'
    AND f.site_domain !~ '(\.edu(\.[a-z]{2})?$|\.ac\.[a-z]{2}$|\.gov(\.[a-z]{2})?$|univ|institut)'
    AND coalesce(f.followers, 0) <= (SELECT (p->>'max_followers')::int FROM prm))                                 AS ok_kind,
  (f.reg_domain IS NOT NULL AND (
      EXISTS (SELECT 1 FROM company_identifiers ci WHERE ci.kind = 'domain' AND ci.value = f.reg_domain)
      OR EXISTS (SELECT 1 FROM startups st WHERE registrable_domain(st.website) = f.reg_domain)
      OR EXISTS (SELECT 1 FROM company_identifiers ci WHERE ci.kind = 'hf_org' AND lower(ci.value) = lower(f.org))))  AS known_company,
  row_number() OVER (PARTITION BY f.reg_domain ORDER BY f.downloads_delta_7d DESC NULLS LAST)                      AS rank_in_domain
FROM f;
COMMENT ON VIEW hf_candidate_pool IS
  'HF orgs with the discovery filters as columns: list_complete, ok_recent (first model within 180 days), ok_growth (downloads +100 in 7 days), ok_site (own website in the profile), ok_kind (not a university / non-profit / big company / large community), known_company. An org is proposed only when all hold.';

CREATE OR REPLACE FUNCTION propose_hf_candidates(p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record; v_n_new int := 0; v_n_seen int := 0; v_detail jsonb := '[]'::jsonb; v_ev jsonb; v_was text;
BEGIN
  FOR r IN
    SELECT * FROM hf_candidate_pool
     WHERE list_complete AND ok_recent AND ok_growth AND ok_site AND ok_kind AND NOT known_company AND rank_in_domain = 1
     ORDER BY downloads_delta_7d DESC NULLS LAST
     LIMIT p_limit
  LOOP
    v_n_seen := v_n_seen + 1;
    v_ev := jsonb_strip_nulls(jsonb_build_object(
      'hf_org', r.org, 'hf_url', 'https://huggingface.co/' || r.org, 'fullname', r.fullname, 'org_type', r.org_type,
      'homepage', r.website, 'github', r.github, 'models', r.models, 'first_model', r.first_model_at::date,
      'downloads', r.downloads, 'downloads_7d', r.downloads_delta_7d, 'likes', r.likes, 'followers', r.followers));
    SELECT status INTO v_was FROM company_candidates WHERE source = 'hf_org' AND candidate_key = 'domain:' || r.reg_domain;
    v_detail := v_detail || jsonb_build_array(jsonb_build_object('org', r.org, 'domain', r.reg_domain,
      'downloads_7d', r.downloads_delta_7d, 'models', r.models, 'first_model', r.first_model_at::date, 'already', v_was));
    CONTINUE WHEN p_dry_run;
    INSERT INTO company_candidates AS c (source, candidate_key, name, website, gate_tier, evidence)
    VALUES ('hf_org', 'domain:' || r.reg_domain, left(coalesce(r.fullname, r.org), 120), r.website, 'queue', v_ev)
    ON CONFLICT (source, candidate_key) DO UPDATE
      SET last_seen_at = now(),
          evidence = CASE WHEN c.status = 'pending' THEN EXCLUDED.evidence ELSE c.evidence END,
          website = coalesce(c.website, EXCLUDED.website);
    IF v_was IS NULL THEN v_n_new := v_n_new + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run', p_dry_run, 'seen', v_n_seen, 'new_candidates', CASE WHEN p_dry_run THEN NULL ELSE v_n_new END, 'detail', v_detail);
END;
$$;
COMMENT ON FUNCTION propose_hf_candidates IS
  'Proposes HF orgs (first model within 180 days, downloads growing, an own website in the profile, not a university / big company / large community, not already a company) as company_candidates (source hf_org, key domain:<registrable domain>). Review only. Dry run by default.';
REVOKE ALL ON FUNCTION propose_hf_candidates(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION propose_hf_candidates(integer, boolean) TO service_role;

-- ── 6. Which orgs the weekly snapshot takes next ─────────────────────────────
-- Every org we have seen (a model recorded, or a profile fetched), the ones never listed in full or listed longest ago first.
-- The weekly job takes p_limit of them per run, so a week of runs covers all of them without one run needing to.
CREATE OR REPLACE FUNCTION hf_orgs_to_snapshot(p_limit integer DEFAULT 50, p_older_than interval DEFAULT interval '6 days')
RETURNS TABLE (org text, models_listed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH seen AS (
    SELECT lower(owner_login) AS org FROM oss_projects WHERE source = 'huggingface_model' AND owner_login <> ''
    UNION
    SELECT lower(org) FROM hf_orgs
  )
  SELECT s.org, o.models_listed_at
    FROM seen s
    LEFT JOIN hf_orgs o ON lower(o.org) = s.org
   WHERE NOT EXISTS (SELECT 1 FROM oss_excluded_owners x WHERE lower(x.owner_login) = s.org)
     AND (o.models_listed_at IS NULL OR o.models_listed_at < now() - p_older_than)
   ORDER BY o.models_listed_at ASC NULLS FIRST, s.org
   LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION hf_orgs_to_snapshot(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hf_orgs_to_snapshot(integer, interval) TO service_role;
