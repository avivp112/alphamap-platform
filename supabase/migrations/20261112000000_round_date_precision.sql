-- How much of a round's announcement_date its source states (owner,
-- 2026-10-29): a year-only round is stored as YYYY-01-01 and must be shown
-- as the year, never as January. NULL = not recorded (older rows): shown as before.
alter table public.funding_rounds add column if not exists announcement_date_precision text
  check (announcement_date_precision in ('day', 'month', 'year'));
