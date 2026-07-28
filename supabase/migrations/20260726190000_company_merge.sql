-- =============================================================================
-- Migration: physical company merge, reversible and non-destructive
-- Created:   2026-07-26
-- Description:
--   Two startups rows describing one company become one row, with every
--   dependent record repointed and the whole thing undoable.
--
-- ── THE RULE: GAP-FILL ONLY. NEVER OVERWRITE. ───────────────────────────────
--   A column on the surviving row is written ONLY if it is currently NULL (or
--   an empty string / empty array). If the survivor already holds a value, the
--   merged row's value is discarded and the column name is recorded in
--   skipped_columns.
--
--   This is not caution for its own sake. Enrichment is expensive and often
--   manual: descriptions, investor tiers, funding history, sector assignments.
--   A merge that overwrites an enriched description with a government
--   registry's blank-ish one destroys work that cost real money, and does it
--   silently. Filling a gap can only add.
--
--   Text arrays are the one exception, and they are still additive: founders,
--   patent_fields and similar are UNIONed rather than replaced, because a union
--   is strictly richer and cannot lose anything the survivor had.
--
-- ── WHICH ROW SURVIVES IS COMPUTED, NOT CHOSEN ──────────────────────────────
--   company_richness() counts populated fields, weighting the expensive ones —
--   an embedding, a description, funding history. The richer row survives.
--   Picking arbitrarily (say, the older id) would sometimes make the thin row
--   the survivor, and gap-fill-only would then leave most of the good data
--   stranded in the row about to be deleted.
--
-- ── FOREIGN KEYS ARE DISCOVERED, NOT LISTED ─────────────────────────────────
--   There are nine FK references to startups across the migration history and
--   there will be more. A hard-coded list would be wrong the first time someone
--   adds a table and would fail silently — orphaning rows rather than erroring.
--   merge_companies() reads pg_constraint at run time, so it repoints whatever
--   exists today.
--
--   Repointing can violate a unique constraint (two watchlist rows for the same
--   user, one per duplicate company). Those collisions are resolved by deleting
--   the losing row and counting it, never by aborting the merge.
--
-- ── REVERSIBILITY ───────────────────────────────────────────────────────────
--   company_merges stores the complete pre-merge row as jsonb. unmerge_company()
--   restores it. What it CANNOT restore is which dependent rows originally
--   belonged to the merged company — repointing is one-way, because a FK column
--   holds one value and the old one is gone. Reversal therefore returns the
--   entity, not the relationships. That limitation is stated in the function
--   comment rather than discovered by someone relying on it.
--
-- Rollback: supabase/rollback/20260726190000_company_merge_down.sql
-- Tests:    supabase/tests/entity_resolution.test.sql
--
-- Idempotent.
-- =============================================================================

/**
 * How much enrichment does this row carry?
 *
 * Weighted, because the fields are not equally expensive to obtain. An
 * embedding costs an OpenAI call; a country code costs nothing. Weighting by
 * cost-to-reacquire means the survivor is the row that would hurt most to lose.
 */
CREATE OR REPLACE FUNCTION company_richness(p_startup_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r        record;
  score    integer := 0;
  col      text;
  weights  jsonb := '{
    "embedding": 10, "description": 8, "website": 6, "founded_year": 4,
    "industry": 3, "sector_id": 3, "employee_count": 3, "logo_url": 2,
    "linkedin_url": 3, "country": 1, "city": 1, "slug": 2
  }'::jsonb;
  v        jsonb;
BEGIN
  SELECT to_jsonb(s) INTO v FROM startups s WHERE s.id = p_startup_id;
  IF v IS NULL THEN RETURN 0; END IF;

  -- Weighted columns.
  FOR col IN SELECT jsonb_object_keys(weights) LOOP
    IF v ? col AND v->>col IS NOT NULL AND btrim(v->>col) <> '' THEN
      score := score + (weights->>col)::int;
    END IF;
  END LOOP;

  -- Everything else counts 1, so a row rich in columns this function has never
  -- heard of still outranks an empty one. New columns need no code change.
  SELECT score + count(*)::int INTO score
    FROM jsonb_each_text(v) e
   WHERE e.key NOT IN ('id','created_at','updated_at')
     AND NOT (weights ? e.key)
     AND e.value IS NOT NULL AND btrim(e.value) <> '';

  -- Relationships are enrichment too, and the most expensive kind.
  SELECT score
       + 5 * (SELECT count(*) FROM funding_rounds  f WHERE f.startup_id = p_startup_id)
       + 3 * (SELECT count(*) FROM raw_gov_filings g WHERE g.startup_id = p_startup_id)
       + 4 * (SELECT count(*) FROM sourcing_companies c WHERE c.startup_id = p_startup_id)
    INTO score;

  RETURN score;
