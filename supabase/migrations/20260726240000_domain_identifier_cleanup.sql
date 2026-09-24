-- =============================================================================
-- Migration: clean up domain identifiers computed before the public-suffix fix
-- Created:   2026-07-26
-- Description:
--   Sourcing Engine audit, Step 5.
--
-- ── WHAT WENT WRONG, AND WHY IT IS STILL IN THE TABLE TODAY ─────────────────
--   20260726210000 fixed registrable_domain() after it collapsed every Korean
--   (.co.kr) and Chinese (.com.cn) company in the corpus onto one bare-suffix
--   value. That migration's REINDEX rebuilds idx_startups_domain -- the
--   FUNCTIONAL INDEX on startups(registrable_domain(website)) -- because an
--   IMMUTABLE function's index entries do not recompute on their own.
--
--   But company_identifiers.value is not a functional index entry. It is a
--   literal value, written once by the backfill INSERT in 20260726180000,
--   using whichever registrable_domain() existed AT THAT TIME. Fixing the
--   function and reindexing startups did nothing to the rows already sitting
--   in company_identifiers -- a REINDEX recomputes an index, not a stored
--   column. Any row inserted before 20260726210000 ran still holds whatever
--   the old, buggy function returned.
--
--   Concretely: for a domain the old 12-entry suffix list did not know (.kr,
--   .cn, and everything else added in the fix), the old function's fallback
--   returned exactly the bare two-label suffix -- "co.kr", "com.cn", and so
--   on -- as a company's registered "domain" identifier. Because
--   company_identifiers is UNIQUE(kind, value), only the FIRST company whose
--   website collapsed this way could ever hold that row; every other company
--   sharing the same collapse simply failed to insert (ON CONFLICT DO
--   NOTHING) and is instead missing a domain identifier it should have. So
--   the blast radius of the historical bug is: a small number of startups
--   hold a WRONG identifier, and an unknown larger number are silently
--   missing a RIGHT one. Both are fixed here.
--
-- ── IDENTIFYING THE BAD ROWS WITHOUT GUESSING ────────────────────────────────
--   No need to re-derive history or duplicate the suffix list: the FIXED
--   registrable_domain() already fails closed on exactly this shape (a
--   registry-level word plus a two-letter ccTLD) and returns NULL for it.
--   Feeding a STORED identifier value back into the fixed function is a
--   direct, self-contained test: registrable_domain(value) IS NULL means the
--   value itself is nothing but a bare public suffix -- never a legitimate
--   company domain, however it got there.
--
-- ── DRY RUN BY DEFAULT ───────────────────────────────────────────────────────
--   Same convention as resolve_tier1(): deleting a row is not reversible the
--   way merge_companies() is (there is no company_merges-style snapshot for
--   company_identifiers), so cleanup_invalid_domain_identifiers() reports what
--   it would delete until told otherwise. This migration runs it once in dry
--   mode at the end purely to surface findings in the migration log; it does
--   NOT delete anything on its own. Run it live by hand after reviewing:
--
--     SELECT cleanup_invalid_domain_identifiers(p_dry_run => false);
--
-- ── THE RE-BACKFILL IS SAFE TO RUN UNCONDITIONALLY ──────────────────────────
--   Unlike the delete, re-deriving correct domain identifiers from
--   startups.website with the NOW-FIXED function is purely additive --
--   ON CONFLICT DO NOTHING, identical in shape to 20260726180000's original
--   backfill. It cannot overwrite a good row and cannot create a wrong one
--   (the function it calls is the one that no longer produces wrong values).
--   It runs immediately, unconditionally, same as the original backfill did.
--
-- Rollback: supabase/rollback/20260726240000_domain_identifier_cleanup_down.sql
-- Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_invalid_domain_identifiers(
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_deleted integer := 0;
  detail    jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'identifier_id', ci.id, 'startup_id', ci.startup_id,
           'bad_value', ci.value, 'source', ci.source)),
         '[]'::jsonb)
    INTO detail
    FROM company_identifiers ci
   WHERE ci.kind = 'domain'
     AND registrable_domain(ci.value) IS NULL;

  IF NOT p_dry_run THEN
    DELETE FROM company_identifiers ci
     WHERE ci.kind = 'domain'
       AND registrable_domain(ci.value) IS NULL;
    GET DIAGNOSTICS n_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'found',   jsonb_array_length(detail),
    'deleted', n_deleted,
    'detail',  detail);
END;
$$;

COMMENT ON FUNCTION cleanup_invalid_domain_identifiers(boolean) IS
  'Deletes company_identifiers rows of kind=domain that are bare public-suffix artifacts of the pre-20260726210000 registrable_domain() bug (identified by feeding the stored value back into the now-fixed function and checking for NULL). DRY RUN BY DEFAULT -- deletion is not reversible the way a merge is, so it is surfaced for review before it runs live.';

REVOKE ALL ON FUNCTION cleanup_invalid_domain_identifiers(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_invalid_domain_identifiers(boolean) TO service_role;

-- Surface findings now, without deleting anything. Run the function again
-- with p_dry_run => false by hand once you've reviewed this.
SELECT cleanup_invalid_domain_identifiers(true);

-- ── Re-backfill: give every startup with a website the CORRECT domain
--    identifier now that registrable_domain() is fixed. Purely additive.
INSERT INTO company_identifiers (startup_id, kind, value, source, confidence)
SELECT s.id, 'domain', registrable_domain(s.website),
       'startups.website (post-public-suffix-fix backfill)', 1.00
  FROM startups s
 WHERE s.website IS NOT NULL
   AND registrable_domain(s.website) IS NOT NULL
ON CONFLICT (kind, value) DO NOTHING;
