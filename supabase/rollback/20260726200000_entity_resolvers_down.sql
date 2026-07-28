-- =============================================================================
-- DOWN migration for 20260726200000_entity_resolvers.sql
--
-- Drops the resolvers. RUN THIS BEFORE the 20260726190000 rollback —
-- decide_match_candidate() calls merge_companies().
--
-- MERGES ALREADY PERFORMED ARE NOT UNDONE, and queued candidates are left
-- alone: entity_match_candidates belongs to 20260726180000, not here. Removing
-- the functions that fill and drain that queue does not empty it. Rows sitting
-- at status='pending' simply stop being actionable until the resolvers are
-- reinstalled.
-- =============================================================================

DROP FUNCTION IF EXISTS decide_match_candidate(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS queue_tier3_candidates(numeric, integer);
DROP FUNCTION IF EXISTS queue_tier2_candidates(integer, boolean);
DROP FUNCTION IF EXISTS resolve_tier1(integer, boolean, text);
DROP FUNCTION IF EXISTS strong_identity_groups();
