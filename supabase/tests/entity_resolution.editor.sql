-- =============================================================================
-- Entity resolution tests — SUPABASE SQL EDITOR VERSION.
--
-- Paste the whole file into the SQL Editor and Run. Results come back as a
-- table with a PASS/FAIL/SKIP column, failures sorted to the top.
--
-- ── THIS TEST WRITES NOTHING. NOT "CLEANS UP AFTER ITSELF" — WRITES NOTHING. ──
--   Every section that touches data runs inside a plpgsql subtransaction that
--   ends in an unconditional RAISE, so the subtransaction is ALWAYS rolled back.
--   Assertion outcomes are accumulated in plpgsql ARRAY VARIABLES, which are not
--   database state and therefore survive that rollback; they are written to the
--   results table afterwards, outside the aborted block.
--
--   Earlier versions inserted fixtures and deleted them again before the final
--   SELECT. That was wrong twice over:
--
--     1. It could not survive the connection dropping mid-run, and unlike the
--        scoring test THIS ONE MERGES AND DELETES COMPANY ROWS.
--     2. The cleanup had to identify its own fixture rows by joining back to
--        startups — but merge_companies() has by then DELETED the startup rows
--        the join depends on. One fixture row (entity_type='investor') escaped
--        every time. Widening the match to 'every watchlist row belonging to a
--        user who watchlisted a ZZ company' caught it — and would have deleted
--        that user's ENTIRE REAL WATCHLIST, because watchlist_items.user_id is
--        a foreign key to auth.users and the fixture has to borrow a real
--        account to satisfy it.
--
--   A rolled-back subtransaction has neither problem: there is nothing to
--   identify and nothing to delete. No recovery snippet is needed below,
--   because a half-finished run leaves no trace to recover from.
--
-- ── WHY THE psql VERSION CANNOT BE PASTED HERE ─────────────────────────────
--   entity_resolution.test.sql opens with \set ON_ERROR_STOP on — a psql
--   CLIENT directive, never sent to the server, so the editor reads it as SQL
--   and errors on line 1. And it reports through RAISE NOTICE, which the editor
--   may put somewhere you never look; an unseen FAIL is worse than no test.
--
-- ── WHAT IS BEING TESTED ────────────────────────────────────────────────────
--   merge_companies() is the most destructive operation in this codebase: it
--   deletes a company row and rewrites foreign keys across every dependent
--   table. The contract it must never break is GAP-FILL ONLY — enrichment that
--   cost real money survives a merge untouched. That contract is invisible when
--   reading the function and only observable by running it.
--
--   Requires migrations 20260726180000 and 20260726190000.
-- =============================================================================

DROP TABLE IF EXISTS er_test_results;
CREATE TEMP TABLE er_test_results (
  seq        serial,
  state      text,
  check_name text,
  got        text,
  want       text
);

