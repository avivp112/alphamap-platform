-- Stage 7b follow-up: the HF org profile fields the live API actually returns (plan, numUsers, isVerified), and the website read from the
-- org page. Replaces record_hf_org_profile with the three extra parameters and shows them in the review evidence. Idempotent.
ALTER TABLE hf_orgs ADD COLUMN IF NOT EXISTS plan        text;      -- 'team' / 'enterprise' / ... when HF says (a paid org)
ALTER TABLE hf_orgs ADD COLUMN IF NOT EXISTS num_users   integer;   -- members of the org
ALTER TABLE hf_orgs ADD COLUMN IF NOT EXISTS is_verified boolean;

DROP FUNCTION IF EXISTS record_hf_org_profile(text,text,text,text,text,integer,boolean,integer,boolean);
CREATE OR REPLACE FUNCTION record_hf_org_profile(
  p_org text, p_fullname text DEFAULT NULL, p_org_type text DEFAULT NULL, p_website text DEFAULT NULL,
  p_github text DEFAULT NULL, p_followers integer DEFAULT NULL, p_is_enterprise boolean DEFAULT NULL,
  p_models_count integer DEFAULT NULL, p_models_listed boolean DEFAULT false,
  p_plan text DEFAULT NULL, p_num_users integer DEFAULT NULL, p_is_verified boolean DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO hf_orgs AS o (org, fullname, org_type, website, github, followers, is_enterprise, models_count, models_listed_at, plan, num_users, is_verified)
  VALUES (lower(p_org), p_fullname, p_org_type, nullif(btrim(p_website), ''), nullif(btrim(p_github), ''), p_followers, p_is_enterprise,
          p_models_count, CASE WHEN p_models_listed THEN now() END, p_plan, p_num_users, p_is_verified)
  ON CONFLICT (org) DO UPDATE
    SET fullname = coalesce(EXCLUDED.fullname, o.fullname),
        org_type = coalesce(EXCLUDED.org_type, o.org_type),
        website = coalesce(EXCLUDED.website, o.website),
        github = coalesce(EXCLUDED.github, o.github),
        followers = coalesce(EXCLUDED.followers, o.followers),
        is_enterprise = coalesce(EXCLUDED.is_enterprise, o.is_enterprise),
        models_count = coalesce(EXCLUDED.models_count, o.models_count),
        models_listed_at = coalesce(EXCLUDED.models_listed_at, o.models_listed_at),
        plan = coalesce(EXCLUDED.plan, o.plan),
        num_users = coalesce(EXCLUDED.num_users, o.num_users),
        is_verified = coalesce(EXCLUDED.is_verified, o.is_verified),
        profile_fetched_at = now();
$$;
REVOKE ALL ON FUNCTION record_hf_org_profile(text,text,text,text,text,integer,boolean,integer,boolean,text,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_hf_org_profile(text,text,text,text,text,integer,boolean,integer,boolean,text,integer,boolean) TO service_role;

-- The review evidence carries the plan, the team size and the verified flag (information for the reviewer, not a filter).
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
    SELECT p.*, o.plan, o.num_users, o.is_verified
      FROM hf_candidate_pool p JOIN hf_orgs o ON lower(o.org) = lower(p.org)
     WHERE p.list_complete AND p.ok_recent AND p.ok_growth AND p.ok_site AND p.ok_kind AND NOT p.known_company AND p.rank_in_domain = 1
     ORDER BY p.downloads_delta_7d DESC NULLS LAST
     LIMIT p_limit
  LOOP
    v_n_seen := v_n_seen + 1;
    v_ev := jsonb_strip_nulls(jsonb_build_object(
      'hf_org', r.org, 'hf_url', 'https://huggingface.co/' || r.org, 'fullname', r.fullname, 'org_type', r.org_type,
      'homepage', r.website, 'github', r.github, 'models', r.models, 'first_model', r.first_model_at::date,
      'downloads', r.downloads, 'downloads_7d', r.downloads_delta_7d, 'likes', r.likes, 'followers', r.followers,
      'plan', r.plan, 'num_users', r.num_users, 'verified', r.is_verified));
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
REVOKE ALL ON FUNCTION propose_hf_candidates(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION propose_hf_candidates(integer, boolean) TO service_role;
