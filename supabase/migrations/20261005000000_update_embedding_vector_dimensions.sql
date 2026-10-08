-- =============================================================================
-- Migration: update_embedding_vector_dimensions
-- Created:   2026-10-05
-- Description: Deprecates OpenAI (text-embedding-3-small, 1536-d) as the
--              embedding provider in favour of a self-hosted Text Embeddings
--              Inference (TEI) server running nomic-ai/nomic-embed-text-v1.5
--              (768-d) on our existing RunPod instance, alongside the
--              self-hosted LLM (see supabase/functions/_shared/llm-client.ts /
--              tei-client.ts). OpenAI's and Nomic's embeddings live in
--              unrelated vector spaces — there is no way to cast one into the
--              other — so every stored embedding is irrecoverably stale and
--              must be nulled out and recomputed from scratch by the existing
--              backfill-embeddings Edge Function + pg_cron schedule
--              (20261004000000_schedule_embedding_backfill.sql). Nulling
--              embedding_updated_at is exactly what makes that happen: the
--              backfill queue is `ORDER BY embedding_updated_at NULLS FIRST`,
--              so every row self-re-queues with no separate "re-embed everything"
--              step required.
--
-- Three tables carry an embedding column; this migration finds exactly these
-- via grep across every migration file (there are no others):
--   1. startups.embedding                — HNSW-indexed, ANN-searched directly.
--   2. investors.embedding                — HNSW-indexed, ANN-searched directly.
--   3. user_preference_vectors.embedding  — NOT indexed (small table; only ever
--      used as the query-side vector in `startups.embedding <=> this`, never
--      itself ANN-searched), per 20260924000000_preference_engine_phase1.
--
-- match_companies_and_funds() (20260721000000_semantic_search_pgvector) is the
-- only RPC that hardcodes a vector dimension (in its `query_embedding
-- extensions.vector(1536)` parameter signature) and must be recreated with
-- vector(768). generate_live_alerts() and top_thesis_matches() were checked
-- and need NO changes — both only ever compare `a.embedding <=> b.embedding`
-- between two already-declared vector columns, which is dimension-agnostic by
-- construction as long as both sides share the same declared type.
--
-- Idempotent; safe to run more than once (ALTER COLUMN TYPE is a no-op once
-- already vector(768); indexes/function use IF EXISTS / CREATE OR REPLACE).
-- =============================================================================

-- 1. ── Drop the two HNSW indexes before changing column type ─────────────────
-- Postgres won't let you ALTER COLUMN TYPE on a column with a dependent index
-- in place; dropping explicitly (rather than relying on CASCADE) keeps this
-- migration's effects legible, matching this codebase's established style of
-- never leaning on implicit cascading behaviour for schema changes.
DROP INDEX IF EXISTS idx_startups_embedding_hnsw;
DROP INDEX IF EXISTS idx_investors_embedding_hnsw;

-- 0. ── Views that select the embedding columns ─────────────────────────────
-- A column's type cannot change while a view or materialized view uses it:
-- startups_search is `SELECT s.*, ...` over startups, so it carries
-- startups.embedding ("cannot alter type of a column used by a view or rule
-- ... materialized view startups_search depends on column embedding" — the
-- error this migration first hit on the live database). This block records
-- every such view, every view built on top of them (startups_market), their
-- indexes, grants and comments, and every function that returns or takes
-- their row type (search_startups & co. return SETOF startups_search) —
-- exactly as the database has them, via pg_get_viewdef / pg_get_indexdef /
-- pg_get_functiondef — then drops them. Step 5b below recreates all of it,
-- so the views come back identical except for the new vector(768) column.
-- Anything else that depends on them aborts the migration (nothing is
-- dropped that is not recreated).
--
-- Runs only while a column is still not vector(768), so this migration is
-- now safe to re-run: on a second run nothing is dropped, altered or reset.

