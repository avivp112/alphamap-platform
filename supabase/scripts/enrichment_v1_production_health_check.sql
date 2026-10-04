-- enrichment_v1_production_health_check.sql
--
-- READ-ONLY. No INSERT/UPDATE/DELETE anywhere in this file — every query
-- below is a SELECT. Safe to run against production as-is.
--
-- Purpose: estimate how widespread the failure modes found in Phase 0
-- (v2 rollout) actually are across the real `startups` table, not just the
-- 2-company golden set. Five checks, each its own section — Supabase's SQL
-- editor only shows the last statement's result when several are run
-- together, so run each section separately (select it, then Run).
--
-- Schema notes this file relies on (confirmed from supabase/migrations/):
--   startups.enrichment_confidence  integer 0-100, nullable, set by v1's
--     stamp step — NOT the same column name as EnrichmentResult's in-memory
--     confidence_score field.
--   startups.funding_history_complete  boolean, nullable.
--   startups.last_enriched_at  timestamptz, nullable — null means v1 has
--     never successfully stamped this row (never processed, or every pass
--     so far errored before reaching the stamp step).
--   funding_rounds.amount_raised  numeric, nullable.
--   funding_rounds.announcement_date  date, nullable.
--   There is no persisted `reasoning` column — v1 only logs it to stdout,
--   it's never written to the DB — so "reasoning empty" can't be checked
--   here. Treated as covered by the enrichment_confidence check instead.

-- ── 1. Confidence health (among rows v1 has actually processed) ───────────
-- Denominator is "ever enriched" (last_enriched_at is not null), not the
-- whole table — a never-touched row trivially has null confidence and that
-- is a queue/coverage fact, not a confidence-quality bug.
select
  count(*) filter (where enrichment_confidence = 0 or enrichment_confidence is null) as flagged,
  count(*)                                                                            as enriched_total,
  round(
    100.0 * count(*) filter (where enrichment_confidence = 0 or enrichment_confidence is null)
      / nullif(count(*), 0),
    1
  ) as pct_flagged
from startups
where last_enriched_at is not null;

-- ── 2. funding_history_complete = true but zero funding_rounds on file ────
-- The exact shape of the Apex/Fresha symptom: "confirmed complete" with
-- nothing to back it up.
select
  count(*) filter (
    where s.funding_history_complete = true and coalesce(fr.n_rounds, 0) = 0
  ) as flagged,
  count(*) as total,
  round(
    100.0 * count(*) filter (
      where s.funding_history_complete = true and coalesce(fr.n_rounds, 0) = 0
    ) / nullif(count(*), 0),
    1
  ) as pct_flagged
from startups s
left join (
  select startup_id, count(*) as n_rounds
  from funding_rounds
  group by startup_id
) fr on fr.startup_id = s.id;

-- ── 3. Possible duplicate rounds (the real APEX bug shape) ────────────────
-- Same startup, two DIFFERENT round rows, amounts within 10% of each other,
-- announcement dates within ~9 months (270 days). Lists the actual pairs —
-- read, don't just count, since a true duplicate (inflates total raised)
-- looks identical in this query to two genuinely separate same-size rounds
-- raised close together (rarer, but real) until a human reads round_type/
-- source_url for each side.
select
  s.id as startup_id,
  s.name as startup_name,
  a.id as round_a_id, a.round_type as round_a_type, a.amount_raised as round_a_amount,
  a.announcement_date as round_a_date, a.source_url as round_a_source,
  b.id as round_b_id, b.round_type as round_b_type, b.amount_raised as round_b_amount,
  b.announcement_date as round_b_date, b.source_url as round_b_source,
  abs(a.announcement_date - b.announcement_date) as days_apart
from funding_rounds a
join funding_rounds b
  on a.startup_id = b.startup_id
  and a.id < b.id  -- each pair reported once, never a row against itself
join startups s on s.id = a.startup_id
where a.amount_raised is not null and b.amount_raised is not null
  and a.amount_raised > 0 and b.amount_raised > 0
  and abs(a.amount_raised - b.amount_raised) / greatest(a.amount_raised, b.amount_raised) <= 0.10
  and a.announcement_date is not null and b.announcement_date is not null
  and abs(a.announcement_date - b.announcement_date) <= 270
order by s.name, days_apart;

-- Same check, collapsed to one row per affected company, for a quick count
-- before reading the full pair list above.
select count(distinct a.startup_id) as companies_with_possible_duplicate_rounds
from funding_rounds a
join funding_rounds b
  on a.startup_id = b.startup_id and a.id < b.id
where a.amount_raised is not null and b.amount_raised is not null
  and a.amount_raised > 0 and b.amount_raised > 0
  and abs(a.amount_raised - b.amount_raised) / greatest(a.amount_raised, b.amount_raised) <= 0.10
  and a.announcement_date is not null and b.announcement_date is not null
  and abs(a.announcement_date - b.announcement_date) <= 270;

-- ── 4. city/country sample check ───────────────────────────────────────────
-- No geo reference table exists in this schema, so this can't be fully
-- automated — two proxies instead:
--
-- 4a. Internal inconsistency: the same city name attached to more than one
--     DISTINCT non-null country is a near-certain data error (a real city
--     doesn't move countries), independent of any external reference data.
select city, count(distinct country) as distinct_countries, array_agg(distinct country) as countries
from startups
where city is not null and country is not null
group by city
having count(distinct country) > 1
order by distinct_countries desc, city;

-- 4b. Manual-eyeball sample: 40 random (city, country) pairs actually on
--     file, weighted toward less-common pairs (a typo is more likely to be
--     a one-off than part of a 50-row cluster). Read through this list for
--     anything that doesn't look like a real place.
select city, country, count(*) as n_startups
from startups
where city is not null and country is not null
group by city, country
order by n_startups asc, random()
limit 40;

-- ── 5. Headcount plausibility ───────────────────────────────────────────────
-- 5a. Flatly implausible headcount (catches the Fresha "140,000 employees"
--     bug shape directly, independent of funding).
select id, name, employee_count, employee_range, last_enriched_at
from startups
where employee_count > 20000
order by employee_count desc;

-- 5b. Headcount implausible RELATIVE to capital raised — more than 1
--     employee per $20K raised is well outside normal burn-rate ranges for
--     a private tech company at any stage.
select
  s.id, s.name, s.employee_count, tr.total_raised,
  round(s.employee_count / (tr.total_raised / 20000.0), 2) as employees_per_20k_raised
from startups s
join (
  select startup_id, sum(amount_raised) as total_raised
  from funding_rounds
  where amount_raised is not null
  group by startup_id
) tr on tr.startup_id = s.id
where s.employee_count is not null
  and tr.total_raised > 0
  and s.employee_count > tr.total_raised / 20000.0
order by employees_per_20k_raised desc;
