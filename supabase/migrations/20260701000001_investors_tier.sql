-- Add a `tier` column to investors (1 = top-tier, 3 = long-tail) so the
-- AlphaMap scoring engine can compute a real Ecosystem Signal from WHO backed
-- a startup, instead of relying on a manually-set startups.investor_tier_score
-- that nothing ever populates.
--
-- Mock tier assignment: we don't have real fund-performance data, so tier is
-- derived from portfolio_size (a reasonable proxy for institutional scale —
-- larger, more active funds skew toward brand-name / top-tier). Firms with a
-- NULL portfolio_size default to tier 2 (neutral).

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS tier smallint CHECK (tier BETWEEN 1 AND 3);

WITH ranked AS (
  SELECT
    id,
    NTILE(3) OVER (ORDER BY portfolio_size DESC NULLS LAST) AS bucket
  FROM investors
  WHERE portfolio_size IS NOT NULL
)
UPDATE investors i
SET tier = ranked.bucket
FROM ranked
WHERE i.id = ranked.id
  AND i.tier IS NULL;

-- Firms with no portfolio_size at all: neutral tier
UPDATE investors SET tier = 2 WHERE tier IS NULL;

ALTER TABLE investors ALTER COLUMN tier SET DEFAULT 2;

CREATE INDEX IF NOT EXISTS idx_investors_name_lower ON investors (lower(name));
