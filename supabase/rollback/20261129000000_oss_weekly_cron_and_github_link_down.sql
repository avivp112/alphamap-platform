-- Rollback of 20261129000000: unschedules the three jobs it added (the daily GitHub / HF jobs belong to 20260726250000 and stay) and drops the GitHub link.
DO $$
DECLARE j text;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOREACH j IN ARRAY ARRAY['snapshot-huggingface', 'snapshot-huggingface-new', 'link-site-dev-orgs'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
END;
$$;
DROP FUNCTION IF EXISTS link_github_orgs(boolean);
DROP VIEW IF EXISTS github_link_candidates;