DO $$
DECLARE
  v_need   boolean;
  v_roots  oid[];
  v_rels   oid[];
  v_types  oid[];
  v_funcs  oid[];
  v_stray  text;
  v_ddl    text[] := '{}';
  i        integer;
  r        record;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid IN ('public.startups'::regclass, 'public.investors'::regclass, 'public.user_preference_vectors'::regclass)
       AND a.attname = 'embedding' AND NOT a.attisdropped
       AND format_type(a.atttypid, a.atttypmod) NOT IN ('vector(768)', 'extensions.vector(768)')
  ) INTO v_need;
  IF NOT v_need THEN
    RAISE NOTICE 'embedding columns are already vector(768) — nothing to rebuild';
    RETURN;
  END IF;

  -- Views / materialized views reading an embedding column directly.
  SELECT array_agg(DISTINCT rw.ev_class) INTO v_roots
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   WHERE d.classid = 'pg_rewrite'::regclass
     AND d.refobjid IN ('public.startups'::regclass, 'public.investors'::regclass, 'public.user_preference_vectors'::regclass)
     AND a.attname = 'embedding'
     AND rw.ev_class NOT IN ('public.startups'::regclass, 'public.investors'::regclass, 'public.user_preference_vectors'::regclass);
  IF v_roots IS NULL THEN
    -- 1536-d OpenAI and 768-d Nomic vectors share no space: USING NULL.
    ALTER TABLE startups ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;
    ALTER TABLE investors ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;
    ALTER TABLE user_preference_vectors ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;
    -- Re-queue every row for the backfill job.
    UPDATE startups  SET embedding_source_hash = NULL, embedding_updated_at = NULL
     WHERE embedding_source_hash IS NOT NULL OR embedding_updated_at IS NOT NULL;
    UPDATE investors SET embedding_source_hash = NULL, embedding_updated_at = NULL
     WHERE embedding_source_hash IS NOT NULL OR embedding_updated_at IS NOT NULL;
    RETURN;
  END IF;

  -- Plus every view built on them, deepest last.
  DROP TABLE IF EXISTS pg_temp._emb_rels;
  CREATE TEMP TABLE _emb_rels AS
  WITH RECURSIVE deps(relid, depth) AS (
    SELECT unnest(v_roots), 0
    UNION
    SELECT rw.ev_class, deps.depth + 1
      FROM deps
      JOIN pg_depend d ON d.refobjid = deps.relid AND d.classid = 'pg_rewrite'::regclass AND d.deptype = 'n'
      JOIN pg_rewrite rw ON rw.oid = d.objid
     WHERE rw.ev_class <> deps.relid AND deps.depth < 10
  )
  SELECT relid, max(depth) AS depth FROM deps GROUP BY relid;

  SELECT array_agg(relid), array_agg(c.reltype) INTO v_rels, v_types
    FROM _emb_rels e JOIN pg_class c ON c.oid = e.relid;

  SELECT array_agg(p.oid) INTO v_funcs
    FROM pg_proc p
   WHERE p.prorettype = ANY (v_types)
      OR p.proargtypes::oid[] && v_types
      -- RETURNS TABLE(peer startups_search, ...) puts the row type in the
      -- OUT parameters (hybrid_lookalikes), which only proallargtypes lists.
      OR coalesce(p.proallargtypes, '{}') && v_types
      -- Any other function the catalogue records as depending on the views
      -- (e.g. a BEGIN ATOMIC SQL body that reads them).
      OR p.oid IN (SELECT d.objid FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.deptype = 'n'
                      AND (d.refobjid = ANY (v_rels) OR d.refobjid = ANY (v_types)));

  -- Refuse to drop anything that would not be recreated.
  SELECT string_agg(DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO v_stray
    FROM pg_depend d
   WHERE d.deptype = 'n'
     AND (d.refobjid = ANY (v_rels) OR d.refobjid = ANY (v_types))
     AND NOT (d.classid = 'pg_rewrite'::regclass
              AND (SELECT ev_class FROM pg_rewrite WHERE oid = d.objid) = ANY (v_rels))
     AND NOT (d.classid = 'pg_proc'::regclass AND d.objid = ANY (coalesce(v_funcs, '{}')));
  IF v_stray IS NOT NULL THEN
    RAISE EXCEPTION 'embedding migration: these objects depend on % and would be dropped without being recreated: %',
      (SELECT string_agg(relid::regclass::text, ', ') FROM _emb_rels), v_stray;
  END IF;

  -- Record: views (shallowest first) with their indexes, then functions,
  -- then grants and comments.
  FOR r IN
    SELECT c.oid, c.relkind, c.reloptions, format('%I.%I', n.nspname, c.relname) AS qname,
           regexp_replace(pg_get_viewdef(c.oid, true), ';\s*$', '') AS def
      FROM _emb_rels e JOIN pg_class c ON c.oid = e.relid JOIN pg_namespace n ON n.oid = c.relnamespace
     ORDER BY e.depth, c.relname
  LOOP
    v_ddl := v_ddl || (
      CASE r.relkind
        WHEN 'm' THEN format('CREATE MATERIALIZED VIEW %s AS %s', r.qname, r.def)
        ELSE format('CREATE VIEW %s%s AS %s', r.qname,
                    CASE WHEN r.reloptions IS NOT NULL THEN ' WITH (' || array_to_string(r.reloptions, ', ') || ')' ELSE '' END,
                    r.def)
      END);
    v_ddl := v_ddl || ARRAY(
      SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i WHERE i.indrelid = r.oid ORDER BY i.indexrelid);
  END LOOP;

  v_ddl := v_ddl || ARRAY(
    SELECT pg_get_functiondef(f) FROM unnest(coalesce(v_funcs, '{}')) f);

  v_ddl := v_ddl || ARRAY(
    SELECT format('GRANT %s ON %s TO %s', x.privilege_type, format('%I.%I', n.nspname, c.relname),
                  CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(x.grantee)) END)
      FROM _emb_rels e JOIN pg_class c ON c.oid = e.relid JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(c.relacl) x);

  -- A recreated function starts with the default (EXECUTE for PUBLIC); a
  -- function whose grants were set explicitly gets exactly those back.
  v_ddl := v_ddl || ARRAY(
    SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', p.oid::regprocedure)
      FROM pg_proc p WHERE p.oid = ANY (coalesce(v_funcs, '{}')) AND p.proacl IS NOT NULL);

  v_ddl := v_ddl || ARRAY(
    SELECT format('GRANT EXECUTE ON FUNCTION %s TO %s', p.oid::regprocedure,
                  CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(x.grantee)) END)
      FROM pg_proc p, LATERAL aclexplode(p.proacl) x
     WHERE p.oid = ANY (coalesce(v_funcs, '{}')) AND x.privilege_type = 'EXECUTE');

  v_ddl := v_ddl || ARRAY(
    SELECT format('COMMENT ON %s %s IS %L', CASE c.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
                  format('%I.%I', n.nspname, c.relname), obj_description(c.oid, 'pg_class'))
      FROM _emb_rels e JOIN pg_class c ON c.oid = e.relid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE obj_description(c.oid, 'pg_class') IS NOT NULL);

  v_ddl := v_ddl || ARRAY(
    SELECT format('COMMENT ON FUNCTION %s IS %L', p.oid::regprocedure, obj_description(p.oid, 'pg_proc'))
      FROM pg_proc p WHERE p.oid = ANY (coalesce(v_funcs, '{}')) AND obj_description(p.oid, 'pg_proc') IS NOT NULL);

  -- Drop: the roots, CASCADE takes the recorded views and functions with them.
  FOR r IN SELECT c.relkind, format('%I.%I', n.nspname, c.relname) AS qname
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = ANY (v_roots)
  LOOP
    EXECUTE format('DROP %s IF EXISTS %s CASCADE',
                   CASE r.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END, r.qname);
  END LOOP;

  BEGIN
    -- 1536-d OpenAI and 768-d Nomic vectors share no space: USING NULL.
    ALTER TABLE startups ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;
    ALTER TABLE investors ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;
    ALTER TABLE user_preference_vectors ALTER COLUMN embedding TYPE extensions.vector(768) USING NULL;
    -- Re-queue every row for the backfill job.
    UPDATE startups  SET embedding_source_hash = NULL, embedding_updated_at = NULL
     WHERE embedding_source_hash IS NOT NULL OR embedding_updated_at IS NOT NULL;
    UPDATE investors SET embedding_source_hash = NULL, embedding_updated_at = NULL
     WHERE embedding_source_hash IS NOT NULL OR embedding_updated_at IS NOT NULL;
  END;

  -- 5b. Recreate the views, indexes, functions, grants and comments recorded
  -- above, in order.
  FOR i IN 1 .. coalesce(array_length(v_ddl, 1), 0) LOOP
    EXECUTE v_ddl[i];
  END LOOP;
  DROP TABLE IF EXISTS pg_temp._emb_rels;
