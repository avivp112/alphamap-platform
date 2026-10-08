-- =============================================================================
-- Migration: merge_companies frees unique values; stop weekly-startup-enrichment
-- Created:   2026-10-12
-- Description:
--   Found by the pipeline monitoring added in 20261011000000 (cron history):
--
--   1. resolve-tier1-identity has failed on every run:
--        duplicate key value violates unique constraint "uq_startups_slug"
--        Key (slug)=(digicert) already exists.
--        ... UPDATE startups SET slug = ($2->>'slug')::text WHERE id = $1
--      merge_companies() gap-fills the survivor's empty slug from the company
--      being merged away — while that row still holds the slug. One collision
--      aborts the whole batch, so no Tier 1 merge has ever completed.
--      Fix: clear every single-column unique value on the loser before the
--      gap fill (the loser is deleted at the end anyway; the snapshot keeps
--      its values for the audit row and unmerge_company()). The rest of the
--      function is the current 20260726190000_company_merge.sql version.
--
--   2. weekly-startup-enrichment — a job created by hand in the database (it
--      is in no migration) running CALL run_enrichment() — fails on every run:
--        column "body" does not exist ... FROM net._http_response
--      (pg_net's column is "content"). It is the old v1 enrichment path, and
--      automatic enrichment must not run on v1 (it waits for v2). The job is
--      unscheduled; run_enrichment() itself is left untouched.
--
-- Rollback: supabase/rollback/20261012000000_merge_unique_values_and_cron_cleanup_down.sql
-- Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION merge_companies(
  p_a          uuid,
  p_b          uuid,
  p_surviving_id uuid DEFAULT NULL,
  p_evidence   jsonb DEFAULT '{}'::jsonb,
  p_merged_by  text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survivor  uuid;
  v_loser     uuid;
  v_snapshot  jsonb;
  v_survivor_row jsonb;
  v_filled    text[] := '{}';
  v_skipped   text[] := '{}';
  v_repointed jsonb  := '{}'::jsonb;
  v_merge_id  uuid;
  rec         record;
  col         text;
  coltype     text;
  n           bigint;
  v_res       jsonb;
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RAISE EXCEPTION 'merge_companies: need two distinct startup ids (got %, %)', p_a, p_b;
  END IF;

  -- Decide the survivor before touching anything.
  IF p_surviving_id IS NOT NULL THEN
    IF p_surviving_id NOT IN (p_a, p_b) THEN
      RAISE EXCEPTION 'merge_companies: p_surviving_id % is neither of the two rows', p_surviving_id;
    END IF;
    v_survivor := p_surviving_id;
    v_loser    := CASE WHEN p_surviving_id = p_a THEN p_b ELSE p_a END;
  ELSIF company_richness(p_a) >= company_richness(p_b) THEN
    v_survivor := p_a; v_loser := p_b;
  ELSE
    v_survivor := p_b; v_loser := p_a;
  END IF;

  SELECT to_jsonb(s) INTO v_snapshot FROM startups s WHERE s.id = v_loser;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'merge_companies: startup % does not exist', v_loser;
  END IF;
  SELECT to_jsonb(s) INTO v_survivor_row FROM startups s WHERE s.id = v_survivor;
  IF v_survivor_row IS NULL THEN
    RAISE EXCEPTION 'merge_companies: startup % does not exist', v_survivor;
  END IF;

  -- ── Free the loser's unique values before the gap fill ─────────────────────
  -- A column with its own unique index (slug) cannot be gap-filled onto the
  -- survivor while the row being merged away still holds the same value:
  -- "duplicate key value violates unique constraint uq_startups_slug" aborted
  -- every resolve_tier1 run (DigiCert). The loser is deleted at the end of
  -- this function anyway, and v_snapshot above keeps its values for the audit
  -- row and for unmerge_company().
  FOR col IN
    SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
     WHERE i.indrelid = 'public.startups'::regclass
       AND i.indisunique AND NOT i.indisprimary
       AND i.indnkeyatts = 1
       AND NOT a.attnotnull
       AND a.attgenerated = ''
  LOOP
    EXECUTE format('UPDATE startups SET %I = NULL WHERE id = $1', col) USING v_loser;
  END LOOP;

  -- ── Column-by-column gap fill ─────────────────────────────────────────────
  -- Driven off the catalogue, so a new column is handled without touching this
  -- function.
  --
  -- pg_attribute + format_type(), NOT information_schema.data_type. For a
  -- user-defined type like vector(1536) data_type returns the literal string
  -- 'USER-DEFINED', and for text[] it returns 'ARRAY' — casting to either is a
  -- syntax error. format_type() returns the real declared type WITH its
  -- modifiers, which is what a cast needs. This surfaced the moment the schema
  -- contained a pgvector column.
  FOR rec IN
    SELECT a.attname                                AS column_name,
           format_type(a.atttypid, a.atttypmod)     AS decl_type,
           t.typname                                AS udt_name
      FROM pg_attribute a
      JOIN pg_type t ON t.oid = a.atttypid
     WHERE a.attrelid = 'public.startups'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attgenerated = ''
       -- attgenerated = '' above already excludes search_tsv, which is
       -- GENERATED ALWAYS AS (...) STORED and recomputes itself from name,
       -- industry and description. Naming it here is belt-and-braces: if it
       -- were ever redefined as a plain trigger-maintained column, copying a
       -- stale value in would make the survivor briefly searchable under the
       -- merged company's terms.
       AND a.attname NOT IN ('id', 'created_at', 'updated_at', 'search_tsv')
     ORDER BY a.attnum
  LOOP
    col     := rec.column_name;
    coltype := rec.udt_name;

    -- Nothing to take.
    CONTINUE WHEN v_snapshot->>col IS NULL OR btrim(coalesce(v_snapshot->>col, '')) IN ('', '[]', '{}');

    IF coltype = '_text' THEN
      -- Text arrays UNION. Strictly additive: the survivor keeps everything it
      -- had and gains what it lacked, so this cannot lose data even though it
      -- writes over a non-null value.
      EXECUTE format(
        'UPDATE startups SET %I = (
           SELECT array_agg(DISTINCT x) FROM (
             SELECT unnest(coalesce(%I, ''{}'')) AS x FROM startups WHERE id = $1
             UNION
             SELECT unnest(coalesce((SELECT array_agg(y) FROM jsonb_array_elements_text($2->%L) y), ''{}''))
           ) u WHERE x IS NOT NULL
         ) WHERE id = $1', col, col, col)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || (col || ' (union)');

    ELSIF coltype = 'jsonb'
      AND jsonb_typeof(v_snapshot->col) = 'array'
      AND jsonb_typeof(v_survivor_row->col) = 'array' THEN
      -- jsonb ARRAYS union too, for the same reason text arrays do.
      --
      -- This branch exists because `founders` is jsonb, not text[] — it was
      -- migrated (founders text[] -> founders_jsonb jsonb -> renamed back).
      -- Without it, founders fell through to gap-fill-only and a merge silently
      -- discarded every founder the survivor did not already list. Which is
      -- precisely the data loss the gap-fill rule exists to prevent, arriving
      -- through the one column most likely to matter.
      --
      -- Deliberately array-only, checked at RUN TIME rather than by column
      -- type: `leadership`, `data_sources` and `investor_amounts` are jsonb
      -- OBJECTS, and merging two objects key-by-key means choosing a winner per
      -- key — an overwrite by another name. Objects stay gap-fill-only.
      EXECUTE format(
        'UPDATE startups SET %I = (
           SELECT jsonb_agg(DISTINCT e) FROM (
             SELECT jsonb_array_elements(%I) AS e FROM startups WHERE id = $1
             UNION
             SELECT jsonb_array_elements($2->%L)
           ) u
         ) WHERE id = $1', col, col, col)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || (col || ' (jsonb union)');

    ELSIF v_survivor_row->>col IS NULL OR btrim(coalesce(v_survivor_row->>col, '')) = '' THEN
      -- THE GAP FILL. Only ever writes into a hole.
      EXECUTE format('UPDATE startups SET %I = ($2->>%L)::%s WHERE id = $1',
                     col, col, rec.decl_type)
        USING v_survivor, v_snapshot;
      v_filled := v_filled || col;

    ELSE
      -- Survivor already has a value. Leave it alone and say so.
      v_skipped := v_skipped || col;
    END IF;
  END LOOP;

  -- ── Repoint every foreign key that references startups ────────────────────
  FOR rec IN
    SELECT con.conrelid::regclass::text AS tbl,
           att.attname                  AS col
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f'
       AND con.confrelid = 'startups'::regclass
       AND con.conrelid <> 'startups'::regclass
  LOOP
    v_res := repoint_startup_refs(
      regexp_replace(rec.tbl, '^public\.', ''), rec.col, v_survivor, v_loser);
    IF (v_res->>'moved')::bigint > 0 OR (v_res->>'dropped')::bigint > 0 THEN
      v_repointed := v_repointed || jsonb_build_object(rec.tbl || '.' || rec.col, v_res);
    END IF;
  END LOOP;

  -- ── Polymorphic references, which pg_constraint CANNOT find ───────────────
  -- The FK sweep above is blind to a column that points at startups without a
  -- foreign key. That is not an oversight in those tables — watchlist_items
  -- holds either a startup or an investor id in one column, and Postgres has no
  -- way to reference two tables from one constraint. The table's own comment
  -- says as much.
  --
  -- The consequence if this loop did not exist: merging a company leaves every
  -- user's watchlist entry pointing at a row that no longer exists. Nothing
  -- errors. The watchlist simply shows a company that cannot be opened.
  --
  -- This list therefore MUST be maintained by hand — there is nothing in the
  -- catalogue to discover. A new polymorphic reference to startups has to be
  -- added here, and the cost of forgetting is silent breakage.
  FOR rec IN
    SELECT * FROM (VALUES
      -- table,                    id column,   discriminator, value for a company
      ('watchlist_items',          'entity_id', 'entity_type', 'startup'),
      ('entity_match_candidates',  'left_id',   'left_kind',   'startup')
      -- company_merges.merged_id is deliberately NOT here: it points at a row
      -- that has been deleted on purpose, and repointing it would destroy the
      -- audit trail this whole function depends on.
    ) AS t(tbl, idcol, typecol, typeval)
  LOOP
    v_res := repoint_startup_refs(rec.tbl, rec.idcol, v_survivor, v_loser,
                                  rec.typecol, rec.typeval);
    IF (v_res->>'moved')::bigint > 0 OR (v_res->>'dropped')::bigint > 0 THEN
      v_repointed := v_repointed
        || jsonb_build_object(rec.tbl || '.' || rec.idcol || ' (polymorphic)', v_res);
    END IF;
  END LOOP;

  -- Record BEFORE deleting, so the audit exists even if the delete fails.
  INSERT INTO company_merges (
    surviving_id, merged_id, merged_snapshot, filled_columns, skipped_columns,
    repointed, evidence, merged_by
  ) VALUES (
    v_survivor, v_loser, v_snapshot, v_filled, v_skipped, v_repointed, p_evidence, p_merged_by
  ) RETURNING id INTO v_merge_id;

  DELETE FROM startups WHERE id = v_loser;

  UPDATE startups SET updated_at = now() WHERE id = v_survivor;

  RETURN v_merge_id;
END;
$$;

COMMENT ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) IS
  'Merges two startups rows. Columns are GAP-FILLED ONLY — an existing value on the survivor is never overwritten, only recorded in skipped_columns; text arrays are unioned, which is additive. The survivor is chosen by company_richness() unless named explicitly. Foreign keys are discovered from pg_constraint at run time, so tables added later are handled without editing this function.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-startup-enrichment') THEN
    PERFORM cron.unschedule('weekly-startup-enrichment');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) TO service_role;
