-- =============================================================================
-- Tests for the entity resolution layer.
--
-- Run:  psql "$SUPABASE_DB_URL" -f supabase/tests/entity_resolution.test.sql
--
-- SAFE ON A LIVE DATABASE. Wrapped in BEGIN ... ROLLBACK; nothing persists.
--
-- merge_companies() is the most destructive operation in this codebase: it
-- deletes a company row and rewrites foreign keys across every dependent table.
-- The contract it must never break is GAP-FILL ONLY — enrichment that cost real
-- money survives a merge untouched. That contract is invisible when reading the
-- function and only observable by running it, which is what this file does.
-- =============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ck(label text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $ck$
BEGIN
  IF got IS NOT DISTINCT FROM want THEN
    RAISE NOTICE 'PASS  % = %', label, coalesce(got, '<null>');
  ELSE
    RAISE NOTICE 'FAIL  %  got % want %', label, coalesce(got, '<null>'), coalesce(want, '<null>');
  END IF;
END $ck$;

-- ── Normalisation ───────────────────────────────────────────────────────────

DO $$ BEGIN
RAISE NOTICE '── normalize_company_name ──';
PERFORM pg_temp.ck('legal suffix stripped', normalize_company_name('ACME ROBOTICS, INC.'), 'acme robotics');
PERFORM pg_temp.ck('stacked suffix', normalize_company_name('Acme Holdings, LLC.'), 'acme holdings');
PERFORM pg_temp.ck('ampersand expanded', normalize_company_name('Smith & Jones Ltd'), 'smith and jones');
-- Space-separated, not hyphenated: trigram similarity scores the two forms very
-- differently, so the fuzzy tier must compare like with like.
PERFORM pg_temp.ck('space-separated, NOT hyphenated', normalize_company_name('Glow-Security Inc'), 'glow security');
PERFORM pg_temp.ck('brand words kept', normalize_company_name('Pika Labs Inc'), 'pika labs');
PERFORM pg_temp.ck('empty -> null', normalize_company_name('  '), NULL);

RAISE NOTICE '';
RAISE NOTICE '── registrable_domain ──';
PERFORM pg_temp.ck('plain', registrable_domain('https://www.acme.com/careers?x=1'), 'acme.com');
PERFORM pg_temp.ck('subdomain dropped', registrable_domain('https://jobs.acme.com'), 'acme.com');
PERFORM pg_temp.ck('multi-part TLD', registrable_domain('https://www.acme-ai.co.uk/'), 'acme-ai.co.uk');
PERFORM pg_temp.ck('deep subdomain + co.uk', registrable_domain('https://a.b.acme.co.uk'), 'acme.co.uk');
PERFORM pg_temp.ck('bare host', registrable_domain('acme.io'), 'acme.io');
PERFORM pg_temp.ck('port stripped', registrable_domain('http://acme.dev:8080/x'), 'acme.dev');
PERFORM pg_temp.ck('no dot -> null', registrable_domain('localhost'), NULL);
PERFORM pg_temp.ck('empty -> null', registrable_domain(''), NULL);
END $$;

-- ── The gap-fill contract ───────────────────────────────────────────────────

DO $$
DECLARE rich uuid; thin uuid; mid uuid; m record;
BEGIN
RAISE NOTICE '';
RAISE NOTICE '── merge_companies: NEVER overwrites enriched data ──';

-- The survivor: enriched by earlier pipelines, at real cost.
-- founders is JSONB, not text[] — it was migrated (founders text[] ->
-- founders_jsonb jsonb -> renamed back). leadership is a jsonb OBJECT, which
-- must behave differently from the array.
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

PERFORM pg_temp.ck('richer row scores higher',
  (company_richness(rich) > company_richness(thin))::text, 'true');

mid := merge_companies(rich, thin, NULL, '{"tier":1}'::jsonb, 'test');
SELECT * INTO m FROM company_merges WHERE id = mid;

PERFORM pg_temp.ck('the ENRICHED row survived', (m.surviving_id = rich)::text, 'true');
PERFORM pg_temp.ck('curated description NOT overwritten',
  (SELECT description FROM startups WHERE id = rich),
  'Hand-curated description written by an analyst.');
PERFORM pg_temp.ck('founded_year NOT overwritten (2024 kept, not 2019)',
  (SELECT founded_year::text FROM startups WHERE id = rich), '2024');
PERFORM pg_temp.ck('description recorded as SKIPPED', ('description' = ANY(m.skipped_columns))::text, 'true');
PERFORM pg_temp.ck('founded_year recorded as SKIPPED', ('founded_year' = ANY(m.skipped_columns))::text, 'true');

PERFORM pg_temp.ck('empty city WAS filled', (SELECT city FROM startups WHERE id = rich), 'Boston');
PERFORM pg_temp.ck('empty employee_count WAS filled',
  (SELECT employee_count::text FROM startups WHERE id = rich), '12');
PERFORM pg_temp.ck('city recorded as FILLED', ('city' = ANY(m.filled_columns))::text, 'true');

PERFORM pg_temp.ck('jsonb founders array UNIONed and deduped',
  (SELECT jsonb_array_length(founders)::text FROM startups WHERE id = rich), '2');
PERFORM pg_temp.ck('  survivor''s founder retained',
  (SELECT (founders @> '[{"name":"Dana Okonkwo"}]'::jsonb)::text FROM startups WHERE id = rich), 'true');
PERFORM pg_temp.ck('  merged founder gained',
  (SELECT (founders @> '[{"name":"Sam Iyer"}]'::jsonb)::text FROM startups WHERE id = rich), 'true');
-- The duplicate entry present in BOTH must not appear twice.
PERFORM pg_temp.ck('  duplicate founder not doubled',
  (SELECT count(*)::text FROM startups s, jsonb_array_elements(s.founders) e
    WHERE s.id = rich AND e->>'name' = 'Dana Okonkwo'), '1');
PERFORM pg_temp.ck('text[] patent_fields also unioned',
  (SELECT array_length(patent_fields,1)::text FROM startups WHERE id = rich), '2');
-- A jsonb OBJECT is not an array: merging two key-by-key would be an overwrite
-- wearing a different hat, so the survivor's is left alone.
PERFORM pg_temp.ck('jsonb OBJECT leadership NOT merged',
  (SELECT leadership->>'ceo' FROM startups WHERE id = rich), 'Dana Okonkwo');

PERFORM pg_temp.ck('duplicate row is gone', (SELECT count(*)::text FROM startups WHERE id = thin), '0');
PERFORM pg_temp.ck('snapshot captured for reversal',
  (m.merged_snapshot->>'name'), 'ZZ ACME ROBOTICS, INC.');
END $$;

-- ── Foreign keys, discovered rather than listed ─────────────────────────────

DO $$
DECLARE a uuid; b uuid; mid uuid; m record; u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
BEGIN
RAISE NOTICE '';
RAISE NOTICE '── merge_companies: dependents repointed, collisions survived ──';
INSERT INTO startups (name, website) VALUES ('ZZ Nova Labs','https://zz-nova.example') RETURNING id INTO a;
INSERT INTO startups (name) VALUES ('ZZ NOVA LABS INC') RETURNING id INTO b;

INSERT INTO funding_rounds (startup_id, round_type) VALUES (b,'Pre-Seed');
INSERT INTO raw_gov_filings (source, accession_number, entity_name, filing_date, startup_id)
VALUES ('sec_form_d','ZZ-ER-1','ZZ NOVA LABS INC', current_date, b);
-- watchlist_items is POLYMORPHIC — entity_id holds a startup or investor id
-- with no foreign key, so pg_constraint cannot find it. Without explicit
-- handling a merge leaves these pointing at a deleted row and nothing errors.
--
-- u1 watchlisted BOTH, so repointing collides on UNIQUE(user_id, entity_type,
-- entity_id). u2 watchlisted ONLY the duplicate and must NOT be collateral
-- damage — a blanket delete on collision loses their entry entirely.
INSERT INTO watchlist_items (user_id, entity_type, entity_id) VALUES (u1,'startup',a), (u1,'startup',b);
INSERT INTO watchlist_items (user_id, entity_type, entity_id) VALUES (u2,'startup',b);
INSERT INTO watchlist_items (user_id, entity_type, entity_id) VALUES (u2,'investor',b);

mid := merge_companies(a, b, a, '{"tier":2}'::jsonb, 'test');
SELECT * INTO m FROM company_merges WHERE id = mid;

PERFORM pg_temp.ck('funding_rounds repointed',
  (SELECT count(*)::text FROM funding_rounds WHERE startup_id = a), '1');
PERFORM pg_temp.ck('raw_gov_filings repointed',
  (SELECT count(*)::text FROM raw_gov_filings WHERE startup_id = a), '1');
PERFORM pg_temp.ck('unique collision did NOT abort the merge',
  (SELECT count(*)::text FROM startups WHERE id = b), '0');
PERFORM pg_temp.ck('polymorphic watchlist repointed, not orphaned',
  (SELECT count(*)::text FROM watchlist_items WHERE entity_type='startup' AND entity_id = b), '0');
PERFORM pg_temp.ck('the NON-colliding user keeps their entry',
  (SELECT (entity_id = a)::text FROM watchlist_items WHERE user_id = u2 AND entity_type='startup'), 'true');
PERFORM pg_temp.ck('an investor watchlist row is untouched',
  (SELECT (entity_id = b)::text FROM watchlist_items WHERE user_id = u2 AND entity_type='investor'), 'true');
PERFORM pg_temp.ck('colliding user ends with one row, not two',
  (SELECT count(*)::text FROM watchlist_items WHERE user_id = u1), '1');
PERFORM pg_temp.ck('the collision is recorded, not hidden',
  (m.repointed::text LIKE '%dropped%')::text, 'true');
PERFORM pg_temp.ck('  and so is what MOVED, separately',
  (m.repointed::text LIKE '%moved%')::text, 'true');
PERFORM pg_temp.ck('repoint counts recorded', (m.repointed ? 'funding_rounds.startup_id')::text, 'true');
END $$;

-- ── Reversal ────────────────────────────────────────────────────────────────

DO $$
DECLARE a uuid; b uuid; mid uuid; restored uuid;
BEGIN
RAISE NOTICE '';
RAISE NOTICE '── unmerge_company ──';
INSERT INTO startups (name, description, city) VALUES ('ZZ Keeper','survivor desc','NYC') RETURNING id INTO a;
INSERT INTO startups (name, description, country) VALUES ('ZZ Keeper Inc','loser desc','Canada') RETURNING id INTO b;
mid := merge_companies(a, b, a);
PERFORM pg_temp.ck('merged away', (SELECT count(*)::text FROM startups WHERE id = b), '0');
restored := unmerge_company(mid, 'test');
PERFORM pg_temp.ck('company restored', (SELECT count(*)::text FROM startups WHERE id = restored), '1');
PERFORM pg_temp.ck('  with its own name', (SELECT name FROM startups WHERE id = restored), 'ZZ Keeper Inc');
PERFORM pg_temp.ck('  with its own description', (SELECT description FROM startups WHERE id = restored), 'loser desc');
PERFORM pg_temp.ck('marked reversed',
  (SELECT (reversed_at IS NOT NULL)::text FROM company_merges WHERE id = mid), 'true');
BEGIN
  PERFORM unmerge_company(mid, 'test');
  RAISE NOTICE 'FAIL  double reversal was allowed';
EXCEPTION WHEN others THEN RAISE NOTICE 'PASS  double reversal refused'; END;
END $$;

-- ── Guards ──────────────────────────────────────────────────────────────────

DO $$
DECLARE a uuid;
BEGIN
RAISE NOTICE '';
RAISE NOTICE '── guards ──';
INSERT INTO startups (name) VALUES ('ZZ Solo') RETURNING id INTO a;
BEGIN PERFORM merge_companies(a, a); RAISE NOTICE 'FAIL  self-merge allowed';
EXCEPTION WHEN others THEN RAISE NOTICE 'PASS  self-merge refused'; END;
BEGIN PERFORM merge_companies(a, gen_random_uuid()); RAISE NOTICE 'FAIL  merged a nonexistent row';
EXCEPTION WHEN others THEN RAISE NOTICE 'PASS  nonexistent row refused'; END;
BEGIN PERFORM merge_companies(a, a, gen_random_uuid()); RAISE NOTICE 'FAIL  bogus survivor allowed';
EXCEPTION WHEN others THEN RAISE NOTICE 'PASS  survivor must be one of the pair'; END;
END $$;

-- ── The uniqueness engine ───────────────────────────────────────────────────

DO $$
DECLARE a uuid; b uuid;
BEGIN
RAISE NOTICE '';
RAISE NOTICE '── company_identifiers ──';
INSERT INTO startups (name, website) VALUES ('ZZ Alpha','https://zz-alpha.example') RETURNING id INTO a;
INSERT INTO company_identifiers (startup_id, kind, value, source)
VALUES (a, 'domain', registrable_domain('https://zz-alpha.example'), 'test');
INSERT INTO startups (name, website) VALUES ('ZZ Alpha Duplicate','https://www.zz-alpha.example/about')
RETURNING id INTO b;
BEGIN
  INSERT INTO company_identifiers (startup_id, kind, value, source)
  VALUES (b, 'domain', registrable_domain('https://www.zz-alpha.example/about'), 'test');
  RAISE NOTICE 'FAIL  two companies claimed one domain';
EXCEPTION WHEN unique_violation THEN
  -- Not an error to swallow. The collision IS the duplicate detection.
  RAISE NOTICE 'PASS  domain collision blocked — that IS the duplicate signal';
END;
END $$;

-- Nothing above is kept.
ROLLBACK;
