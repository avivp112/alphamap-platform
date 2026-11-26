-- vc_funds_stage0_names.sql — stage 0, READ ONLY (SELECT only). Run in the Supabase SQL Editor; export each result as CSV.

-- ── Query A (the main one): every investor name that appears in a round ────────────────────────────────────────
-- lead_investor is split on , and ; but NOT before a legal suffix ("Bain Capital, LP" stays one name).
-- Names are grouped by lower(btrim(name)) only; merging is decided locally by lib/funds/investorNames.ts.
-- Export as: names.csv
WITH leads AS (
  SELECT fr.id AS round_id, btrim(x) AS name
    FROM funding_rounds fr,
         LATERAL regexp_split_to_table(
           coalesce(fr.lead_investor, ''),
           '\s*[,;](?!\s*(?:l\.?p\.?|llc|l\.l\.c\.|inc\.?|ltd\.?|llp|gmbh|limited)(?:\s|,|;|$))\s*', 'i') AS x
   WHERE btrim(x) <> ''
), parts AS (
  SELECT fr.id AS round_id, btrim(n) AS name
    FROM funding_rounds fr, LATERAL unnest(coalesce(fr.investors, '{}'::text[])) AS n
   WHERE btrim(n) <> ''
), per_round AS (
  SELECT round_id, lower(name) AS k, min(name) AS name, bool_or(is_lead) AS is_lead
    FROM (SELECT round_id, name, true AS is_lead FROM leads
          UNION ALL SELECT round_id, name, false FROM parts) u
   GROUP BY round_id, lower(name)
)
SELECT min(p.name)                                              AS name,
       count(*)                                                 AS rounds,
       count(DISTINCT r.startup_id)                             AS startups,
       count(*) FILTER (WHERE p.is_lead)                        AS rounds_led,
       max(r.announcement_date)                                 AS last_round,
       count(*) FILTER (WHERE r.announcement_date >= current_date - interval '24 months') AS rounds_24m,
       count(*) FILTER (WHERE r.announcement_date >= current_date - interval '12 months') AS rounds_12m
  FROM per_round p JOIN funding_rounds r ON r.id = p.round_id
 GROUP BY p.k
 ORDER BY rounds DESC;

-- ── Query B: does lead_investor really hold several names? (a check on the split above) ──────────────────────────
SELECT count(*) FILTER (WHERE lead_investor ~ '[,;]')                      AS leads_with_separator,
       count(*) FILTER (WHERE lead_investor ~* ',\s*(l\.?p\.?|llc|inc\.?|ltd\.?|llp|gmbh|limited)(\s|,|;|$)') AS leads_with_legal_suffix_comma,
       count(*)                                                            AS leads_total
  FROM funding_rounds WHERE lead_investor IS NOT NULL;
SELECT lead_investor FROM funding_rounds WHERE lead_investor ~ '[,;]' ORDER BY random() LIMIT 25;

-- ── Query C: volume for the role-verification run (sizes the cost estimate) ───────────────────────────────────────
SELECT
  count(*) FILTER (WHERE announcement_date >= current_date - interval '12 months')                                   AS rounds_12m,
  count(*) FILTER (WHERE announcement_date >= current_date - interval '24 months')                                   AS rounds_24m,
  count(*) FILTER (WHERE announcement_date >= current_date - interval '24 months' AND (lead_investor IS NOT NULL OR cardinality(investors) > 0)) AS rounds_24m_with_investors,
  count(*) FILTER (WHERE announcement_date >= current_date - interval '24 months' AND lead_investor IS NOT NULL)     AS rounds_24m_with_lead,
  count(*) FILTER (WHERE announcement_date >= current_date - interval '24 months' AND source_url IS NOT NULL)        AS rounds_24m_with_source_url,
  count(*) FILTER (WHERE announcement_date IS NULL)                                                                  AS rounds_without_date,
  count(*) FILTER (WHERE capital_type IS DISTINCT FROM 'equity')                                                     AS rounds_not_equity
  FROM funding_rounds;
SELECT capital_type, count(*) FROM funding_rounds GROUP BY 1 ORDER BY 2 DESC;