-- Records are built as delimited strings so they can live in a text[] variable
-- and outlive the rollback. chr(1) is the delimiter: it cannot occur in a
-- company name, a domain, or a column name.
CREATE OR REPLACE FUNCTION pg_temp.mk(label text, got text, want text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(chr(1), label, coalesce(got,'<null>'), coalesce(want,'<null>'), 'auto');
$$;

-- For assertions phrased as "this must be refused", where the observation is
-- whether an exception fired rather than a returned value.
CREATE OR REPLACE FUNCTION pg_temp.mkn(label text, passed boolean) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(chr(1), label, CASE WHEN passed THEN 'refused' ELSE 'allowed' END,
                   'refused', 'auto');
$$;

-- A skipped check is reported, never silently dropped: an assertion that did
-- not run must not look like one that passed.
CREATE OR REPLACE FUNCTION pg_temp.mks(label text, why text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(chr(1), label, why, why, 'skip');
$$;

CREATE OR REPLACE FUNCTION pg_temp.flush(res text[]) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE e text; p text[];
BEGIN
  FOREACH e IN ARRAY res LOOP
    p := string_to_array(e, chr(1));
    INSERT INTO er_test_results (state, check_name, got, want) VALUES (p[4], p[1], p[2], p[3]);
  END LOOP;
END $f$;

-- ── Normalisation ───────────────────────────────────────────────────────────
-- Pure functions, no writes, so no rollback wrapper is needed.

DO $$
DECLARE res text[] := '{}';
BEGIN
res := array_append(res, pg_temp.mk('legal suffix stripped', normalize_company_name('ACME ROBOTICS, INC.'), 'acme robotics'));
res := array_append(res, pg_temp.mk('stacked suffix', normalize_company_name('Acme Holdings, LLC.'), 'acme holdings'));
res := array_append(res, pg_temp.mk('ampersand expanded', normalize_company_name('Smith & Jones Ltd'), 'smith and jones'));
-- Space-separated, not hyphenated: trigram similarity scores the two forms very
-- differently, so the fuzzy tier must compare like with like.
res := array_append(res, pg_temp.mk('space-separated, NOT hyphenated', normalize_company_name('Glow-Security Inc'), 'glow security'));
res := array_append(res, pg_temp.mk('brand words kept', normalize_company_name('Pika Labs Inc'), 'pika labs'));
res := array_append(res, pg_temp.mk('name: empty -> null', normalize_company_name('  '), NULL));

res := array_append(res, pg_temp.mk('plain', registrable_domain('https://www.acme.com/careers?x=1'), 'acme.com'));
res := array_append(res, pg_temp.mk('subdomain dropped', registrable_domain('https://jobs.acme.com'), 'acme.com'));
res := array_append(res, pg_temp.mk('multi-part TLD', registrable_domain('https://www.acme-ai.co.uk/'), 'acme-ai.co.uk'));
res := array_append(res, pg_temp.mk('deep subdomain + co.uk', registrable_domain('https://a.b.acme.co.uk'), 'acme.co.uk'));
res := array_append(res, pg_temp.mk('bare host', registrable_domain('acme.io'), 'acme.io'));
res := array_append(res, pg_temp.mk('port stripped', registrable_domain('http://acme.dev:8080/x'), 'acme.dev'));
res := array_append(res, pg_temp.mk('no dot -> null', registrable_domain('localhost'), NULL));
res := array_append(res, pg_temp.mk('domain: empty -> null', registrable_domain(''), NULL));

PERFORM pg_temp.flush(res);
END $$;

-- ── The gap-fill contract ───────────────────────────────────────────────────

DO $$
DECLARE
  res  text[] := '{}';
  rich uuid; thin uuid; mid uuid; m record;
BEGIN
  BEGIN
    -- The survivor: enriched by earlier pipelines, at real cost.
    -- founders is JSONB, not text[] — it was migrated (founders text[] ->
    -- founders_jsonb jsonb -> renamed back). leadership is a jsonb OBJECT,
    -- which must behave differently from the array.
    INSERT INTO startups (name, website, description, industry, founded_year, country,
                          founders, patent_fields, leadership)
    VALUES ('ZZ Acme Robotics', 'https://zz-acme-robotics.example',
            'Hand-curated description written by an analyst.', 'Robotics', 2024, 'United States',
            '[{"name":"Dana Okonkwo"}]'::jsonb, ARRAY['robotics'], '{"ceo":"Dana Okonkwo"}'::jsonb)
    RETURNING id INTO rich;
    INSERT INTO funding_rounds (startup_id, round_type) VALUES (rich, 'Seed');

    -- The duplicate: thin registry stub, but holds two facts the survivor lacks.
    INSERT INTO startups (name, description, founded_year, city, employee_count,
                          founders, patent_fields, leadership)
    VALUES ('ZZ ACME ROBOTICS, INC.', 'Registry stub.', 2019, 'Boston', 12,
            '[{"name":"Sam Iyer"},{"name":"Dana Okonkwo"}]'::jsonb, ARRAY['control systems'],
            '{"ceo":"Somebody Else"}'::jsonb)
    RETURNING id INTO thin;

    res := array_append(res, pg_temp.mk('richer row scores higher',
      (company_richness(rich) > company_richness(thin))::text, 'true'));

    mid := merge_companies(rich, thin, NULL, '{"tier":1}'::jsonb, 'test');
    SELECT * INTO m FROM company_merges WHERE id = mid;

    res := array_append(res, pg_temp.mk('the ENRICHED row survived', (m.surviving_id = rich)::text, 'true'));
    res := array_append(res, pg_temp.mk('curated description NOT overwritten',
      (SELECT description FROM startups WHERE id = rich),
      'Hand-curated description written by an analyst.'));
    res := array_append(res, pg_temp.mk('founded_year NOT overwritten (2024 kept, not 2019)',
      (SELECT founded_year::text FROM startups WHERE id = rich), '2024'));
    res := array_append(res, pg_temp.mk('description recorded as SKIPPED', ('description' = ANY(m.skipped_columns))::text, 'true'));
    res := array_append(res, pg_temp.mk('founded_year recorded as SKIPPED', ('founded_year' = ANY(m.skipped_columns))::text, 'true'));

    res := array_append(res, pg_temp.mk('empty city WAS filled', (SELECT city FROM startups WHERE id = rich), 'Boston'));
    res := array_append(res, pg_temp.mk('empty employee_count WAS filled',
      (SELECT employee_count::text FROM startups WHERE id = rich), '12'));
    res := array_append(res, pg_temp.mk('city recorded as FILLED', ('city' = ANY(m.filled_columns))::text, 'true'));

    res := array_append(res, pg_temp.mk('jsonb founders array UNIONed and deduped',
      (SELECT jsonb_array_length(founders)::text FROM startups WHERE id = rich), '2'));
    res := array_append(res, pg_temp.mk('  survivor''s founder retained',
      (SELECT (founders @> '[{"name":"Dana Okonkwo"}]'::jsonb)::text FROM startups WHERE id = rich), 'true'));
    res := array_append(res, pg_temp.mk('  merged founder gained',
      (SELECT (founders @> '[{"name":"Sam Iyer"}]'::jsonb)::text FROM startups WHERE id = rich), 'true'));
    -- The duplicate entry present in BOTH must not appear twice.
    res := array_append(res, pg_temp.mk('  duplicate founder not doubled',
      (SELECT count(*)::text FROM startups s, jsonb_array_elements(s.founders) e
        WHERE s.id = rich AND e->>'name' = 'Dana Okonkwo'), '1'));
    res := array_append(res, pg_temp.mk('text[] patent_fields also unioned',
      (SELECT array_length(patent_fields,1)::text FROM startups WHERE id = rich), '2'));
    -- A jsonb OBJECT is not an array: merging two key-by-key would be an
    -- overwrite wearing a different hat, so the survivor's is left alone.
    res := array_append(res, pg_temp.mk('jsonb OBJECT leadership NOT merged',
      (SELECT leadership->>'ceo' FROM startups WHERE id = rich), 'Dana Okonkwo'));

    res := array_append(res, pg_temp.mk('duplicate row is gone', (SELECT count(*)::text FROM startups WHERE id = thin), '0'));
    res := array_append(res, pg_temp.mk('snapshot captured for reversal',
      (m.merged_snapshot->>'name'), 'ZZ ACME ROBOTICS, INC.'));

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('gap-fill section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── Foreign keys, discovered rather than listed ─────────────────────────────

DO $$
DECLARE
  res text[] := '{}';
  a uuid; b uuid; mid uuid; m record;
  u1 uuid; u2 uuid; have_users boolean := false; how text;
BEGIN
  BEGIN
    INSERT INTO startups (name, website) VALUES ('ZZ Nova Labs','https://zz-nova.example') RETURNING id INTO a;
    INSERT INTO startups (name) VALUES ('ZZ NOVA LABS INC') RETURNING id INTO b;

    INSERT INTO funding_rounds (startup_id, round_type) VALUES (b,'Pre-Seed');
    INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id)
    VALUES ('sec_form_d','ZZ-ER-1','ZZ NOVA LABS INC', current_date, b);

    -- watchlist_items.user_id is a FOREIGN KEY to auth.users, so gen_random_uuid()
    -- is rejected outright — the failure that exposed this. Synthetic auth.users
    -- rows are inserted instead, which is only safe because this entire block is
    -- rolled back: they never become visible to anything. Borrowing two real
    -- accounts would work too, but would briefly show them companies that do not
    -- exist, and is unnecessary.
    BEGIN
      u1 := gen_random_uuid();
      u2 := gen_random_uuid();
      INSERT INTO auth.users (id) VALUES (u1), (u2);
      have_users := true;
      how := 'synthetic';
    EXCEPTION WHEN OTHERS THEN
      -- No INSERT rights on auth.users, or it has NOT NULL columns this does not
      -- populate. Fall back to two existing accounts — still rolled back.
      --
      -- Nested again, because the fallback can fail too (no auth schema at all,
      -- as on a bare test cluster). An uncaught failure here would abort the
      -- WHOLE section and take the four FK assertions below with it — they have
      -- nothing to do with watchlists and must still run.
      BEGIN
        SELECT id INTO u1 FROM auth.users ORDER BY id LIMIT 1;
        SELECT id INTO u2 FROM auth.users WHERE id IS DISTINCT FROM u1 ORDER BY id LIMIT 1;
        have_users := u1 IS NOT NULL AND u2 IS NOT NULL;
        how := 'existing accounts';
      EXCEPTION WHEN OTHERS THEN
        have_users := false;
        how := 'unavailable';
      END;
    END;

    IF have_users THEN
      -- u1 watchlisted BOTH, so repointing collides on UNIQUE(user_id,
      -- entity_type, entity_id). u2 watchlisted ONLY the duplicate and must NOT
      -- be collateral damage — a blanket delete on collision loses their entry
      -- entirely, which is exactly the regression this pair of rows pins down.
      INSERT INTO watchlist_items (user_id, entity_type, entity_id) VALUES (u1,'startup',a), (u1,'startup',b);
      INSERT INTO watchlist_items (user_id, entity_type, entity_id) VALUES (u2,'startup',b);
      INSERT INTO watchlist_items (user_id, entity_type, entity_id) VALUES (u2,'investor',b);
    END IF;

    mid := merge_companies(a, b, a, '{"tier":2}'::jsonb, 'test');
    SELECT * INTO m FROM company_merges WHERE id = mid;

    res := array_append(res, pg_temp.mk('funding_rounds repointed',
      (SELECT count(*)::text FROM funding_rounds WHERE startup_id = a), '1'));
    res := array_append(res, pg_temp.mk('raw_gov_filings repointed',
      (SELECT count(*)::text FROM raw_gov_filings WHERE startup_id = a), '1'));
    res := array_append(res, pg_temp.mk('unique collision did NOT abort the merge',
      (SELECT count(*)::text FROM startups WHERE id = b), '0'));

    IF have_users THEN
      res := array_append(res, pg_temp.mk('polymorphic watchlist repointed, not orphaned',
        (SELECT count(*)::text FROM watchlist_items WHERE entity_type='startup' AND entity_id = b), '0'));
      res := array_append(res, pg_temp.mk('the NON-colliding user keeps their entry',
        (SELECT (entity_id = a)::text FROM watchlist_items WHERE user_id = u2 AND entity_type='startup'), 'true'));
      res := array_append(res, pg_temp.mk('an investor watchlist row is untouched',
        (SELECT (entity_id = b)::text FROM watchlist_items WHERE user_id = u2 AND entity_type='investor'), 'true'));
      res := array_append(res, pg_temp.mk('colliding user ends with one row, not two',
        (SELECT count(*)::text FROM watchlist_items WHERE user_id = u1), '1'));
      res := array_append(res, pg_temp.mk('the collision is recorded, not hidden',
        (m.repointed::text LIKE '%dropped%')::text, 'true'));
      res := array_append(res, pg_temp.mk('  and so is what MOVED, separately',
        (m.repointed::text LIKE '%moved%')::text, 'true'));
    ELSE
      res := array_append(res, pg_temp.mks('polymorphic watchlist repointed, not orphaned', 'no two auth.users available'));
      res := array_append(res, pg_temp.mks('the NON-colliding user keeps their entry',   'no two auth.users available'));
      res := array_append(res, pg_temp.mks('an investor watchlist row is untouched',     'no two auth.users available'));
      res := array_append(res, pg_temp.mks('colliding user ends with one row, not two',  'no two auth.users available'));
      res := array_append(res, pg_temp.mks('the collision is recorded, not hidden',      'no two auth.users available'));
      res := array_append(res, pg_temp.mks('  and so is what MOVED, separately',         'no two auth.users available'));
    END IF;

    res := array_append(res, pg_temp.mk('repoint counts recorded', (m.repointed ? 'funding_rounds.startup_id')::text, 'true'));

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('foreign-key section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── Reversal ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  res text[] := '{}';
  a uuid; b uuid; mid uuid; restored uuid;
BEGIN
  BEGIN
    INSERT INTO startups (name, description, city) VALUES ('ZZ Keeper','survivor desc','NYC') RETURNING id INTO a;
    INSERT INTO startups (name, description, country) VALUES ('ZZ Keeper Inc','loser desc','Canada') RETURNING id INTO b;
    mid := merge_companies(a, b, a);
    res := array_append(res, pg_temp.mk('merged away', (SELECT count(*)::text FROM startups WHERE id = b), '0'));
    restored := unmerge_company(mid, 'test');
    res := array_append(res, pg_temp.mk('company restored', (SELECT count(*)::text FROM startups WHERE id = restored), '1'));
    res := array_append(res, pg_temp.mk('  with its own name', (SELECT name FROM startups WHERE id = restored), 'ZZ Keeper Inc'));
    res := array_append(res, pg_temp.mk('  with its own description', (SELECT description FROM startups WHERE id = restored), 'loser desc'));
    res := array_append(res, pg_temp.mk('marked reversed',
      (SELECT (reversed_at IS NOT NULL)::text FROM company_merges WHERE id = mid), 'true'));
    BEGIN
      PERFORM unmerge_company(mid, 'test');
      res := array_append(res, pg_temp.mkn('double reversal refused', false));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, pg_temp.mkn('double reversal refused', true));
    END;

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('reversal section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── Guards ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  res text[] := '{}';
  a uuid;
BEGIN
  BEGIN
    INSERT INTO startups (name) VALUES ('ZZ Solo') RETURNING id INTO a;

    BEGIN PERFORM merge_companies(a, a); res := array_append(res, pg_temp.mkn('self-merge refused', false));
    EXCEPTION WHEN OTHERS THEN res := array_append(res, pg_temp.mkn('self-merge refused', true)); END;

    BEGIN PERFORM merge_companies(a, gen_random_uuid()); res := array_append(res, pg_temp.mkn('nonexistent row refused', false));
    EXCEPTION WHEN OTHERS THEN res := array_append(res, pg_temp.mkn('nonexistent row refused', true)); END;

    BEGIN PERFORM merge_companies(a, a, gen_random_uuid()); res := array_append(res, pg_temp.mkn('survivor must be one of the pair', false));
    EXCEPTION WHEN OTHERS THEN res := array_append(res, pg_temp.mkn('survivor must be one of the pair', true)); END;

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('guards section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── The uniqueness engine ───────────────────────────────────────────────────

DO $$
DECLARE
  res text[] := '{}';
  a uuid; b uuid;
BEGIN
  BEGIN
    INSERT INTO startups (name, website) VALUES ('ZZ Alpha','https://zz-alpha.example') RETURNING id INTO a;
    INSERT INTO company_identifiers (startup_id, kind, value, source)
    VALUES (a, 'domain', registrable_domain('https://zz-alpha.example'), 'test');
    INSERT INTO startups (name, website) VALUES ('ZZ Alpha Duplicate','https://www.zz-alpha.example/about')
    RETURNING id INTO b;
    BEGIN
      INSERT INTO company_identifiers (startup_id, kind, value, source)
      VALUES (b, 'domain', registrable_domain('https://www.zz-alpha.example/about'), 'test');
      res := array_append(res, pg_temp.mkn('domain collision blocked — that IS the duplicate signal', false));
    EXCEPTION WHEN unique_violation THEN
      -- Not an error to swallow. The collision IS the duplicate detection.
      res := array_append(res, pg_temp.mkn('domain collision blocked — that IS the duplicate signal', true));
    END;

    RAISE EXCEPTION USING ERRCODE = 'raise_exception', MESSAGE = '__ROLLBACK__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK__' THEN
      res := array_append(res, pg_temp.mk('uniqueness section aborted', SQLERRM, 'no error'));
    END IF;
  END;
  PERFORM pg_temp.flush(res);
END $$;

-- ── Results ─────────────────────────────────────────────────────────────────
-- FAIL first, then SKIP, then PASS. A section that aborted contributes a FAIL
-- row carrying the SQLERRM, so a broken run cannot look like a short one.
SELECT CASE WHEN state = 'skip' THEN 'SKIP'
            WHEN got = want    THEN 'PASS'
            ELSE 'FAIL' END AS result,
       check_name, got, want
  FROM er_test_results
 ORDER BY CASE WHEN state = 'skip' THEN 1 WHEN got = want THEN 2 ELSE 0 END, seq;