END;
$$;


-- 2./3. ── Column type change and hash reset: inside step 0's block, so
-- dropping the views, changing the columns and recreating the views happen
-- as ONE
-- statement — the Supabase SQL editor does not keep a session (or a temp
-- table) across the statements of a script, and a half-done run must never
-- leave startups_search dropped.

-- 4. ── Recreate the two HNSW indexes against the new vector(768) columns ─────
CREATE INDEX IF NOT EXISTS idx_startups_embedding_hnsw
  ON startups USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_investors_embedding_hnsw
  ON investors USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 5. ── Update column comments to stop describing OpenAI/1536-d ──────────────
COMMENT ON COLUMN startups.embedding IS
  'nomic-ai/nomic-embed-text-v1.5 (768-d, self-hosted TEI on RunPod) embedding of the company''s semantic profile (name + industry + description). Populated by the backfill-embeddings Edge Function. NULL = not yet embedded.';
COMMENT ON COLUMN investors.embedding IS
  'nomic-ai/nomic-embed-text-v1.5 (768-d, self-hosted TEI on RunPod) embedding of the firm''s semantic profile (name + description + thesis). Populated by the backfill-embeddings Edge Function. NULL = not yet embedded.';
COMMENT ON COLUMN user_preference_vectors.embedding IS
  'Same 768-d nomic-embed-text-v1.5 space as startups.embedding/investors.embedding (20261005000000_update_embedding_vector_dimensions) — a centroid of real company embeddings the user has engaged with. No HNSW index here: queries always go startups.embedding <=> (this one user''s vector), which uses the existing index on startups, not one on this table.';

