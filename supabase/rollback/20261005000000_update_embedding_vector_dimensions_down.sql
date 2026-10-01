-- Rollback for 20261005000000_update_embedding_vector_dimensions.sql
--
-- Restores the pre-migration SCHEMA shape (vector(1536) columns, indexes, and
-- the match_companies_and_funds() signature) exactly as
-- 20260721000000_semantic_search_pgvector.sql left it. This is a schema
-- rollback only, not a data recovery: embeddings are nulled on the way up
-- AND on the way back down, because a 768-d Nomic vector and a 1536-d OpenAI
-- vector are different coordinate spaces in either direction — there is no
-- value-preserving cast either way. Rolling back restores the ABILITY to
-- store OpenAI-shaped vectors again; the actual values still need a fresh
-- backfill run against whichever provider is configured afterwards.

-- 1. ── Drop the HNSW indexes before changing column type back ───────────────
DROP INDEX IF EXISTS idx_startups_embedding_hnsw;
DROP INDEX IF EXISTS idx_investors_embedding_hnsw;

-- 2. ── Revert column type on all three embedding-bearing tables ─────────────
ALTER TABLE startups
  ALTER COLUMN embedding TYPE extensions.vector(1536) USING NULL;

ALTER TABLE investors
  ALTER COLUMN embedding TYPE extensions.vector(1536) USING NULL;

ALTER TABLE user_preference_vectors
  ALTER COLUMN embedding TYPE extensions.vector(1536) USING NULL;

-- 3. ── Reset bookkeeping so the backfill queue re-processes every row ────────
UPDATE startups  SET embedding_source_hash = NULL, embedding_updated_at = NULL
 WHERE embedding_source_hash IS NOT NULL OR embedding_updated_at IS NOT NULL;

UPDATE investors SET embedding_source_hash = NULL, embedding_updated_at = NULL
 WHERE embedding_source_hash IS NOT NULL OR embedding_updated_at IS NOT NULL;

-- 4. ── Recreate the two HNSW indexes against the restored vector(1536) columns
CREATE INDEX IF NOT EXISTS idx_startups_embedding_hnsw
  ON startups USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_investors_embedding_hnsw
  ON investors USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 5. ── Restore original column comments ──────────────────────────────────────
COMMENT ON COLUMN startups.embedding IS
  'OpenAI text-embedding-3-small (1536-d) embedding of the company''s semantic profile (name + industry + description). Populated by scripts/backfill_embeddings.ts. NULL = not yet embedded.';
COMMENT ON COLUMN investors.embedding IS
  'OpenAI text-embedding-3-small (1536-d) embedding of the firm''s semantic profile (name + description + thesis). Populated by scripts/backfill_embeddings.ts. NULL = not yet embedded.';
COMMENT ON COLUMN user_preference_vectors.embedding IS
  'Same 1536-dim space as startups.embedding/investors.embedding (20260721000000_semantic_search_pgvector) — a meaningful centroid of real company embeddings the user has engaged with, never a hand-rolled weighted-tag vector. No HNSW index here: queries always go startups.embedding <=> (this one user''s vector), which uses the existing index on startups, not one on this table.';

-- 6. ── Recreate match_companies_and_funds() with its original vector(1536) parameter
-- Kept VOLATILE (not reverted to the original STABLE) deliberately: STABLE +
-- this body's `SET LOCAL hnsw.ef_search` is rejected outright by PostgreSQL
-- ("SET is not allowed in a non-volatile function") — a pre-existing bug
-- fixed in the forward migration, independent of the vector dimension this
-- rollback is undoing. Reverting it would just reintroduce a function that
-- errors on every call, which serves no rollback purpose.
DROP FUNCTION IF EXISTS match_companies_and_funds(extensions.vector, integer, double precision, text);

CREATE FUNCTION match_companies_and_funds(
  query_embedding extensions.vector(1536),
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
  SET LOCAL hnsw.ef_search = 100;

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
    ORDER BY s.embedding <=> query_embedding
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
    ORDER BY i.embedding <=> query_embedding
    LIMIT match_count
  )
  SELECT r.entity_type, r.id, r.name, r.slug, r.description, r.similarity, r.metadata
  FROM (SELECT * FROM startup_hits UNION ALL SELECT * FROM investor_hits) r
  WHERE r.similarity >= match_threshold
  ORDER BY r.similarity DESC
  LIMIT LEAST(GREATEST(match_count, 1), 50);
END;
$$;

COMMENT ON FUNCTION match_companies_and_funds(extensions.vector, integer, double precision, text) IS
  'Semantic retrieval for the AI Search & Q&A Engine. Given a 1536-d query embedding, returns the top `match_count` startups and/or investors by cosine similarity (>= match_threshold), newest-relevance-first. entity_filter narrows to one type. Type-specific fields ride in `metadata` jsonb so the contract is stable.';

GRANT EXECUTE ON FUNCTION match_companies_and_funds(extensions.vector, integer, double precision, text)
  TO anon, authenticated, service_role;
