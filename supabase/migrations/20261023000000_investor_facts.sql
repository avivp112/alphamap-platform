-- =============================================================================
-- "Check a company", stage 3: facts about the investors a check found.
--
-- Product decision (2026-10-21): no quality score — investors.tier is derived
-- from portfolio size, not performance. Instead, plain facts from AlphaMap's
-- own funding_rounds, per investor name:
--   companies   distinct companies it took part in
--   rounds      rounds it took part in
--   rounds_led  rounds it led
--   main_stages its three most frequent round types
-- plus the investors-directory row when the name matches one exactly.
--
-- Names match case- and space-insensitively, nothing looser: "Sequoia" and
-- "Sequoia Capital" are different names here. A miss shows as zero rounds,
-- which the app words as "not in AlphaMap's data yet" — never as a fact
-- about the investor.
--
-- Service role only (the check worker). Rollback:
-- supabase/rollback/20261023000000_investor_facts_down.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION investor_facts(p_names text[])
RETURNS TABLE (
  name text, investor_id uuid, investor_name text,
  companies integer, rounds integer, rounds_led integer, main_stages text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT DISTINCT ON (lower(btrim(n))) btrim(n) AS name, lower(btrim(n)) AS key
      FROM unnest(coalesce(p_names, '{}')) AS n
     WHERE btrim(coalesce(n, '')) <> ''
     LIMIT 50
  ), part AS (
    SELECT q.key, fr.id AS round_id, fr.startup_id, fr.round_type,
           lower(btrim(coalesce(fr.lead_investor, ''))) = q.key AS led
      FROM q
      JOIN funding_rounds fr
        ON lower(btrim(coalesce(fr.lead_investor, ''))) = q.key
        OR EXISTS (SELECT 1 FROM unnest(fr.investors) AS i WHERE lower(btrim(i)) = q.key)
  )
  SELECT q.name,
         inv.id,
         inv.name,
         count(DISTINCT p.startup_id)::integer,
         count(DISTINCT p.round_id)::integer,
         (count(DISTINCT p.round_id) FILTER (WHERE p.led))::integer,
         coalesce((
           SELECT array_agg(s.round_type ORDER BY s.c DESC, s.round_type)
             FROM (SELECT p2.round_type, count(*) AS c
                     FROM part p2
                    WHERE p2.key = q.key AND p2.round_type IS NOT NULL AND p2.round_type <> 'Other'
                    GROUP BY p2.round_type
                    ORDER BY count(*) DESC, p2.round_type
                    LIMIT 3) s
         ), '{}')
    FROM q
    LEFT JOIN part p ON p.key = q.key
    LEFT JOIN LATERAL (
      SELECT i.id, i.name FROM investors i WHERE lower(btrim(i.name)) = q.key ORDER BY i.id LIMIT 1
    ) inv ON true
   GROUP BY q.key, q.name, inv.id, inv.name
   ORDER BY q.name;
$$;

REVOKE ALL ON FUNCTION investor_facts(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION investor_facts(text[]) TO service_role;