-- 6. ── Recreate match_companies_and_funds() with a vector(768) parameter ─────
-- Body is otherwise identical to 20260721000000_semantic_search_pgvector.sql
-- (only the parameter's declared dimension changes; every comparison inside
-- is dimension-agnostic) EXCEPT for one bundled bug fix discovered while
-- validating this migration locally: the function was declared STABLE while
-- its body executes `SET LOCAL hnsw.ef_search = 100` — PostgreSQL
-- unconditionally rejects a SET/SET LOCAL statement inside a STABLE (or
-- IMMUTABLE) function ("SET is not allowed in a non-volatile function"),
-- confirmed by reproducing the identical error against the untouched
-- original function body. That means every call to this RPC has errored
-- since its introduction, independent of this migration's dimension change.
-- Since this function is already being dropped and recreated here, the fix
-- (STABLE -> VOLATILE) rides along rather than shipping a still-broken
-- function under a new vector dimension.
DROP FUNCTION IF EXISTS match_companies_and_funds(extensions.vector, integer, double precision, text);

CREATE FUNCTION match_companies_and_funds(
  query_embedding extensions.vector(768),
  match_count     integer          DEFAULT 10,
  match_threshold double precision DEFAULT 0.0,
  entity_filter   text             DEFAULT 'all'   -- 'all' | 'startup' | 'investor'
)
RETURNS TABLE (
  entity_type text,
  id          uuid,
  name        text,
  slug        text,
  description text,
  similarity  double precision,
  metadata    jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Lift approximate-search recall for this query (default is 40). Higher =
  -- more candidates explored per probe = better top-K quality, minor latency.
  SET LOCAL hnsw.ef_search = 100;

  -- Each per-table CTE does its OWN `ORDER BY embedding <=> query LIMIT k`, which
  -- is the exact shape the HNSW index accelerates — so we fetch each table's top
  -- candidates via the index (no full-table distance scan), then merge and take
  -- the global top-K. Fetching match_count from each side guarantees the merged
  -- top match_count is correct even if one type dominates the results.
  RETURN QUERY
  WITH startup_hits AS (
    SELECT
      'startup'::text AS entity_type,
      s.id,
      s.name,
      s.slug,
      s.description,
      1 - (s.embedding <=> query_embedding) AS similarity,
      jsonb_build_object(
        'industry',     s.industry,
        'website',      s.website,
        'city',         s.city,
        'country',      s.country,
        'logo_url',     s.logo_url,
        'growth_trend', s.growth_trend
      ) AS metadata
    FROM startups s
    WHERE s.embedding IS NOT NULL
      AND entity_filter IN ('all', 'startup')
    ORDER BY s.embedding <=> query_embedding      -- index-accelerated ANN
    LIMIT match_count
  ),
  investor_hits AS (
    SELECT
      'investor'::text AS entity_type,
      i.id,
      i.name,
      i.slug,
      COALESCE(i.description, i.thesis) AS description,
      1 - (i.embedding <=> query_embedding) AS similarity,
      jsonb_build_object(
        'firm_type',    COALESCE(i.firm_type, 'vc'),
        'headquarters', i.headquarters,
        'fund_size',    i.fund_size,
        'website',      i.website,
        'thesis',       i.thesis,
        'tier',         i.tier
      ) AS metadata
    FROM investors i
    WHERE i.embedding IS NOT NULL
      AND entity_filter IN ('all', 'investor')
    ORDER BY i.embedding <=> query_embedding      -- index-accelerated ANN
    LIMIT match_count
  )
  SELECT r.entity_type, r.id, r.name, r.slug, r.description, r.similarity, r.metadata
  FROM (SELECT * FROM startup_hits UNION ALL SELECT * FROM investor_hits) r
  WHERE r.similarity >= match_threshold
  ORDER BY r.similarity DESC
  LIMIT LEAST(GREATEST(match_count, 1), 50);   -- hard cap: never return > 50
END;
$$;

COMMENT ON FUNCTION match_companies_and_funds(extensions.vector, integer, double precision, text) IS
  'Semantic retrieval for the AI Search & Q&A Engine. Given a 768-d query embedding (nomic-embed-text-v1.5, self-hosted TEI), returns the top `match_count` startups and/or investors by cosine similarity (>= match_threshold), newest-relevance-first. entity_filter narrows to one type. Type-specific fields ride in `metadata` jsonb so the contract is stable.';

GRANT EXECUTE ON FUNCTION match_companies_and_funds(extensions.vector, integer, double precision, text)
  TO anon, authenticated, service_role;
