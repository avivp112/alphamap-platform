-- =============================================================================
-- DOWN migration for 20260726210000_registrable_domain_public_suffix.sql
--
-- DO NOT RUN THIS unless you are also rolling back 20260726180000. Reverting
-- restores a registrable_domain() that reduces deepbio.co.kr to 'co.kr', which
-- makes strong_identity_groups() propose merging every company under a ccTLD
-- it does not know into a single entity. If resolve_tier1() is then called with
-- p_dry_run => false, unrelated companies are destroyed.
--
-- There is no safe partial rollback: the function is a correctness fix, not a
-- feature. The only reason this file exists is that every migration here has a
-- matching down file, and a missing one is worse than an explicit warning.
--
-- If you must revert, drop the resolvers FIRST so nothing can act on the bad
-- grouping:
--
--   \i supabase/rollback/20260726200000_entity_resolvers_down.sql
--
-- Then restore the old definition by re-running 20260726180000 and REINDEX:
--
--   REINDEX INDEX idx_startups_domain;
-- =============================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'Refusing to roll back the public-suffix fix. Reverting it lets resolve_tier1() merge unrelated companies that share a ccTLD. Read this file for the deliberate procedure if you truly intend to.';
END $$;