END;
$$;

COMMENT ON FUNCTION company_richness(uuid) IS
  'Weighted count of populated fields and attached records, weighted by cost-to-reacquire. Decides which row survives a merge, so that gap-fill-only never strands good data in the row being deleted.';

/**
 * Merge p_merged_id into p_surviving_id. Returns the audit row id.
 *
 * Pass NULL for p_surviving_id to let company_richness() choose — which is the
 * intended usage. Explicit survivor selection exists for the review queue,
 * where a human may know something the score does not.
 */
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

  -- ── Column-by-column gap fill ─────────────────────────────────────────────
  -- Driven off information_schema so a new column is handled without touching
  -- this function.
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
       AND a.attname NOT IN ('id', 'created_at', 'updated_at')
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
    BEGIN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', rec.tbl, rec.col, rec.col)
        USING v_survivor, v_loser;
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      -- Both companies had a row that would collide once repointed — the same
      -- user watchlisting both, say. Drop the loser's and count it. Aborting
      -- the whole merge over a duplicate watchlist entry would be absurd.
      EXECUTE format('DELETE FROM %s WHERE %I = $1', rec.tbl, rec.col) USING v_loser;
      GET DIAGNOSTICS n = ROW_COUNT;
      v_repointed := v_repointed || jsonb_build_object(rec.tbl || '.' || rec.col || ' (collided, deleted)', n);
      CONTINUE;
    END;
    IF n > 0 THEN
      v_repointed := v_repointed || jsonb_build_object(rec.tbl || '.' || rec.col, n);
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

/**
 * Undo a merge: restore the deleted company from its snapshot.
 *
 * WHAT THIS DOES NOT DO, stated plainly: it cannot return the dependent rows
 * that were repointed. A foreign key column holds one value, and the old one
 * was overwritten — the information is gone. Reversal restores the ENTITY, not
 * its relationships. It also cannot un-fill columns, because by then a later
 * enrichment may have refined them and blanking those would destroy newer work.
 *
 * So this is a safety net for "we merged the wrong pair", recovering the
 * company record itself, not a transaction rollback.
 */
CREATE OR REPLACE FUNCTION unmerge_company(p_merge_id uuid, p_by text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m       record;
  cols    text;
  vals    text;
  new_id  uuid;
BEGIN
  SELECT * INTO m FROM company_merges WHERE id = p_merge_id;
  IF m IS NULL THEN
    RAISE EXCEPTION 'unmerge_company: no merge record %', p_merge_id;
  END IF;
  IF m.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'unmerge_company: merge % was already reversed at %', p_merge_id, m.reversed_at;
  END IF;
  IF EXISTS (SELECT 1 FROM startups WHERE id = m.merged_id) THEN
    RAISE EXCEPTION 'unmerge_company: startup % already exists — nothing to restore', m.merged_id;
  END IF;

  -- Restore only columns that still exist, so a snapshot taken before a schema
  -- change can still be restored.
  -- format_type() again, for the same reason as merge_companies().
  SELECT string_agg(quote_ident(k.key), ', '),
         string_agg(format('($1->>%L)::%s', k.key, format_type(a.atttypid, a.atttypmod)), ', ')
    INTO cols, vals
    FROM jsonb_object_keys(m.merged_snapshot) k(key)
    JOIN pg_attribute a
      ON a.attrelid = 'public.startups'::regclass
     AND a.attname = k.key
     AND a.attnum > 0 AND NOT a.attisdropped
   WHERE m.merged_snapshot->>k.key IS NOT NULL;

  EXECUTE format('INSERT INTO startups (%s) VALUES (%s) RETURNING id', cols, vals)
    USING m.merged_snapshot INTO new_id;

  UPDATE company_merges
     SET reversed_at = now(),
         evidence = evidence || jsonb_build_object('reversed_by', p_by)
   WHERE id = p_merge_id;

  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION unmerge_company(uuid, text) IS
  'Restores a merged-away company from its snapshot. Does NOT restore repointed dependent rows — a foreign key holds one value and the old one is gone — nor un-fill columns, since later enrichment may have refined them. A safety net for a wrong pairing, not a transaction rollback.';

REVOKE ALL ON FUNCTION company_richness(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION unmerge_company(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION company_richness(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION unmerge_company(uuid, text) TO service_role;
