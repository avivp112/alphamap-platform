-- Extend funding_rounds with valuation provenance and explicit lead investor.
ALTER TABLE funding_rounds
  ADD COLUMN IF NOT EXISTS is_valuation_estimated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_investor          text;

-- Extend startups with leadership roster and headcount trend.
-- leadership: JSONB array of { name: text, role: text }
-- growth_trend: one of "rapid growth" | "moderate growth" | "stable" | "reduction" | "unknown"
ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS leadership   jsonb,
  ADD COLUMN IF NOT EXISTS growth_trend text;
