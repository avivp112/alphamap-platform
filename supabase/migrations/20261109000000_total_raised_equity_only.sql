-- =============================================================================
-- 20261109000000_total_raised_equity_only.sql
--
-- Total Raised counts equity only — never an acquisition, a secondary, a
-- buyout, an IPO or debt (owner, 2026-10-27). startups_search.total_raised
-- (the Private Market list, compare, peers) summed every funding_rounds row:
-- BETA's $169M Export-Import Bank loan, a $150M "Secondary", an acquisition
-- price. It now sums only rows whose capital_type (migration 20261107000000)
-- is 'equity' — the same rule as lib/enrichment/rounds.ts and src/lib/capital.ts.
--
-- How: the materialized view is rebuilt from its own current definition
-- (pg_get_viewdef) with that one sum filtered — together with every view
-- built on it, its indexes, the functions that return its row type, grants
-- and comments, exactly as the database has them (the method of
-- 20261005000000_update_embedding_vector_dimensions.sql). One statement: a
-- half-done run never leaves startups_search dropped. Anything else that
-- depends on it aborts the migration. Safe to re-run: once the sum is
-- filtered, nothing is rebuilt.
--
-- Needs 20261107000000_funding_capital_type.sql first.
-- Rollback: supabase/rollback/20261109000000_total_raised_equity_only_down.sql
-- =============================================================================

DO $$
DECLARE
  v_root   oid := 'public.startups_search'::regclass;
  v_def    text;
  v_newdef text;
  v_rels   oid[];
  v_types  oid[];
  v_funcs  oid[];
  v_stray  text;
  v_ddl    text[] := '{}';
  i        integer;
  r        record;
BEGIN
  v_def := regexp_replace(pg_get_viewdef(v_root, true), ';\s*$', '');
  IF v_def ~* 'capital_type' THEN
    RAISE NOTICE 'startups_search.total_raised already counts equity only — nothing to rebuild';
    RETURN;
  END IF;
  v_newdef := regexp_replace(v_def, 'sum\(fr\.amount_raised\)(\s+AS\s+total_raised)',
                             'sum(fr.amount_raised) FILTER (WHERE fr.capital_type = ''equity''::text)\1', 'i');
  IF v_newdef = v_def THEN
    RAISE EXCEPTION 'startups_search: the total_raised sum was not found in its definition — nothing changed';
  END IF;

  -- The view and every view built on it, deepest last.
  DROP TABLE IF EXISTS pg_temp._tr_rels;
  CREATE TEMP TABLE _tr_rels AS
  WITH RECURSIVE deps(relid, depth) AS (
    SELECT v_root, 0
    UNION
    SELECT rw.ev_class, deps.depth + 1
      FROM deps
      JOIN pg_depend d ON d.refobjid = deps.relid AND d.classid = 'pg_rewrite'::regclass AND d.deptype = 'n'
      JOIN pg_rewrite rw ON rw.oid = d.objid
     WHERE rw.ev_class <> deps.relid AND deps.depth < 10
  )
  SELECT relid, max(depth) AS depth FROM deps GROUP BY relid;

  SELECT array_agg(relid), array_agg(c.reltype) INTO v_rels, v_types
    FROM _tr_rels e JOIN pg_class c ON c.oid = e.relid;

  SELECT array_agg(p.oid) INTO v_funcs
    FROM pg_proc p
   WHERE p.prorettype = ANY (v_types)
      OR p.proargtypes::oid[] && v_types
      OR coalesce(p.proallargtypes, '{}') && v_types
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
    RAISE EXCEPTION 'these objects depend on startups_search and would be dropped without being recreated: %', v_stray;
  END IF;

  -- Record: views (shallowest first, startups_search with its new sum) with
  -- their indexes, then functions, then grants and comments.
  FOR r IN
    SELECT c.oid, c.relkind, c.reloptions, format('%I.%I', n.nspname, c.relname) AS qname,
           CASE WHEN c.oid = v_root THEN v_newdef ELSE regexp_replace(pg_get_viewdef(c.oid, true), ';\s*$', '') END AS def
      FROM _tr_rels e JOIN pg_class c ON c.oid = e.relid JOIN pg_namespace n ON n.oid = c.relnamespace
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
      SELECT pg_get_indexdef(ix.indexrelid) FROM pg_index ix WHERE ix.indrelid = r.oid ORDER BY ix.indexrelid);
  END LOOP;

  v_ddl := v_ddl || ARRAY(SELECT pg_get_functiondef(f) FROM unnest(coalesce(v_funcs, '{}')) f);

  v_ddl := v_ddl || ARRAY(
    SELECT format('GRANT %s ON %s TO %s', x.privilege_type, format('%I.%I', n.nspname, c.relname),
                  CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(x.grantee)) END)
      FROM _tr_rels e JOIN pg_class c ON c.oid = e.relid JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(c.relacl) x);

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
      FROM _tr_rels e JOIN pg_class c ON c.oid = e.relid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE obj_description(c.oid, 'pg_class') IS NOT NULL);

  v_ddl := v_ddl || ARRAY(
    SELECT format('COMMENT ON FUNCTION %s IS %L', p.oid::regprocedure, obj_description(p.oid, 'pg_proc'))
      FROM pg_proc p WHERE p.oid = ANY (coalesce(v_funcs, '{}')) AND obj_description(p.oid, 'pg_proc') IS NOT NULL);

  -- Drop the root; CASCADE takes the recorded views and functions with it.
  DROP MATERIALIZED VIEW public.startups_search CASCADE;

  -- Recreate everything recorded above, in order.
  FOR i IN 1 .. coalesce(array_length(v_ddl, 1), 0) LOOP
    EXECUTE v_ddl[i];
  END LOOP;
  DROP TABLE IF EXISTS pg_temp._tr_rels;
END;
$$;

-- Confirm: no company's Total Raised includes debt or a non-capital event any more.
SELECT count(*) AS companies_whose_total_changed
  FROM startups_search s
 WHERE EXISTS (SELECT 1 FROM funding_rounds fr WHERE fr.startup_id = s.id AND fr.capital_type <> 'equity' AND coalesce(fr.amount_raised, 0) > 0);
SELECT name, total_raised FROM startups_search WHERE name ILIKE 'BETA%' ORDER BY name LIMIT 5;
