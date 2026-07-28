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
--   ARRAYS are the exception, and they are still additive: text[] and jsonb
--   arrays are UNIONed rather than replaced, because a union is strictly richer
--   and cannot lose anything the survivor had. jsonb OBJECTS are not merged —
--   combining two objects key-by-key means picking a winner per key, which is
--   an overwrite wearing a different hat.
--
--   KNOWN LIMITATION of gap-fill-only, worth stating rather than discovering:
--   a column with a NOT NULL default is never "empty", so it never fills. If
--   the survivor has is_serial_founder = false (the default, meaning nobody
--   looked) and the merged row has true (meaning somebody did), the false wins
--   and the finding is lost. Distinguishing "checked and false" from "never
--   checked" is impossible without a third state, and inferring one would
--   violate the never-overwrite rule outright. Such columns appear in
--   skipped_columns, so the loss is at least visible in the audit.
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
--   BUT DISCOVERY HAS A BLIND SPOT, and it is not a small one. A POLYMORPHIC
--   reference — watchlist_items holds either a startup or an investor id in one
--   entity_id column — cannot have a foreign key at all, because Postgres
--   cannot reference two tables from one constraint. pg_constraint therefore
--   knows nothing about it.
--
--   Without explicit handling, merging a company leaves every user's watchlist
--   entry pointing at a deleted row. Nothing errors; the watchlist just shows a
--   company that will not open. Those references are listed by hand in the
--   second repoint loop, and that list has to be maintained — there is nothing
--   to discover.
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
 * Repoint every row in one table from the merged company to the survivor.
 *
 * Returns {"moved": n, "dropped": n}.
 *
 * ── WHY THIS IS ROW-AT-A-TIME ON COLLISION ─────────────────────────────────
 * The obvious implementation is one UPDATE, and on unique_violation delete the
 * loser's rows. That is wrong, and wrong in a way that quietly loses user data:
 * a single colliding row aborts the whole statement, and the blanket DELETE
 * then removes every row for the merged company — including the ones that had
 * no conflict at all and would have repointed cleanly.
 *
 * Observed before the fix: a user who had watchlisted ONLY the duplicate lost
 * their entry entirely, because a DIFFERENT user happened to have watchlisted
 * both.
 *
 * So the bulk path is tried first (fast, and the common case), and only on a
 * collision does it fall back to per-row: update what can move, delete only
 * what genuinely conflicts.
 */
CREATE OR REPLACE FUNCTION repoint_startup_refs(
  p_table     text,
  p_id_column text,
  p_survivor  uuid,
  p_loser     uuid,
  p_extra_col text DEFAULT NULL,
  p_extra_val text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_where text;
  v_pk    text;
  v_moved bigint := 0;
  v_drop  bigint := 0;
  r       record;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RETURN jsonb_build_object('moved', 0, 'dropped', 0);
  END IF;

  v_where := format('%I = %L', p_id_column, p_loser);
  IF p_extra_col IS NOT NULL THEN
    v_where := v_where || format(' AND %I = %L', p_extra_col, p_extra_val);
  END IF;

  -- Fast path.
  BEGIN
    EXECUTE format('UPDATE %I SET %I = %L WHERE %s', p_table, p_id_column, p_survivor, v_where);
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RETURN jsonb_build_object('moved', v_moved, 'dropped', 0);
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- fall through
  END;

  -- Precise path. Needs a single-column primary key to address rows
  -- individually; without one there is no safe way to be surgical, so the
  -- blanket behaviour is kept and reported honestly as such.
  SELECT a.attname INTO v_pk
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
   WHERE i.indrelid = ('public.' || p_table)::regclass
     AND i.indisprimary
     AND array_length(i.indkey::int[], 1) = 1;

  IF v_pk IS NULL THEN
    EXECUTE format('DELETE FROM %I WHERE %s', p_table, v_where);
    GET DIAGNOSTICS v_drop = ROW_COUNT;
    RETURN jsonb_build_object('moved', 0, 'dropped', v_drop, 'note', 'no single-column PK; blanket delete');
  END IF;

  FOR r IN EXECUTE format('SELECT %I AS pk FROM %I WHERE %s', v_pk, p_table, v_where)
  LOOP
    BEGIN
      EXECUTE format('UPDATE %I SET %I = %L WHERE %I = %L',
                     p_table, p_id_column, p_survivor, v_pk, r.pk);
      v_moved := v_moved + 1;
    EXCEPTION WHEN unique_violation THEN
      -- This specific row would duplicate one the survivor already has.
      EXECUTE format('DELETE FROM %I WHERE %I = %L', p_table, v_pk, r.pk);
      v_drop := v_drop + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('moved', v_moved, 'dropped', v_drop);
END;
$$;

COMMENT ON FUNCTION repoint_startup_refs(text,text,uuid,uuid,text,text) IS
  'Moves one table''s rows from a merged company to the survivor. Falls back from a bulk UPDATE to per-row on a unique collision, so rows that do NOT conflict are never collateral damage — the failure mode a blanket delete produces silently.';

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
       -- search_tsv is derived from other columns by trigger and regenerates
       -- itself on the updated_at write at the end of this function. Copying a
       -- stale one in would make the survivor briefly searchable under the
       -- merged company's terms and is pure noise.
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
-- SECURITY INVOKER, so it cannot exceed the caller's own rights — but it is a
-- dynamic-SQL surface that exists only to serve merge_companies(), and inside
-- that SECURITY DEFINER function it runs as the definer regardless of grants.
-- Nothing outside should be able to reach it.
REVOKE ALL ON FUNCTION repoint_startup_refs(text,text,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION unmerge_company(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION company_richness(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION merge_companies(uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION unmerge_company(uuid, text) TO service_role;
