-- =============================================================================
-- Entity resolver tests — runs in BOTH psql and the Supabase SQL Editor.
--
-- No \set directives and no RAISE NOTICE reporting, so unlike the older test
-- pair this needs only one file. Results come back as a table, failures first.
--
-- WRITES NOTHING: every section runs in a plpgsql subtransaction ended by an
-- unconditional RAISE, so it is always rolled back. Assertion outcomes live in
-- plpgsql array variables, which are not database state and survive that
-- rollback. See entity_resolution.editor.sql for the full reasoning.
--
-- Requires 20260726180000, 20260726190000, 20260726200000.
-- =============================================================================

DROP TABLE IF EXISTS er2_test_results;
CREATE TEMP TABLE er2_test_results (seq serial, state text, check_name text, got text, want text);

CREATE OR REPLACE FUNCTION pg_temp.mk(label text, got text, want text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(chr(1), label, coalesce(got,'<null>'), coalesce(want,'<null>'), 'auto');
$$;

CREATE OR REPLACE FUNCTION pg_temp.mkn(label text, passed boolean) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(chr(1), label, CASE WHEN passed THEN 'refused' ELSE 'allowed' END, 'refused', 'auto');
$$;

CREATE OR REPLACE FUNCTION pg_temp.flush(res text[]) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE e text; p text[];
BEGIN
  FOREACH e IN ARRAY res LOOP
    p := string_to_array(e, chr(1));
    INSERT INTO er2_test_results (state, check_name, got, want) VALUES (p[4], p[1], p[2], p[3]);
  END LOOP;
END $f$;

-- ── Tier 1: strong identifiers auto-merge ───────────────────────────────────

DO $$
DECLARE
  res text[] := '{}';
  a uuid; b uuid; c uuid; other uuid;
  dry jsonb; wet jsonb;
BEGIN
  BEGIN
    -- Three rows, one company. Same registrable domain via three URL spellings,
    -- which is the whole point of normalising before grouping.
    INSERT INTO startups (name, website, description, industry, founded_year)
    VALUES ('ZR Helio', 'https://www.zr-helio.example/about', 'The enriched one.', 'Energy', 2023)
    RETURNING id INTO a;
    INSERT INTO startups (name, website) VALUES ('ZR Helio Inc', 'http://zr-helio.example') RETURNING id INTO b;
    INSERT INTO startups (name, website) VALUES ('ZR HELIO, INC.', 'https://jobs.zr-helio.example:8080/x') RETURNING id INTO c;
    -- A row that must NOT be touched: different domain, similar name.
    INSERT INTO startups (name, website) VALUES ('ZR Helio Systems', 'https://zr-helio-systems.example') RETURNING id INTO other;

    res := array_append(res, pg_temp.mk('group found across URL spellings',
      (SELECT array_length(startup_ids,1)::text FROM strong_identity_groups()
        WHERE value = 'zr-helio.example'), '3'));
    res := array_append(res, pg_temp.mk('  the different domain is NOT in it',
      (SELECT (other = ANY(startup_ids))::text FROM strong_identity_groups()
        WHERE value = 'zr-helio.example'), 'false'));

    -- Dry run must change nothing.
    --
    -- NOTE the scoping. resolve_tier1() operates on the WHOLE database, so on a
    -- populated one its totals include the real backlog — the first run of this
    -- test against production reported 18 merges, being 16 genuine redundant
    -- rows plus these 2. Asserting on the global count tests the data, not the
    -- code, and fails differently every week. Every count below is therefore
    -- filtered to this section's own fixtures.
    dry := resolve_tier1(500, true, 'test');
    res := array_append(res, pg_temp.mk('dry run reports THIS fixture''s merges',
      (SELECT count(*)::text FROM jsonb_array_elements(dry->'detail') e
        WHERE e->>'survivor' = a::text), '2'));
    res := array_append(res, pg_temp.mk('  and names the absorbed rows',
      (SELECT count(*)::text FROM jsonb_array_elements(dry->'detail') e
        WHERE e->>'survivor' = a::text AND e->>'merged' IN (b::text, c::text)), '2'));
    res := array_append(res, pg_temp.mk('dry run flagged as such', (dry->>'dry_run'), 'true'));
    res := array_append(res, pg_temp.mk('DRY RUN CHANGED NOTHING',
      (SELECT count(*)::text FROM startups WHERE id IN (a,b,c)), '3'));
    res := array_append(res, pg_temp.mk('  and wrote no audit rows',
      (SELECT count(*)::text FROM entity_match_candidates WHERE right_startup_id IN (a,b,c)), '0'));

    -- For real. On a populated database this genuinely merges the real backlog
    -- too — and the enclosing subtransaction rolls all of it back, which is the
    -- entire reason this test can be run against production at all.
    wet := resolve_tier1(500, false, 'test');
    res := array_append(res, pg_temp.mk('executed THIS fixture''s merges',
      (SELECT count(*)::text FROM jsonb_array_elements(wet->'detail') e
        WHERE e->>'survivor' = a::text), '2'));
    res := array_append(res, pg_temp.mk('three rows collapsed to one',
      (SELECT count(*)::text FROM startups WHERE id IN (a,b,c)), '1'));
    -- The enriched row had a description, industry and founded_year; the others
    -- had nothing. company_richness must pick it.
    res := array_append(res, pg_temp.mk('the ENRICHED row is the survivor',
      (SELECT count(*)::text FROM startups WHERE id = a), '1'));
    res := array_append(res, pg_temp.mk('the unrelated domain is untouched',
      (SELECT count(*)::text FROM startups WHERE id = other), '1'));
    -- The audit lives in company_merges, NOT entity_match_candidates — that
    -- table cascades on right_startup_id and cannot survive the merge it would
    -- be documenting.
    res := array_append(res, pg_temp.mk('merge audit records tier 1',
      (SELECT count(*)::text FROM company_merges
        WHERE surviving_id = a AND evidence->>'tier' = '1'), '2'));
    res := array_append(res, pg_temp.mk('  naming the identifier that matched',
      (SELECT DISTINCT evidence->>'value' FROM company_merges
        WHERE surviving_id = a AND evidence->>'tier' = '1'), 'zr-helio.example'));

    -- Re-running finds nothing: the group is gone.
    res := array_append(res, pg_temp.mk('re-run is a no-op',
      (SELECT count(*)::text FROM strong_identity_groups() WHERE value = 'zr-helio.example'), '0'));

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('tier 1 section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── Tier 2: name + corroboration queues, never merges ───────────────────────

DO $$
DECLARE
  res text[] := '{}';
  a uuid; b uuid; x uuid; y uuid; n1 int; n2 int;
BEGIN
  BEGIN
    -- Same normalised name AND same country -> queued.
    INSERT INTO startups (name, country, founded_year) VALUES ('ZR Vantage Labs', 'Israel', 2022) RETURNING id INTO a;
    INSERT INTO startups (name, country, founded_year) VALUES ('ZR Vantage Labs, Inc.', 'Israel', 2022) RETURNING id INTO b;
    -- Same normalised name, NOTHING else agrees -> must NOT be queued. This is
    -- the 'Apex Capital' case the tier policy exists for.
    INSERT INTO startups (name, country, founded_year, city) VALUES ('ZR Apex Capital', 'France', 2011, 'Paris') RETURNING id INTO x;
    INSERT INTO startups (name, country, founded_year, city) VALUES ('ZR Apex Capital LLC', 'Japan', 1998, 'Osaka') RETURNING id INTO y;

    n1 := queue_tier2_candidates(500, false);

    res := array_append(res, pg_temp.mk('corroborated pair queued',
      (SELECT count(*)::text FROM entity_match_candidates
        WHERE left_id = LEAST(a,b) AND right_startup_id = GREATEST(a,b)), '1'));
    res := array_append(res, pg_temp.mk('  as PENDING, not merged',
      (SELECT status FROM entity_match_candidates
        WHERE left_id = LEAST(a,b) AND right_startup_id = GREATEST(a,b)), 'pending'));
    res := array_append(res, pg_temp.mk('  BOTH ROWS STILL EXIST',
      (SELECT count(*)::text FROM startups WHERE id IN (a,b)), '2'));
    res := array_append(res, pg_temp.mk('  score reflects 2 corroborators',
      (SELECT score::text FROM entity_match_candidates
        WHERE left_id = LEAST(a,b) AND right_startup_id = GREATEST(a,b)), '0.900'));
    res := array_append(res, pg_temp.mk('  stored canonically (lo < hi)',
      (SELECT (left_id < right_startup_id)::text FROM entity_match_candidates
        WHERE left_id = LEAST(a,b) AND right_startup_id = GREATEST(a,b)), 'true'));

    res := array_append(res, pg_temp.mk('UNCORROBORATED name match NOT queued',
      (SELECT count(*)::text FROM entity_match_candidates
        WHERE left_id = LEAST(x,y) AND right_startup_id = GREATEST(x,y)), '0'));

    -- Idempotence: the reviewer must not see the same pair twice.
    n2 := queue_tier2_candidates(500, false);
    res := array_append(res, pg_temp.mk('re-queue inserts nothing new', n2::text, '0'));
    res := array_append(res, pg_temp.mk('  still exactly one row for the pair',
      (SELECT count(*)::text FROM entity_match_candidates
        WHERE left_id = LEAST(a,b) AND right_startup_id = GREATEST(a,b)), '1'));

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('tier 2 section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── Tier 3: fuzzy, and what it must not swallow ─────────────────────────────

DO $$
DECLARE
  res text[] := '{}';
  a uuid; b uuid; e1 uuid; e2 uuid;
BEGIN
  BEGIN
    INSERT INTO startups (name) VALUES ('ZR Quantumleap Robotics') RETURNING id INTO a;
    INSERT INTO startups (name) VALUES ('ZR Quantumleap Robotic')  RETURNING id INTO b;
    -- Exact normalised-name twins: tier 2's territory, must not appear here too.
    INSERT INTO startups (name, country) VALUES ('ZR Twinmatch', 'Spain') RETURNING id INTO e1;
    INSERT INTO startups (name, country) VALUES ('ZR Twinmatch Ltd', 'Spain') RETURNING id INTO e2;

    PERFORM queue_tier3_candidates(0.50, 200);

    res := array_append(res, pg_temp.mk('near-miss pair queued',
      (SELECT count(*)::text FROM entity_match_candidates
        WHERE left_id = LEAST(a,b) AND right_startup_id = GREATEST(a,b) AND tier = 3), '1'));
    res := array_append(res, pg_temp.mk('  as pending',
      (SELECT status FROM entity_match_candidates
        WHERE left_id = LEAST(a,b) AND right_startup_id = GREATEST(a,b) AND tier = 3), 'pending'));
    res := array_append(res, pg_temp.mk('  neither row merged',
      (SELECT count(*)::text FROM startups WHERE id IN (a,b)), '2'));
    res := array_append(res, pg_temp.mk('EXACT twins excluded from tier 3',
      (SELECT count(*)::text FROM entity_match_candidates
        WHERE left_id = LEAST(e1,e2) AND right_startup_id = GREATEST(e1,e2) AND tier = 3), '0'));

    BEGIN
      PERFORM queue_tier3_candidates(1.5, 10);
      res := array_append(res, pg_temp.mkn('out-of-range threshold refused', false));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, pg_temp.mkn('out-of-range threshold refused', true));
    END;

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('tier 3 section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── The reviewer's verb ─────────────────────────────────────────────────────

DO $$
DECLARE
  res text[] := '{}';
  a uuid; b uuid; c uuid; d uuid;
  cid uuid; rid uuid; mid uuid;
BEGIN
  BEGIN
    INSERT INTO startups (name, country, description) VALUES ('ZR Decide One', 'Canada', 'keep me') RETURNING id INTO a;
    INSERT INTO startups (name, country) VALUES ('ZR Decide One Ltd', 'Canada') RETURNING id INTO b;
    INSERT INTO startups (name, country) VALUES ('ZR Decide Two', 'Norway') RETURNING id INTO c;
    INSERT INTO startups (name, country) VALUES ('ZR Decide Two Inc', 'Norway') RETURNING id INTO d;
    PERFORM queue_tier2_candidates(500, false);

    SELECT id INTO cid FROM entity_match_candidates
     WHERE left_id = LEAST(a,b) AND right_startup_id = GREATEST(a,b);
    SELECT id INTO rid FROM entity_match_candidates
     WHERE left_id = LEAST(c,d) AND right_startup_id = GREATEST(c,d);

    -- Reject: nothing merges, but the refusal is recorded.
    PERFORM decide_match_candidate(rid, 'rejected', 'reviewer');
    res := array_append(res, pg_temp.mk('reject leaves both rows',
      (SELECT count(*)::text FROM startups WHERE id IN (c,d)), '2'));
    res := array_append(res, pg_temp.mk('  and records the refusal',
      (SELECT status FROM entity_match_candidates WHERE id = rid), 'rejected'));
    res := array_append(res, pg_temp.mk('  with the reviewer named',
      (SELECT decided_by FROM entity_match_candidates WHERE id = rid), 'reviewer'));
    -- A rejected pair must never be re-proposed.
    PERFORM queue_tier2_candidates(500, false);
    res := array_append(res, pg_temp.mk('REJECTED PAIR NOT RE-QUEUED',
      (SELECT count(*)::text FROM entity_match_candidates
        WHERE left_id = LEAST(c,d) AND right_startup_id = GREATEST(c,d)), '1'));
    res := array_append(res, pg_temp.mk('  and is still rejected, not reset',
      (SELECT status FROM entity_match_candidates
        WHERE left_id = LEAST(c,d) AND right_startup_id = GREATEST(c,d)), 'rejected'));

    -- Confirm: merges, and survives the cascade that deletes one startup.
    mid := decide_match_candidate(cid, 'confirmed', 'reviewer', a);
    res := array_append(res, pg_temp.mk('confirm merged the pair',
      (SELECT count(*)::text FROM startups WHERE id IN (a,b)), '1'));
    res := array_append(res, pg_temp.mk('  keeping the named survivor',
      (SELECT description FROM startups WHERE id = a), 'keep me'));
    res := array_append(res, pg_temp.mk('  returned a merge audit id',
      (SELECT count(*)::text FROM company_merges WHERE id = mid), '1'));
    -- The candidate row is GONE, by design: right_startup_id cascades. Pinning
    -- that here so nobody later "fixes" the queue by reading it back.
    res := array_append(res, pg_temp.mk('candidate row is consumed by the merge',
      (SELECT count(*)::text FROM entity_match_candidates WHERE id = cid), '0'));
    -- So the decision has to be durable somewhere else, and this is where.
    res := array_append(res, pg_temp.mk('DECISION IS DURABLE IN company_merges',
      (SELECT evidence->>'candidate_id' FROM company_merges WHERE id = mid), cid::text));
    res := array_append(res, pg_temp.mk('  with the reviewer attributed',
      (SELECT merged_by FROM company_merges WHERE id = mid), 'reviewer'));
    res := array_append(res, pg_temp.mk('  and the tier retained',
      (SELECT evidence->>'tier' FROM company_merges WHERE id = mid), '2'));

    BEGIN
      PERFORM decide_match_candidate(cid, 'confirmed', 'reviewer');
      res := array_append(res, pg_temp.mkn('deciding twice refused', false));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, pg_temp.mkn('deciding twice refused', true));
    END;
    BEGIN
      PERFORM decide_match_candidate(rid, 'maybe', 'reviewer');
      res := array_append(res, pg_temp.mkn('bogus decision refused', false));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, pg_temp.mkn('bogus decision refused', true));
    END;

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('review section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── Results ─────────────────────────────────────────────────────────────────
SELECT CASE WHEN state = 'skip' THEN 'SKIP'
            WHEN got = want    THEN 'PASS'
            ELSE 'FAIL' END AS result,
       check_name, got, want
  FROM er2_test_results
 ORDER BY CASE WHEN state = 'skip' THEN 1 WHEN got = want THEN 2 ELSE 0 END, seq;
