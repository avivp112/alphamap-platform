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
